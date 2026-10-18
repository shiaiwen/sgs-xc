/**
 * 更新提示控制器：拉取远程 manifest，维护 hasUpdate / 弹窗状态，
 * 支持「稍后」记下已忽略版本，以及打开下载页。
 */

import type { XiaochaoConfigStore } from '../../config/config-store';
import {
  compareVersions,
  getXiaochaoVersion,
  isNewerVersion,
  newerVersion,
  parseUpdateManifest,
  readUserscriptManagerVersion,
  XIAOCHAO_UPDATE_MANIFEST_URL,
  XIAOCHAO_UPDATE_PAGE_URL,
  type XiaochaoUpdateManifest
} from './update-manifest.ts';

export interface UpdateNoticeSnapshot {
  currentVersion: string;
  latestVersion: string | null;
  notes: string;
  pageUrl: string;
  hasUpdate: boolean;
  dialogOpen: boolean;
  failureMessage: string;
}

export interface UpdateNoticeController {
  getSnapshot(): UpdateNoticeSnapshot;
  subscribe(listener: (snapshot: UpdateNoticeSnapshot) => void): () => void;
  start(): void;
  checkNow(): Promise<UpdateNoticeSnapshot>;
  dismissDialog(): void;
  openUpdatePage(): Promise<void>;
  dispose(): void;
}

export interface UpdateNoticeControllerOptions {
  fetchImpl?: typeof fetch;
  currentVersion?: string;
  manifestUrl?: string;
  skipRemoteCheck?: boolean;
  /** electron 只认构建进脚本的版本。userscript 还认油猴已装版本，并在打开更新页后记下线上版本。 */
  platform?: 'electron' | 'userscript';
}

const DISMISSED_VERSION_KEY = 'update.dismissedVersion' as const;
const INSTALLED_VERSION_KEY = 'update.installedVersion' as const;

function createEmptySnapshot(currentVersion: string): UpdateNoticeSnapshot {
  return {
    currentVersion,
    latestVersion: null,
    notes: '',
    pageUrl: XIAOCHAO_UPDATE_PAGE_URL,
    hasUpdate: false,
    dialogOpen: false,
    failureMessage: ''
  };
}

/** 创建更新提示控制器（不自动请求；由 install / checkNow 触发）。 */
export function createUpdateNoticeController(
  configStore: XiaochaoConfigStore,
  openExternal: (url: string) => Promise<void>,
  options: UpdateNoticeControllerOptions = {}
): UpdateNoticeController {
  const manifestUrl = options.manifestUrl || XIAOCHAO_UPDATE_MANIFEST_URL;
  const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  const browserUpdate = options.platform === 'userscript';
  /**
   * 浏览器取构建版本、油猴已装版本、更新后记下的版本里较新的一个。
   * 微端只用构建进脚本的版本，不读壳版本，也不读浏览器记下的版本。
   */
  function readVersion(): string {
    const baked = options.currentVersion || getXiaochaoVersion();
    if (!browserUpdate) return baked;
    return newerVersion(
      newerVersion(baked, readUserscriptManagerVersion()),
      configStore.get(INSTALLED_VERSION_KEY)
    );
  }
  /** 浏览器打开更新页后，把线上脚本版本记成已安装，避免下次仍拿更新前的版本去比。 */
  function rememberInstalled(version: string): void {
    if (!browserUpdate) return;
    const next = String(version || '').trim();
    if (!/^\d+(?:\.\d+)*$/.test(next)) return;
    const previous = configStore.get(INSTALLED_VERSION_KEY);
    if (previous && compareVersions(next, previous) <= 0) return;
    configStore.set(INSTALLED_VERSION_KEY, next);
  }
  let snapshot = createEmptySnapshot(readVersion());
  const listeners = new Set<(next: UpdateNoticeSnapshot) => void>();
  let disposed = false;
  let checking = false;
  let queued = false;
  const cleanups: Array<() => void> = [];
  const waiters: Array<(snapshot: UpdateNoticeSnapshot) => void> = [];

  function emit(next: UpdateNoticeSnapshot): void {
    snapshot = next;
    listeners.forEach((listener) => listener(snapshot));
  }

  /** 「稍后」：记下 latestVersion 并关闭弹窗；角标仍由 hasUpdate 决定。 */
  function dismissDialog(): void {
    const latest = snapshot.latestVersion;
    if (latest) configStore.set(DISMISSED_VERSION_KEY, latest);
    if (snapshot.dialogOpen) emit({ ...snapshot, dialogOpen: false });
  }

  /** 用远程清单刷新快照。本地版本每次现读，浏览器更新记下来之后不再提示。 */
  function applyManifest(manifest: XiaochaoUpdateManifest): void {
    const currentVersion = readVersion();
    const hasUpdate = isNewerVersion(manifest.version, currentVersion);
    emit({
      currentVersion,
      latestVersion: manifest.version,
      notes: manifest.notes,
      pageUrl: manifest.pageUrl,
      hasUpdate,
      dialogOpen: false,
      failureMessage: ''
    });
  }

  /** 直接请求版本接口。 */
  async function checkRemote(): Promise<void> {
    if (!fetchImpl) {
      emit({ ...snapshot, failureMessage: '检查失败' });
      return;
    }
    try {
      const response = await fetchImpl(manifestUrl, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer'
      });
      if (disposed) return;
      if (!response.ok) {
        emit({ ...snapshot, failureMessage: '检查失败' });
        return;
      }
      const raw = await response.json();
      if (disposed) return;
      const manifest = parseUpdateManifest(raw);
      if (manifest) applyManifest(manifest);
      else emit({ ...snapshot, failureMessage: '检查失败' });
    } catch (error) {
      console.warn('[检查更新] 拉取失败:', error);
      if (!disposed) emit({ ...snapshot, failureMessage: '检查失败' });
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (disposed || options.skipRemoteCheck || typeof window === 'undefined') return;
      const run = () => {
        void this.checkNow();
      };
      const onVisible = () => {
        if (document.visibilityState === 'visible') run();
      };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', run);
      cleanups.push(() => document.removeEventListener('visibilitychange', onVisible));
      cleanups.push(() => window.removeEventListener('focus', run));
      run();
      const timer = window.setTimeout(run, 8000);
      cleanups.push(() => window.clearTimeout(timer));
    },
    async checkNow() {
      if (disposed || options.skipRemoteCheck) return snapshot;
      if (checking) {
        queued = true;
        return new Promise((resolve) => {
          waiters.push(resolve);
        });
      }
      checking = true;
      try {
        do {
          queued = false;
          await checkRemote();
        } while (queued && !disposed);
      } finally {
        checking = false;
        const pending = waiters.splice(0);
        pending.forEach((resolve) => resolve(snapshot));
      }
      return snapshot;
    },
    dismissDialog() {
      dismissDialog();
    },
    async openUpdatePage() {
      const url = snapshot.pageUrl || XIAOCHAO_UPDATE_PAGE_URL;
      try {
        await openExternal(url);
      } catch {
        if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
      }
      rememberInstalled(snapshot.latestVersion || '');
      const currentVersion = readVersion();
      const latest = snapshot.latestVersion;
      emit({
        ...snapshot,
        currentVersion,
        hasUpdate: latest ? isNewerVersion(latest, currentVersion) : false,
        dialogOpen: false,
        failureMessage: ''
      });
      dismissDialog();
    },
    dispose() {
      disposed = true;
      queued = false;
      cleanups.splice(0).forEach((cleanup) => cleanup());
      listeners.clear();
    }
  };
}

/** 安装并 start 更新提示控制器，供工具 Tab 角标与弹窗使用。 */
export function installUpdateNoticeController(
  configStore: XiaochaoConfigStore,
  openExternal: (url: string) => Promise<void>,
  options: UpdateNoticeControllerOptions = {}
): UpdateNoticeController {
  const controller = createUpdateNoticeController(configStore, openExternal, options);
  controller.start();
  return controller;
}

/**
 * 更新提示控制器：拉取远程 manifest，维护 hasUpdate / 弹窗状态，
 * 支持「稍后」记下已忽略版本，以及打开下载页。
 * 能在后台自动换上新版时不提示；自动换不了或者微端外壳要换时才亮「去更新」。
 */

import type { PlatformAdapter, UpdatePackageRequest } from '../../adapters/platform';
import type { XiaochaoConfigStore } from '../../config/config-store';
import { UPDATE_DONE_TOAST_MS } from '../../const/update-reload.ts';
import { showToast } from '../../ui/toast/show-toast.ts';
import {
  createAutoUpdateCoordinator,
  IDLE_AUTO_UPDATE,
  type AutoUpdateAssessment,
  type AutoUpdateCoordinator,
  type AutoUpdatePhase
} from './auto-update-coordinator.ts';
import {
  migrateUpdateDeviceStateFromLegacy,
  readUpdateDeviceState,
  rememberDismissedVersion,
  rememberInstalledVersion
} from './update-device-state.ts';
import {
  getXiaochaoVersion,
  isNewerVersion,
  newerVersion,
  parseUpdateManifest,
  readUserscriptManagerVersion,
  XIAOCHAO_UPDATE_MANIFEST_URL,
  XIAOCHAO_UPDATE_PAGE_URL,
  type XiaochaoUpdateManifest
} from './update-manifest.ts';
import { createUpdateReloadSafetyCheck } from './update-reload-safety.ts';

export interface UpdateNoticeSnapshot {
  currentVersion: string;
  latestVersion: string | null;
  notes: string;
  pageUrl: string;
  hasUpdate: boolean;
  /** 自动更新进行到哪一步；线上没有更新的版本时为 idle。 */
  autoUpdate: AutoUpdatePhase;
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
  /** 新版已经下好时立刻刷新游戏页；现在刷新会打断玩家就不刷，返回是否刷新了。 */
  applyUpdateNow(): boolean;
  dispose(): void;
}

export interface UpdateNoticeControllerOptions {
  fetchImpl?: typeof fetch;
  currentVersion?: string;
  manifestUrl?: string;
  skipRemoteCheck?: boolean;
  /** electron 只认构建进脚本的版本。userscript 还认油猴已装版本，并在打开更新页后记下线上版本。 */
  platform?: 'electron' | 'userscript';
  /** 后台准备新版、等空档刷新；不传时有新版就提示手动更新。 */
  autoUpdate?: AutoUpdateCoordinator;
}

/** 没有自动更新时，有新版就要玩家手动装。 */
const MANUAL_ONLY: AutoUpdateAssessment = { phase: 'unavailable', manualRequired: false };

function createEmptySnapshot(currentVersion: string): UpdateNoticeSnapshot {
  return {
    currentVersion,
    latestVersion: null,
    notes: '',
    pageUrl: XIAOCHAO_UPDATE_PAGE_URL,
    hasUpdate: false,
    autoUpdate: 'idle',
    dialogOpen: false,
    failureMessage: ''
  };
}

function toUpdatePackageRequest(manifest: XiaochaoUpdateManifest): UpdatePackageRequest {
  return {
    version: manifest.version,
    userscriptPayloadUrl: manifest.userscriptPayloadUrl,
    userscriptPayloadSha256: manifest.userscriptPayloadSha256
  };
}

/** 创建更新提示控制器（不自动请求；由 install / checkNow 触发）。 */
export function createUpdateNoticeController(
  openExternal: (url: string) => Promise<void>,
  options: UpdateNoticeControllerOptions = {}
): UpdateNoticeController {
  const manifestUrl = options.manifestUrl || XIAOCHAO_UPDATE_MANIFEST_URL;
  const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  const browserUpdate = options.platform === 'userscript';
  const autoUpdate = options.autoUpdate;
  /** 正在运行的这份小抄的版本，自动更新只拿它和线上比。 */
  function readRunningVersion(): string {
    return options.currentVersion || getXiaochaoVersion();
  }
  /**
   * 浏览器取构建版本、油猴已装版本、更新后记下的版本里较新的一个。
   * 微端只用构建进脚本的版本，不读壳版本，也不读浏览器记下的版本。
   */
  function readVersion(): string {
    const baked = readRunningVersion();
    if (!browserUpdate) return baked;
    return newerVersion(
      newerVersion(baked, readUserscriptManagerVersion()),
      readUpdateDeviceState().installedVersion
    );
  }
  /** 浏览器打开更新页后，把线上脚本版本记成已安装，避免下次仍拿更新前的版本去比。 */
  function rememberInstalled(version: string): void {
    if (!browserUpdate) return;
    rememberInstalledVersion(version);
  }
  let snapshot = createEmptySnapshot(readVersion());
  const listeners = new Set<(next: UpdateNoticeSnapshot) => void>();
  let disposed = false;
  let checking = false;
  let queued = false;
  let latestManifest: XiaochaoUpdateManifest | null = null;
  let autoAssessment = IDLE_AUTO_UPDATE;
  const cleanups: Array<() => void> = [];
  const waiters: Array<(snapshot: UpdateNoticeSnapshot) => void> = [];

  function emit(next: UpdateNoticeSnapshot): void {
    snapshot = next;
    listeners.forEach((listener) => listener(snapshot));
  }

  /** 「稍后」：记下 latestVersion 并关闭弹窗；角标仍由 hasUpdate 决定。 */
  function dismissDialog(): void {
    const latest = snapshot.latestVersion;
    if (latest) rememberDismissedVersion(latest);
    if (snapshot.dialogOpen) emit({ ...snapshot, dialogOpen: false });
  }

  /** 线上版本比显示的版本新，并且自动更新换不上或者还要手动装外壳时，才亮「去更新」。 */
  function snapshotFromManifest(manifest: XiaochaoUpdateManifest): UpdateNoticeSnapshot {
    const currentVersion = readVersion();
    const newer = isNewerVersion(manifest.version, currentVersion);
    const assessment = autoUpdate ? autoAssessment : MANUAL_ONLY;
    const needsManual = assessment.phase === 'unavailable' || assessment.manualRequired;
    return {
      currentVersion,
      latestVersion: manifest.version,
      notes: manifest.notes,
      pageUrl: manifest.pageUrl,
      hasUpdate: newer && needsManual,
      autoUpdate: newer ? assessment.phase : 'idle',
      dialogOpen: false,
      failureMessage: ''
    };
  }

  /** 用远程清单刷新快照。本地版本每次现读，浏览器更新记下来之后不再提示。 */
  async function applyManifest(manifest: XiaochaoUpdateManifest): Promise<void> {
    const assessment = autoUpdate && isNewerVersion(manifest.version, readRunningVersion())
      ? await autoUpdate.assess(toUpdatePackageRequest(manifest))
      : IDLE_AUTO_UPDATE;
    if (disposed) return;
    latestManifest = manifest;
    autoAssessment = assessment;
    emit(snapshotFromManifest(manifest));
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
      if (manifest) await applyManifest(manifest);
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
      if (autoUpdate) {
        autoUpdate.start();
        cleanups.push(autoUpdate.subscribe((assessment) => {
          autoAssessment = assessment;
          if (latestManifest) emit({ ...snapshotFromManifest(latestManifest), dialogOpen: snapshot.dialogOpen });
        }));
      }
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
      emit(latestManifest
        ? snapshotFromManifest(latestManifest)
        : { ...snapshot, currentVersion: readVersion(), hasUpdate: false, dialogOpen: false, failureMessage: '' });
      dismissDialog();
    },
    applyUpdateNow() {
      return autoUpdate?.applyNow() ?? false;
    },
    dispose() {
      disposed = true;
      queued = false;
      cleanups.splice(0).forEach((cleanup) => cleanup());
      autoUpdate?.dispose();
      listeners.clear();
    }
  };
}

/** 安装并 start 更新提示控制器，供工具 Tab 角标、版本入口和无感更新使用。 */
export function installUpdateNoticeController(
  configStore: XiaochaoConfigStore,
  platform: PlatformAdapter
): UpdateNoticeController {
  migrateUpdateDeviceStateFromLegacy(configStore);
  const autoUpdate = createAutoUpdateCoordinator({
    runningVersion: getXiaochaoVersion(),
    stageUpdate: (request) => platform.stageUpdate(request),
    canReload: window.top === window,
    isReloadSafe: createUpdateReloadSafetyCheck(),
    reload: () => window.location.reload(),
    notifyUpdated: (version) => showToast(`小抄已更新到 ${version}`, 'success', UPDATE_DONE_TOAST_MS)
  });
  const controller = createUpdateNoticeController((url) => platform.openExternal(url), {
    platform: platform.platform,
    autoUpdate
  });
  controller.start();
  return controller;
}

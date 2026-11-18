/**
 * 无感更新：平台在后台把新版准备好，等玩家不在打牌时把游戏页刷新一次。
 * 窗口在后台时直接刷新；在前台要等玩家一段时间没动鼠标键盘。
 * 每一页对同一个版本只刷新一次；刷新后没换成新版，就改成提示玩家手动更新。
 */
import type { StagedUpdateReport, UpdatePackageRequest } from '../../adapters/platform';
import {
  UPDATE_PREPARE_GRACE_MS,
  UPDATE_PREPARE_POLL_MS,
  UPDATE_RELOAD_CHECK_MS,
  UPDATE_RELOAD_FOREGROUND_IDLE_MS,
  UPDATE_RELOAD_SESSION_KEY,
  UPDATE_RELOAD_STABLE_CHECKS
} from '../../const/update-reload.ts';
import { everyInterval } from '../../runtime/shared-ticker.ts';
import { compareVersions } from './update-manifest.ts';

const RELOAD_CHECK_LABEL = '无感更新刷新检查';
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const;

/**
 * idle：没有新版；preparing：后台在下；ready：下好了，等空档刷新；
 * staged：下好了，但这一页不能由小抄刷新，玩家下次打开或自己刷新网页时换上；
 * unavailable：这个环境自动换不了或者失败了，要玩家手动更新。
 */
export type AutoUpdatePhase = 'idle' | 'preparing' | 'ready' | 'staged' | 'unavailable';

export interface AutoUpdateAssessment {
  phase: AutoUpdatePhase;
  /** 除了自动换脚本，还得玩家手动装一次，例如微端外壳要换。 */
  manualRequired: boolean;
}

export const IDLE_AUTO_UPDATE: AutoUpdateAssessment = { phase: 'idle', manualRequired: false };

export interface AutoUpdateCoordinator {
  /** 页面启动时调用：刚为新版刷新过的，提示已更新。 */
  start(): void;
  /** 线上版本比正在运行的新时调用，可以反复调用。 */
  assess(request: UpdatePackageRequest): Promise<AutoUpdateAssessment>;
  /** 新版已下好、现在刷新又不会打断玩家时立刻刷新，返回是否刷新了。 */
  applyNow(): boolean;
  /** 后台继续询问下载进度后状态变了时通知。 */
  subscribe(listener: (assessment: AutoUpdateAssessment) => void): () => void;
  dispose(): void;
}

export interface AutoUpdateCoordinatorOptions {
  /** 正在运行的小抄版本。 */
  runningVersion: string;
  stageUpdate(request: UpdatePackageRequest): Promise<StagedUpdateReport>;
  /**
   * 小抄能不能自己刷新这一页。游戏嵌在平台网页里时只能刷新游戏那一块，
   * 平台给的登录参数可能已经过期，刷了可能进不去，这时不刷。
   */
  canReload: boolean;
  /** 现在刷新会不会打断玩家。 */
  isReloadSafe(): boolean;
  reload(): void;
  /** 刷新后换上新版时调用，用来提示玩家。 */
  notifyUpdated(version: string): void;
}

interface ReloadRecord {
  version: string;
  /** true：刚为这一版刷新，还没确认换上；false：刷新过，但没换上。 */
  pending: boolean;
}

const UNSUPPORTED_REPORT: StagedUpdateReport = {
  supported: false,
  stagedVersion: '',
  failed: false,
  manualRequired: false
};

export function createAutoUpdateCoordinator(options: AutoUpdateCoordinatorOptions): AutoUpdateCoordinator {
  const listeners = new Set<(assessment: AutoUpdateAssessment) => void>();
  const firstSeenAt = new Map<string, number>();
  const cleanups: Array<() => void> = [];
  let disposed = false;
  let current = IDLE_AUTO_UPDATE;
  let latestRequest: UpdatePackageRequest | null = null;
  let pollTimer: number | undefined;
  let readyVersion = '';
  let stopWatching: (() => void) | null = null;
  let stableChecks = 0;
  let lastInputAt = Date.now();
  /** 会话存储写不进去时没法保证只刷新一次，干脆不自动刷新。 */
  let reloadRecordUnwritable = false;

  function clearPoll(): void {
    if (pollTimer === undefined) return;
    window.clearTimeout(pollTimer);
    pollTimer = undefined;
  }

  function schedulePoll(): void {
    clearPoll();
    pollTimer = window.setTimeout(() => {
      pollTimer = undefined;
      const request = latestRequest;
      if (!request || disposed) return;
      void evaluate(request).then((next) => {
        if (disposed) return;
        const changed = next.phase !== current.phase || next.manualRequired !== current.manualRequired;
        current = next;
        if (changed) listeners.forEach((listener) => listener(current));
      });
    }, UPDATE_PREPARE_POLL_MS);
  }

  async function evaluate(request: UpdatePackageRequest): Promise<AutoUpdateAssessment> {
    if (!firstSeenAt.has(request.version)) firstSeenAt.set(request.version, Date.now());
    let report: StagedUpdateReport;
    try {
      report = await options.stageUpdate(request);
    } catch (error) {
      console.warn('[xiaochao] 准备新版失败', error);
      report = UNSUPPORTED_REPORT;
    }
    if (disposed) return IDLE_AUTO_UPDATE;
    return decide(request, report);
  }

  function decide(request: UpdatePackageRequest, report: StagedUpdateReport): AutoUpdateAssessment {
    const manualRequired = report.manualRequired;
    clearPoll();
    const attempted = readReloadRecord();
    const reloadedWithoutEffect = attempted !== null && !attempted.pending
      && compareVersions(request.version, attempted.version) <= 0;
    if (reloadedWithoutEffect || reloadRecordUnwritable || !report.supported || report.failed) {
      stopReloadWatch();
      return { phase: 'unavailable', manualRequired };
    }
    if (report.stagedVersion && compareVersions(report.stagedVersion, request.version) >= 0) {
      if (!options.canReload) return { phase: 'staged', manualRequired };
      watchForReload(report.stagedVersion);
      return { phase: 'ready', manualRequired };
    }
    if (Date.now() - (firstSeenAt.get(request.version) ?? Date.now()) >= UPDATE_PREPARE_GRACE_MS) {
      return { phase: 'unavailable', manualRequired };
    }
    schedulePoll();
    return { phase: 'preparing', manualRequired };
  }

  function watchForReload(version: string): void {
    readyVersion = version;
    if (stopWatching) return;
    stableChecks = 0;
    lastInputAt = Date.now();
    const markInput = () => {
      lastInputAt = Date.now();
    };
    INPUT_EVENTS.forEach((name) => window.addEventListener(name, markInput, { capture: true, passive: true }));
    const stopTicker = everyInterval(RELOAD_CHECK_LABEL, UPDATE_RELOAD_CHECK_MS, checkReload);
    stopWatching = () => {
      stopTicker();
      INPUT_EVENTS.forEach((name) => window.removeEventListener(name, markInput, { capture: true }));
      stopWatching = null;
    };
  }

  function stopReloadWatch(): void {
    readyVersion = '';
    stopWatching?.();
  }

  function checkReload(): void {
    const away = document.visibilityState === 'hidden'
      || Date.now() - lastInputAt >= UPDATE_RELOAD_FOREGROUND_IDLE_MS;
    if (!readyVersion || !away || !options.isReloadSafe()) {
      stableChecks = 0;
      return;
    }
    stableChecks += 1;
    if (stableChecks >= UPDATE_RELOAD_STABLE_CHECKS) reloadNow();
  }

  function reloadNow(): boolean {
    if (!writeReloadRecord({ version: readyVersion, pending: true })) {
      reloadRecordUnwritable = true;
      stopReloadWatch();
      return false;
    }
    stopReloadWatch();
    options.reload();
    return true;
  }

  /** 刷新时玩家多半不在跟前，等页面在前台、玩家动了鼠标或键盘再提示，免得提示自己消失了也没人看见。 */
  function notifyWhenSeen(version: string): void {
    const stop = () => {
      INPUT_EVENTS.forEach((name) => window.removeEventListener(name, notify, { capture: true }));
    };
    const notify = () => {
      if (document.visibilityState === 'hidden') return;
      stop();
      options.notifyUpdated(version);
    };
    INPUT_EVENTS.forEach((name) => window.addEventListener(name, notify, { capture: true, passive: true }));
    cleanups.push(stop);
  }

  return {
    start() {
      const record = readReloadRecord();
      if (!record?.pending) return;
      if (compareVersions(options.runningVersion, record.version) >= 0) {
        clearReloadRecord();
        notifyWhenSeen(options.runningVersion);
        return;
      }
      writeReloadRecord({ version: record.version, pending: false });
    },
    async assess(request) {
      latestRequest = request;
      const next = await evaluate(request);
      if (!disposed) current = next;
      return next;
    },
    applyNow() {
      if (disposed || !readyVersion || !options.isReloadSafe()) return false;
      return reloadNow();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      clearPoll();
      stopReloadWatch();
      cleanups.splice(0).forEach((cleanup) => cleanup());
      listeners.clear();
    }
  };
}

function readReloadRecord(): ReloadRecord | null {
  try {
    const raw = sessionStorage.getItem(UPDATE_RELOAD_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version?: unknown; pending?: unknown } | null;
    if (typeof parsed?.version !== 'string' || !parsed.version) return null;
    return { version: parsed.version, pending: parsed.pending === true };
  } catch {
    return null;
  }
}

function writeReloadRecord(record: ReloadRecord): boolean {
  try {
    sessionStorage.setItem(UPDATE_RELOAD_SESSION_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

function clearReloadRecord(): void {
  try {
    sessionStorage.removeItem(UPDATE_RELOAD_SESSION_KEY);
  } catch {
    // 会话存储不可用时下次也读不到这条记录。
  }
}

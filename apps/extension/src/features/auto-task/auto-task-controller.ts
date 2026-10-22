/**
 * 自动任务总控：按日状态机驱动领取流程，协调 runner / claims / windows。
 */

import type { CardConfigSource } from '../../adapters/card-config-source.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { resolveGameAccountId } from '../../runtime/game-account-session.ts';
import {
  accountScopedStorageKey,
  accountStorageKey,
  createTaskScope,
  watchSceneSwitch
} from '../skin-background/skin-runtime.ts';
import { beijingDayIndex, createAutoTaskClaims } from './auto-task-claims.ts';
import { createAutoTaskRunner, type AutoTaskOptions } from './auto-task-runner.ts';
import { ALL_AUTO_TASK_KEYS, AUTO_TASK_ENABLED_KEY } from './auto-task-settings.ts';
import { mountAutoTaskProbe, probeAutoTaskRuntime } from './auto-task-probe.ts';
import type { TaskRuleContext } from './auto-task-rules.ts';
import { createAutoTaskWindows } from './auto-task-windows.ts';

export type AutoTaskReason = 'login' | 'gameEnd' | 'postGame' | 'switch' | 'tavern' | 'heartbeat' | 'auto' | 'timer';

export interface AutoTaskPayload {
  reason: string;
  postGame: boolean;
  daily: boolean;
  login: boolean;
}

export type AutoTaskPhase = 'idle' | 'waiting' | 'running';

export interface AutoTaskStatus {
  phase: AutoTaskPhase;
  lastReason: string;
  lastStartedAt: number;
  lastFinishedAt: number;
  message: string;
}

export interface AutoTaskController {
  schedule(reason?: AutoTaskReason, force?: boolean): boolean;
  getStatus(): AutoTaskStatus;
  subscribe(listener: (status: AutoTaskStatus) => void): () => void;
  dispose(): void;
}

export interface AutoTaskControllerOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  cardConfigSource?: Pick<CardConfigSource, 'getAutoTaskData'>;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => number;
}

const PASS_DELAYS = [1000, 5000, 20000];
const GUARD_EXTRA_MS = 20000;
const POST_GAME_THROTTLE_MS = 30000;
const MANAGER_WAIT_ATTEMPTS = 30;
const MANAGER_WAIT_INTERVAL = 1000;
const SCHEDULE_DELAY_MS = 2000;
const ACCOUNT_POLL_MS = 1000;
const PERIODIC_AUTO_TASK_MS = 10 * 60 * 1000;
const PERIODIC_AUTO_TASK_FIRST_MS = 90 * 1000;
const LAST_TASK_DATE_KEY = 'XC::lastTaskDate';

/**
 * 自动领取：登录、局结束、开关、跨天心跳、定时补领等时机调度一轮任务、活动、邮件、福利等。
 */
export function installAutoTaskController(
  configStore: XiaochaoConfigStore,
  gameEvents: GameEventBus,
  options: AutoTaskControllerOptions = {}
): AutoTaskController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const storage = options.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
  const now = options.now ?? Date.now;
  const tasks = createTaskScope();
  const patcher = createMethodPatcher();
  const windows = createAutoTaskWindows(globalObject, locator, tasks);
  const claims = createAutoTaskClaims(storage, () => accountStorageKey(storage), now);
  const listeners = new Set<(status: AutoTaskStatus) => void>();
  const unsubscribes: Array<() => void> = [];

  let status: AutoTaskStatus = {
    phase: 'idle',
    lastReason: '',
    lastStartedAt: 0,
    lastFinishedAt: 0,
    message: '未运行'
  };
  let running = false;
  let runningUntil = 0;
  let pending: AutoTaskPayload | null = null;
  let postGameScheduledAt = 0;
  let lastDayIndex = readStoredDayIndex();
  let loginAccountId = '';
  let lastPeriodicScheduleAt = 0;

  function probeRuleContext(): TaskRuleContext {
    const data = options.cardConfigSource?.getAutoTaskData() ?? null;
    return {
      skipTavern: configStore.get('autoTask.skipTavern'),
      skipDiJiaQuan: configStore.get('autoTask.skipDiJiaQuan'),
      skipHuanLeDou: configStore.get('autoTask.skipHuanLeDou'),
      taskIds: data?.taskIds ?? null,
      newFuliTaskIds: data?.newFuliTaskIds ?? null,
      returnUnlockTaskIds: data?.returnUnlockTaskIds ?? null,
      goodsName: () => '',
      goodsHasPropItem: () => false
    };
  }

  const runner = createAutoTaskRunner({
    locator,
    windows,
    claims,
    tasks,
    enabled: () => configStore.get(AUTO_TASK_ENABLED_KEY),
    options: readOptions,
    configData: () => options.cardConfigSource?.getAutoTaskData() ?? null
  });

  try {
    mountAutoTaskProbe(globalObject as Window, () => probeAutoTaskRuntime(
      locator,
      options.cardConfigSource?.getAutoTaskData() ?? null,
      probeRuleContext()
    ));
  } catch (error) {
    console.warn('[自动领取] 探测接口挂载失败:', error);
  }

  function readOptions(): AutoTaskOptions {
    return {
      skipTavern: configStore.get('autoTask.skipTavern'),
      skipMail: configStore.get('autoTask.skipMail'),
      skipDailyGeneralBag: configStore.get('autoTask.skipDailyGeneralBag'),
      skipSignTrialCard: configStore.get('autoTask.skipSignTrialCard'),
      skipDiJiaQuan: configStore.get('autoTask.skipDiJiaQuan'),
      skipHuanLeDou: configStore.get('autoTask.skipHuanLeDou'),
      skipFreeBless: configStore.get('autoTask.skipFreeBless')
    };
  }

  function setStatus(patch: Partial<AutoTaskStatus>): void {
    status = { ...status, ...patch };
    listeners.forEach((listener) => {
      try {
        listener(status);
      } catch (error) {
        console.warn('[自动领取] 状态订阅失败:', error);
      }
    });
  }

  function readStoredDayIndex(): number {
    try {
      const key = accountScopedStorageKey(LAST_TASK_DATE_KEY, storage);
      const owned = storage?.getItem(key);
      const raw = owned ?? storage?.getItem(LAST_TASK_DATE_KEY);
      if (!owned && raw) {
        storage?.setItem(key, raw);
        storage?.removeItem(LAST_TASK_DATE_KEY);
      }
      const value = raw === null || raw === undefined ? Number.NaN : Number(JSON.parse(raw));
      return Number.isFinite(value) ? value : -1;
    } catch {
      return -1;
    }
  }

  function writeStoredDayIndex(day: number): void {
    try {
      storage?.setItem(accountScopedStorageKey(LAST_TASK_DATE_KEY, storage), JSON.stringify(day));
    } catch {
      // 存储不可用时仅靠内存跨天检测。
    }
  }

  function managersReady(): boolean {
    return Boolean(locator.dispatcher() && locator.manager('TaskManager') && locator.manager('ActivityManager'));
  }

  function mergePayload(left: AutoTaskPayload | null, right: AutoTaskPayload): AutoTaskPayload {
    if (!left) return right;
    const daily = left.daily || right.daily;
    return {
      reason: [left.reason, right.reason].filter(Boolean).join('+') || 'auto',
      postGame: Boolean(left.postGame && right.postGame && !daily),
      daily,
      login: left.login || right.login
    };
  }

  function buildPayload(reason: AutoTaskReason): AutoTaskPayload {
    return {
      reason,
      postGame: reason === 'postGame',
      daily: true,
      login: reason === 'login'
    };
  }

  function queuePending(payload: AutoTaskPayload): void {
    pending = mergePayload(pending, payload);
    const wait = Math.max(1000, runningUntil - now() + 500);
    tasks.later(() => {
      const next = pending;
      pending = null;
      if (next && configStore.get(AUTO_TASK_ENABLED_KEY)) startRun(next);
    }, wait);
  }

  function startRun(payload: AutoTaskPayload): void {
    if (!configStore.get(AUTO_TASK_ENABLED_KEY) || tasks.disposed) return;
    if (running) {
      queuePending(payload);
      return;
    }
    if (!managersReady()) {
      setStatus({ phase: 'waiting', lastReason: payload.reason, message: '等待管理器就绪' });
      return;
    }
    const guardMs = PASS_DELAYS[PASS_DELAYS.length - 1] + GUARD_EXTRA_MS;
    running = true;
    runningUntil = now() + guardMs;
    setStatus({
      phase: 'running',
      lastReason: payload.reason,
      lastStartedAt: now(),
      message: `运行中（${payload.reason}）`
    });
    tasks.later(() => {
      running = false;
      runningUntil = 0;
      setStatus({
        phase: 'idle',
        lastFinishedAt: now(),
        message: pending ? '排队等待下一轮' : '本轮结束'
      });
    }, guardMs);
    if (!configStore.get('autoTask.skipDailyGeneralBag')) runner.claimDailyGeneralBag();
    PASS_DELAYS.forEach((delay) => {
      tasks.later(() => {
        if (!configStore.get(AUTO_TASK_ENABLED_KEY) || tasks.disposed) return;
        runner.runPass();
      }, delay);
    });
  }

  function schedule(reason: AutoTaskReason = 'auto', force = false): boolean {
    if (!configStore.get(AUTO_TASK_ENABLED_KEY)) return false;
    const payload = buildPayload(reason);
    if (reason === 'postGame') {
      const time = now();
      if (postGameScheduledAt && time - postGameScheduledAt < POST_GAME_THROTTLE_MS) return false;
      postGameScheduledAt = time;
    }
    if (!force && running) return false;
    setStatus({ phase: 'waiting', lastReason: reason, message: `已调度（${reason}）` });
    tasks.later(async () => {
      if (!configStore.get(AUTO_TASK_ENABLED_KEY) || tasks.disposed) return;
      const ready = await tasks.poll(() => managersReady() || null, MANAGER_WAIT_ATTEMPTS, MANAGER_WAIT_INTERVAL);
      if (ready && configStore.get(AUTO_TASK_ENABLED_KEY)) startRun(payload);
      else if (!tasks.disposed) setStatus({ phase: 'idle', message: '管理器未就绪，本轮取消' });
    }, SCHEDULE_DELAY_MS);
    return true;
  }

  function onCrossDay(reason: AutoTaskReason): void {
    const day = beijingDayIndex(now());
    if (day === lastDayIndex) return;
    lastDayIndex = day;
    writeStoredDayIndex(day);
    if (configStore.get(AUTO_TASK_ENABLED_KEY)) schedule(reason, true);
  }

  // 账号到了领一轮。同一账号不重复领，换号再领。
  function noteAccountArrival(): void {
    const id = resolveGameAccountId(globalObject, locator);
    if (!id || id === loginAccountId) return;
    loginAccountId = id;
    if (configStore.get(AUTO_TASK_ENABLED_KEY)) schedule('login', true);
  }

  function periodicAutoTask(): void {
    if (!configStore.get(AUTO_TASK_ENABLED_KEY) || tasks.disposed) return;
    if (!resolveGameAccountId(globalObject, locator)) return;
    const time = now();
    if (lastPeriodicScheduleAt && time - lastPeriodicScheduleAt < PERIODIC_AUTO_TASK_MS) return;
    if (status.phase === 'running') return;
    if (schedule('timer', false)) lastPeriodicScheduleAt = time;
  }

  function armPeriodicAutoTask(delayMs = PERIODIC_AUTO_TASK_FIRST_MS): void {
    tasks.later(() => {
      periodicAutoTask();
      if (!tasks.disposed) armPeriodicAutoTask(PERIODIC_AUTO_TASK_MS);
    }, delayMs);
  }

  function watchAccount(): void {
    noteAccountArrival();
    tasks.later(watchAccount, ACCOUNT_POLL_MS);
  }

  function onGameEnded(): void {
    if (!configStore.get(AUTO_TASK_ENABLED_KEY)) return;
    const day = beijingDayIndex(now());
    if (lastDayIndex !== day) {
      lastDayIndex = day;
      writeStoredDayIndex(day);
      schedule('gameEnd', true);
    } else {
      schedule('postGame', true);
    }
  }

  const onAutoTaskConfigReady = () => {
    if (configStore.get(AUTO_TASK_ENABLED_KEY)) schedule('auto', true);
  };
  globalObject.addEventListener?.('xiaochao-autotask-config', onAutoTaskConfigReady);
  unsubscribes.push(() => globalObject.removeEventListener?.('xiaochao-autotask-config', onAutoTaskConfigReady));

  watchAccount();
  armPeriodicAutoTask();

  if (configStore.get(AUTO_TASK_ENABLED_KEY) && resolveGameAccountId(globalObject, locator)) {
    tasks.later(() => {
      if (!configStore.get(AUTO_TASK_ENABLED_KEY) || tasks.disposed) return;
      if (!resolveGameAccountId(globalObject, locator)) return;
      schedule('auto', true);
    }, SCHEDULE_DELAY_MS);
  }

  unsubscribes.push(gameEvents.subscribe((event) => {
    if (event.type === 'game-ended') onGameEnded();
    // 心跳到达后按北京时间看日期。变了才领，并写入 XC::lastTaskDate。
    if (event.type === 'heart-alive') onCrossDay('heartbeat');
  }));

  ALL_AUTO_TASK_KEYS.forEach((key) => {
    unsubscribes.push(configStore.subscribe(key, ({ value, previousValue }) => {
      if (key === AUTO_TASK_ENABLED_KEY && value === true && value !== previousValue) {
        schedule('switch', true);
      }
      if (key === 'autoTask.skipTavern' && value === false && configStore.get(AUTO_TASK_ENABLED_KEY)) {
        schedule('tavern', true);
      }
      if (key === 'autoTask.skipFreeBless' && value === false && configStore.get(AUTO_TASK_ENABLED_KEY)) {
        schedule('switch', true);
      }
    }));
  });

  watchSceneSwitch(locator, patcher, tasks, () => {
    if (configStore.get(AUTO_TASK_ENABLED_KEY)) runner.scheduleLowBeanFree('scene');
  });

  return {
    schedule,
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      unsubscribes.length = 0;
      listeners.clear();
      windows.dispose();
      patcher.restoreAll();
      tasks.dispose();
      running = false;
      pending = null;
      setStatus({ phase: 'idle', message: '已卸载' });
      const host = globalObject as Window & {
        __XC_PROBE_AUTO_TASK__?: () => unknown;
        __xcProbeAutoTask?: () => unknown;
      };
      delete host.__XC_PROBE_AUTO_TASK__;
      delete host.__xcProbeAutoTask__;
      const bridge = (globalObject as unknown as Record<string, unknown>).__XIAOCHAO_ENGINEERING__;
      if (bridge && typeof bridge === 'object') delete (bridge as Record<string, unknown>).probeAutoTask;
    }
  };
}

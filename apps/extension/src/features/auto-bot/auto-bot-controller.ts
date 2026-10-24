/**
 * 自动托管总控：按轮询驱动大厅/房间/对局流程，并改写部分协议以配合托管。
 *
 * 依赖配置项 assist.autoBotEnabled / 百胜 / 酒馆目标；与自动换将（auto-hg）互斥协调。
 * filterMessage 供消息源在游戏处理前改写 payload。
 */

import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import { accountScopedStorageKey } from '../skin-background/skin-runtime.ts';
import {
  AUTO_BOT_ENABLED_KEY,
  AUTO_LOG_ENABLED_KEY,
  AUTO_BOT_TAVERN_TARGET_KEY,
  AUTO_HG_ENABLED_KEY,
  BAI_SHENG_ENABLED_KEY
} from '../extra-assist/extra-assist-settings.ts';
import { RESTART_DELAY_MS } from '../auto-hg/auto-hg-actions.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import { DEAL_INTERVAL_MS } from './auto-bot-actions.ts';
import { tryBaiShengDianjiang, readAchList, unfinishedBaiShengIds } from './auto-bot-baisheng.ts';
import {
  leaveGameAfterDeath,
  readIdentitySeatStates,
  readSeatAiFlags,
  readSelfSeatId,
  shouldLeaveAfterDeath,
  shouldLeaveWhenRebelTeamDead
} from './auto-bot-leave.ts';
import { emptyRoomSession, runAutoBotHall, runAutoBotTable, type AutoBotRoomSession } from './auto-bot-rooms.ts';
import { runAutoBotDeal, type AutoBotPlayContext } from './auto-bot-play.ts';
import {
  readTavernProgress,
  requestTavernProgress,
  tavernStatusText,
  type TavernProgress
} from './auto-bot-tavern.ts';
import {
  clickFirstGeneral,
  findGeneralWindows,
  handleExtraBotWindows,
  handlePlayWindows
} from './auto-bot-windows.ts';

type UnknownRecord = Record<string, unknown>;

const STATE_KEY = 'XC_AUTO_BOT_STATE';
const SESSION_KEY = 'XC_AUTO_BOT_SESSION';
const LEAVE_DELAY_MS = 5000;
const TAVERN_POLL_MS = 5000;

export interface AutoBotStatus {
  tavernText: string;
  managedRoom: boolean;
  kind: number;
}

export interface AutoBotController {
  dispose(): void;
  filterMessage(payload: UnknownRecord, className: string): void;
  getStatus(): AutoBotStatus;
}

export interface AutoBotControllerOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  gameEvents?: GameEventBus;
  pollIntervalMs?: number;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

function persistEnabled(globalObject: LayaRuntimeWindow, enabled: boolean): void {
  try {
    const key = accountScopedStorageKey(STATE_KEY, globalObject.localStorage);
    if (enabled) globalObject.localStorage?.setItem?.(key, '1');
    else globalObject.localStorage?.removeItem?.(key);
  } catch {
    // 忽略异常
  }
}

function sessionStorageKey(globalObject: LayaRuntimeWindow): string {
  return accountScopedStorageKey(SESSION_KEY, globalObject.localStorage);
}

function persistSession(globalObject: LayaRuntimeWindow, session: AutoBotRoomSession): void {
  try {
    globalObject.localStorage?.setItem?.(sessionStorageKey(globalObject), JSON.stringify({
      managedRoom: session.managedRoom,
      kind: session.kind,
      baiShengGeneralId: session.baiShengGeneralId,
      aiPromptDone: session.aiPromptDone
    }));
  } catch {
    // 忽略异常
  }
}

function restoreSession(globalObject: LayaRuntimeWindow): AutoBotRoomSession {
  const session = emptyRoomSession();
  try {
    const key = sessionStorageKey(globalObject);
    const owned = globalObject.localStorage?.getItem?.(key);
    const raw = owned ?? globalObject.localStorage?.getItem?.(SESSION_KEY);
    if (!owned && raw) {
      globalObject.localStorage?.setItem?.(key, raw);
      globalObject.localStorage?.removeItem?.(SESSION_KEY);
    }
    if (!raw) return session;
    const parsed = JSON.parse(raw) as Partial<AutoBotRoomSession>;
    if (typeof parsed.managedRoom === 'boolean') session.managedRoom = parsed.managedRoom;
    if (parsed.kind === 11 || parsed.kind === 28 || parsed.kind === 29 || parsed.kind === 1) {
      session.kind = parsed.kind;
    }
    if (Number(parsed.baiShengGeneralId) > 0) session.baiShengGeneralId = Number(parsed.baiShengGeneralId);
    if (parsed.aiPromptDone === true) session.aiPromptDone = true;
  } catch {
    // 忽略异常
  }
  return session;
}

/**
 * 自动挂机全套：建房/入座/开局、选将、出牌、窗口、酒馆目标、百胜点将、阵亡离场。
 * 托管出牌与桌上流程。不重包 ShowWindow，改为轮询窗口。
 * 盖主速刷开启时让出选将、出牌和房间流程。
 */
/** 安装自动托管控制器；返回 dispose / filterMessage / getStatus。 */
export function installAutoBotController(
  configStore: XiaochaoConfigStore,
  options: AutoBotControllerOptions = {}
): AutoBotController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const pollIntervalMs = options.pollIntervalMs ?? 400;
  let disposed = false;
  let enabled = configStore.get(AUTO_BOT_ENABLED_KEY) === true;
  let baiSheng = configStore.get(BAI_SHENG_ENABLED_KEY) === true;
  let tavernTarget = configStore.get(AUTO_BOT_TAVERN_TARGET_KEY);
  let runId = 0;
  let lastTableAt = 0;
  let lastHallAt = 0;
  let lastTavernAt = 0;
  let tavernProgress: TavernProgress | null = null;
  let session = restoreSession(globalObject);
  let play: AutoBotPlayContext = { decision: null, mode: 'off' };
  let lastPlayTrace = '';
  let rebelTeamLeavePending = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const cleanups: Array<() => void> = [];

  persistEnabled(globalObject, enabled);

  function trace(event: string, detail: Record<string, unknown> = {}): void {
    if (configStore.get(AUTO_LOG_ENABLED_KEY) !== true) return;
    console.info('[小抄][自动挂机]', event, detail);
    // DevTools 导出时对象经常被折叠为 “{…}”；同步打印纯 JSON，便于直接
    // 粘贴到 bug.txt 对照每张手牌的 Activated/Selected 状态和目标座位。
    try {
      console.info('[小抄][自动挂机]', `${event}详情`, JSON.stringify(detail));
    } catch {
      // 日志绝不能影响挂机流程。
    }
  }

  function tracePlay(source: string, scene: string): void {
    const detail = {
      source,
      scene,
      mode: play.mode,
      reason: play.reason ?? '',
      fallbackLevel: play.decision?.fallbackLevel ?? 0,
      decisionKey: play.decision?.key ?? '',
      diagnostic: play.diagnostic ?? {}
    };
    const fingerprint = JSON.stringify(detail);
    if (fingerprint === lastPlayTrace) return;
    lastPlayTrace = fingerprint;
    trace('出牌决策', detail);
  }

  cleanups.push(configStore.subscribe(AUTO_BOT_ENABLED_KEY, ({ value }) => {
    enabled = value === true;
    persistEnabled(globalObject, enabled);
    bumpRun();
    play = { decision: null, mode: 'off' };
    lastPlayTrace = '';
    trace(enabled ? '自动挂机已开启' : '自动挂机已关闭', { tavernTarget });
    if (!enabled) session = emptyRoomSession();
    persistSession(globalObject, session);
    if (enabled && !stopIfTavernDone()) scheduleTable(0);
  }));
  cleanups.push(configStore.subscribe(BAI_SHENG_ENABLED_KEY, ({ value }) => {
    baiSheng = value === true;
  }));
  cleanups.push(configStore.subscribe(AUTO_LOG_ENABLED_KEY, ({ value }) => {
    lastPlayTrace = '';
    if (value === true) trace('日志已开启', { enabled, tavernTarget });
  }));
  cleanups.push(configStore.subscribe(AUTO_BOT_TAVERN_TARGET_KEY, ({ value }) => {
    tavernTarget = value;
    refreshTavern(true);
    if (enabled) stopIfTavernDone();
  }));

  if (options.gameEvents) {
    cleanups.push(options.gameEvents.subscribe((event) => {
      if (!enabled || disposed) return;
      if (event.type === 'game-ended') {
        trace('对局结束，准备重新开始', { kind: session.kind });
        play = { decision: null, mode: 'off' };
        rebelTeamLeavePending = false;
        refreshTavern(true);
        if (stopIfTavernDone()) return;
        scheduleTable(RESTART_DELAY_MS);
      }
      if (event.type === 'player-died') {
        const identitySeats = readIdentitySeatStates(globalObject);
        if (!rebelTeamLeavePending && shouldLeaveWhenRebelTeamDead(identitySeats)) {
          rebelTeamLeavePending = true;
          trace('四名反贼均已阵亡，立即返回下一场', { seats: identitySeats });
          later(() => {
            const clicked = leaveGameAfterDeath(locator, globalObject);
            trace('反贼全灭返回', { clicked });
          }, 600);
          return;
        }
        const selfSeatId = readSelfSeatId(locator, globalObject);
        if (!shouldLeaveAfterDeath({
          deadSeatId: event.seatId,
          selfSeatId,
          seats: readSeatAiFlags(globalObject)
        })) return;
        trace('己方阵亡，5 秒后离开对局', { seatId: event.seatId });
        later(() => leaveGameAfterDeath(locator, globalObject), LEAVE_DELAY_MS);
      }
    }));
  }

  const pollTimer = globalObject.setInterval?.(() => tick(), pollIntervalMs);
  if (pollTimer != null) cleanups.push(() => globalObject.clearInterval?.(pollTimer));
  const dealTimer = globalObject.setInterval?.(() => deal(), DEAL_INTERVAL_MS);
  if (dealTimer != null) cleanups.push(() => globalObject.clearInterval?.(dealTimer));
  if (enabled && !stopIfTavernDone()) {
    refreshTavern(true);
    scheduleTable(0);
  }

  function bumpRun(): number {
    runId += 1;
    return runId;
  }

  function stillRunning(expected: number): boolean {
    return !disposed && enabled && runId === expected;
  }

  function later(callback: () => void, delay: number): void {
    const expected = runId;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (stillRunning(expected)) callback();
    }, delay);
    timers.add(timer);
  }

  function hgOwnsPlay(): boolean {
    return configStore.get(AUTO_HG_ENABLED_KEY) === true;
  }

  function refreshTavern(request: boolean): void {
    if (request) requestTavernProgress(locator);
    tavernProgress = readTavernProgress(locator, tavernTarget);
  }

  function stopIfTavernDone(): boolean {
    if (tavernTarget === 'none') return false;
    const progress = tavernProgress ?? readTavernProgress(locator, tavernTarget);
    tavernProgress = progress;
    if (!progress?.available || !progress.completed) return false;
    trace('酒馆目标已完成，自动挂机将停止', { target: tavernTarget, current: progress.current });
    configStore.set(AUTO_BOT_ENABLED_KEY, false);
    return true;
  }

  function scheduleTable(delay: number): void {
    later(() => {
      if (hgOwnsPlay()) return;
      trace('执行桌面流程', { kind: session.kind, managedRoom: session.managedRoom });
      session = runAutoBotTable(locator, globalObject, session, {
        baiSheng,
        onBaiSheng: (scene, currentId) => tryBaiShengDianjiang(
          locator,
          scene,
          unfinishedBaiShengIds(readAchList(globalObject), locator),
          currentId
        ),
        schedule: later,
        onTrace: trace
      });
      persistSession(globalObject, session);
    }, delay);
  }

  function tick(): void {
    if (disposed || !enabled) return;
    const now = Date.now();
    if (now - lastTavernAt >= TAVERN_POLL_MS) {
      lastTavernAt = now;
      refreshTavern(false);
      if (stopIfTavernDone()) return;
    }
    handleExtraBotWindows(locator, globalObject, session.kind);
    if (hgOwnsPlay()) return;
    for (const win of findGeneralWindows(locator)) {
      if (Array.isArray(win.generalUis) && win.generalUis.length) clickFirstGeneral(win);
    }
    if (now - lastHallAt >= 2000) {
      lastHallAt = now;
      session = runAutoBotHall(locator, globalObject, session, now);
      persistSession(globalObject, session);
    }
    if (now - lastTableAt >= 500) {
      lastTableAt = now;
      session = runAutoBotTable(locator, globalObject, session, {
        baiSheng,
        onBaiSheng: (scene, currentId) => tryBaiShengDianjiang(
          locator,
          scene,
          unfinishedBaiShengIds(readAchList(globalObject), locator),
          currentId
        ),
        schedule: later,
        onTrace: trace
      });
      persistSession(globalObject, session);
    }
  }

  function deal(): void {
    if (disposed || !enabled || hgOwnsPlay()) return;
    const activeScene = asRecord(locator.gameScene()) ?? asRecord(locateGameScene(globalObject));
    if (String(activeScene?.SceneName ?? activeScene?.sceneName ?? activeScene?.name ?? '') === 'RogueLikeGameScene') {
      return;
    }
    handlePlayWindows(locator, globalObject);
    play = runAutoBotDeal(locator, globalObject, play);
    tracePlay('普通对局', String(activeScene?.SceneName ?? activeScene?.sceneName ?? activeScene?.name ?? ''));
    const scene = asRecord(locateGameScene(globalObject));
    const self = asRecord(scene?.SelfSeatUi);
    if (session.kind === 28 && self && typeof self.canHalfShow === 'function') {
      try { if (self.canHalfShow()) self.onHalfShow?.(); } catch { /* ignore */ }
    }
  }

  return {
    filterMessage(payload, className) {
      if (!enabled || disposed) return;
      if (className === 'MsgGameOver') {
        play = { decision: null, mode: 'off' };
        rebelTeamLeavePending = false;
        refreshTavern(true);
        later(() => {
          if (stopIfTavernDone()) return;
          scheduleTable(0);
        }, RESTART_DELAY_MS);
        return;
      }
      if (className === 'SmsgUpdateTaskProgressToClient' || className === 'decodeUserQuestInfoRep') {
        refreshTavern(false);
        stopIfTavernDone();
      }
    },
    getStatus() {
      return {
        tavernText: tavernStatusText(tavernProgress, tavernTarget),
        managedRoom: session.managedRoom,
        kind: session.kind
      };
    },
    dispose() {
      disposed = true;
      enabled = false;
      bumpRun();
      persistEnabled(globalObject, false);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const cleanup of cleanups.splice(0)) {
        try { cleanup(); } catch { /* ignore */ }
      }
    }
  };
}

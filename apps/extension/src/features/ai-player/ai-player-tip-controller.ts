/**
 * 打开资料时提示人机，真人显示资料页编号按钮；座位上真人用游戏的画法显示等级和昵称，人机不显示。
 */

import { locateGameScene, type GameRuntimeWindow } from '../seat-display/game-scene-locator.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import {
  isUserInfoDialogOpen,
  isUserInfoViewUnderOpenWindow,
  shouldDeferSeatTopManagerSync,
} from '../../runtime/game-native-dialog.ts';
import { showToast } from '../../ui/toast/show-toast.ts';
import { PLAY_NAME_DEBUG_LOG_MAX } from '../../const/play-name-sync.ts';
import {
  AI_PLAYER_SCAN_IN_GAME_MS,
  AI_PLAYER_SCAN_OUT_OF_GAME_MS,
  AI_PLAYER_SCAN_START_MS
} from '../../const/poll-intervals.ts';
import { everyInterval } from '../../runtime/shared-ticker.ts';
import { isAiClientId, playNameVisible, readNestedClientId } from './ai-client.ts';
import {
  appendPlayNameDebugLog,
  isPlayNameSyncPaused,
  isRankOrDoudizhuScene,
  readSeatPlayNameForDebug,
  syncSeatPlayName
} from './play-name-sync.ts';

type UnknownRecord = Record<string, unknown>;
const AI_PLAYER_PERF_LABEL = '人机提示';

export interface PlayNameDebugState {
  pauseSync: boolean;
  verbose: boolean;
  log: string[];
  maxLog: number;
  scanCount: number;
  lastScanAt: number;
  lastScanMs: number;
  lastError: string;
  probe: () => ReturnType<typeof probePlayNameSeats>;
  selfCheck: () => ReturnType<typeof runPlayNameSelfCheck>;
  pause: () => void;
  resume: () => void;
  clearLog: () => void;
}

interface PlayNameDebugWindow extends GameRuntimeWindow {
  __xcProbePlayName?: () => ReturnType<typeof probePlayNameSeats>;
  __xcPlayNameDebug?: PlayNameDebugState;
}

/** 局内排查：先同步一轮，再看每个座位的编号、游戏名字层里写的字和开关。 */
export function probePlayNameSeats(globalObject: GameRuntimeWindow = window) {
  const scene = asRecord(locateGameScene(globalObject));
  if (!scene) {
    return { scene: false as const, seats: [] as readonly object[] };
  }
  const seatUis = readSeatUis(scene);
  const steps = seatUis.map((seatUi) => {
    try {
      return syncSeatPlayName(seatUi, globalObject);
    } catch (error) {
      return `error: ${String(error)}`;
    }
  });
  const seats = seatUis.map((seatUi, index) => {
    const seat = asRecord(seatUi.seat);
    const debug = readSeatPlayNameForDebug(seatUi, globalObject);
    return {
      index,
      step: steps[index],
      isHide: seat?.isHide === true,
      playNameVisible: playNameVisible(debug.clientId),
      hasOtherTopManager: Boolean(seatUi.otherTopManager),
      hasTopManager: Boolean(seatUi.topManager),
      ...debug
    };
  });
  const debugState = (globalObject as PlayNameDebugWindow).__xcPlayNameDebug;
  return {
    scene: true as const,
    rankOrDoudizhu: isRankOrDoudizhuScene(globalObject, scene),
    scanCount: debugState?.scanCount ?? null,
    lastError: debugState?.lastError ?? '',
    seatCount: seats.length,
    seats
  };
}

/** 自动跑一轮昵称同步并返回探测结果，供本地排查。 */
export function runPlayNameSelfCheck(globalObject: GameRuntimeWindow = window) {
  const result = probePlayNameSeats(globalObject);
  appendPlayNameDebugLog(globalObject, `selfCheck seats=${result.seatCount}`);
  return result;
}

/** 挂到 window 与 __XIAOCHAO_ENGINEERING__，控制台可反复调用。 */
export function mountPlayNameProbe(globalObject: GameRuntimeWindow): () => ReturnType<typeof probePlayNameSeats> {
  const run = () => probePlayNameSeats(globalObject);
  const debugWindow = globalObject as PlayNameDebugWindow;
  debugWindow.__xcProbePlayName = run;
  const bridge = asRecord((globalObject as UnknownRecord).__XIAOCHAO_ENGINEERING__);
  if (bridge) bridge.probePlayName = run;
  return run;
}

/** 昵称同步调试：暂停轮询、看日志、手动 probe。 */
export function mountPlayNameDebug(globalObject: GameRuntimeWindow): PlayNameDebugState {
  const debugWindow = globalObject as PlayNameDebugWindow;
  const existing = debugWindow.__xcPlayNameDebug;
  if (existing) return existing;

  const probe = mountPlayNameProbe(globalObject);
  const state: PlayNameDebugState = {
    pauseSync: false,
    verbose: true,
    log: [],
    maxLog: PLAY_NAME_DEBUG_LOG_MAX,
    scanCount: 0,
    lastScanAt: 0,
    lastScanMs: 0,
    lastError: '',
    probe,
    selfCheck: () => runPlayNameSelfCheck(globalObject),
    pause() { state.pauseSync = true; },
    resume() { state.pauseSync = false; },
    clearLog() { state.log.length = 0; }
  };
  debugWindow.__xcPlayNameDebug = state;
  const bridge = asRecord((globalObject as UnknownRecord).__XIAOCHAO_ENGINEERING__);
  if (bridge) {
    bridge.playNameDebug = state;
    bridge.runPlayNameSelfCheck = () => runPlayNameSelfCheck(globalObject);
  }
  appendPlayNameDebugLog(globalObject, 'playNameDebug 已挂载：selfCheck 可手动探测昵称');
  return state;
}

/** 安装对战 AI 开局提示、资料页人机提示和座位名字处理。 */
export function installAiPlayerTipController(
  gameEvents: GameEventBus,
  globalObject: GameRuntimeWindow = window
): () => void {
  mountPlayNameDebug(globalObject);
  let profileTipId = 0;
  let aiTipShownThisGame = false;
  let gameEnded = false;
  const stopEvents = gameEvents.subscribe((event) => {
    // 仅在结束后的下一局开始时解锁；启动轮询时收到的首个开始事件不重复弹。
    if (event.type === 'game-started') {
      if (gameEnded) aiTipShownThisGame = false;
      gameEnded = false;
      scan();
    } else if (event.type === 'game-ended') {
      gameEnded = true;
    }
  });
  let pollIntervalMs = AI_PLAYER_SCAN_START_MS;
  let stopScanning = everyInterval(AI_PLAYER_PERF_LABEL, pollIntervalMs, scan, {}, globalObject);
  scan();

  return () => {
    stopEvents();
    stopScanning();
  };

  function setPollInterval(nextMs: number): void {
    if (nextMs === pollIntervalMs) return;
    pollIntervalMs = nextMs;
    stopScanning();
    stopScanning = everyInterval(AI_PLAYER_PERF_LABEL, pollIntervalMs, scan, {}, globalObject);
  }

  function scan(): void {
    setPollInterval(locateGameScene(globalObject) ? AI_PLAYER_SCAN_IN_GAME_MS : AI_PLAYER_SCAN_OUT_OF_GAME_MS);
    if (shouldDeferSeatTopManagerSync(globalObject)) return;
    // 彼此独立扫描：座位 UI 尚未就绪或某一步访问异常时，也要继续挂资料页钩子。
    try { scanSeats(); } catch { /* 下一轮重试 */ }
    try { scanProfile(); } catch { /* 下一轮重试 */ }
  }

  /** 同步每个座位的名字；排位和斗地主里有人机时提示一次。 */
  function scanSeats(): void {
    const scene = asRecord(locateGameScene(globalObject));
    if (!scene) return;
    const seatUis = readSeatUis(scene);
    const debugState = (globalObject as PlayNameDebugWindow).__xcPlayNameDebug;

    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const skipNameSync = isPlayNameSyncPaused(globalObject);
    if (!skipNameSync) {
      for (const seatUi of seatUis) {
        try {
          syncSeatPlayName(seatUi, globalObject);
        } catch (error) {
          // 单座失败不影响其他座。
          if (debugState) debugState.lastError = String(error);
        }
      }
    }

    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (debugState) {
      debugState.scanCount += 1;
      debugState.lastScanAt = Date.now();
      debugState.lastScanMs = Math.round(t1 - t0);
      appendPlayNameDebugLog(
        globalObject,
        skipNameSync
          ? 'scan skip nameSync pause=true'
          : `scan nameSync ${seatUis.length} seats ${debugState.lastScanMs}ms`
      );
    }

    const seats = seatUis
      .map((seatUi) => ({ seatUi, seat: asRecord(seatUi.seat) }))
      .filter((item) => item.seat && item.seat.isHide !== true);
    if (gameEnded || aiTipShownThisGame || !isRankOrDoudizhuScene(globalObject, scene)) return;
    if (!seats.some(({ seat }) => isAiClientId(readNestedClientId(seat)))) return;
    aiTipShownThisGame = true;
    showToast('对战AI小杀！', 'warning', 4000);
  }

  /** 资料页打开后：人机提示，真人显示编号按钮。 */
  function scanProfile(): void {
    hookUserInfoView(globalObject, tipProfile);
    if (!isUserInfoDialogOpen(globalObject)) {
      profileTipId = 0;
      return;
    }
    const view = findUserInfoView(globalObject);
    if (!view) {
      profileTipId = 0;
      return;
    }
    // 不同客户端版本会把资料字段放在 view 本身或 userData / userInfo 子对象里。
    const rawClientId = readNestedClientId(view);
    if (rawClientId == null || rawClientId === '') return;
    const clientId = Number(rawClientId);
    if (!Number.isFinite(clientId)) return;
    const button = asRecord(view.result7Btn);
    if (button) button.visible = !isAiClientId(clientId);
    if (!isAiClientId(clientId)) {
      profileTipId = 0;
      return;
    }
    tipProfile(clientId);
  }

  function tipProfile(clientId: number): void {
    if (!isAiClientId(clientId) || profileTipId === clientId) return;
    profileTipId = clientId;
    showToast('小抄: 这是个人机', 'warning', 5000);
  }
}

/** 资料刷新结束后立刻判断，不等下一轮扫描。 */
function hookUserInfoView(globalObject: GameRuntimeWindow, tip: (clientId: number) => void): void {
  const classUtils = asRecord(asRecord(globalObject.Laya)?.ClassUtils);
  const getClass = classUtils?.getClass;
  if (typeof getClass !== 'function') return;
  let ctor: { prototype?: UnknownRecord } | null = null;
  try {
    ctor = getClass.call(classUtils, 'UserInfoView') as { prototype?: UnknownRecord } | null;
  } catch {
    return;
  }
  const proto = ctor?.prototype;
  const original = proto?.onWinInfo;
  if (!proto || typeof original !== 'function' || original.__xcAiProfileWrapped === true) return;
  const wrapped = function (this: UnknownRecord, ...args: unknown[]) {
    const result = original.apply(this, args);
    const rawClientId = readNestedClientId(this);
    const clientId = Number(rawClientId);
    if (rawClientId != null && rawClientId !== '' && isAiClientId(clientId)) tip(clientId);
    const button = asRecord(this.result7Btn);
    if (button && rawClientId != null && rawClientId !== '' && Number.isFinite(clientId)) {
      button.visible = !isAiClientId(clientId);
    }
    return result;
  };
  wrapped.__xcAiProfileWrapped = true;
  try {
    Object.defineProperty(proto, 'onWinInfo', { configurable: true, writable: true, value: wrapped });
  } catch {
    // 方法不能改时，靠窗口层轮询补按钮。
  }
}

function findUserInfoView(globalObject: GameRuntimeWindow): UnknownRecord | null {
  const stage = asRecord(asRecord(globalObject.Laya)?.stage);
  if (!stage) return null;
  const layers = childNodes(stage).filter((child) => [4, 5, 6].includes(Number(child.layerOrder)));
  let scanned = 0;
  for (const layer of layers) {
    const found = findView(layer, 0, () => scanned++ < 4000);
    if (found) return found;
  }
  return null;
}

function findView(node: UnknownRecord, depth: number, allow: () => boolean): UnknownRecord | null {
  if (depth > 16 || node.destroyed === true || node.visible === false || !allow()) return null;
  const ctor = typeof node.constructor === 'function' ? node.constructor.name : '';
  const looksLikeUserInfoView = 'userData' in node
    && 'result7Btn' in node
    && typeof node.onWinInfo === 'function';
  if (ctor === 'UserInfoView' || node.name === 'UserInfoView' || looksLikeUserInfoView) {
    if (isUserInfoViewUnderOpenWindow(node)) return node;
  }
  for (const child of childNodes(node)) {
    const found = findView(child, depth + 1, allow);
    if (found) return found;
  }
  return null;
}

function readSeatUis(scene: UnknownRecord): UnknownRecord[] {
  const container = asRecord(scene.seatContainer);
  const list = container?.seatUIs ?? container?.seatUis;
  if (!Array.isArray(list)) return [];
  return list.map(asRecord).filter((seat): seat is UnknownRecord => seat !== null);
}

function childNodes(node: UnknownRecord): UnknownRecord[] {
  const lists = [node._children, node.children];
  const result: UnknownRecord[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const child of list) {
      const record = asRecord(child);
      if (record) result.push(record);
    }
  }
  return result;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

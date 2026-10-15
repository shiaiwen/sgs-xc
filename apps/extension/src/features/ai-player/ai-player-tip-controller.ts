/**
 * 打开资料时提示人机，真人显示资料页编号按钮；座位上的人机使用游戏原名。
 */

import { locateGameScene, type GameRuntimeWindow } from '../seat-display/game-scene-locator.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import { showToast } from '../../ui/toast/show-toast.ts';
import { clearSeatGeneralTips, collectSeatTipTargets } from '../extra-assist/seat-general-tips.ts';
import { isAiClientId, playNameVisible, readNestedClientId } from './ai-client.ts';
import {
  appendPlayNameDebugLog,
  beginPlayNameScanBatch,
  endPlayNameScanBatch,
  isPlayNameSyncPaused,
  isReplayLikeScene,
  readSeatNickNameForDebug,
  seedPlayNameDirectory,
  syncSeatPlayName
} from './play-name-sync.ts';

type UnknownRecord = Record<string, unknown>;

export interface PlayNameDebugState {
  pauseSync: boolean;
  verbose: boolean;
  forceFullSync: boolean;
  log: string[];
  maxLog: number;
  scanCount: number;
  lastScanAt: number;
  lastScanMs: number;
  lastError: string;
  replayLike: boolean;
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

/** 录像或局内排查：看每个座位有没有编号、名字开关在不在。 */
export function probePlayNameSeats(globalObject: GameRuntimeWindow = window) {
  const scene = asRecord(locateGameScene(globalObject));
  if (!scene) {
    return { scene: false as const, seats: [] as readonly object[] };
  }
  const flags: Record<string, unknown> = {};
  for (const key of [
    'isDouDiZhu', 'IsDouDiZhu', 'isReplay', 'IsReplay', 'isPlayBack', 'IsPlayBack',
    'isRecord', 'IsRecord', 'modeName', 'ModeName'
  ]) {
    if (key in scene) flags[key] = scene[key];
  }
  const seatUis = readSeatUis(scene);
  beginPlayNameScanBatch(globalObject, { forceFull: true });
  try {
    seedPlayNameDirectory(globalObject, seatUis);
    for (let i = 0; i < seatUis.length; i += 1) {
      syncSeatPlayName(seatUis[i], globalObject, i);
    }
  } finally {
    endPlayNameScanBatch();
  }
  const seats = seatUis.map((seatUi, index) => {
    const seat = asRecord(seatUi.seat);
    const playerInfo = asRecord(seat?.playerInfo);
    const clientId = playerInfo?.ClientId ?? playerInfo?.clientId;
    const debug = readSeatNickNameForDebug(seatUi, globalObject, index);
    return {
      index,
      isHide: seat?.isHide === true,
      clientId: clientId ?? null,
      playNameVisible: playNameVisible(clientId),
      managerKeys: debug.managers,
      hasOtherTopManager: Boolean(seatUi.otherTopManager),
      hasTopManager: Boolean(seatUi.topManager),
      playerName: debug.name,
      nameLabelCount: debug.nameLabelCount,
      clonedPlayName: debug.clonedPlayName,
      mountStrategy: debug.mountStrategy,
      playNameLabels: debug.playNameLabels
    };
  });
  const acceptance = {
    liveRankOrDdz: '真人局排位/斗地主应显示对面昵称',
    replay: '录像尽量补显；游戏不支持时靠 mountStrategy C 挂头像上'
  };
  return { scene: true as const, flags, seatCount: seats.length, acceptance, seats };
}

/** 自动跑一轮昵称同步并返回探测结果，供本地排查。 */
export function runPlayNameSelfCheck(globalObject: GameRuntimeWindow = window) {
  const result = probePlayNameSeats(globalObject);
  appendPlayNameDebugLog(globalObject, `selfCheck seats=${result.seatCount}`);
  return result;
}

/** 安装对战 AI 开局提示、资料页人机提示和座位名称处理。 */
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
    forceFullSync: false,
    log: [],
    maxLog: 80,
    scanCount: 0,
    lastScanAt: 0,
    lastScanMs: 0,
    lastError: '',
    replayLike: false,
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
    } else if (event.type === 'game-ended') {
      gameEnded = true;
    }
  });
  const timer = globalObject.setInterval(scan, 200);
  scan();

  return () => {
    stopEvents();
    globalObject.clearInterval(timer);
  };

  function scan(): void {
    // 彼此独立扫描：座位 UI 尚未就绪或某一步访问异常时，也要继续挂资料页钩子。
    try { clearDrawnIds(); } catch { /* 下一轮重试 */ }
    try { scanSeats(); } catch { /* 下一轮重试 */ }
    try { scanProfile(); } catch { /* 下一轮重试 */ }
  }

  /** 清掉以前写在武将牌上的编号。 */
  function clearDrawnIds(): void {
    const scene = asRecord(locateGameScene(globalObject));
    clearSeatGeneralTips(collectSeatTipTargets(asRecord(scene?.seatContainer)?.seatUIs), 'player-id');
  }

  /** 排位和斗地主提示人机；真人的游戏内名字与资料页编号保持可见。 */
  function scanSeats(): void {
    const scene = asRecord(locateGameScene(globalObject));
    if (!scene) return;
    const seatUis = readSeatUis(scene);
    const replayLike = isReplayLikeScene(globalObject);
    const debugState = (globalObject as PlayNameDebugWindow).__xcPlayNameDebug;
    if (debugState) debugState.replayLike = replayLike;

    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const skipNameSync = isPlayNameSyncPaused(globalObject);
    if (!skipNameSync) {
      const forceFull = debugState?.forceFullSync === true;
      beginPlayNameScanBatch(globalObject, { forceFull });
      try {
        seedPlayNameDirectory(globalObject, seatUis);
        for (let i = 0; i < seatUis.length; i += 1) {
          try { syncSeatPlayName(seatUis[i], globalObject, i); } catch { /* 单座失败不影响其他座 */ }
        }
      } finally {
        endPlayNameScanBatch();
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
          ? `scan skip nameSync replay=${replayLike} pause=${isPlayNameSyncPaused(globalObject)}`
          : `scan nameSync ${seatUis.length} seats ${debugState.lastScanMs}ms replay=${replayLike}`
      );
    }

    const seats = seatUis
      .map((seatUi) => ({ seatUi, seat: asRecord(seatUi.seat) }))
      .filter((item) => item.seat && item.seat.isHide !== true);
    if (gameEnded || aiTipShownThisGame || !isAiHintMode(scene, globalObject)) return;
    if (!seats.some(({ seat }) => isAiClientId(readNestedClientId(seat)))) return;
    aiTipShownThisGame = true;
    showToast('对战AI小杀！', 'warning', 4000);
  }

  /** 资料页打开后：人机提示，真人显示编号按钮。 */
  function scanProfile(): void {
    hookUserInfoView(globalObject, tipProfile);
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
  if (ctor === 'UserInfoView' || node.name === 'UserInfoView' || looksLikeUserInfoView) return node;
  for (const child of childNodes(node)) {
    const found = findView(child, depth + 1, allow);
    if (found) return found;
  }
  return null;
}

function isAiHintMode(scene: UnknownRecord, globalObject: GameRuntimeWindow): boolean {
  if (scene.isDouDiZhu === true || scene.IsDouDiZhu === true) return true;
  if ([
    scene.isRanked,
    scene.IsRanked,
    scene.isRank,
    scene.IsRank,
    scene.isRankMatch,
    scene.IsRankMatch,
    scene.isDuanWei,
    scene.IsDuanWei,
    scene.isJingJi,
    scene.IsJingJi
  ].some((flag) => flag === true)) return true;
  const roomList = asRecord(scene.roomListView);
  const areaLabel = asRecord(asRecord(scene.topMenu)?.areaServerLabel)?.text;
  const parts: unknown[] = [
    scene.modeName,
    scene.ModeName,
    scene.gameModeName,
    roomList?.modeName,
    roomList?.modeLabel,
    roomList?.title,
    roomList?.nameTxt,
    areaLabel
  ];
  const context = asRecord((globalObject as UnknownRecord).GameContext);
  try {
    const vo = typeof context?.GetModeVO === 'function' ? asRecord(context.GetModeVO()) : null;
    parts.push(vo?.ModeName, vo?.modeName, vo?.Name, vo?.name);
  } catch {
    // 读取不到模式名时不把山河图误认为排位或斗地主。
  }
  return /斗地主|dou\s*di\s*zhu|排位|rank(?:ed|ing)?/i.test(
    parts.filter((part) => typeof part === 'string').join(' ')
  );
}

/** 游戏把名字开关放在 otherTopManager，有的座位只挂在 topManager。 */
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

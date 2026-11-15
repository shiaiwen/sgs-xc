/**
 * 其他座位的名字：真人用游戏名字层自己的方法画出等级和昵称并打开，人机关掉。自己的座位不动。
 */

import { locateGameScene, type GameRuntimeWindow } from '../seat-display/game-scene-locator.ts';
import { playNameVisible, readNestedClientId } from './ai-client.ts';
import {
  drawRealPlayerName,
  readGameNameLabel,
  readGameShowName,
  readRequestedShowName
} from './real-player-name-init.ts';
import { shouldDeferSeatTopManagerSync } from '../../runtime/game-native-dialog.ts';
import {
  PLAY_NAME_DEBUG_CLOCK_END,
  PLAY_NAME_DEBUG_CLOCK_START,
  PLAY_NAME_DEBUG_LOG_MAX
} from '../../const/play-name-sync.ts';

type UnknownRecord = Record<string, unknown>;

const PLAY_NAME_VISIBLE_APPLIED_KEY = '__xcPlayNameVisibleApplied';

interface PlayNameDebugBridge {
  pauseSync?: boolean;
  verbose?: boolean;
  log?: string[];
  maxLog?: number;
}

type PlayNameDebugWindow = GameRuntimeWindow & { __xcPlayNameDebug?: PlayNameDebugBridge };

export function isPlayNameSyncPaused(globalObject: GameRuntimeWindow = window): boolean {
  return (globalObject as PlayNameDebugWindow).__xcPlayNameDebug?.pauseSync === true;
}

export function appendPlayNameDebugLog(globalObject: GameRuntimeWindow, message: string): void {
  const state = (globalObject as PlayNameDebugWindow).__xcPlayNameDebug;
  if (!state || state.verbose === false) return;
  const log = state.log ?? (state.log = []);
  const max = state.maxLog ?? PLAY_NAME_DEBUG_LOG_MAX;
  const clock = new Date().toISOString().slice(PLAY_NAME_DEBUG_CLOCK_START, PLAY_NAME_DEBUG_CLOCK_END);
  log.push(`${clock} ${message}`);
  if (log.length > max) log.splice(0, log.length - max);
}

/**
 * 排位、天梯、斗地主、八人匹配和 8人匹配会把真人名字藏起来。
 * 这些局里名字开关有时只在 topManager，普通房间仍只认 otherTopManager，避免把房间和身份局的名字打开。
 */
export function isRankOrDoudizhuScene(
  globalObject: GameRuntimeWindow,
  sceneInput?: UnknownRecord | null
): boolean {
  const scene = sceneInput ?? asRecord(locateGameScene(globalObject));
  if (!scene) return false;
  const flagOn = (value: unknown) => value === true || value === 1 || value === '1';
  if (flagOn(scene.isDouDiZhu) || flagOn(scene.IsDouDiZhu)) return true;
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
  ].some(flagOn)) return true;
  const roomList = asRecord(scene.roomListView);
  const topMenu = asRecord(scene.topMenu);
  const areaLabel = asRecord(topMenu?.areaServerLabel)?.text;
  const parts: unknown[] = [
    scene.modeName,
    scene.ModeName,
    scene.gameModeName,
    scene.modelName,
    scene.ModelName,
    scene.sectionName,
    scene.SectionName,
    roomList?.modeName,
    roomList?.modeLabel,
    roomList?.title,
    roomList?.nameTxt,
    areaLabel,
    asRecord(topMenu?.modeLabel)?.text,
    asRecord(topMenu?.modeName)?.text
  ];
  const context = asRecord((globalObject as UnknownRecord).GameContext);
  try {
    const vo = typeof context?.GetModeVO === 'function' ? asRecord(context.GetModeVO()) : null;
    parts.push(
      vo?.ModeName, vo?.modeName, vo?.Name, vo?.name,
      vo?.SectionName, vo?.sectionName, vo?.ModelName, vo?.modelName,
      vo?.SectionDesc, vo?.Desc, vo?.desc
    );
  } catch {
    // 读不到模式名时保持关闭，不凭空当成排位或斗地主。
  }
  return /斗地主|dou\s*di\s*zhu|排位|天梯|八人匹配|8人匹配|rank(?:ed|ing)?/i.test(
    parts.filter((part) => typeof part === 'string').join(' ')
  );
}

/** 一轮同步在这个座位上停在哪一步，排查时看。 */
export type PlayNameSyncStep =
  | 'paused'
  | 'deferred'
  | 'no-client-id'
  | 'own-seat'
  | 'no-manager'
  | 'no-player-info'
  | 'name-pending'
  | 'ai-hidden'
  | 'real-shown';

/** 对单个座位同步名字。 */
export function syncSeatPlayName(
  seatUi: UnknownRecord,
  globalObject: GameRuntimeWindow = window
): PlayNameSyncStep {
  if (isPlayNameSyncPaused(globalObject)) return 'paused';
  if (shouldDeferSeatTopManagerSync(globalObject)) return 'deferred';

  const seat = asRecord(seatUi.seat);
  const visible = playNameVisible(readSeatClientId(seat));
  if (visible === null) return 'no-client-id';
  if (isOwnSeat(seatUi, seat, globalObject)) return 'own-seat';

  const manager = resolvePlayNameManager(seatUi, globalObject);
  if (!manager) return 'no-manager';
  if (visible) {
    const playerInfo = readSeatPlayerInfo(seat);
    if (!playerInfo) return 'no-player-info';
    // 游戏还没写上昵称时先不打开，免得只露出一条空的名字底。
    if (!drawRealPlayerName(manager, playerInfo)) return 'name-pending';
  }
  setGamePlayNameVisible(manager, visible);
  return visible ? 'real-shown' : 'ai-hidden';
}

export interface PlayNameRowDebug {
  text: string | null;
  visible: unknown;
  x: unknown;
  y: unknown;
  width: unknown;
  height: unknown;
  drawed: unknown;
}

export interface PlayNameSeatDebug {
  clientId: unknown;
  manager: string;
  showName: string;
  nickname: string;
  userLevel: unknown;
  requestedName: unknown;
  layerVisible: unknown;
  textVisible: unknown;
  switchOn: unknown;
  hasRoundTexture: boolean;
  bar: PlayNameRowDebug | null;
  nameRow: PlayNameRowDebug | null;
  levelRow: PlayNameRowDebug | null;
  nameFields: Record<string, string>;
}

/** 排查用：座位资料里的昵称、游戏名字层三样东西现在的状态和游戏自己记的开关。 */
export function readSeatPlayNameForDebug(
  seatUi: UnknownRecord,
  globalObject: GameRuntimeWindow = window
): PlayNameSeatDebug {
  const seat = asRecord(seatUi.seat);
  const manager = resolvePlayNameManager(seatUi, globalObject);
  const playerInfo = readSeatPlayerInfo(seat);
  return {
    clientId: readSeatClientId(seat),
    manager: manager ? String(manager.constructor?.name ?? '') : '',
    showName: playerInfo ? readGameShowName(playerInfo) : '',
    nickname: describeRawValue(readField(playerInfo, 'nickname')),
    userLevel: readField(playerInfo, 'UserLevel'),
    requestedName: manager ? readRequestedShowName(manager) : null,
    layerVisible: readField(manager, 'visible'),
    textVisible: readField(manager, 'textVisible'),
    switchOn: readField(manager, 'playerNameVisible'),
    hasRoundTexture: asRecord(manager?.roundTexture) !== null,
    bar: readRowForDebug(manager?.playerNameBg),
    nameRow: readRowForDebug(manager ? readGameNameLabel(manager) : null),
    levelRow: readRowForDebug(manager?.playerLevelTxt),
    nameFields: collectNameFields({ seat, info: playerInfo })
  };
}

function readRowForDebug(value: unknown): PlayNameRowDebug | null {
  const row = asRecord(value);
  if (!row) return null;
  return {
    text: 'text' in row ? String(readField(row, 'text') ?? '') : null,
    visible: readField(row, 'visible'),
    x: readField(row, 'x'),
    y: readField(row, 'y'),
    width: readField(row, 'width'),
    height: readField(row, 'height'),
    drawed: readField(row, 'drawed')
  };
}

/** 资料对象自己身上带名字字样的字符串字段，用来看昵称实际放在哪。 */
function collectNameFields(sources: Record<string, UnknownRecord | null>): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [label, source] of Object.entries(sources)) {
    if (!source) continue;
    for (const key of Object.keys(source)) {
      if (!/name|nick/i.test(key)) continue;
      const value = readField(source, key);
      if (typeof value === 'string') found[`${label}.${key}`] = value;
    }
  }
  return found;
}

function describeRawValue(value: unknown): string {
  return typeof value === 'string' ? value : `<${value === null ? 'null' : typeof value}>`;
}

function readField(record: UnknownRecord | null | undefined, key: string): unknown {
  if (!record) return undefined;
  try {
    return record[key];
  } catch {
    return undefined;
  }
}

function managerWithPlayNameSwitch(value: unknown): UnknownRecord | null {
  const manager = asRecord(value);
  if (!manager || typeof manager.SetPlayNameVisible !== 'function') return null;
  return manager;
}

function resolvePlayNameManager(seatUi: UnknownRecord, globalObject: GameRuntimeWindow): UnknownRecord | null {
  const other = managerWithPlayNameSwitch(seatUi.otherTopManager);
  if (other) return other;
  if (!isRankOrDoudizhuScene(globalObject)) return null;
  return managerWithPlayNameSwitch(seatUi.topManager);
}

/**
 * 名字层已经是要的状态就不再调用。
 * 游戏写名字时会按模式把名字关掉，所以先看游戏自己记的开关，读不到再看上次调用的结果。
 */
function setGamePlayNameVisible(manager: UnknownRecord, visible: boolean): void {
  const current = typeof manager.playerNameVisible === 'boolean'
    ? manager.playerNameVisible
    : manager[PLAY_NAME_VISIBLE_APPLIED_KEY];
  if (current === visible) return;
  try {
    (manager.SetPlayNameVisible as (visible: boolean) => void).call(manager, visible);
    manager[PLAY_NAME_VISIBLE_APPLIED_KEY] = visible;
  } catch {
    // 没切换成功时下一轮再试。
  }
}

function isOwnSeat(
  seatUi: UnknownRecord,
  seat: UnknownRecord | null,
  globalObject: GameRuntimeWindow
): boolean {
  if (seat?.IsSelf === true || seat?.isSelf === true) return true;
  const scene = asRecord(locateGameScene(globalObject));
  const selfUi = scene?.SelfSeatUi ?? scene?.selfSeatUi;
  return selfUi != null && selfUi === seatUi;
}

/** 游戏写名字时传的也是这一份。 */
function readSeatPlayerInfo(seat: UnknownRecord | null): UnknownRecord | null {
  return asRecord(seat?.PlayerInfo) ?? asRecord(seat?.playerInfo);
}

function readSeatClientId(seat: UnknownRecord | null): unknown {
  const playerInfo = asRecord(seat?.playerInfo) ?? asRecord(seat?.PlayerInfo);
  const direct = playerInfo?.ClientId ?? playerInfo?.clientId;
  if (direct != null && direct !== '') return direct;
  return readNestedClientId(seat);
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

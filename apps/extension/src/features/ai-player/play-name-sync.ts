/**
 * 真人昵称：SetPlayNameVisible + 必要时 Laya 补字（A/B/C 挂载，带几何自检）。
 */

import { createLayaObjectLocator } from '../../adapters/laya-object-locator.ts';
import { locateGameEventDispatcher, locateGameScene, type GameRuntimeWindow } from '../seat-display/game-scene-locator.ts';
import { AI_CLIENT_ID_MIN, playNameVisible, readNestedClientId } from './ai-client.ts';

type UnknownRecord = Record<string, unknown>;

const PLAYER_INFO_PUSH_METHODS = ['SetPlayerInfo', 'UpdatePlayerInfo', 'RefreshPlayerInfo'] as const;
const PLAY_NAME_FALLBACK_KEY = '__xcPlayNameLabel';
const PLAY_NAME_MOUNT_KEY = '__xcPlayNameMount';
const PLAY_NAME_PUSHED_KEY = '__xcPlayNamePushed';
const PLAY_NAME_FALLBACK_NAME = 'xcSeatPlayName';
const GUANJIE_NAME = /guanJie|GuanJie|官阶/i;

interface PlayNameDebugBridge {
  pauseSync?: boolean;
  verbose?: boolean;
  forceFullSync?: boolean;
  log?: string[];
  maxLog?: number;
  scanCount?: number;
  lastScanAt?: number;
  lastScanMs?: number;
  lastError?: string;
}

interface PlayNameScanCache {
  template: UnknownRecord | null | undefined;
  tableRows: UnknownRecord[] | null;
  replayLike: boolean;
  forceFull: boolean;
}

let activeScanCache: PlayNameScanCache | null = null;
let playNameByClientId = new Map<number, string>();
let playNameByListIndex = new Map<number, string>();

type PlayNameSyncMode = 'full' | 'minimal';

/** 一轮扫描前汇总各座昵称，避免 gds 读不到单座 label。 */
export function seedPlayNameDirectory(
  globalObject: GameRuntimeWindow,
  seatUis: readonly UnknownRecord[]
): void {
  playNameByClientId = new Map();
  playNameByListIndex = new Map();
  for (let i = 0; i < seatUis.length; i += 1) {
    const seatUi = seatUis[i];
    const seat = asRecord(seatUi?.seat);
    const clientId = Number(readSeatClientId(seat));
    const manager = asRecord(seatUi?.otherTopManager) ?? asRecord(seatUi?.topManager);
    const name = readNickFromSeatBundle(seat, manager);
    if (name) {
      playNameByListIndex.set(i, name);
      if (Number.isFinite(clientId)) playNameByClientId.set(clientId, name);
    }
  }
  mergeTableRowsIntoPlayNameDirectory(globalObject, seatUis.length);
}

function mergeTableRowsIntoPlayNameDirectory(globalObject: GameRuntimeWindow, seatCount: number): void {
  const deepRoom = activeScanCache?.forceFull === true;
  const rows = activeScanCache?.tableRows ?? collectOrderedTableSeatEntries(globalObject, deepRoom);
  if (activeScanCache && !activeScanCache.tableRows) activeScanCache.tableRows = rows;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const nick = readNickFromDatumEntry(row);
    if (!nick) continue;
    const id = Number(readNestedClientId(row));
    if (Number.isFinite(id) && !playNameByClientId.has(id)) playNameByClientId.set(id, nick);
    const seatIdx = readDatumSeatIndex(row);
    if (seatIdx !== null && seatIdx >= 0 && seatIdx < seatCount) {
      playNameByListIndex.set(seatIdx, nick);
    } else if (i < seatCount) {
      playNameByListIndex.set(i, nick);
    }
  }
}

/** 单测用：查看当前轮次汇总到的昵称表。 */
export function snapshotPlayNameDirectoryForTest(): {
  byClientId: Record<number, string>;
  byListIndex: Record<number, string>;
} {
  return {
    byClientId: Object.fromEntries(playNameByClientId.entries()),
    byListIndex: Object.fromEntries(playNameByListIndex.entries())
  };
}

function lookupPlayNameDirectory(clientId: unknown, seatListIndex: number | null): string {
  const id = Number(clientId);
  if (Number.isFinite(id)) {
    const hit = playNameByClientId.get(id);
    if (hit) return hit;
  }
  if (seatListIndex !== null) {
    const byIndex = playNameByListIndex.get(seatListIndex);
    if (byIndex) return byIndex;
  }
  return '';
}

/** 一轮座位扫描开始前调用，合并名单/模板查询，减轻录像卡顿。 */
export function beginPlayNameScanBatch(
  globalObject: GameRuntimeWindow,
  options: { forceFull?: boolean; replayLike?: boolean } = {}
): void {
  activeScanCache = {
    template: undefined,
    tableRows: null,
    replayLike: options.replayLike ?? isReplayLikeScene(globalObject),
    forceFull: options.forceFull === true
  };
}

export function endPlayNameScanBatch(): void {
  activeScanCache = null;
}

export function isReplayLikeScene(globalObject: GameRuntimeWindow = window): boolean {
  const scene = asRecord(locateGameScene(globalObject));
  if (!scene) return false;
  for (const key of ['isReplay', 'IsReplay', 'isPlayBack', 'IsPlayBack', 'isRecord', 'IsRecord']) {
    const value = scene[key];
    if (value === true || value === 1 || value === '1') return true;
  }
  return false;
}

export function isPlayNameSyncPaused(globalObject: GameRuntimeWindow = window): boolean {
  const win = globalObject as GameRuntimeWindow & { __xcPlayNameDebug?: PlayNameDebugBridge };
  return win.__xcPlayNameDebug?.pauseSync === true;
}

export function appendPlayNameDebugLog(globalObject: GameRuntimeWindow, message: string): void {
  const win = globalObject as GameRuntimeWindow & { __xcPlayNameDebug?: PlayNameDebugBridge };
  const state = win.__xcPlayNameDebug;
  if (!state || state.verbose === false) return;
  const log = state.log ?? (state.log = []);
  const max = state.maxLog ?? 80;
  log.push(`${new Date().toISOString().slice(11, 23)} ${message}`);
  if (log.length > max) log.splice(0, log.length - max);
}

interface PlayNameLayaWindow extends GameRuntimeWindow {
  Laya?: {
    Text?: new () => UnknownRecord;
    Point?: new (x: number, y: number) => object;
    stage?: { width?: number; height?: number };
  };
}

export type PlayNameMountStrategy = 'native' | 'A' | 'B' | 'C' | 'none';

/**
 * 排位、斗地主会把真人名字藏起来。
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
    // 读不到模式名时保持关闭，不凭空当成排位或斗地主。
  }
  return /斗地主|dou\s*di\s*zhu|排位|rank(?:ed|ing)?/i.test(
    parts.filter((part) => typeof part === 'string').join(' ')
  );
}

function managerWithPlayNameSwitch(value: unknown): UnknownRecord | null {
  const manager = asRecord(value);
  if (!manager || typeof manager.SetPlayNameVisible !== 'function') return null;
  return manager;
}

function resolvePlayNameManager(seatUi: UnknownRecord, allowTopManager: boolean): UnknownRecord | null {
  const other = managerWithPlayNameSwitch(seatUi.otherTopManager);
  if (other) return other;
  if (!allowTopManager) return null;
  return managerWithPlayNameSwitch(seatUi.topManager);
}

/** 对单个座位 UI 同步真人昵称显示。 */
export function syncSeatPlayName(
  seatUi: UnknownRecord,
  globalObject: GameRuntimeWindow = window,
  seatListIndex: number | null = null
): void {
  if (isPlayNameSyncPaused(globalObject)) return;

  const seat = asRecord(seatUi.seat);
  const clientId = readSeatClientId(seat);
  const visible = playNameVisible(clientId);
  if (visible === null) return;
  if (isOwnSeat(seatUi, seat, globalObject)) return;

  if (visible === true && isRankOrDoudizhuScene(globalObject)) {
    revealRankPlayName(seatUi, seat, clientId);
    return;
  }

  const manager = resolvePlayNameManager(seatUi, false);
  if (!manager) return;

  purgeInvalidPlayNameNodes(seatUi, manager);

  const mode = resolvePlayNameSyncMode(globalObject);
  if (mode === 'minimal') {
    syncSeatPlayNameMinimal(seatUi, seat, manager, visible, globalObject, seatListIndex);
    return;
  }

  const name = resolveDisplayName(seatUi, seat, clientId, manager, globalObject, seatListIndex);

  if (visible && name) {
    const playerInfo = hydrateSeatPlayerInfo(seat, clientId, globalObject, name);
    if (playerInfo) pushPlayerInfoToManagerOnce(manager, playerInfo, name);
  }

  try {
    manager.SetPlayNameVisible.call(manager, visible);
  } catch {
    try { manager.SetPlayNameVisible(visible); } catch { /* 下轮再试 */ }
  }

  applyPlayNameDisplay(seatUi, manager, visible, name, globalObject);
}

/** 排位和斗地主只走座位自己的名字开关，不改文字节点。 */
function revealRankPlayName(seatUi: UnknownRecord, seat: UnknownRecord | null, clientId: unknown): void {
  const manager = asRecord(seatUi.otherTopManager);
  const showName = manager?.SetPlayNameVisible;
  if (typeof showName !== 'function') return;
  const playerInfo = asRecord(seat?.playerInfo) ?? asRecord(seat?.PlayerInfo);
  const raw = playerInfo?.ClientId ?? playerInfo?.clientId ?? clientId;
  const id = Number(raw);
  if (!Number.isFinite(id)) return;
  showName.call(manager, id < AI_CLIENT_ID_MIN);
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

function resolvePlayNameSyncMode(globalObject: GameRuntimeWindow): PlayNameSyncMode {
  const win = globalObject as GameRuntimeWindow & { __xcPlayNameDebug?: PlayNameDebugBridge & { forceFullSync?: boolean } };
  if (win.__xcPlayNameDebug?.forceFullSync === true) return 'full';
  if (activeScanCache?.forceFull) return 'full';
  if (activeScanCache?.replayLike ?? isReplayLikeScene(globalObject)) return 'minimal';
  return 'full';
}

/** 录像默认路径：只开关可见性，昵称只读已有 UI，最多补挂一次头像字。 */
function syncSeatPlayNameMinimal(
  seatUi: UnknownRecord,
  seat: UnknownRecord | null,
  manager: UnknownRecord,
  visible: boolean,
  globalObject: GameRuntimeWindow,
  seatListIndex: number | null
): void {
  try {
    manager.SetPlayNameVisible.call(manager, visible);
  } catch {
    try { manager.SetPlayNameVisible(visible); } catch { /* 下轮再试 */ }
  }
  teardownPlayNameFallback(seatUi, manager);
  if (!visible) {
    manager[PLAY_NAME_MOUNT_KEY] = 'none';
    return;
  }
  manager[PLAY_NAME_MOUNT_KEY] = 'none';
  // 录像只开关游戏内昵称，不往 Laya 树挂补字，避免回放协议 resume 遍历子节点崩溃。
}

function teardownPlayNameFallback(seatUi: UnknownRecord, manager: UnknownRecord): void {
  const avatar = resolveSeatAvatar(seatUi);
  for (const host of [avatar, manager].filter(Boolean)) {
    const record = asRecord(host);
    if (!record) continue;
    const label = asRecord(record[PLAY_NAME_FALLBACK_KEY]);
    if (!label) continue;
    label.visible = false;
    try {
      if (typeof label.removeSelf === 'function') label.removeSelf();
      else if (typeof label.destroy === 'function') label.destroy(true);
    } catch { /* ignore */ }
    delete record[PLAY_NAME_FALLBACK_KEY];
  }
  delete manager[PLAY_NAME_FALLBACK_KEY];
  manager[PLAY_NAME_MOUNT_KEY] = 'none';
}

function resolveDisplayNameCheap(
  seatUi: UnknownRecord,
  seat: UnknownRecord | null,
  manager: UnknownRecord,
  clientId: unknown,
  seatListIndex: number | null
): string {
  const fromDir = lookupPlayNameDirectory(clientId, seatListIndex);
  if (fromDir) return fromDir;
  const fromSeat = readNickFromSeatBundle(seat, manager);
  if (fromSeat) return fromSeat;
  return readNickFromSeatUiFields(seatUi);
}

function applyPlayNameDisplay(
  seatUi: UnknownRecord,
  manager: UnknownRecord,
  visible: boolean,
  name: string,
  globalObject: GameRuntimeWindow,
  options: { replayOnceFallback?: boolean } = {}
): void {
  if (!visible) {
    hideFallbackLabel(manager, seatUi);
    manager[PLAY_NAME_MOUNT_KEY] = 'none';
    return;
  }

  if (nativeLabelShowsName(manager, name) && nativeLabelRenderable(manager, globalObject)) {
    manager[PLAY_NAME_MOUNT_KEY] = 'native';
    hideFallbackLabel(manager, seatUi);
    return;
  }

  if (!name) {
    manager[PLAY_NAME_MOUNT_KEY] = 'none';
    return;
  }

  if (fallbackLabelAlreadyGood(seatUi, manager, name, globalObject)) return;

  if (isReplayLikeScene(globalObject)) return;

  const template = resolvePlayNameLabelTemplate(globalObject);
  ensureFallbackLabel(seatUi, manager, name, template, globalObject);
}

function fallbackLabelAlreadyGood(
  seatUi: UnknownRecord,
  manager: UnknownRecord,
  name: string,
  globalObject: GameRuntimeWindow
): boolean {
  const mount = manager[PLAY_NAME_MOUNT_KEY] as PlayNameMountStrategy | undefined;
  if (!mount || mount === 'none') return false;
  const label = asRecord(manager[PLAY_NAME_FALLBACK_KEY]);
  if (!label || label.destroyed || label.visible === false) return false;
  if (String(label.text ?? '').trim() !== name.trim()) return false;
  if (mount === 'native') return true;
  if (mount === 'C') {
    const avatar = resolveSeatAvatar(seatUi);
    if (!avatar) return false;
    const parent = asRecord(label.parent) ?? asRecord(label._parent);
    return parent === avatar;
  }
  return labelBoundsTrustworthy(label, globalObject);
}

function resolvePlayNameLabelTemplate(globalObject: GameRuntimeWindow): UnknownRecord | null {
  if (activeScanCache && activeScanCache.template !== undefined) {
    return activeScanCache.template;
  }
  const template = findPlayNameLabelTemplate(globalObject);
  if (activeScanCache) activeScanCache.template = template;
  return template;
}

function isEdsManager(manager: UnknownRecord): boolean {
  return /eds/i.test(String(manager.constructor?.name ?? ''));
}

function isGdsManager(manager: UnknownRecord): boolean {
  return /gds/i.test(String(manager.constructor?.name ?? ''));
}

function nativeLabelRenderable(manager: UnknownRecord, globalObject: GameRuntimeWindow): boolean {
  const label = asRecord(manager.playerNameTxt) ?? asRecord(manager.PlayerNameTxt);
  if (!label) return false;
  return labelBoundsTrustworthy(label, globalObject);
}

function labelBoundsTrustworthy(label: UnknownRecord, globalObject: GameRuntimeWindow): boolean {
  const parent = asRecord(label.parent) ?? asRecord(label._parent);
  if (!parent) return false;
  const bounds = readLabelScreenBounds(label, globalObject);
  return bounds?.onScreen === true;
}

function nativeLabelShowsName(manager: UnknownRecord, name: string): boolean {
  const label = asRecord(manager.playerNameTxt) ?? asRecord(manager.PlayerNameTxt);
  if (!label || label.visible === false || !('text' in label)) return false;
  const text = String(label.text ?? '').trim();
  if (!text) return false;
  const expected = name.trim();
  if (!expected) return true;
  if (text === expected) return true;
  return !/^DO-\d+$/i.test(String(label.name || ''));
}

function resolveDisplayName(
  seatUi: UnknownRecord,
  seat: UnknownRecord | null,
  clientId: unknown,
  manager: UnknownRecord,
  globalObject: GameRuntimeWindow,
  seatListIndex: number | null = null
): string {
  const fromDir = lookupPlayNameDirectory(clientId, seatListIndex);
  if (fromDir) return fromDir;
  const fromSeat = readNickFromSeatBundle(seat, manager);
  if (fromSeat) return fromSeat;
  const fromResolver = resolveSeatNickName(seat, clientId, globalObject, seatListIndex);
  if (fromResolver) return fromResolver;
  const fromScene = readNickFromSeatContainer(globalObject, clientId);
  if (fromScene) return fromScene;
  return readNickFromSeatUiFields(seatUi);
}

function readManagerLabelText(manager: UnknownRecord | null): string {
  const label = asRecord(manager?.playerNameTxt) ?? asRecord(manager?.PlayerNameTxt);
  if (!label || !('text' in label)) return '';
  const text = String(label.text ?? '').trim();
  return text;
}

function readNickFromSeatContainer(globalObject: GameRuntimeWindow, clientId: unknown): string {
  const id = Number(clientId);
  if (!Number.isFinite(id)) return '';
  const scene = asRecord(locateGameScene(globalObject));
  const list = asRecord(scene?.seatContainer)?.seatUIs ?? asRecord(scene?.seatContainer)?.seatUis;
  if (!Array.isArray(list)) return '';
  for (const rawSeatUi of list) {
    const seatUi = asRecord(rawSeatUi);
    if (!seatUi) continue;
    const seat = asRecord(seatUi.seat);
    if (Number(readSeatClientId(seat)) !== id) continue;
    const fromSeat = readNickFromSeatBundle(seat);
    if (fromSeat) return fromSeat;
    const fromManager = readManagerLabelText(asRecord(seatUi.otherTopManager));
    if (fromManager) return fromManager;
  }
  return '';
}

function readNickFromSeatUiFields(seatUi: UnknownRecord): string {
  const seat = asRecord(seatUi.seat);
  const manager = asRecord(seatUi.otherTopManager) ?? asRecord(seatUi.topManager);
  return readNickFromSeatBundle(seat, manager);
}

function hideFallbackLabel(manager: UnknownRecord, seatUi?: UnknownRecord): void {
  const label = asRecord(manager[PLAY_NAME_FALLBACK_KEY]);
  if (label) label.visible = false;
  const avatar = seatUi ? resolveSeatAvatar(seatUi) : null;
  const avatarLabel = avatar ? asRecord(avatar[PLAY_NAME_FALLBACK_KEY]) : null;
  if (avatarLabel && avatarLabel !== label) avatarLabel.visible = false;
}

function ensureFallbackLabel(
  seatUi: UnknownRecord,
  manager: UnknownRecord,
  name: string,
  template: UnknownRecord | null,
  globalObject: GameRuntimeWindow
): boolean {
  const avatar = resolveSeatAvatar(seatUi);
  if (avatar) {
    return ensurePlayNameOnAvatar(seatUi, manager, name, template, globalObject);
  }

  let label = asRecord(manager[PLAY_NAME_FALLBACK_KEY]);
  if (label?.destroyed) {
    delete manager[PLAY_NAME_FALLBACK_KEY];
    label = null;
  }
  if (!label) {
    label = createFallbackLabel(globalObject, template);
    if (!label) return false;
    manager[PLAY_NAME_FALLBACK_KEY] = label;
  }

  const strategies: PlayNameMountStrategy[] = isGdsManager(manager)
    ? ['C', 'A', 'B']
    : ['C', 'A', 'B'];
  let mounted: PlayNameMountStrategy = 'none';
  for (const strategy of strategies) {
    if (!mountFallbackLabel(seatUi, manager, label, template, strategy, globalObject)) continue;
    polishFallbackLabel(label, template);
    if (strategy === 'C' || labelBoundsTrustworthy(label, globalObject)) {
      mounted = strategy;
      break;
    }
  }

  label.text = name;
  label.visible = true;
  revealNodeChain(label);
  manager[PLAY_NAME_MOUNT_KEY] = mounted === 'none' ? 'C' : mounted;
  if (typeof label.repaint === 'function') label.repaint();
  return mounted !== 'none';
}

/** 与座位武将 tip 相同：字挂在 seatAvatar 上，避免 gds/eds 原生节点不在树里。 */
function ensurePlayNameOnAvatar(
  seatUi: UnknownRecord,
  manager: UnknownRecord,
  name: string,
  template: UnknownRecord | null,
  globalObject: GameRuntimeWindow
): boolean {
  const avatar = resolveSeatAvatar(seatUi);
  if (!avatar) return false;

  let label = asRecord(avatar[PLAY_NAME_FALLBACK_KEY]) ?? asRecord(manager[PLAY_NAME_FALLBACK_KEY]);
  if (label?.destroyed) {
    delete avatar[PLAY_NAME_FALLBACK_KEY];
    delete manager[PLAY_NAME_FALLBACK_KEY];
    label = null;
  }
  if (!label) {
    label = createFallbackLabel(globalObject, template);
    if (!label) return false;
    avatar[PLAY_NAME_FALLBACK_KEY] = label;
    manager[PLAY_NAME_FALLBACK_KEY] = label;
  }

  if (!mountStrategyC(seatUi, label, globalObject)) return false;
  polishFallbackLabel(label, template);
  label.fontSize = Number(label.fontSize ?? template?.fontSize ?? 18);
  label.align = 'center';
  label.width = Math.max(Number(label.width ?? 0), 168);
  label.text = name;
  label.visible = true;
  revealNodeChain(label);
  manager[PLAY_NAME_MOUNT_KEY] = 'C';
  if (typeof label.repaint === 'function') label.repaint();
  return true;
}

function mountFallbackLabel(
  seatUi: UnknownRecord,
  manager: UnknownRecord,
  label: UnknownRecord,
  template: UnknownRecord | null,
  strategy: PlayNameMountStrategy,
  globalObject: GameRuntimeWindow
): boolean {
  if (strategy === 'A') return mountStrategyA(manager, label, template, globalObject);
  if (strategy === 'B') return mountStrategyB(manager, label, globalObject);
  if (strategy === 'C') return mountStrategyC(seatUi, label, globalObject);
  return false;
}

function mountStrategyA(
  manager: UnknownRecord,
  label: UnknownRecord,
  template: UnknownRecord | null,
  globalObject: GameRuntimeWindow
): boolean {
  if (!template) return false;
  const templateParent = asRecord(template.parent) ?? asRecord(template._parent);
  const parentName = String(templateParent?.name || '');
  const host = parentName
    ? findNodeByName(manager, parentName, 0)
    : null;
  const mountHost = host && typeof host.addChild === 'function'
    ? host
    : findDisplayHost(manager) ?? manager;
  attachChild(mountHost, label);
  alignLabelToTemplate(label, template, mountHost, globalObject);
  return true;
}

function mountStrategyB(manager: UnknownRecord, label: UnknownRecord, globalObject: GameRuntimeWindow): boolean {
  const ref = findReferenceTextLeaf(manager);
  if (!ref) return false;
  const host = asRecord(ref.parent) ?? asRecord(ref._parent) ?? findDisplayHost(manager) ?? manager;
  attachChild(host, label);
  const refX = Number(ref.x ?? 0);
  const refY = Number(ref.y ?? 0);
  const refH = Number(ref.height ?? 20);
  label.x = refX;
  label.y = refY - refH - 2;
  if (typeof label.pos === 'function') label.pos(label.x, label.y);
  return true;
}

function resolveSeatAvatar(seatUi: UnknownRecord): UnknownRecord | null {
  const avatar = asRecord(seatUi.seatAvatar) ?? asRecord(seatUi.SeatAvatar);
  return avatar && typeof avatar.addChild === 'function' ? avatar : null;
}

function mountStrategyC(
  seatUi: UnknownRecord,
  label: UnknownRecord,
  _globalObject: GameRuntimeWindow
): boolean {
  const avatar = resolveSeatAvatar(seatUi);
  if (!avatar) return false;
  if (!isLayaDisplayNode(label)) return false;
  const addChild = avatar.addChild;
  if (typeof addChild !== 'function') return false;
  if (typeof label.removeSelf === 'function') {
    try { label.removeSelf(); } catch { /* ignore */ }
  }
  addChild.call(avatar, label);
  const w = Number(avatar.width ?? avatar._width ?? avatar.unscaledWidth ?? 120);
  const lw = Number(label.width ?? 168);
  const lh = Number(label.height ?? 26);
  const x = Math.round((w - lw) / 2);
  const y = -lh - 8;
  label.x = x;
  label.y = y;
  label.zOrder = 9999;
  if (typeof label.pos === 'function') label.pos(x, y);
  return true;
}

function findReferenceTextLeaf(manager: UnknownRecord): UnknownRecord | null {
  const queue: UnknownRecord[] = [manager];
  const seen = new WeakSet<object>();
  while (queue.length) {
    const node = queue.shift()!;
    if (seen.has(node)) continue;
    seen.add(node);
    if (node !== manager && typeof node.text === 'string' && node.visible !== false) {
      const nodeName = String(node.name || '');
      if (GUANJIE_NAME.test(nodeName)) continue;
      if (String(node.text).trim().length > 0) return node;
    }
    for (const listKey of ['_children', 'children']) {
      const list = node[listKey];
      if (!Array.isArray(list)) continue;
      for (const child of list) {
        const record = asRecord(child);
        if (record) queue.push(record);
      }
    }
  }
  return null;
}

function polishFallbackLabel(label: UnknownRecord, template: UnknownRecord | null): void {
  label.zOrder = Math.max(Number(label.zOrder ?? 0), 9999);
  if (!label.font) label.font = template?.font ?? 'Microsoft YaHei';
  if (!label.color) label.color = '#FFFFFF';
  if (label.stroke == null) label.stroke = 2;
  if (!label.strokeColor) label.strokeColor = '#000000';
  if (Number(label.scaleX) === 0) label.scaleX = 1;
  if (Number(label.scaleY) === 0) label.scaleY = 1;
  label.mouseEnabled = false;
}

function createFallbackLabel(
  globalObject: GameRuntimeWindow,
  template: UnknownRecord | null
): UnknownRecord | null {
  const win = globalObject as PlayNameLayaWindow;
  const Text = win.Laya?.Text;
  if (!Text) return null;
  const label = asRecord(new Text());
  if (!label || !isLayaDisplayNode(label)) return null;
  label.name = PLAY_NAME_FALLBACK_NAME;
  label.text = '';
  label.fontSize = 20;
  label.color = '#FFFFFF';
  label.stroke = 2;
  label.strokeColor = '#000000';
  label.align = 'center';
  label.valign = 'middle';
  label.width = 168;
  label.height = 26;
  label.mouseEnabled = false;
  if (template) copyLabelStyle(template, label);
  return label;
}

function isLayaDisplayNode(node: UnknownRecord): boolean {
  return typeof node._getBit === 'function' || typeof node._setBit === 'function';
}

function purgeInvalidPlayNameNodes(seatUi: UnknownRecord, manager: UnknownRecord): void {
  const avatar = resolveSeatAvatar(seatUi);
  for (const host of [avatar, manager].filter(Boolean)) {
    const record = asRecord(host);
    if (!record) continue;
    const label = asRecord(record[PLAY_NAME_FALLBACK_KEY]);
    if (!label || isLayaDisplayNode(label)) continue;
    try {
      if (typeof label.removeSelf === 'function') label.removeSelf();
      else if (typeof label.destroy === 'function') label.destroy(true);
    } catch { /* ignore */ }
    delete record[PLAY_NAME_FALLBACK_KEY];
  }
}

function copyLabelStyle(source: UnknownRecord, target: UnknownRecord): void {
  for (const key of [
    'font', 'fontSize', 'color', 'stroke', 'strokeColor', 'bold', 'align', 'valign',
    'leading', 'wordWrap', 'width', 'height', 'scaleX', 'scaleY', 'pivotX', 'pivotY'
  ]) {
    if (key in source) target[key] = source[key];
  }
}

function alignLabelToTemplate(
  label: UnknownRecord,
  template: UnknownRecord | null,
  host: UnknownRecord,
  globalObject: GameRuntimeWindow
): void {
  if (!template) {
    label.x = 6;
    label.y = 2;
    if (typeof label.pos === 'function') label.pos(6, 2);
    return;
  }
  const anchor = toLocalPoint(template, host, Number(template.x ?? 0), Number(template.y ?? 0), globalObject)
    ?? toLocalPoint(template, host, 0, 0, globalObject);
  if (anchor) {
    label.x = anchor.x;
    label.y = anchor.y;
    if (typeof label.pos === 'function') label.pos(anchor.x, anchor.y);
    return;
  }
  label.x = Number(template.x ?? 6);
  label.y = Number(template.y ?? 2);
  if (typeof label.pos === 'function') label.pos(label.x, label.y);
}

function toLocalPoint(
  from: UnknownRecord,
  to: UnknownRecord,
  x: number,
  y: number,
  globalObject: GameRuntimeWindow
): { x: number; y: number } | null {
  try {
    const Point = (globalObject as PlayNameLayaWindow).Laya?.Point;
    const makePoint = (px: number, py: number) => (
      typeof Point === 'function' ? new Point(px, py) : { x: px, y: py }
    );
    const global = typeof from.localToGlobal === 'function'
      ? asRecord((from.localToGlobal as Function).call(from, makePoint(x, y)))
      : { x, y };
    if (!global) return null;
    const local = typeof to.globalToLocal === 'function'
      ? asRecord((to.globalToLocal as Function).call(to, makePoint(Number(global.x), Number(global.y))))
      : global;
    const px = Number(local?.x);
    const py = Number(local?.y);
    return Number.isFinite(px) && Number.isFinite(py) ? { x: px, y: py } : null;
  } catch {
    return null;
  }
}

function toGlobalPoint(
  node: UnknownRecord,
  x: number,
  y: number,
  globalObject: GameRuntimeWindow
): { x: number; y: number } | null {
  try {
    const Point = (globalObject as PlayNameLayaWindow).Laya?.Point;
    const makePoint = (px: number, py: number) => (
      typeof Point === 'function' ? new Point(px, py) : { x: px, y: py }
    );
    if (typeof node.localToGlobal !== 'function') return null;
    const global = asRecord((node.localToGlobal as Function).call(node, makePoint(x, y)));
    const px = Number(global?.x);
    const py = Number(global?.y);
    return Number.isFinite(px) && Number.isFinite(py) ? { x: px, y: py } : null;
  } catch {
    return null;
  }
}

export function readLabelScreenBounds(
  label: UnknownRecord,
  globalObject: GameRuntimeWindow = window
): { x: number; y: number; width: number; height: number; onScreen: boolean } | null {
  const w = Math.max(1, Number(label.width ?? 80));
  const h = Math.max(1, Number(label.height ?? 24));
  const p0 = toGlobalPoint(label, 0, 0, globalObject);
  const p1 = toGlobalPoint(label, w, h, globalObject);
  if (!p0 || !p1) return null;
  const x = Math.min(p0.x, p1.x);
  const y = Math.min(p0.y, p1.y);
  const width = Math.abs(p1.x - p0.x);
  const height = Math.abs(p1.y - p0.y);
  const stage = (globalObject as PlayNameLayaWindow).Laya?.stage;
  const stageW = Number(stage?.width ?? 1920);
  const stageH = Number(stage?.height ?? 1080);
  const onScreen = x + width > 0 && y + height > 0 && x < stageW && y < stageH;
  return { x, y, width, height, onScreen };
}

function readParentChain(node: UnknownRecord | null, depth = 8): { name: string; visible: boolean; alpha: number }[] {
  const chain: { name: string; visible: boolean; alpha: number }[] = [];
  let current = node;
  for (let i = 0; i < depth && current; i += 1) {
    chain.push({
      name: String(current.name || current.constructor?.name || 'node'),
      visible: current.visible !== false,
      alpha: Number(current.alpha ?? 1)
    });
    current = asRecord(current.parent) ?? asRecord(current._parent);
  }
  return chain;
}

function findNodeByName(root: UnknownRecord, targetName: string, depth: number): UnknownRecord | null {
  if (depth > 10) return null;
  if (String(root.name || '') === targetName) return root;
  for (const listKey of ['_children', 'children']) {
    const list = root[listKey];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const child = asRecord(item);
      if (!child) continue;
      const hit = findNodeByName(child, targetName, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function findDisplayHost(manager: UnknownRecord): UnknownRecord | null {
  for (const key of ['topSpr', 'TopSpr', 'uiRoot', 'UIRoot', 'content', 'Content', 'box', 'Box']) {
    const host = asRecord(manager[key]);
    if (host && typeof host.addChild === 'function') return host;
  }
  return typeof manager.addChild === 'function' ? manager : null;
}

function attachChild(host: UnknownRecord, label: UnknownRecord): void {
  if (!isLayaDisplayNode(label)) return;
  if (typeof label.removeSelf === 'function') {
    try { label.removeSelf(); } catch { /* ignore */ }
  }
  const addChild = host.addChild;
  if (typeof addChild === 'function') addChild.call(host, label);
}

function revealNodeChain(node: UnknownRecord): void {
  let current: UnknownRecord | null = node;
  for (let depth = 0; depth < 10 && current; depth += 1) {
    current.visible = true;
    if (typeof current.alpha === 'number' && current.alpha <= 0) current.alpha = 1;
    current = asRecord(current.parent) ?? asRecord(current._parent);
  }
}

function findPlayNameLabelTemplate(globalObject: GameRuntimeWindow): UnknownRecord | null {
  const scene = asRecord(locateGameScene(globalObject));
  const list = asRecord(scene?.seatContainer)?.seatUIs ?? asRecord(scene?.seatContainer)?.seatUis;
  if (!Array.isArray(list)) return null;
  for (const rawSeatUi of list) {
    const seatUi = asRecord(rawSeatUi);
    if (!seatUi) continue;
    const manager = asRecord(seatUi.otherTopManager);
    if (!isEdsManager(manager ?? {})) continue;
    const direct = asRecord(manager?.playerNameTxt) ?? asRecord(manager?.PlayerNameTxt);
    if (direct && 'text' in direct) return direct;
  }
  for (const rawSeatUi of list) {
    const seatUi = asRecord(rawSeatUi);
    const manager = asRecord(seatUi?.otherTopManager);
    const direct = asRecord(manager?.playerNameTxt) ?? asRecord(manager?.PlayerNameTxt);
    if (direct && 'text' in direct) return direct;
  }
  return null;
}

function resolveSeatNickName(
  seat: UnknownRecord | null,
  clientId: unknown,
  globalObject: GameRuntimeWindow,
  seatListIndex: number | null = null
): string {
  const fromSeat = readNickFromSeatBundle(seat);
  if (fromSeat) return fromSeat;
  const id = Number(clientId);
  if (!Number.isFinite(id)) return '';
  const seatIndex = readSeatIndex(seat) ?? seatListIndex;
  return readTableNickName(globalObject, id, seatIndex) ?? '';
}

function readSeatClientId(seat: UnknownRecord | null): unknown {
  const playerInfo = asRecord(seat?.playerInfo) ?? asRecord(seat?.PlayerInfo);
  const direct = playerInfo?.ClientId ?? playerInfo?.clientId;
  if (direct != null && direct !== '') return direct;
  return readNestedClientId(seat);
}

function hydrateSeatPlayerInfo(
  seat: UnknownRecord | null,
  clientId: unknown,
  globalObject: GameRuntimeWindow,
  resolvedName: string
): UnknownRecord | null {
  const playerInfo = asRecord(seat?.playerInfo) ?? asRecord(seat?.PlayerInfo);
  if (!playerInfo) return null;
  const name = resolvedName || (Number.isFinite(Number(clientId))
    ? readTableNickName(globalObject, Number(clientId), readSeatIndex(seat) ?? null) ?? ''
    : '');
  if (!name || readNameFromRecord(playerInfo)) return playerInfo;
  try {
    playerInfo.playerName = name;
    playerInfo.nickName = name;
    playerInfo.NickName = name;
  } catch { /* 只读 */ }
  return playerInfo;
}

function pushPlayerInfoToManagerOnce(manager: UnknownRecord, playerInfo: UnknownRecord, name: string): void {
  const pushed = String(manager[PLAY_NAME_PUSHED_KEY] ?? '');
  if (pushed === name.trim()) return;
  for (const method of PLAYER_INFO_PUSH_METHODS) {
    const fn = manager[method];
    if (typeof fn !== 'function') continue;
    try {
      fn.call(manager, playerInfo);
      manager[PLAY_NAME_PUSHED_KEY] = name.trim();
      return;
    } catch { /* 试下一个 */ }
  }
}

function readSeatIndex(seat: UnknownRecord | null): number | null {
  if (!seat) return null;
  for (const key of ['seatID', 'seatId', 'SeatID', 'SeatId', 'index', 'Index']) {
    const parsed = Number(seat[key]);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 8) continue;
    return parsed === 8 ? 7 : parsed;
  }
  return null;
}

export function readSeatNickNameForDebug(
  seatUi: UnknownRecord,
  globalObject: GameRuntimeWindow = window,
  seatListIndex: number | null = null
): {
  clientId: unknown;
  name: string;
  managers: string[];
  nameLabelCount: number;
  clonedPlayName: boolean;
  mountStrategy: PlayNameMountStrategy;
  playNameLabels: PlayNameLabelSnapshot[];
} {
  const seat = asRecord(seatUi.seat);
  const clientId = readSeatClientId(seat);
  const revealRealId = playNameVisible(clientId) === true && isRankOrDoudizhuScene(globalObject);
  const manager = resolvePlayNameManager(seatUi, revealRealId);
  const name = resolveDisplayName(
    seatUi,
    seat,
    clientId,
    manager ?? {},
    globalObject,
    seatListIndex
  );
  const mountStrategy = (manager?.[PLAY_NAME_MOUNT_KEY] as PlayNameMountStrategy | undefined) ?? 'none';
  const playNameLabels = readPlayNameLabelSnapshots(manager, globalObject, seatUi);
  return {
    clientId,
    name,
    managers: manager ? [String(manager.constructor?.name ?? 'manager')] : [],
    nameLabelCount: playNameLabels.length,
    clonedPlayName: Boolean(manager?.[PLAY_NAME_FALLBACK_KEY]),
    mountStrategy,
    playNameLabels
  };
}

export interface PlayNameLabelSnapshot {
  nodeName: string;
  text: string;
  visible: boolean;
  alpha: number;
  bounds: { x: number; y: number; width: number; height: number; onScreen: boolean } | null;
  parentChain: { name: string; visible: boolean; alpha: number }[];
}

function readPlayNameLabelSnapshots(
  manager: UnknownRecord | null,
  globalObject: GameRuntimeWindow,
  seatUi?: UnknownRecord
): PlayNameLabelSnapshot[] {
  if (!manager) return [];
  const labels: UnknownRecord[] = [];
  const fallback = asRecord(manager[PLAY_NAME_FALLBACK_KEY]);
  if (fallback && 'text' in fallback) labels.push(fallback);
  const avatar = seatUi ? resolveSeatAvatar(seatUi) : null;
  const onAvatar = avatar ? asRecord(avatar[PLAY_NAME_FALLBACK_KEY]) : null;
  if (onAvatar && 'text' in onAvatar && onAvatar !== fallback) labels.push(onAvatar);
  const native = asRecord(manager.playerNameTxt) ?? asRecord(manager.PlayerNameTxt);
  if (native && 'text' in native && native !== fallback && native !== onAvatar) labels.push(native);
  return labels.map((label) => ({
    nodeName: String(label.name || ''),
    text: String(label.text ?? ''),
    visible: label.visible !== false,
    alpha: Number(label.alpha ?? 1),
    bounds: readLabelScreenBounds(label, globalObject),
    parentChain: readParentChain(label)
  }));
}

function readTableNickName(
  globalObject: GameRuntimeWindow,
  clientId: number,
  seatIndex: number | null
): string | null {
  if (resolvePlayNameSyncMode(globalObject) === 'minimal') return null;
  const deepRoom = activeScanCache?.forceFull === true;
  const ordered = activeScanCache?.tableRows ?? collectOrderedTableSeatEntries(globalObject, deepRoom);
  if (activeScanCache && !activeScanCache.tableRows) {
    activeScanCache.tableRows = ordered;
  }
  for (const row of ordered) {
    const rowId = Number(readNestedClientId(row));
    const rowSeat = readDatumSeatIndex(row);
    const idMatch = Number.isFinite(rowId) && rowId === clientId;
    const seatMatch = seatIndex !== null && rowSeat !== null && rowSeat === seatIndex;
    if (!idMatch && !seatMatch) continue;
    const nick = readNickFromDatumEntry(row);
    if (nick) return nick;
  }
  if (seatIndex !== null && seatIndex >= 0 && seatIndex < ordered.length) {
    const nick = readNickFromDatumEntry(ordered[seatIndex]);
    if (nick) return nick;
  }
  return readNameFromGameScene(globalObject, clientId, seatIndex);
}

function collectOrderedTableSeatEntries(globalObject: GameRuntimeWindow, deepRoom = false): UnknownRecord[] {
  const rawEntries: { value: unknown; index: number; seatIndex: number | null }[] = [];
  let order = 0;
  for (const pack of iterTableSeatPacks(globalObject, deepRoom)) {
    const list = asSeatList(pack);
    for (const value of list) {
      rawEntries.push({ value, index: order, seatIndex: readDatumSeatIndex(value) });
      order += 1;
    }
  }
  if (!rawEntries.length) return [];
  return orderSeatEntries(rawEntries)
    .map((entry) => asRecord(entry.value))
    .filter((entry): entry is UnknownRecord => entry !== null);
}

function iterTableSeatPacks(globalObject: GameRuntimeWindow, deepRoom = false): UnknownRecord[] {
  const packs: UnknownRecord[] = [];
  const room = locateRoomController(globalObject, deepRoom);
  if (room) {
    for (const key of ['TabbleSeatInfos', 'tabbleSeatInfos', 'TableSeatInfos', 'tableSeatInfos'] as const) {
      const record = asRecord(room[key]);
      if (record) packs.push(record);
    }
  }
  const scene = asRecord(locateGameScene(globalObject));
  if (scene) {
    for (const key of ['TabbleSeatInfos', 'tabbleSeatInfos', 'TableSeatInfos', 'tableSeatInfos'] as const) {
      const record = asRecord(scene[key]);
      if (record) packs.push(record);
    }
  }
  return packs;
}

function readNickFromDatumEntry(value: unknown): string {
  const record = asRecord(value);
  if (!record) return '';
  const sources = [
    record,
    asRecord(record.SeatPlayerInfo),
    asRecord(record.seatPlayerInfo),
    asRecord(record.playerInfo),
    asRecord(record.PlayerInfo),
    asRecord(record.WaitInfo),
    asRecord(record.waitInfo),
    asRecord(record.data),
    asRecord(record.Data),
    asRecord(record.value),
    asRecord(record.Value)
  ].filter((entry): entry is UnknownRecord => entry !== null);
  for (const source of sources) {
    const nick = pickFirstNick(
      readNameFromRecord(source),
      readNameFromRecord(asRecord(source.userInfo)),
      readNameFromRecord(asRecord(source.UserInfo))
    );
    if (nick) return nick;
  }
  return '';
}

function orderSeatEntries<T extends { index: number; seatIndex: number | null }>(entries: T[]): T[] {
  const known = entries.map((entry) => entry.seatIndex).filter((value): value is number => value !== null);
  const oneBased = known.some((value) => value >= 8);
  const normalized = entries.map((entry) => ({
    ...entry,
    seatIndex: entry.seatIndex === null ? null : entry.seatIndex - (oneBased ? 1 : 0)
  }));
  return normalized.sort((left, right) => {
    if (left.seatIndex === null && right.seatIndex === null) return left.index - right.index;
    if (left.seatIndex === null) return 1;
    if (right.seatIndex === null) return -1;
    return left.seatIndex - right.seatIndex;
  });
}

function asSeatList(pack: UnknownRecord): unknown[] {
  const raw = pack.datum ?? pack.Datum ?? pack.list ?? pack.objs ?? pack;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && typeof (raw as { length?: unknown }).length === 'number') {
    return Array.from(raw as ArrayLike<unknown>);
  }
  const record = asRecord(raw);
  return record ? Object.values(record) : [];
}

function readNameFromGameScene(
  globalObject: GameRuntimeWindow,
  clientId: number,
  seatIndex: number | null
): string | null {
  const scene = asRecord(locateGameScene(globalObject));
  if (!scene) return null;
  const bags: unknown[] = [];
  for (const key of ['playerInfos', 'PlayerInfos', 'players', 'Players', 'replayPlayers', 'ReplayPlayers']) {
    const value = scene[key];
    if (Array.isArray(value)) bags.push(...value);
  }
  for (const entry of bags) {
    const row = asRecord(entry);
    if (!row) continue;
    const rowId = Number(readNestedClientId(row));
    const rowSeat = readDatumSeatIndex(row) ?? readSeatIndex(row);
    const idMatch = Number.isFinite(rowId) && rowId === clientId;
    const seatMatch = seatIndex !== null && rowSeat !== null && rowSeat === seatIndex;
    if (!idMatch && !seatMatch) continue;
    const nick = readNickFromDatumEntry(row);
    if (nick) return nick;
  }
  return null;
}

function readDatumSeatIndex(value: unknown): number | null {
  const record = asRecord(value);
  if (!record) return null;
  const sources = [
    record,
    asRecord(record.SeatPlayerInfo),
    asRecord(record.seatPlayerInfo),
    asRecord(record.playerInfo),
    asRecord(record.PlayerInfo),
    asRecord(record.data),
    asRecord(record.Data)
  ].filter((entry): entry is UnknownRecord => entry !== null);
  for (const source of sources) {
    for (const key of ['SeatID', 'SeatId', 'seatID', 'seatId', 'SeatIndex', 'seatIndex', 'Index', 'index']) {
      const parsed = Number(source[key]);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 8) continue;
      return parsed === 8 ? 7 : parsed;
    }
  }
  return null;
}

function locateRoomController(globalObject: GameRuntimeWindow, deep = false): UnknownRecord | null {
  const win = globalObject as UnknownRecord;
  const cache = asRecord(win.__xcPlayNameRoomCache);
  const now = Date.now();
  if (cache && now - Number(cache.at ?? 0) < 30_000 && cache.room) {
    return asRecord(cache.room);
  }

  const locator = createLayaObjectLocator(globalObject);
  const context = asRecord(asRecord(globalObject as UnknownRecord).GameContext)
    ?? locator.gameContext();
  const candidates = [
    locator.manager('RoomControler'),
    locator.manager('RoomController'),
    asRecord(context?.RoomControler),
    asRecord(context?.roomControler),
    locator.managerFromList((manager) => hasTableSeatPack(manager))
  ];
  for (const room of candidates) {
    if (room && hasTableSeatPack(room)) {
      win.__xcPlayNameRoomCache = { at: now, room };
      return room;
    }
  }
  if (!deep) return null;

  const dispatcher = locateGameEventDispatcher(globalObject);
  const events = asRecord(dispatcher?._events);
  if (!events) return null;
  for (const listeners of Object.values(events)) {
    const list = Array.isArray(listeners) ? listeners : [listeners];
    for (const listener of list) {
      const caller = asRecord(asRecord(listener)?.caller);
      if (hasTableSeatPack(caller)) {
        win.__xcPlayNameRoomCache = { at: now, room: caller };
        return caller;
      }
    }
  }
  return null;
}

function hasTableSeatPack(record: UnknownRecord | null | undefined): boolean {
  if (!record) return false;
  return Boolean(
    record.TabbleSeatInfos
    || record.tabbleSeatInfos
    || record.TableSeatInfos
    || record.tableSeatInfos
    || record.TableSetting
    || record.tableSetting
  );
}

function pickFirstNick(...candidates: string[]): string {
  for (const candidate of candidates) {
    const text = candidate.trim();
    if (text) return text;
  }
  return '';
}

function readNickFromSeatBundle(seat: UnknownRecord | null, manager?: UnknownRecord | null): string {
  return pickFirstNick(
    readManagerLabelText(manager ?? null),
    readNameFromRecord(seat),
    readNameFromRecord(asRecord(seat?.playerInfo)),
    readNameFromRecord(asRecord(seat?.PlayerInfo))
  );
}

function readNameFromRecord(record: UnknownRecord | null): string {
  if (!record) return '';
  for (const key of ['playerName', 'nickName', 'NickName', 'name', 'Name', 'UserName', 'userName']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

/**
 * 身份演武中的自选身份 / 自选反贼 / 自选主忠：按房间座位顺序显示身份。
 */

import { createLayaObjectLocator } from '../../adapters/laya-object-locator.ts';
import { locateGameEventDispatcher, locateGameScene, type GameRuntimeWindow } from '../seat-display/game-scene-locator.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import {
  figureByClientOrder,
  figureConflicts,
  figureForChooseIdentityOrder,
  isChooseFigureSetting,
  isExplicitChooseFigure,
  isIdentityFigure,
  resolveSeatFigure,
  shouldRevealIdentityFigures
} from './choose-figure.ts';

type UnknownRecord = Record<string, unknown>;
const DEBUG_KEY = '__XIAOCHAO_CHOOSE_FIGURE_DEBUG__';
/** 断线重连会重载页面，锁定的身份存这里，重载后接着用。 */
const FIGURE_LOCK_KEY = '__XIAOCHAO_CHOOSE_FIGURE_LOCK__';
const FIGURE_LOCK_VERSION = 4;

function sessionStore(globalObject: GameRuntimeWindow): Storage {
  return (globalObject as unknown as { sessionStorage: Storage }).sessionStorage;
}

interface ChooseFigureDebugState {
  enabled: true;
  history: Array<Record<string, unknown>>;
  last: Record<string, unknown> | null;
  clear(): void;
}

/** 挂上轮询：进局后反复尝试，直到房间座位和武将牌都就绪。 */
export function installChooseFigureController(
  globalObject: GameRuntimeWindow = window,
  gameEvents?: GameEventBus
): () => void {
  let stableClientIds: string[] = [];
  let stableRoomKey = '';
  /** 本局锁定的「账号 → 身份」。座位顺序再怎么变，同一个人的身份不变。 */
  const lockedFigures = new Map<string, number>();
  /** 本局锁定的「座位 → 身份」。重连后读不到账号时用它兜底，保证身份不变。 */
  const lockedBySeat = new Map<number, number>();
  /** 按昵称记住身份。重连后座位号会变，昵称还在。 */
  const lockedByName = new Map<string, number>();
  /** 上一次写进会话缓存的座位锁定条数，避免每轮都写。 */
  let persistedSeatCount = -1;
  /** 断线重连后不再重画身份：座位对象是新建的，对应关系一变就会把人画错。 */
  let frozenAfterReconnect = false;
  /** 缓存属于哪个房间。换房间时旧缓存必须作废，否则会拿上一局的身份顶替。 */
  let cachedRoomKey = '';
  /** 刚和游戏给的身份对不上、被作废的那份房间顺序，不再重复认。 */
  let rejectedOrderKey = '';
  // 断线重连会重载页面，内存里的记录会丢，所以从会话存储恢复上一次锁定的身份。
  try {
    const raw = sessionStore(globalObject).getItem(FIGURE_LOCK_KEY);
    const saved = raw ? JSON.parse(raw) as { version?: unknown; clientIds?: unknown; figures?: unknown; roomKey?: unknown } : null;
    if (saved?.version !== FIGURE_LOCK_VERSION) throw new Error('stale');
    if (typeof saved?.roomKey === 'string') cachedRoomKey = saved.roomKey;
    if (Array.isArray(saved?.clientIds)) stableClientIds = saved.clientIds.map((value) => String(value));
    if (saved?.figures && typeof saved.figures === 'object') {
      for (const [clientId, figure] of Object.entries(saved.figures as Record<string, unknown>)) {
        const value = Number(figure);
        if (Number.isInteger(value) && value > 0) lockedFigures.set(clientId, value);
      }
    }
    if (saved?.figuresBySeat && typeof saved.figuresBySeat === 'object') {
      for (const [seatId, figure] of Object.entries(saved.figuresBySeat as Record<string, unknown>)) {
        const key = Number(seatId);
        const value = Number(figure);
        if (Number.isInteger(key) && Number.isInteger(value) && value > 0) lockedBySeat.set(key, value);
      }
    }
    if (saved?.figuresByName && typeof saved.figuresByName === 'object') {
      for (const [name, figure] of Object.entries(saved.figuresByName as Record<string, unknown>)) {
        const value = Number(figure);
        if (name && Number.isInteger(value) && value > 0) lockedByName.set(name, value);
      }
    }
    if (lockedFigures.size || lockedByName.size) frozenAfterReconnect = true;
  } catch {
    // 会话存储不可用时按没锁定处理。
  }
  let lastDebugSignature = '';
  let lastDebugAt = 0;
  const debug = createDebugState(globalObject);
  const timer = globalObject.setInterval(applyChooseFigures, 1000);
  const unsubscribe = gameEvents?.subscribe((event) => {
    if (event.type === 'game-reconnected') {
      // 手里真有锁定才需要冻结。没有锁定可保的时候也冻结，会把之后每一局都锁死，
      // 只能退回按画面座位号猜，反而猜出第二个主公。
      if (lockedFigures.size || lockedByName.size || lockedBySeat.size) frozenAfterReconnect = true;
      recordDebug(debug, { event: 'game-reconnected', stableRoomKey, stableClientTokens: stableClientIds.map(clientToken) });
    }
    if (event.type === 'game-ended' && event.settled) {
      // 断线、离桌、场景重建也会报一局结束，那些不能清。只有结算后下一局才重算。
      recordDebug(debug, { event: 'game-ended', stableRoomKey, stableClientTokens: stableClientIds.map(clientToken) });
      clearFigureLock();
    }
  });
  applyChooseFigures();
  return () => {
    globalObject.clearInterval(timer);
    unsubscribe?.();
  };

  function persistFigureLock(): void {
    try {
      sessionStore(globalObject).setItem(FIGURE_LOCK_KEY, JSON.stringify({
        version: FIGURE_LOCK_VERSION,
        roomKey: cachedRoomKey,
        clientIds: stableClientIds,
        figures: Object.fromEntries(lockedFigures),
        figuresByName: Object.fromEntries(lockedByName),
        figuresBySeat: Object.fromEntries(lockedBySeat)
      }));
    } catch {
      // 会话存储不可用时只保留内存里的锁定。
    }
  }

  function clearFigureLock(): void {
    stableClientIds = [];
    stableRoomKey = '';
    lockedFigures.clear();
    lockedBySeat.clear();
    lockedByName.clear();
    persistedSeatCount = -1;
    cachedRoomKey = '';
    frozenAfterReconnect = false;
    rejectedOrderKey = '';
    try {
      sessionStore(globalObject).removeItem(FIGURE_LOCK_KEY);
    } catch {
      // 会话存储不可用时忽略。
    }
  }

  function applyChooseFigures(): void {
    try {
      const locator = createLayaObjectLocator(globalObject);
      const room = roomController(globalObject);
      const setting = asRecord(room?.TableSetting) ?? asRecord(room?.tableSetting);
      const mode = readMode(globalObject, room, setting);
      const settingSnapshot = readIdentitySettingSnapshot(setting);
      if (!shouldRevealIdentityFigures({
        modeText: mode.modeText,
        modeType: mode.modeType,
        chooseFigure: mode.chooseFigure,
        chooseFigureExplicit: mode.chooseFigureExplicit
      })) {
        const debugSnapshot = {
          event: 'poll', roomKey: readRoomKey(room), setting: settingSnapshot,
          modeText: mode.modeText, modeType: mode.modeType, chooseMode: mode.chooseFigure, modeEnabled: false
        };
        const signature = JSON.stringify(debugSnapshot);
        const now = Date.now();
        if (signature !== lastDebugSignature || now - lastDebugAt >= 2000) {
          recordDebug(debug, debugSnapshot);
          lastDebugSignature = signature;
          lastDebugAt = now;
        }
        return;
      }
      const currentClientIds = readClientIds(
        asRecord(room?.TabbleSeatInfos)
        ?? asRecord(room?.tabbleSeatInfos)
        ?? asRecord(room?.TableSeatInfos)
        ?? asRecord(room?.tableSeatInfos)
      );
      if (currentClientIds.length !== 8) {
        recordDebug(debug, {
          event: 'poll', diagnostic: 'room-seat-list-not-ready',
          roomKey: readRoomKey(room), modeText: mode.modeText, modeType: mode.modeType,
          chooseMode: mode.chooseFigure, modeEnabled: true,
          seatListLength: readSeatListLength(room)
        });
      }
      const roomKey = readRoomKey(room);
      const scene = seatScene(globalObject, locator);
      const seatUis = readSeatUis(scene);
      /** 牌局场景存在就是在局内。 */
      const inMatch = readSeatUis(asRecord(locateGameScene(globalObject))).length > 0;
      const seatReads = seatUis.map((seatUi) => {
        const seat = asRecord(seatUi.seat);
        const manager = asRecord(seatUi.figureManager) ?? asRecord(seatUi.FigureManager);
        return {
          seatUi,
          manager,
          clientId: readSeatClientId(seat),
          seatName: readSeatName(seat),
          seatId: readSeatId(seat),
          isSelf: seatUi === scene?.SelfSeatUi,
          /** 这一轮还没写过任何东西时，这里读到的就是游戏给的身份。 */
          gameFigure: Number(manager?.Figure)
        };
      });
      const selfRead = seatReads.find((read) => read.isSelf) ?? null;
      const selfGameFigure = isIdentityFigure(selfRead?.gameFigure) ? Number(selfRead?.gameFigure) : 0;
      const hasLock = lockedFigures.size > 0 || lockedByName.size > 0 || lockedBySeat.size > 0;
      // 房间座位表才是身份顺序，画面座位号不是。认身份的两个时机：
      // 一是在房间里，二是手里已经没有锁定的时候，重连丢过一次锁就靠这一步捡回来。
      // 手里有锁又已经进局就绝不重认：重连后房间对象会重建、顺序会变，重认等于把主公认丢。
      const accountsReadable = currentClientIds.filter((clientId) => clientId).length >= 2;
      const orderKey = currentClientIds.join(',');
      const canCapture = currentClientIds.length === 8 && accountsReadable && (!inMatch || !hasLock)
        // 刚被作废过的那份顺序不再重复认，否则每轮都会重认一次再作废一次。
        && orderKey !== rejectedOrderKey;
      let mappingRebuilt = false;
      if (canCapture && (orderKey !== stableClientIds.join(',') || roomKey !== cachedRoomKey)) {
        stableClientIds = currentClientIds;
        stableRoomKey = roomKey;
        cachedRoomKey = roomKey;
        lockedFigures.clear();
        lockedByName.clear();
        lockedBySeat.clear();
        frozenAfterReconnect = false;
        for (const clientId of stableClientIds) {
          const figure = figureByClientOrder(stableClientIds, clientId);
          if (clientId && figure > 0) lockedFigures.set(clientId, figure);
        }
        persistFigureLock();
        mappingRebuilt = true;
        recordDebug(debug, {
          event: 'capture', roomKey, inMatch,
          stableClientTokens: stableClientIds.map(clientToken)
        });
      }
      const seatMappings: Array<Record<string, unknown>> = [];
      // 按这份锁定算出每个座位该显示什么身份。
      const planned = seatReads.map((read) => {
        const seatOrder = seatOrderIndex(read.seatId);
        const decision = resolveSeatFigure({
          isSelf: read.isSelf,
          byAccount: read.clientId ? lockedFigures.get(read.clientId) : undefined,
          byName: read.seatName ? lockedByName.get(read.seatName) : undefined,
          bySeat: read.seatId !== null ? lockedBySeat.get(read.seatId) : undefined,
          byRoomOrder: figureByClientOrder(stableClientIds, read.clientId),
          // 局内不按画面座位号猜：那不是身份顺序，猜出来会多出一个主公。
          bySeatIndex: !inMatch && !lockedFigures.size && seatOrder !== null
            ? figureForChooseIdentityOrder(seatOrder)
            : 0
        });
        return { read, decision };
      });
      // 刚认出来的这份顺序要先和游戏已经给出来的身份对一遍，对不上就整份作废：
      // 自己那格是服务器给的，重连后它最能说明这份顺序是不是这一局的。
      const knownConflicts = planned.filter(({ read, decision }) => (
        shouldTrustGameFigure(read) && figureConflicts(decision.figure, read.gameFigure)
      ));
      if (knownConflicts.length > 0) {
        recordDebug(debug, {
          event: 'mapping-rejected', roomKey, inMatch, rebuilt: mappingRebuilt,
          conflicts: knownConflicts.map(({ read, decision }) => ({
            seatToken: clientToken(read.clientId),
            gameFigure: read.gameFigure,
            mappedFigure: decision.figure
          }))
        });
        // 同一份顺序只作废一次：作废后不再重认，免得每轮重认一遍再作废一遍。
        clearFigureLock();
        rejectedOrderKey = orderKey;
      }
      for (const { read, decision } of planned) {
        const { figure, source } = decision;
        const writable = decision.writable && knownConflicts.length === 0;
        // 只把「账号锁定 / 房间顺序」这两个可信来源记下来：画面座位号只是进房前的
        // 垫底猜测，一旦当成锁定，后面房间顺序算对了也翻不回来。
        const trusted = source === '账' || source === '序';
        if (!frozenAfterReconnect && trusted && figure > 0 && knownConflicts.length === 0) {
          if (read.seatName && !lockedByName.has(read.seatName)) lockedByName.set(read.seatName, figure);
          if (read.seatId !== null && lockedBySeat.get(read.seatId) !== figure) lockedBySeat.set(read.seatId, figure);
        }
        if (writable && figure > 0) revealFigure(read.manager, figure);
        seatMappings.push({
          seatId: read.seatId,
          clientToken: clientToken(read.clientId),
          isSelf: read.isSelf,
          currentFigure: read.gameFigure,
          expectedFigure: figure,
          writable
        });
      }
      // 两份锁定都写进会话缓存：按账号的一份用于重连后仍读得到账号，
      // 按座位的一份用于重连后账号读不出来时兜底，保证身份不变。
      const rememberedCount = lockedByName.size + lockedFigures.size;
      if (rememberedCount && rememberedCount !== persistedSeatCount) {
        persistedSeatCount = rememberedCount;
        persistFigureLock();
      }
      const debugSnapshot = {
        event: 'poll',
        roomKey,
        setting: settingSnapshot,
        modeText: mode.modeText,
        modeType: mode.modeType,
        chooseMode: mode.chooseFigure,
        modeEnabled: true,
        selfFigure: figureName(selfGameFigure),
        inMatch,
        frozenAfterReconnect,
        currentClientTokens: currentClientIds.map(clientToken),
        stableRoomKey,
        stableClientTokens: stableClientIds.map(clientToken),
        seats: seatMappings
      };
      const signature = JSON.stringify(debugSnapshot);
      const now = Date.now();
      if (signature !== lastDebugSignature || now - lastDebugAt >= 2000) {
        recordDebug(debug, debugSnapshot);
        lastDebugSignature = signature;
        lastDebugAt = now;
      }
    } catch (error) {
      recordDebug(debug, {
        event: 'error',
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      });
    }
  }
}

function readSeatListLength(room: UnknownRecord | null): number {
  const seats = asRecord(room?.TabbleSeatInfos)
    ?? asRecord(room?.tabbleSeatInfos)
    ?? asRecord(room?.TableSeatInfos)
    ?? asRecord(room?.tableSeatInfos);
  if (!seats) return 0;
  const raw = seats.datum ?? seats.Datum ?? seats.list ?? seats.objs ?? seats;
  return Array.isArray(raw) || (raw && typeof raw === 'object' && typeof (raw as { length?: unknown }).length === 'number')
    ? Number((raw as { length: number }).length)
    : 0;
}

/** 模式名可能只存在于游戏上下文或房间设置文字中。 */
function readMode(
  globalObject: GameRuntimeWindow,
  room: UnknownRecord | null,
  setting: UnknownRecord | null
): { modeText: string; modeType: number; chooseFigure: boolean; chooseFigureExplicit: boolean } {
  const scene = asRecord(locateGameScene(globalObject));
  const topMenu = asRecord(scene?.topMenu);
  const area = asRecord(topMenu?.areaServerLabel);
  const parts: unknown[] = [area?.text, scene?.modeName, scene?.ModeName];
  const context = createLayaObjectLocator(globalObject).gameContext()
    ?? asRecord((globalObject as unknown as UnknownRecord).GameContext);
  let modeType = 0;
  try {
    const getModeVo = context?.GetModeVO;
    const vo = typeof getModeVo === 'function' ? asRecord(getModeVo.call(context)) : null;
    const getModeType = context?.GetModeType;
    const rawModeType = vo?.ModeType ?? vo?.modeType
      ?? (typeof getModeType === 'function' ? getModeType.call(context) : 0);
    modeType = Number(rawModeType) || 0;
    parts.push(
      vo?.ModeName, vo?.modeName, vo?.Name, vo?.name,
      vo?.SectionName, vo?.sectionName, vo?.ModelName, vo?.modelName,
      vo?.SectionDesc, vo?.Desc, vo?.desc
    );
  } catch {
    // 模式名读失败时继续看房间设置里的文字。
  }
  collectChinese(setting, parts);
  collectChinese(room, parts);
  const chooseFigureExplicit = isExplicitChooseFigure(setting) || isExplicitChooseFigure(room);
  return {
    modeText: parts.filter((part): part is string => typeof part === 'string').join(' '),
    modeType,
    chooseFigure: isChooseFigureSetting(setting) || isChooseFigureSetting(room),
    chooseFigureExplicit
  };
}

function collectChinese(record: UnknownRecord | null, parts: unknown[]): void {
  if (!record) return;
  for (const value of Object.values(record)) {
    if (typeof value === 'string' && /[\u4e00-\u9fff]/.test(value)) parts.push(value);
  }
}

function createDebugState(globalObject: GameRuntimeWindow): ChooseFigureDebugState {
  const host = globalObject as unknown as UnknownRecord;
  const existing = asRecord(host[DEBUG_KEY]);
  if (existing && Array.isArray(existing.history)) return existing as unknown as ChooseFigureDebugState;
  const state: ChooseFigureDebugState = {
    enabled: true,
    history: [],
    last: null,
    clear() { state.history.length = 0; state.last = null; }
  };
  host[DEBUG_KEY] = state;
  return state;
}

function recordDebug(state: ChooseFigureDebugState, entry: Record<string, unknown>): void {
  const record = { at: new Date().toISOString(), ...entry };
  state.last = record;
  state.history.push(record);
  if (state.history.length > 100) state.history.splice(0, state.history.length - 100);
}

/** 读取房间标识，防止同一页面切到另一房间时沿用旧账号顺序。 */
function readRoomKey(room: UnknownRecord | null): string {
  if (!room) return '';
  for (const key of ['RoomID', 'RoomId', 'roomID', 'roomId', 'TableID', 'TableId', 'tableId', 'RoomNo']) {
    const value = room[key];
    if (value === null || value === undefined || value === '') continue;
    return String(value);
  }
  return '';
}

function readIdentitySettingSnapshot(setting: UnknownRecord | null): Record<string, unknown> {
  if (!setting) return {};
  return Object.fromEntries(Object.entries(setting)
    .filter(([key, value]) => /choose|select|figure|identity|rebel|lord|loyal|zhong|fan|zhu|role/i.test(key)
      && ['string', 'number', 'boolean'].includes(typeof value)));
}

/** 房间单例没有固定入口，按管理器列表、类名和事件监听者依次找。 */
function roomController(globalObject: GameRuntimeWindow): UnknownRecord | null {
  const globals = globalObject as UnknownRecord;
  const locator = createLayaObjectLocator(globalObject);
  const windowManager = locator.manager('WindowManager');
  const managerList = asRecord(windowManager?.constructor)?.managerList;
  const named = [
    // 旧版就是按类名 RoomControler 从注册表取房间单例的，优先走这条。
    asRecord(locator.manager('RoomControler')),
    asRecord(locator.manager('RoomController')),
    roomFromReady(locator),
    firstRoom(Array.isArray(managerList) ? managerList : []),
    lookupNamed(globals, 'RoomControler'),
    asRecord(asRecord(globals.GameContext)?.RoomControler),
    asRecord(asRecord(globals.GameContext)?.roomControler),
    nestedRoom(locator.gameContext())
  ];
  for (const room of named) {
    if (room) return room;
  }
  const dispatcher = locateGameEventDispatcher(globalObject);
  const events = asRecord(dispatcher?._events);
  if (!events) return null;
  for (const listeners of Object.values(events)) {
    const list = Array.isArray(listeners) ? listeners : [listeners];
    for (const listener of list) {
      const caller = asRecord(asRecord(listener)?.caller);
      if (hasTableSetting(caller)) return caller;
    }
  }
  return null;
}

/** 进房应答的监听者就是房间对象。 */
function roomFromReady(locator: ReturnType<typeof createLayaObjectLocator>): UnknownRecord | null {
  const events = asRecord(locator.manager('ServerProxy')?._events);
  const listeners = events?.GsCReadyResp;
  const list = Array.isArray(listeners) ? listeners : [listeners];
  for (const listener of list) {
    const caller = asRecord(asRecord(listener)?.caller);
    if (hasTableSetting(caller)) return caller;
  }
  return null;
}

/** 牌局优先；人还在等待房间时用当前场景上的座位。 */
function seatScene(
  globalObject: GameRuntimeWindow,
  locator: ReturnType<typeof createLayaObjectLocator>
): UnknownRecord | null {
  const game = asRecord(locateGameScene(globalObject));
  if (readSeatUis(game).length > 0) return game;
  const current = asRecord(locator.scene());
  if (readSeatUis(current).length > 0) return current;
  return null;
}

function firstRoom(list: unknown[]): UnknownRecord | null {
  for (const item of list) {
    const record = asRecord(item);
    if (hasTableSetting(record)) return record;
  }
  return null;
}

function nestedRoom(context: UnknownRecord | null): UnknownRecord | null {
  if (!context) return null;
  for (const value of Object.values(context)) {
    const record = asRecord(value);
    if (hasTableSetting(record)) return record;
  }
  return null;
}

function lookupNamed(globals: UnknownRecord, name: string): UnknownRecord | null {
  for (const runtime of [asRecord(globals.zy), asRecord(globals.laya), asRecord(globals.Laya)]) {
    const lookup = runtime?.class;
    if (typeof lookup !== 'function') continue;
    try {
      const found = lookup.call(runtime, name);
      const record = asRecord(found);
      if (hasTableSetting(record)) return record;
      if (typeof found === 'function') {
        const ctor = found as { instance?: unknown; I?: unknown; prototype?: object };
        const instance = asRecord(ctor.instance) ?? asRecord(ctor.I);
        if (hasTableSetting(instance)) return instance;
      }
    } catch {
      // 换下一个入口。
    }
  }
  try {
    const classUtils = asRecord(asRecord(globals.Laya)?.ClassUtils);
    const getClass = classUtils?.getClass;
    if (typeof getClass !== 'function') return null;
    const ctor = getClass.call(classUtils, name) as { instance?: unknown; I?: unknown } | undefined;
    return asRecord(ctor?.instance) ?? asRecord(ctor?.I);
  } catch {
    return null;
  }
}

function hasTableSetting(value: UnknownRecord | null): boolean {
  return !!(value && (value.TableSetting || value.tableSetting || value.TabbleSeatInfos || value.tabbleSeatInfos || value.TableSeatInfos));
}

/** 只接受正好 8 个座位的账号表，空位保留位置，不能滤掉后错位。 */
function readClientIds(seats: UnknownRecord | null): string[] {
  if (!seats) return [];
  const raw = seats.datum ?? seats.Datum ?? seats.list ?? seats.objs ?? seats;
  const list = asList(raw);
  // 名单顺序必须等于座位顺序，否则身份会整体错位。带座位号时按座位号排一遍。
  const ordered = orderSeatEntries(list.map((value, index) => ({
    value,
    index,
    seatIndex: readDatumSeatIndex(value)
  }))).map((entry) => entry.value);
  const ids = ordered.map(readDatumClientId);
  return ids.length === 8 ? ids : [];
}

/** 画面上的座位号。8 号位改成序号 7，0 到 7 保持原样。 */
function seatOrderIndex(seatId: number | null): number | null {
  if (seatId === null) return null;
  if (seatId === 8) return 7;
  if (seatId >= 0 && seatId < 8) return seatId;
  return null;
}

/**
 * 按座位号排队。没有座位号的人不能占到 0 号，否则主公会整桌错一位。
 * 座位号如果是 1 到 8，先改成从 0 开始再排。
 */
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

/** 名单每一项自带的座位号，没有就返回 null。 */
function readDatumSeatIndex(value: unknown): number | null {
  const record = asRecord(value);
  if (!record) return null;
  const sources = [
    record,
    asRecord(record.SeatPlayerInfo),
    asRecord(record.seatPlayerInfo),
    asRecord(record.playerInfo),
    asRecord(record.PlayerInfo),
    asRecord(record.data)
  ].filter((entry): entry is UnknownRecord => entry !== null);
  for (const source of sources) {
    for (const key of ['SeatID', 'SeatId', 'seatID', 'seatId', 'SeatIndex', 'seatIndex', 'Index', 'index']) {
      const parsed = Number(source[key]);
      if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 8) return parsed;
    }
  }
  return null;
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && typeof (value as { length?: unknown }).length === 'number') {
    return Array.from(value as ArrayLike<unknown>);
  }
  return [];
}

/** 扩展自己写过的座位：写过的值不能再当成游戏给的身份来校验。 */
const writtenManagers = new WeakSet<object>();

/** 游戏还没被我们改写过的座位，它上面的身份才是服务器给的，能用来校验。 */
function shouldTrustGameFigure(read: { manager: UnknownRecord | null; gameFigure: number }): boolean {
  return !!read.manager && !writtenManagers.has(read.manager) && isIdentityFigure(read.gameFigure);
}

/** 身份还没写成目标值时才调用 SetFigure，避免每轮轮询重绘。 */
function revealFigure(manager: UnknownRecord | null, figure: number): void {
  if (!manager || figure <= 0 || Number(manager.Figure) === figure) return;
  writtenManagers.add(manager);
  if (typeof manager.SetFigure === 'function') {
    try { manager.SetFigure(figure); } catch { /* 单座位失败不影响其他人。 */ }
    return;
  }
  manager.Figure = figure;
}

function readDatumClientId(value: unknown): string {
  const record = asRecord(value);
  const seatPlayer = asRecord(record?.SeatPlayerInfo)
    ?? asRecord(record?.seatPlayerInfo)
    ?? asRecord(record?.playerInfo)
    ?? asRecord(record?.data)
    ?? asRecord(record?.Data)
    ?? asRecord(record?.value)
    ?? record;
  return normalizeId(seatPlayer?.ClientId ?? seatPlayer?.clientId ?? seatPlayer?.ClientID);
}

function readSeatName(seat: UnknownRecord | null): string {
  const sources = [seat, asRecord(seat?.playerInfo), asRecord(seat?.PlayerInfo)];
  for (const source of sources) {
    if (!source) continue;
    for (const key of ['playerName', 'nickName', 'NickName', 'name', 'Name', 'UserName', 'userName']) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return '';
}

function readSeatClientId(seat: UnknownRecord | null): string {
  const sources = [
    seat,
    asRecord(seat?.playerInfo),
    asRecord(seat?.PlayerInfo),
    asRecord(seat?.SeatPlayerInfo),
    asRecord(seat?.seatPlayerInfo),
    asRecord(seat?.data),
    asRecord(seat?.Data)
  ];
  for (const source of sources) {
    if (!source) continue;
    const id = normalizeId(source.ClientId ?? source.clientId ?? source.ClientID ?? source.clientID);
    if (id) return id;
  }
  return '';
}

function figureName(figure: number): string {
  if (figure === 1) return '主公';
  if (figure === 2) return '忠臣';
  if (figure === 3) return '反贼';
  if (figure === 4) return '内奸';
  return '无';
}

function readSeatId(seat: UnknownRecord | null): number | null {
  if (!seat) return null;
  for (const key of ['seatID', 'seatId', 'SeatID', 'SeatId', 'index', 'Index']) {
    const value = Number(seat[key]);
    if (Number.isInteger(value) && value >= 0 && value < 0xff) return value;
  }
  return null;
}

/** 调试记录只保留账号编号的稳定短指纹，不写出原始 ClientId。 */
function clientToken(value: string): string {
  if (!value) return '';
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeId(value: unknown): string {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? String(id) : '';
}

function readSeatUis(scene: UnknownRecord | null): UnknownRecord[] {
  const container = asRecord(scene?.seatContainer);
  const list = container?.seatUIs ?? container?.seatUis;
  if (!Array.isArray(list)) return [];
  return list.map(asRecord).filter((seat): seat is UnknownRecord => seat !== null);
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

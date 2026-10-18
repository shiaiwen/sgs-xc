/**
 * 游戏协议 → 业务事件翻译：从日志参数识别 ClassName，产出 GameEvent。
 */

import type { GameEvent } from '../runtime/game-event-bus.ts';

type UnknownRecord = Record<string, unknown>;

const TURN_MESSAGE_NAMES = new Set(['MsgGameTurnNtf']);
/** 新行动角色开始时 Round=0；每位玩家回合切换时清空本回合弃牌。 */
const PLAYER_TURN_MESSAGE_NAMES = new Set(['GsCGamephaseNtf']);
const CARD_USE_MESSAGE_NAMES = new Set(['PubGsCUseCard', 'PubGsCUseSpell']);
const CARD_MOVE_MESSAGE_NAME = 'PubGsCMoveCard';
const FRIEND_HAND_REVEAL_MESSAGE_NAME = 'ClientHappyGetFriendHandcardRep';
const OPT_TARGET_MESSAGE_NAME = 'GsCRoleOptTargetNtf';
const TEMPORARY_CARD_REORDER_MESSAGE_NAME = 'CGsRoleSpellOptRep';
const PLAYER_DIED_MESSAGE_NAME = 'SmsgGamePlayerDead';
const SPELL_TARGET_MESSAGE_NAME = 'PubGsCUseSpell';
const ROLE_DATA_MESSAGE_NAME = 'GsCUpdateRoleDataExNtf';
const TRIGGER_SPELL_MESSAGE_NAME = 'GsCTriggerSpellNew';
const CARD_LIST_MESSAGE_NAME = 'MsgGamePlayCardNtf';
/** 结算界面和同房间再开一局都不切换场景，本局数据必须按协议结束清空。 */
const GAME_OVER_MESSAGE_NAMES = new Set([
  'MsgGameOver',
  'decodeMsgGameOver',
  'ClientLeavetableRep',
  'ClientLeaveTableRep'
]);
const SHA_COUNT_DATA_ID = 1;
const SEAT_ID_KEYS = [
  'SeatID', 'SeatId', 'seatID', 'seatId',
  'SrcSeatID', 'SrcSeatId', 'FromSeatID', 'FromSeatId'
] as const;
const SRC_SEAT_ID_KEYS = ['SrcSeatID', 'SrcSeatId', 'srcSeatID', 'srcSeatId'] as const;
const TARGET_SEAT_ID_KEYS = [
  'targetSeatID', 'TargetSeatID', 'targetSeatId', 'TargetSeatId',
  'DestSeatID', 'DestSeatId'
] as const;
const CARD_ID_KEYS = ['CardID', 'CardId', 'cardID', 'cardId'] as const;
const DRAW_PILE_ZONE = 1;
const DRAW_PILE_TOP = 0xff00;
const DRAW_PILE_BOTTOM = 0;

/** 刚打出的牌。恃才会把它放上牌堆顶，寸目让随后那张摸牌从牌堆底拿。 */
let playedCard: { seatId: number; cardId: number; placedOnTop: boolean } | null = null;
/** 本局已经发动过寸目的座位。之后从牌堆进手都按牌堆底算。 */
const bottomDrawSeats = new Set<number>();
const SPELL_DRAW_BOTTOM_INSTEAD = 816;
/** 恃才：把刚用的牌放到牌堆顶。14163 是按点数发动的同一效果。 */
const SPELL_PUT_USED_ON_TOP = new Set([815, 14163]);
const CARD_IDS_KEYS = ['CardIDs', 'CardIds', 'cardIDs', 'cardIds', 'Cards', 'card_ids', 'card_list', 'CardList'] as const;

/** 一条协议可能对应多个业务事件（SpellOptRep = 看牌 + 临时区重排线索）。未知协议直接忽略。 */
export function translateGameMessages(rawArguments: unknown[]): GameEvent[] {
  const rawPayload = findMessagePayload(rawArguments);
  if (!rawPayload) return [];
  const payload = protocolBody(rawPayload);
  const className = readString(payload, ['ClassName', 'className']);
  if (!className) return [];
  // 心跳不带座位。自动领取用它判断北京时间是否跨天。
  if (className === 'MsgHeartAliveRep') return [{ type: 'heart-alive' }];
  if (className === 'decodeMsgGameStart' || className === 'MsgGameStart') {
    playedCard = null;
    bottomDrawSeats.clear();
    return [{ type: 'game-started', freshGame: true }];
  }
  if (className === 'MsgReconnectGame') return [{ type: 'game-reconnected' }];
  if (/shuffle|reshuffle|洗牌/i.test(className)) return [{ type: 'deck-shuffled' }];
  if (className === 'MsgGameOver' || className === 'decodeMsgGameOver') {
    return [{ type: 'game-ended', settled: true }];
  }
  if (GAME_OVER_MESSAGE_NAMES.has(className)) return [{ type: 'game-ended' }];
  if (className === 'GsCUpdateHpNtf') {
    const event = translateSpellDamage(payload);
    return event ? [event] : [];
  }
  const friendTags = translateFriendHandTags(payload);
  if (friendTags) return [friendTags];
  if (className === OPT_TARGET_MESSAGE_NAME) {
    const event = translateOptTarget(payload);
    return event ? [event] : [];
  }
  if (className === TEMPORARY_CARD_REORDER_MESSAGE_NAME) return translateSpellOptRep(payload);
  if (className === ROLE_DATA_MESSAGE_NAME) {
    return [translateShaCount(payload), translateSpellData(payload)]
      .filter((item): item is GameEvent => item !== null);
  }
  if (className === CARD_LIST_MESSAGE_NAME) {
    const list = payload.CardList ?? payload.cardList;
    const cardIds = isArrayLike(list)
      ? Array.from(list, Number).filter((id) => Number.isInteger(id) && id > 0)
      : [];
    return cardIds.length ? [{ type: 'card-list-ready', cardIds }] : [];
  }
  if (className === TRIGGER_SPELL_MESSAGE_NAME) {
    const event = translateTriggerSpell(payload);
    return event ? [event] : [];
  }
  const event = translateSingleMessage(payload, className);
  if (PLAYER_TURN_MESSAGE_NAMES.has(className)) {
    const phaseEvent = translatePhase(payload);
    return [event, phaseEvent].filter((item): item is GameEvent => item !== null);
  }
  return event ? [event] : [];
}

function translateSpellDamage(payload: UnknownRecord): GameEvent | null {
  const spellId = readNonNegativeInteger(payload, ['SpellID', 'SpellId', 'spellID', 'spellId']);
  const seatId = readSeatId(payload, ['SeatID', 'SeatId', 'seatID', 'seatId', 'DestSeatID', 'DestSeatId']);
  const damage = readFiniteNumber(payload, ['Damage', 'damage']);
  if (spellId === null || seatId === null || damage === null || damage <= 0) return null;
  return { type: 'spell-damage-resolved', seatId, spellId, damage };
}

function translateFriendHandTags(payload: UnknownRecord): GameEvent | null {
  const protocol = asRecord(payload.Protocol);
  const nested = protocol ? protocolBody(protocol) : payload;
  const errorId = readNonNegativeInteger(nested, ['error_id', 'ErrorID', 'errorId']);
  if (errorId !== 0 && errorId !== 1) return null;
  const seatId = readSeatId(nested, ['seat_id', 'SeatID', 'seatId']);
  const rawIds = nested.card_list ?? nested.CardList ?? nested.cardList;
  if (seatId === null || !isArrayLike(rawIds)) return null;
  const cardIds = Array.from(rawIds, Number).filter((id) => Number.isInteger(id) && id > 0);
  return { type: 'friend-hand-tags-updated', seatId, cardIds };
}

function translatePhase(payload: UnknownRecord): GameEvent | null {
  const seatId = readSeatId(payload, [
    ...SEAT_ID_KEYS,
    'CurrentID', 'CurrentId', 'currentID', 'currentId'
  ]);
  const phase = readNonNegativeInteger(payload, ['Round', 'round']);
  if (seatId === null || phase === null) return null;
  return { type: 'phase-changed', seatId, phase };
}

/** DataID=1 且 Datas 至少 3 项时，Datas[1] 为已出杀次数、Datas[2] 为上限。 */
function translateShaCount(payload: UnknownRecord): GameEvent | null {
  const dataId = readNonNegativeInteger(payload, ['DataID', 'DataId', 'dataID', 'dataId']);
  const datas = payload.Datas ?? payload.datas;
  if (dataId !== SHA_COUNT_DATA_ID || !Array.isArray(datas) || datas.length < 3) return null;
  const seatId = readSeatId(payload, SEAT_ID_KEYS);
  const used = Number(datas[1]);
  const limit = Number(datas[2]);
  if (seatId === null || !Number.isFinite(limit)) return null;
  return { type: 'sha-count-updated', seatId, used: Number.isFinite(used) ? used : 0, limit };
}

function translateSpellData(payload: UnknownRecord): GameEvent | null {
  if (payload.IsSpell !== true && payload.isSpell !== true) return null;
  const dataId = readNonNegativeInteger(payload, ['DataID', 'DataId', 'dataID', 'dataId']);
  const datas = payload.Datas ?? payload.datas;
  const seatId = readSeatId(payload, SEAT_ID_KEYS);
  if (dataId === null || seatId === null || !Array.isArray(datas)) return null;
  return { type: 'spell-data-updated', seatId, dataId, datas: datas.map(Number) };
}

function translateTriggerSpell(payload: UnknownRecord): GameEvent | null {
  const seatId = readSeatId(payload, ['TriggerSeatId', 'TriggerSeatID', 'triggerSeatId', 'triggerSeatID']);
  const data = payload.TriggerSpellData ?? payload.triggerSpellData;
  if (seatId === null || !Array.isArray(data)) return null;
  const spellIds = data
    .map((item) => {
      const record = item && typeof item === 'object' ? item as UnknownRecord : null;
      return readNonNegativeInteger(record ?? {}, ['SpellId', 'SpellID', 'spellId', 'spellID']);
    })
    .filter((spellId): spellId is number => spellId !== null && spellId > 0);
  for (const spellId of spellIds) noteBottomDrawSeat(seatId, spellId);
  return spellIds.length ? { type: 'spell-triggered', seatId, spellIds } : null;
}

function translateSingleMessage(payload: UnknownRecord, className: string): GameEvent | null {
  if (className === CARD_MOVE_MESSAGE_NAME) return translateCardMovement(payload);
  // MsgGameTurnNtf 通常只有 TurnCnt，不携带 SeatID。必须在通用座位校验前
  // 处理，否则每次回合切换都会被提前丢弃，本回合统计便永远不会清空。
  if (TURN_MESSAGE_NAMES.has(className)) {
    const seatId = readSeatId(payload, [
      ...SEAT_ID_KEYS,
      'CurrentID', 'CurrentId', 'currentID', 'currentId'
    ]);
    return {
      type: 'turn-started',
      seatId: seatId ?? 0,
      seatIdKnown: seatId !== null,
      turnCount: readNonNegativeInteger(payload, [
        'TurnCnt', 'turnCnt', 'Turn', 'turn', 'TurnCount', 'turnCount'
      ]) ?? 0,
      round: readNonNegativeInteger(payload, ['Round', 'round']) ?? 0
    };
  }
  // 每位行动角色开始（Round=0）时清空本回合弃牌；Round>0 只是阶段推进。
  if (PLAYER_TURN_MESSAGE_NAMES.has(className)) {
    const seatId = readSeatId(payload, [
      ...SEAT_ID_KEYS,
      'CurrentID', 'CurrentId', 'currentID', 'currentId'
    ]);
    const round = readNonNegativeInteger(payload, ['Round', 'round']);
    if (seatId === null || round === null || round !== 0) return null;
    return {
      type: 'turn-started',
      seatId,
      seatIdKnown: true,
      turnCount: 0,
      round: 0
    };
  }
  const seatId = readSeatId(payload, SEAT_ID_KEYS);
  if (seatId === null) return null;

  const stateId = readNonNegativeInteger(payload, ['StateID', 'StateId', 'stateID', 'stateId']);
  const stateValue = readFiniteNumber(payload, ['Value', 'value']);
  if (stateId !== null && stateValue !== null) {
    return { type: 'seat-state-changed', seatId, stateId, value: stateValue };
  }
  if (className === PLAYER_DIED_MESSAGE_NAME) {
    const killerSeatId = readSeatId(payload, [
      'MurderSeatID', 'MurderSeatId', 'murderSeatID', 'murderSeatId',
      'KillerSeatID', 'KillerSeatId'
    ]);
    return { type: 'player-died', seatId, killerSeatId };
  }
  if (className === SPELL_TARGET_MESSAGE_NAME) {
    const spellId = readNonNegativeInteger(payload, ['SpellID', 'SpellId', 'spellID', 'spellId']);
    const targetSeatIds = readSeatIdArray(payload, ['DestSeatIDs', 'DestSeatIds', 'Targets']);
    const cardIds = readCardIds(payload);
    if (spellId !== null && (targetSeatIds.length || cardIds.length)) {
      noteBottomDrawSeat(seatId, spellId);
      return {
        type: 'spell-targeted',
        seatId,
        spellId,
        targetSeatIds,
        cardIds,
        effectIndex: readNonNegativeInteger(payload, ['EffectIndex', 'effectIndex'])
      };
    }
  }

  if (className === FRIEND_HAND_REVEAL_MESSAGE_NAME) {
    const cardIds = readCardIds(payload);
    return cardIds.length ? { type: 'hand-cards-revealed', seatId, cardIds } : null;
  }
  if (!CARD_USE_MESSAGE_NAMES.has(className)) return null;

  const cardIds = readCardIds(payload);
  if (!cardIds.length) return null;
  const usedSpellId = readNonNegativeInteger(payload, ['SpellID', 'SpellId', 'spellID', 'spellId']) ?? 0;
  noteBottomDrawSeat(seatId, usedSpellId);
  const usedCardId = cardIds.find((cardId) => cardId > 0);
  if (usedCardId) playedCard = { seatId, cardId: usedCardId, placedOnTop: false };
  return {
    type: 'cards-used',
    seatId,
    cardIds,
    source: className === 'PubGsCUseSpell' ? 'use-spell' : 'use-card',
    useType: readNonNegativeInteger(payload, ['UseType', 'useType']),
    isSend: payload.isSend === true,
    fromZone: readNonNegativeInteger(payload, ['fromZone', 'FromZone'])
  };
}

function translateCardMovement(payload: UnknownRecord): GameEvent | null {
  const body = payload;
  const cardCount = readNonNegativeInteger(body, ['CardCount', 'cardCount', 'card_count']);
  const moveType = readNonNegativeInteger(body, ['MoveType', 'moveType', 'move_type']);
  // MoveType=0 仍可能是有效的牌移动枚举值；有正数牌数且类名为 MoveCard 时即可记录。
  if (!cardCount || payload.isSend === true || body.isSend === true) return null;
  const fromZone = readNonNegativeInteger(body, ['FromZone', 'fromZone', 'from_zone']) ?? 0;
  const toZone = readNonNegativeInteger(body, ['ToZone', 'toZone', 'to_zone']) ?? 0;
  const moved: Extract<GameEvent, { type: 'cards-moved' }> = {
    type: 'cards-moved',
    cardCount,
    cardIds: readMovementCardIds(body),
    fromId: normalizeZoneOwner(
      readNonNegativeInteger(body, ['FromID', 'FromId', 'fromID', 'fromId', 'from_id']) ?? 0,
      fromZone
    ),
    fromZone,
    fromPosition: readNonNegativeInteger(body, ['FromPosition', 'fromPosition', 'from_position']) ?? 0,
    fromZoneParam: readNonNegativeInteger(body, ['FromZoneParam', 'fromZoneParam', 'from_zone_param']) ?? 0,
    toId: normalizeZoneOwner(
      readNonNegativeInteger(body, ['ToID', 'ToId', 'toID', 'toId', 'to_id']) ?? 0,
      toZone
    ),
    toZone,
    toPosition: readNonNegativeInteger(body, ['ToPosition', 'toPosition', 'to_position']) ?? 0,
    toZoneParam: readNonNegativeInteger(body, ['ToZoneParam', 'toZoneParam', 'to_zone_param']) ?? 0,
    moveType: moveType ?? 0,
    spellId: readNonNegativeInteger(body, ['SpellID', 'SpellId', 'spellID', 'spellId', 'spell_id']) ?? 0,
    srcSeatId: readSeatId(body, SRC_SEAT_ID_KEYS)
  };
  noteBottomDrawSeat(moved.srcSeatId ?? moved.toId, moved.spellId);
  return adjustBottomDraw(adjustPlayedCardPile(moved));
}

function noteBottomDrawSeat(seatId: number | null, spellId: number): void {
  if (spellId === SPELL_DRAW_BOTTOM_INSTEAD && seatId !== null && seatId >= 0 && seatId < 0xff) {
    bottomDrawSeats.add(seatId);
  }
}

/** 寸目座位从牌堆进手，位置没写或被当成顶时，改成从底摸。 */
function adjustBottomDraw(moved: Extract<GameEvent, { type: 'cards-moved' }>): Extract<GameEvent, { type: 'cards-moved' }> {
  if (moved.fromZone !== DRAW_PILE_ZONE || moved.toZone !== 5) return moved;
  if (moved.spellId !== SPELL_DRAW_BOTTOM_INSTEAD && !bottomDrawSeats.has(moved.toId)) return moved;
  if (moved.fromPosition === DRAW_PILE_BOTTOM) return moved;
  return { ...moved, fromPosition: DRAW_PILE_BOTTOM };
}

/**
 * 恃才把刚用的那张牌放上牌堆顶。协议经常不写位置，缺省就变成牌堆底，顶上就看不到这张牌。
 * 放上去之后寸目摸的那一张从牌堆底拿，不能把刚放上顶的牌摸走。
 */
function adjustPlayedCardPile(moved: Extract<GameEvent, { type: 'cards-moved' }>): Extract<GameEvent, { type: 'cards-moved' }> {
  const pending = playedCard;
  const seatId = moved.srcSeatId ?? moved.fromId;
  const knownId = moved.cardIds.find((cardId) => cardId > 0) ?? 0;
  const putOnTop = moved.toZone === DRAW_PILE_ZONE && moved.cardCount === 1 && (
    SPELL_PUT_USED_ON_TOP.has(moved.spellId)
    || (pending !== null && !pending.placedOnTop && seatId === pending.seatId && (knownId === 0 || knownId === pending.cardId))
  );
  if (putOnTop) {
    if (pending) pending.placedOnTop = true;
    const pileSeat = pending?.seatId ?? moved.srcSeatId;
    if (pileSeat !== null && pileSeat >= 0 && pileSeat < 0xff) bottomDrawSeats.add(pileSeat);
    const cardId = knownId > 0 ? knownId : pending?.cardId ?? 0;
    return {
      ...moved,
      toPosition: DRAW_PILE_TOP,
      cardIds: cardId > 0 ? moved.cardIds.map((id) => id > 0 ? id : cardId) : [...moved.cardIds]
    };
  }
  if (!pending) return moved;
  if (pending.placedOnTop && moved.fromZone === DRAW_PILE_ZONE && moved.toZone === 5
    && moved.toId === pending.seatId) {
    const placedId = pending.cardId;
    playedCard = null;
    return {
      ...moved,
      fromPosition: DRAW_PILE_BOTTOM,
      cardIds: moved.cardIds.map((cardId) => cardId === placedId ? 0 : cardId)
    };
  }
  // 出牌会先经过处理区或弃牌堆，这时还不能忘掉，否则后面放上牌堆顶时对不上这张牌。
  if (moved.cardIds.includes(pending.cardId) && moved.toZone === 5) {
    playedCard = null;
    return moved;
  }
  return moved;
}

/**
 * 网页端字段在 ProtoObj / Data，微端在 data.protoObj。
 * 外层已有的字段优先，避免把已经摊平的协议再盖掉。
 */
function protocolBody(payload: UnknownRecord): UnknownRecord {
  const message = asRecord(payload.msg) ?? asRecord(payload.Msg);
  const data = asRecord(payload.Data)
    ?? asRecord(payload.data)
    ?? asRecord(message?.Data)
    ?? asRecord(message?.data);
  const nestedRecords = [
    asRecord(payload.Protocol),
    asRecord(payload.protocol),
    asRecord(payload.ProtoObj),
    asRecord(payload.protoObj),
    asRecord(data?.Protocol),
    asRecord(data?.protocol),
    asRecord(data?.ProtoObj),
    asRecord(data?.protoObj),
    asRecord(message?.Protocol),
    asRecord(message?.protocol),
    asRecord(message?.ProtoObj),
    asRecord(message?.protoObj),
    data,
    message
  ].filter((record): record is UnknownRecord => record !== null && record !== payload);
  if (!nestedRecords.length) return payload;
  const merged: UnknownRecord = { ...payload };
  for (const nested of nestedRecords) {
    for (const [key, value] of Object.entries(nested)) {
      // 网页端外层常挂着空 CardIDs，真实牌号在 Protocol / ProtoObj。空列表不能挡住内层。
      if (merged[key] === undefined || isEmptyList(merged[key])) merged[key] = value;
    }
  }
  return merged;
}

function isEmptyList(value: unknown): boolean {
  return isArrayLike(value) && value.length === 0;
}

/**
 * GsCRoleOptTargetNtf：SeatID=操作者，SrcSeatID=施法者，
 * targetSeatID=被看座位（255=牌堆），Param/Params 含义由技能决定。
 * 这里只搬字段，不解释；解释在 mingpai/spell-move-judge.ts。
 */
function translateOptTarget(payload: UnknownRecord): GameEvent | null {
  const spellId = readNonNegativeInteger(payload, ['SpellID', 'SpellId', 'spellID', 'spellId']);
  const seatId = readSeatId(payload, ['SeatID', 'SeatId', 'seatID', 'seatId'])
    ?? readSeatId(payload, SRC_SEAT_ID_KEYS);
  if (spellId === null || seatId === null) return null;
  return {
    type: 'opt-target',
    seatId,
    srcSeatId: readSeatId(payload, SRC_SEAT_ID_KEYS),
    targetSeatId: readNonNegativeInteger(payload, TARGET_SEAT_ID_KEYS),
    spellId,
    param: readNonNegativeInteger(payload, ['Param', 'param']) ?? 0,
    params: readRawNumberArray(payload, ['Params', 'params']),
    cardIds: readRawNumberArray(payload, ['CardIDs', 'CardIds', 'cardIDs', 'cardIds']),
    optType: readNonNegativeInteger(payload, ['Type', 'type'])
  };
}

function translateSpellOptRep(payload: UnknownRecord): GameEvent[] {
  const seatId = readSeatId(payload, SEAT_ID_KEYS);
  const spellId = readNonNegativeInteger(payload, ['SpellID', 'SpellId', 'spellID', 'spellId']);
  if (seatId === null || spellId === null) return [];
  const events: GameEvent[] = [{
    type: 'spell-opt-rep',
    seatId,
    spellId,
    optType: readNonNegativeInteger(payload, ['Type', 'type']) ?? 0,
    datas: readRawNumberArray(payload, ['Datas', 'datas'])
  }];
  const trace = readNumberArray(payload, [
    'Args', 'args', 'Params', 'params', 'Param', 'param',
    'Values', 'values', 'Result', 'result'
  ]);
  if (trace.length === 1 || trace.length === 3) {
    events.push({
      type: 'temporary-cards-reordered',
      seatId,
      spellId,
      zoneParam: readNonNegativeInteger(payload, ['ZoneParam', 'TempZoneParam', 'ToZoneParam', 'toZoneParam']),
      trace
    });
  }
  return events;
}

function readRawNumberArray(payload: UnknownRecord, keys: readonly string[]): number[] {
  for (const key of keys) {
    const value = payload[key];
    if (!Array.isArray(value)) continue;
    return value.map(nonNegativeInteger).filter(isNumber);
  }
  return [];
}

const GLOBAL_ZONE_IDS = new Set([0, 1, 2, 3, 9, 12]);

/** 原版 Zone 构造器会把公共区域的协议 ID=0 归一为 0xff。 */
function normalizeZoneOwner(ownerId: number, zone: number): number {
  return ownerId === 0 && GLOBAL_ZONE_IDS.has(zone) ? 0xff : ownerId;
}

function readMovementCardIds(payload: UnknownRecord): number[] {
  for (const key of CARD_IDS_KEYS) {
    const value = payload[key];
    if (!isArrayLike(value)) continue;
    return Array.from(value, (candidate) => {
      const card = asRecord(candidate);
      return card
        ? readNonNegativeInteger(card, CARD_ID_KEYS) ?? 0
        : nonNegativeInteger(candidate) ?? 0;
    });
  }
  // 单张移动（顺手牵羊等）有时只带 CardID，不带 CardIDs 数组。
  for (const key of CARD_ID_KEYS) {
    const value = nonNegativeInteger(payload[key]);
    if (value !== null) return [value];
  }
  return [];
}

function readNumberArray(payload: UnknownRecord, keys: readonly string[]): number[] {
  for (const key of keys) {
    const value = payload[key];
    if (!Array.isArray(value)) continue;
    const numbers = value.map(nonNegativeInteger).filter(isNumber);
    if (numbers.length === value.length) return numbers;
  }
  return [];
}

function readSeatIdArray(payload: UnknownRecord, keys: readonly string[]): number[] {
  for (const key of keys) {
    const value = payload[key];
    if (!Array.isArray(value)) continue;
    return value
      .map((candidate) => nonNegativeInteger(candidate))
      .filter((seatId): seatId is number => seatId !== null && seatId < 0xff);
  }
  return [];
}

function isNumber(value: number | null): value is number {
  return value !== null;
}

function findMessagePayload(rawArguments: unknown[]): UnknownRecord | null {
  for (let index = rawArguments.length - 1; index >= 0; index -= 1) {
    const candidate = asRecord(rawArguments[index]);
    if (candidate && readString(candidate, ['ClassName', 'className'])) return candidate;
  }
  return null;
}

/** 返回原始协议对象（可写引用）及其类名，供分发前改写使用。 */
export function findGameMessage(
  rawArguments: unknown[]
): { payload: UnknownRecord; className: string } | null {
  const payload = findMessagePayload(rawArguments);
  if (!payload) return null;
  return { payload, className: readString(payload, ['ClassName', 'className']) };
}

function readCardIds(payload: UnknownRecord): number[] {
  const ids: number[] = [];
  for (const key of CARD_IDS_KEYS) {
    const value = payload[key];
    if (!Array.isArray(value)) continue;
    value.forEach((candidate) => appendCardId(ids, candidate));
  }
  for (const key of CARD_ID_KEYS) appendCardId(ids, payload[key]);
  return [...new Set(ids)];
}

function appendCardId(target: number[], candidate: unknown): void {
  const card = asRecord(candidate);
  const value = card ? readPositiveInteger(card, CARD_ID_KEYS) : positiveInteger(candidate);
  if (value !== null) target.push(value);
}

function readString(record: UnknownRecord, keys: readonly string[]): string {
  for (const key of keys) if (typeof record[key] === 'string') return record[key] as string;
  return '';
}

function readPositiveInteger(record: UnknownRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = positiveInteger(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function readSeatId(record: UnknownRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = nonNegativeInteger(record[key]);
    if (value !== null && value < 0xff) return value;
  }
  return null;
}

function readNonNegativeInteger(record: UnknownRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = nonNegativeInteger(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function readFiniteNumber(record: UnknownRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

/** 协议里的 repeated 字段可能是普通数组，也可能是类型化数组。 */
function isArrayLike(value: unknown): value is ArrayLike<unknown> {
  return Array.isArray(value) || ArrayBuffer.isView(value)
    || (asRecord(value) !== null && Number.isInteger((value as { length?: unknown }).length));
}

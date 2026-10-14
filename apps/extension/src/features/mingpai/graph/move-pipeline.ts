/**
 * 移牌主链：把一条移牌消息翻译成对牌位图的区域操作。
 *
 * 顺序和分支与旧版一致：
 * 1. 早退（张数 0 / 移动类型 0 / 目标 11 区 / 自发包）；
 * 2. 回收区（12）单独处理；
 * 3. 手牌回牌堆、洗牌各自有独立分支；
 * 4. 同区同主人就地亮牌；
 * 5. 其余走普通换区：来源区 remove、目标区 add，临时区先按网格取回。
 *
 * 位置纠偏、张数纠偏在进入这里之前完成。
 */

import {
  CardSlot,
  CardZone,
  DRAW_PILE_BOTTOM,
  DRAW_PILE_TOP,
  POSITION_UNSPECIFIED,
  cardCounter,
  getSlotsByKey,
  isCardGraphReady,
  moveSlots,
  packSlots
} from './card-graph.ts';
import {
  correctIdentifiedCards,
  downgradeTempZoneGrid,
  findTempZoneGrid,
  isTrackedTempZone,
  markGridCardsReturned,
  registerTempZoneGrid,
  takeGridCardsByPosition,
  takeGridCardsForSpell,
  applyPendingDeckReturn,
  planPendingDeckReturn,
  retargetZonePosition,
  swapZoneCardsByKey,
  type PendingDeckReturn
} from './temporary-zone-grid.ts';

export interface GraphMoveMessage {
  cardCount: number;
  cardIds: number[];
  fromId: number;
  fromZone: number;
  fromPosition: number;
  fromZoneParam: number;
  toId: number;
  toZone: number;
  toPosition: number;
  toZoneParam: number;
  moveType: number;
  spellId: number;
  /** 技能来源座位；缺省用 FromID。 */
  srcSeatId?: number | null;
  /** 微端回包标记，整条跳过。 */
  isSend?: boolean;
  /** 3483：牌堆顶要打包几张（由看牌回报给出）。 */
  pilePackCount?: number;
}

/** 3483 暂存到技能区的那批手牌，以及牌堆归还的暂存计划。 */
export interface Spell3483Hold {
  handCards: CardSlot[];
  pendingDeckReturn: PendingDeckReturn | null;
}

export interface GraphMoveState {
  /** 开局发牌阶段为 null，对局中为布尔。 */
  isGameStart?: boolean | null;
  /** 已经洗过一次。 */
  isPassed?: boolean;
  /** 3483 的跨移牌状态。 */
  spell3483?: Spell3483Hold | null;
}

export type MoveHandling =
  | 'ignored'
  | 'whole-hand-show'
  | 'recycled'
  | 'hand-to-pile'
  | 'reshuffle'
  | 'same-zone-show'
  | 'zone-move';

export interface GraphMoveResult {
  handling: MoveHandling;
  /** 这一批最终落到目标区的牌。 */
  moved: CardSlot[];
}

const RECYCLE_ZONE = 12;
const IGNORED_TO_ZONE = 11;
const SHUFFLE_FROM_ZONE = 2;
const SHUFFLE_TO_ZONE = 9;
const SHUFFLE_MOVE_TYPE = 255;
const DEAL_MOVE_TYPE = 19;
/** 从区外把牌铺进牌堆顶。 */
const OUTSIDE_ZONE = 0;
const PILE_ZONE = 1;
/** 3694：位置给的是「顶 + 1」时这一段单独处理。 */
const DEAL_PLACEHOLDER_SPELL_ID = 3694;
/** 从牌堆摸牌 / 起手发牌。 */
const DRAW_TO_HAND_MOVE_TYPE = 1;
/** 从临时区整批回手时按未返还牌或外部置换格取回。 */
const GRID_RETURN_SPELL_IDS = [987, 988, 3776];

/** 主链的早退条件。 */
export function isMoveIgnored(move: GraphMoveMessage): boolean {
  return move.moveType === 0
    || !(move.cardCount > 0)
    || move.toZone === IGNORED_TO_ZONE
    || move.isSend === true;
}

/** 同一个人在同一区里亮牌。 */
export function isWholeHandShow(move: GraphMoveMessage): boolean {
  if (move.moveType !== 24 || move.fromZone !== 5 || move.toZone !== 5) return false;
  if (!Number.isInteger(move.fromId) || move.fromId < 0 || move.fromId >= 255) return false;
  if (move.fromId !== move.toId) return false;
  if (!Number.isInteger(move.cardCount) || move.cardCount < 0) return false;
  return move.cardIds.length === move.cardCount;
}

/** 牌没换区也没换主人，只是原地展示。 */
export function isSameZoneShow(move: GraphMoveMessage): boolean {
  if (move.fromZone !== move.toZone || move.fromId !== move.toId) return false;
  if (!move.cardIds.some((cardId) => cardId > 0)) return false;
  if (move.spellId === 7011 && move.moveType === 19) return false;
  if (move.spellId === 3744 && move.moveType === 21) return false;
  return true;
}

function positiveCount(cardIds: readonly number[]): number {
  return cardIds.filter((cardId) => cardId > 0).length;
}

function sourceZone(move: GraphMoveMessage): CardZone {
  return new CardZone(move.fromId, move.fromZone, move.fromPosition, move.cardCount, move.spellId, move.fromZoneParam);
}

function targetZone(move: GraphMoveMessage): CardZone {
  return new CardZone(move.toId, move.toZone, move.toPosition, move.cardCount, move.spellId, move.toZoneParam);
}

/** 张数不够时用 0 补齐，再按牌号建槽位。 */
function padCardIds(move: GraphMoveMessage): number[] {
  const ids = move.cardIds.slice(0, Math.max(0, move.cardCount));
  while (ids.length < move.cardCount) ids.push(0);
  return ids;
}

/** 牌进这一区时把「这一格是哪张牌」写进统计。 */
function noteCardsAdded(cardIds: readonly number[], key: number): void {
  cardIds.filter((cardId) => cardId > 0).forEach((cardId) => cardCounter.add(cardId, key));
}

/** 移牌消息的入口。 */
export function applyGraphMove(move: GraphMoveMessage, state: GraphMoveState = {}): GraphMoveResult {
  if (!isCardGraphReady()) return { handling: 'ignored', moved: [] };
  if (isWholeHandShow(move)) return wholeHandShow(move);
  if (isMoveIgnored(move)) return { handling: 'ignored', moved: [] };
  if (move.toZone === RECYCLE_ZONE || move.fromZone === RECYCLE_ZONE) return recycleBranch(move);
  if (isDealIntoPile(move)) return dealIntoPile(move, state);
  if (move.fromZone === 5 && move.toZone === 1 && move.spellId === 0 && move.moveType === DEAL_MOVE_TYPE) {
    return handToDrawPile(move);
  }
  if (move.fromZone === SHUFFLE_FROM_ZONE && move.toZone === SHUFFLE_TO_ZONE
    && move.moveType === SHUFFLE_MOVE_TYPE) {
    return reshuffle(move, state);
  }
  if (isBottomDrawFromTempZone(move)) return takeBottomFromTempZone(move);
  if (move.spellId === SPELL_3483) return spell3483Branch(move, state);
  if (isSameZoneShow(move)) return sameZoneShow(move);
  return ordinaryZoneMove(move);
}

const SPELL_3483 = 0xd9b;

/**
 * 3483：手牌先暂存到技能区，牌堆回手的张数对上时再把暂存的手牌按 key 换回来。
 * 换不回来就退回「牌堆底部取牌」，并把暂存的手牌打包成组。
 */
function spell3483Branch(move: GraphMoveMessage, state: GraphMoveState): GraphMoveResult {
  const source = sourceZone(move);
  const target = targetZone(move);
  const hold = state.spell3483 ?? null;
  const spellId = move.spellId;
  let moved: CardSlot[] = [];

  if (move.fromZone === 0xa && move.toZone === 0xa) {
    if (positiveCount(move.cardIds) === 0) {
      source.pos = DRAW_PILE_BOTTOM;
      target.pos = DRAW_PILE_TOP;
    }
    moved = target.add(source.remove(move.cardIds, spellId)) as CardSlot[];
  } else if (move.fromZone === 1 && move.toZone === 0xa && move.fromPosition === POSITION_UNSPECIFIED) {
    packSlots(source.cards.slice(0, move.pilePackCount ?? 0));
    if (positiveCount(move.cardIds) === 0) source.pos = DRAW_PILE_BOTTOM;
    moved = target.add(source.remove(move.cardIds, spellId)) as CardSlot[];
  } else if (move.fromZone === 5 && move.toZone === 0xa) {
    moved = target.add(source.remove(move.cardIds, spellId)) as CardSlot[];
    state.spell3483 = { handCards: moved, pendingDeckReturn: null };
  } else if (move.fromZone === 0xa && move.toZone === 1 && move.fromPosition === POSITION_UNSPECIFIED) {
    retargetZonePosition(target, DRAW_PILE_TOP);
    if (positiveCount(move.cardIds) === 0 && hold?.handCards.length) {
      hold.pendingDeckReturn = planPendingDeckReturn(source, target, move.cardCount, hold.handCards);
      if (!hold.pendingDeckReturn) {
        moved = target.add(source.remove(move.cardIds, spellId)) as CardSlot[];
        state.spell3483 = null;
      }
    } else {
      moved = target.add(source.remove(move.cardIds, spellId)) as CardSlot[];
      state.spell3483 = null;
    }
  } else if (move.fromZone === 0xa && move.toZone === 5 && hold?.pendingDeckReturn) {
    if (!swapZoneCardsByKey(source, hold.handCards, move.cardIds)) packSlots(hold.handCards);
    moved = target.add(source.remove(move.cardIds, spellId)) as CardSlot[];
    applyPendingDeckReturn(hold.pendingDeckReturn, source);
    state.spell3483 = null;
  } else {
    moved = target.add(source.remove(move.cardIds, spellId)) as CardSlot[];
    if (move.fromZone === 0xa) state.spell3483 = null;
  }

  noteCardsAdded(move.cardIds, 0);
  return { handling: 'zone-move', moved };
}

/** 3208：暗牌从技能临时区回手时拿的是最底下一张。 */
function isBottomDrawFromTempZone(move: GraphMoveMessage): boolean {
  return move.spellId === 3208 && move.fromZone === 10 && move.toZone === 5
    && positiveCount(move.cardIds) === 0;
}

function takeBottomFromTempZone(move: GraphMoveMessage): GraphMoveResult {
  const source = sourceZone(move);
  const target = targetZone(move);
  source.pos = DRAW_PILE_BOTTOM;
  packSlots(source.cards.slice(0, Math.max(0, source.length - 1)), true);
  const moved = source.remove(move.cardIds, move.spellId);
  target.add(moved);
  noteCardsAdded(move.cardIds, 0);
  return { handling: 'zone-move', moved };
}

/**
 * 同一个人手牌内的整手亮牌：亮出来的留在手牌，其余推进回收区。
 * 这条分支独占，主链不再往下走。
 */
function wholeHandShow(move: GraphMoveMessage): GraphMoveResult {
  const zone = new CardZone(move.fromId, 5);
  const ids = move.cardIds.slice();
  const shown = ids.length ? zone.show(ids).filter(Boolean) : [];
  const shownSet = new Set(shown);
  const rest = zone.cards.filter((card) => !shownSet.has(card));
  if (rest.length) new CardZone(255, RECYCLE_ZONE).add(rest);
  zone.set(shown);
  return { handling: 'whole-hand-show', moved: shown };
}

/** 回收区：进 12 区按牌号建槽位；出 12 区只改账本不搬数组。 */
function recycleBranch(move: GraphMoveMessage): GraphMoveResult {
  const zone = targetZone(move);
  if (move.toZone !== RECYCLE_ZONE) {
    const created = padCardIds(move)
      .map((cardId) => new CardSlot(cardId, cardId, zone.zoneID));
    zone.add(created);
    noteCardsAdded(move.cardIds, 0);
    return { handling: 'recycled', moved: created };
  }
  if (move.fromZone !== RECYCLE_ZONE && move.fromZone !== 0) {
    const taken = sourceZone(move).remove(move.cardIds, move.spellId);
    moveSlots(taken, targetZone(move).zoneID);
    return { handling: 'recycled', moved: taken };
  }
  return { handling: 'recycled', moved: [] };
}

/**
 * 手牌整批回牌堆：先把牌堆里的未知段打包成一格，
 * 再把回来的牌挂到那一格后面，之后按顺序就能对回牌号。
 */
function handToDrawPile(move: GraphMoveMessage): GraphMoveResult {
  const pile = targetZone(move);
  const groupKey = packSlots(pile.cards, true);
  const incoming = sourceZone(move).remove(move.cardIds.filter((cardId) => cardId > 0), move.spellId);
  const attached = incoming.map((card) => {
    if (groupKey === 0) card.destroy(groupKey);
    else {
      card.create(groupKey);
      cardCounter.counter(card.id as number, 0);
    }
    card.plot(true);
    return card;
  });
  pile.add(attached);
  noteCardsAdded(move.cardIds, 0);
  return { handling: 'hand-to-pile', moved: attached };
}

/**
 * 开局从区外把牌铺进牌堆顶。
 * 「顶 + 1」这一支只铺未知占位槽位；「顶」这一支在开局阶段身份写 0，
 * 也就是这些牌算进了牌堆但不算明牌。
 */
function isDealIntoPile(move: GraphMoveMessage): boolean {
  return move.fromZone === OUTSIDE_ZONE && move.toZone === PILE_ZONE && move.moveType === DEAL_MOVE_TYPE;
}

function dealIntoPile(move: GraphMoveMessage, state: GraphMoveState): GraphMoveResult {
  const target = targetZone(move);
  const ids = padCardIds(move);
  const withPlaceholdersOnly = move.spellId === DEAL_PLACEHOLDER_SPELL_ID
    && move.toPosition === DRAW_PILE_TOP + 1;
  if (withPlaceholdersOnly) target.pos = POSITION_UNSPECIFIED;
  const keepIdentity = !withPlaceholdersOnly
    && move.toPosition === DRAW_PILE_TOP
    && !state.isGameStart;
  const created = ids.map((cardId) => new CardSlot(keepIdentity && cardId > 0 ? cardId : 0, cardId, target.zoneID));
  target.add(created);
  noteCardsAdded(move.cardIds, 0);
  return { handling: 'zone-move', moved: created };
}

/**
 * 从牌堆摸牌 / 起手发牌：牌号全都有时，旧版把源区取牌方向设成游戏给的布局坐标，
 * 也就是按那个下标从牌堆数组里取牌。读不到这个常量就沿用纠偏后的位置。
 */
function readDealAnchorPosition(): number | null {
  const host = (globalThis as { Uc1cryZVg?: { yKZ6cyV?: unknown } }).Uc1cryZVg;
  const anchor = Number(host?.yKZ6cyV);
  return Number.isFinite(anchor) ? anchor : null;
}

/** 洗牌：开局把未知牌打成一个明牌组，之后整堆落回目标区。 */
function reshuffle(move: GraphMoveMessage, state: GraphMoveState): GraphMoveResult {
  const source = sourceZone(move);
  const target = targetZone(move);
  if (state.isGameStart && !state.isPassed) {
    packSlots(getSlotsByKey(0).map((slot) => slot.destroy()), false, 1);
  }
  const merged = [
    ...target.cards.map((card) => (state.isPassed ? card.destroy(0) as CardSlot : card)),
    ...source.cards.map((card) => card.destroy(0) as CardSlot)
  ];
  target.set(merged);
  source.set([]);
  cardCounter.counter(undefined, 0);
  return { handling: 'reshuffle', moved: merged };
}

/** 就地亮牌：这是把「未知槽位」认成具体牌的唯一入口。 */
function sameZoneShow(move: GraphMoveMessage): GraphMoveResult {
  const zone = sourceZone(move);
  const shown = zone.show(move.cardIds, move.spellId);
  return { handling: 'same-zone-show', moved: shown };
}

/** 普通换区：临时区先按网格取回，其余走来源区摘除 + 目标区加入。 */
function ordinaryZoneMove(move: GraphMoveMessage): GraphMoveResult {
  const source = sourceZone(move);
  const target = targetZone(move);
  if (move.fromZone === PILE_ZONE && move.toZone === 5 && move.moveType === DRAW_TO_HAND_MOVE_TYPE
    && move.cardCount > 0 && positiveCount(move.cardIds) === move.cardCount) {
    const anchor = readDealAnchorPosition();
    if (anchor !== null) source.pos = anchor;
  }
  const tempSource = isTrackedTempZone(move.fromZone);
  const returningToPile = tempSource && move.toZone === 1
    && (move.toPosition === DRAW_PILE_TOP || move.toPosition === DRAW_PILE_BOTTOM);
  const returningToHand = tempSource && move.toZone === 5
    && GRID_RETURN_SPELL_IDS.includes(move.spellId);
  const srcSeatId = move.srcSeatId ?? move.fromId;
  const state = (returningToPile || returningToHand)
    ? findTempZoneGrid(srcSeatId, move.spellId, source)
    : null;

  let moved: CardSlot[] | null = null;
  if (state && returningToPile && positiveCount(move.cardIds) === 0) {
    moved = takeGridCardsByPosition(state, source, move.toPosition, move.cardCount);
    if (!moved) downgradeTempZoneGrid(state, source);
  } else if (state && returningToHand) {
    moved = takeGridCardsForSpell(state, source, move.cardCount);
    if (moved) correctIdentifiedCards(moved, move.cardIds);
  }
  if (!moved) moved = source.remove(move.cardIds, move.spellId);

  target.add(moved);
  markGridCardsReturned(state, moved, source);
  // 牌堆一次进多张到临时区时登记网格，之后的回报三元组才有地方落。
  if (move.fromZone === 1 && isTrackedTempZone(move.toZone) && move.cardCount > 1) {
    registerTempZoneGrid({
      seatId: srcSeatId,
      spellId: move.spellId,
      tempZone: target.zoneID,
      cards: moved
    });
  }
  noteCardsAdded(move.cardIds, 0);
  return { handling: 'zone-move', moved };
}

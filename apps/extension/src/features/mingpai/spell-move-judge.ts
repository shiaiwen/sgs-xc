/**
 * 看牌和移牌的补号。
 * 协议经常不带具体牌号，这里按技能、来源区和去向区把已经亮过的牌填回去。
 * 分区里牌的增删仍由明牌引擎做，这里只产出「这张牌是哪张」。
 */

import {
  DRAW_PILE_OWNER,
  DRAW_PILE_POSITION,
  deckReveal,
  handReveal,
  type CardReveal
} from './rules/reveal-types.ts';

const TOP = DRAW_PILE_POSITION.TOP;
const BOTTOM = DRAW_PILE_POSITION.BOTTOM;
const UNSPECIFIED = DRAW_PILE_POSITION.UNSPECIFIED;

/** 协议分区。 */
const ZONE_NONE = 0;
const ZONE_DRAW = 1;
const ZONE_DISCARD = 2;
const ZONE_JUDGE = 3;
const ZONE_SKILL = 4;
const ZONE_HAND = 5;
const ZONE_SHOW = 8;
const ZONE_TEMP = 10;
const ZONE_RECYCLE = 11;

/** 协议移牌类型。 */
const MOVE_DEAL = 1;
const MOVE_PUT = 8;
const MOVE_GAIN = 11;
const MOVE_DRAW = 13;
const MOVE_PLACE = 15;
const MOVE_GIVE = 18;
const MOVE_SWAP = 19;
const MOVE_REVEAL = 21;
const OPT_CHOOSE = 22;
const OPT_BOTTOM = 50;
const OPT_SKIP = 73;

/** 判定牌按座位颜色收回手牌。 */
const SPELL_JUDGE_RECOVERY = 3571;
/** 弃牌堆暗置进手，用先前亮出的牌补号。 */
const SPELL_DISCARD_TO_HAND = 3511;
/** 自己亮出的牌随后暗置进手，一次一张。 */
const SPELL_SELF_HAND_GAIN = [7016, 7017] as const;
/** 先亮目标手牌，再按选项把亮出的或其余手牌交给自己。 */
const SPELL_HAND_EXCHANGE = 361;
/** 周旋：手牌暗置进自己的技能区。 */
const SPELL_ZHOUXUAN = 3065;
/** 与周旋同类：亮出后暗置到技能区，参考脚本与 0xbf9 同组。 */
const SPELL_KNOWN_PILE_FROM_EQUIP = 0x122;
const KNOWN_PILE_PLACEMENT_SPELLS = new Set<number>([SPELL_ZHOUXUAN, SPELL_KNOWN_PILE_FROM_EQUIP]);
const ZONE_EQUIP = 6;
/** 顺手牵羊锦囊。 */
const SPELL_SNATCH = 2;
/** 弃牌堆暗置进手。 */
const SPELL_DISCARD_GAIN = 3157;
/** 弃牌堆暗置放回牌堆顶。 */
const SPELL_DISCARD_TO_TOP = [3750, 3753] as const;
/** 手牌暂存到技能区，再按原顺序换回。 */
const SPELL_HAND_HOLD = 3483;
/** 手牌亮出后进临时区，再进牌堆或弃牌堆。 */
const SPELL_HAND_STACK = 3488;
/** 弃牌堆里的红牌暗置放回牌堆。 */
const SPELL_RED_BACK_TO_DRAW = 3543;
/** 无来源区放进牌堆时改放到底部，并清掉牌号。 */
const SPELL_FORCE_BOTTOM = 3694;
/** 临时区暗牌进手时，其余临时区牌不再按旧顺序补。 */
const SPELL_DROP_TEMP = 3208;
/** 牌堆位置没写明时，按牌堆顶取。 */
const SPELL_FROM_DRAW_TOP = [3208, 7011, 987, 988, 3903] as const;
/** 牌堆底一次取三张进临时区。 */
const SPELL_DRAW_BOTTOM_THREE = 3776;
/** 牌堆底一张进手。 */
const SPELL_DRAW_BOTTOM_ONE = 3101;
/** 寸目：摸牌改为从牌堆底摸。 */
const SPELL_DRAW_BOTTOM_INSTEAD = 816;
/** 牌堆顶一张进技能区。 */
const SPELL_DRAW_TOP_TO_SKILL = 795;
/** 牌号列表头两张是下标，不是牌。 */
const SPELL_INDEXED_CARDS = 713;
/** 放回牌堆顶时要剔掉的特殊牌。 */
const SPECIAL_PILE_CARDS = [4400, 4401] as const;
/** 看牌结果直接当手牌。 */
const SPELL_SHOW_HAND = 3659;
/** 看牌结果直接当牌堆顶，有一种操作类型除外。 */
const SPELL_SHOW_DECK = 3744;
/** 指定操作类型时，看牌结果当牌堆顶。 */
const SPELL_SHOW_DECK_TYPED = 3868;
/** 分两次看牌堆，第二次才亮出来。 */
const SPELL_DEFERRED_PILE = 7009;
/** 看牌结果倒序后当牌堆底。 */
const SPELL_SHOW_DECK_BOTTOM = 3336;
/** 看牌堆，并记下还要再亮一次。 */
const SPELL_PILE_PREVIEW = [7010, 7011] as const;
/** 看牌堆顶一张。 */
const SPELL_PEEK_ONE = 943;
/** 参数第一位是张数，后面是自己的部分手牌。 */
const SPELL_PARTIAL_OWN_HAND = 898;
/** 参数成对出现，取每一对里的牌号；目标是牌堆就当牌堆顶。 */
const SPELL_PAIRED_LOOK = 3266;
/** 参数末尾若干张是目标的部分手牌。 */
const SPELL_PARTIAL_TARGET_HAND = [987, 988] as const;
/** 自己看牌堆，张数在参数第一位。 */
const SPELL_OWN_PILE_LOOK = 3903;
/** 当前回合座位交出的一张手牌，随后可能放回牌堆。 */
const SPELL_GIVE_ONE = 780;

/** 看别人手牌：参数里直接是牌号。 */
const HAND_LOOK_SPELLS = [4, 5, 921, 372, 811, 357, 3119, 501, 3437, 4025] as const;
/** 看别人手牌：只有参数位为 0 时，后面的数才是牌号。 */
const HAND_LOOK_WHEN_IDLE = [851, 361, 774, 3310, 3876] as const;

const COLOR_RED = 1;
const COLOR_BLACK = 2;

export interface OptJudgeInput {
  spellId: number;
  param: number;
  params: readonly number[];
  cardIds: readonly number[];
  srcSeatId: number | null;
  targetSeatId: number | null;
  optType: number | null;
  myId: number | null;
  mySeats: readonly number[];
  /** 按技能名认出来的「看别人手牌」技能号，参数与固定名单同形。 */
  isHandLookSpell?: (spellId: number) => boolean;
}

export interface MoveJudgeInput {
  cardCount: number;
  cardIds: readonly number[];
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
  srcSeatId: number | null;
  isSend?: boolean;
}

export interface MoveJudgeHost {
  /** 判定的颜色来源是否也适用于这个技能号；缺省只认 3571。 */
  isJudgeRecoverySpell?: (spellId: number) => boolean;
  /** 判定牌按颜色收进手牌时回报一次牌号，调用方据此打标签。 */
  onJudgeCardRecovered?: (seatId: number, cardIds: readonly number[]) => void;
  myId: number | null;
  nationWar: boolean;
  cardType: (cardId: number) => number;
  isRedCard: (cardId: number) => boolean | null;
  zoneCardIds: (seatId: number, zone: number) => readonly number[];
  handCardIds: (seatId: number) => readonly number[];
  equipmentCardIds?: (seatId: number) => readonly number[];
}

export interface MoveJudgeResult {
  ignore: boolean;
  cardIds: number[];
  fromPosition: number;
  toPosition: number;
  /** 3208：其余临时区牌被收成未知，不能再按旧顺序补出来。 */
  dropOtherTemporary: boolean;
}

const judgmentsBySeat = new Map<number, number[]>();
const colorBySeat = new Map<number, number>();
const shownJudgeBySeat = new Map<number, number[]>();
/** 最近一次在展示区露面的判定牌号，椒遇回手时用来把牌认成确定牌。 */
let lastJudgeCardId: number | null = null;
const shownBySpell = new Map<number, number[]>();
const shownCard3488 = new Map<number, number>();
let stackedCard3488 = 0;
let pileShowLeft = 0;
let currentSeatId: number | null = null;
let givenCardBy780: number | null = null;
let handExchange361: { casterSeatId: number; targetSeatId: number; shown: number[]; choice: number } | null = null;
const knownPilePendingPlacements = new Map<string, number[]>();

function knownPilePlacementKey(spellId: number, seatId: number): string {
  return `${spellId}:${seatId}`;
}
const qingyiPending = new Map<number, number[]>();
const qianfuPending = new Map<string, number[]>();
/**
 * 手牌暂存技能：pilePackCount3483 是牌堆顶要打包几张，storedHand3483 是暂存进技能区的手牌。
 * 打包张数由移牌入口读取；暂存手牌在离开技能区时清掉。
 */
let pilePackCount3483 = 0;
let storedHand3483: number[] = [];

export function resetSpellMoveState(): void {
  judgmentsBySeat.clear();
  colorBySeat.clear();
  shownJudgeBySeat.clear();
  lastJudgeCardId = null;
  shownBySpell.clear();
  shownCard3488.clear();
  stackedCard3488 = 0;
  pileShowLeft = 0;
  currentSeatId = null;
  givenCardBy780 = null;
  handExchange361 = null;
  knownPilePendingPlacements.clear();
  qingyiPending.clear();
  qianfuPending.clear();
  pilePackCount3483 = 0;
  storedHand3483 = [];
}

export function noteCurrentTurnSeat(seatId: number): void {
  currentSeatId = seatId;
}

/** 3483：牌堆顶这一步要打包几张；由看牌回报写，移牌管线在牌堆 → 技能区那一步取。 */
export function getSpell3483PileCount(): number {
  return pilePackCount3483;
}

export function noteSeatCardColor(seatId: number, color: number): void {
  if (color === COLOR_RED || color === COLOR_BLACK) colorBySeat.set(seatId, color);
}

/** UseSpell 亮出的牌，供后面的暗置移动补号。 */
export function noteSpellShownCards(
  spellId: number,
  srcSeatId: number,
  cardIds: readonly number[],
  myId: number | null,
  targetSeatIds: readonly number[] = [],
  effectIndex: number | null = null
): void {
  const known = cardIds.filter((cardId) => cardId > 0);
  if (spellId === SPELL_DISCARD_TO_HAND && known.length && srcSeatId === myId) shownBySpell.set(spellId, known);
  // 7016 / 7017：自己亮出的牌随后暗置进手牌，一次一张，按亮出的顺序取。
  if ((spellId === SPELL_SELF_HAND_GAIN[0] || spellId === SPELL_SELF_HAND_GAIN[1]) && known.length && srcSeatId === myId) {
    shownBySpell.set(spellId, known);
  }
  if (spellId === SPELL_HAND_EXCHANGE) {
    const targets = targetSeatIds.filter((seatId) => seatId !== srcSeatId);
    if (targetSeatIds.length === 1 && targets.length === 1) {
      handExchange361 = { casterSeatId: srcSeatId, targetSeatId: targets[0] ?? srcSeatId, shown: [], choice: 0 };
    }
  }
  if (KNOWN_PILE_PLACEMENT_SPELLS.has(spellId) && effectIndex === 1 && known.length) {
    knownPilePendingPlacements.set(knownPilePlacementKey(spellId, srcSeatId), known);
  }
  if (spellId === SPELL_DISCARD_GAIN && known.length) qingyiPending.set(srcSeatId, known);
  if (spellId === SPELL_DISCARD_TO_TOP[0] || spellId === SPELL_DISCARD_TO_TOP[1]) {
    const key = `${spellId}-${srcSeatId}`;
    qianfuPending.delete(key);
    if (effectIndex === 2 && targetSeatIds.length === 0 && known.length) qianfuPending.set(key, known);
  }
}

/** 看牌面板：按技能号决定这些牌号是手牌还是牌堆。 */
export function judgeOptTarget(input: OptJudgeInput): CardReveal[] {
  const spellId = input.spellId;
  const param = input.param;
  const params = input.params;
  const src = input.srcSeatId;
  const target = input.targetSeatId;
  const myId = input.myId;
  if ([SPELL_SELF_HAND_GAIN[0], SPELL_SELF_HAND_GAIN[1]].includes(spellId) && params.length > 0 && src === myId) {
    shownBySpell.set(spellId, [...params]);
  }
  const reveals: CardReveal[] = [];
  const showHand = (seat: number | null, ids: readonly number[], partial: boolean): void => {
    if (seat === null || seat === undefined || seat === DRAW_PILE_OWNER) return;
    reveals.push(...handReveal(seat, [...ids], partial));
  };
  const showDeck = (ids: readonly number[], packUnknown = false): void => {
    reveals.push(...deckReveal([...ids], 'top', packUnknown));
  };
  // 看牌技能给的牌号多数在 Params 里，少数只给 CardIDs，两边都收。
  const lookIds = params.length ? [...params] : [...(input.cardIds ?? [])];
  if (
    (HAND_LOOK_SPELLS.includes(spellId as typeof HAND_LOOK_SPELLS[number]) && lookIds.length > 0
      || (HAND_LOOK_WHEN_IDLE.includes(spellId as typeof HAND_LOOK_WHEN_IDLE[number]) || spellId === SPELL_HAND_EXCHANGE) && param === 0 && params.length > 0
      || input.isHandLookSpell?.(spellId) === true && lookIds.length > 0)
  ) {
    showHand(target, lookIds, false);
  } else if (spellId === SPELL_PEEK_ONE && param === 0 && params.length === 1) {
    showDeck(params);
  } else if (spellId === SPELL_PARTIAL_OWN_HAND && param === 0 && params.length > 2) {
    showHand(src, params.slice(1, (params[0] ?? 0) + 1), true);
  } else if ((spellId === SPELL_PARTIAL_TARGET_HAND[0] || spellId === SPELL_PARTIAL_TARGET_HAND[1]) && param === 1 && params.length > 2) {
    showHand(target, params.slice(-(params[1] ?? 0)), true);
  } else if (spellId === SPELL_OWN_PILE_LOOK && param === 0 && params.length > 2 && target === DRAW_PILE_OWNER && src === myId) {
    const count = params[0] ?? 0;
    showDeck(params.slice(2, 2 + count));
  } else if (spellId === SPELL_PAIRED_LOOK && param === 0 && params.length > 0 && target !== null && src === myId) {
    const ids = params.filter((_, index) => index % 3 === 1);
    if (target === DRAW_PILE_OWNER) showDeck(ids);
    else showHand(target, ids, true);
  } else if (spellId === SPELL_HAND_HOLD && param === 1 && params.length > 2) {
    showHand(target, params.slice(-(params[1] ?? 0)), true);
  } else if (spellId === SPELL_HAND_HOLD && param === 1 && (params[0] ?? 0) > 0) {
    pilePackCount3483 = params[0] ?? 0;
  } else if ((spellId === SPELL_PILE_PREVIEW[0] || spellId === SPELL_PILE_PREVIEW[1]) && params.length > 0 && target === DRAW_PILE_OWNER && src === myId) {
    pileShowLeft = params.length;
    showDeck(params, true);
  }
  // 出牌让对方响应时，参数里是打出的那张牌。不能因为有目标、有牌号，就记成对方的手牌。
  return reveals;
}

/** 技能操作回报：记下选项，或把回报里的牌号当成手牌、牌堆顶、牌堆底。 */
export function judgeSpellOpt(spellId: number, optType: number, seatId: number, datas: readonly number[]): CardReveal[] {
  if (spellId === SPELL_HAND_EXCHANGE && handExchange361 && optType === OPT_CHOOSE && seatId === handExchange361.casterSeatId && (datas[0] === 1 || datas[0] === 2)) {
    handExchange361.choice = datas[0] ?? 0;
  }
  if (spellId === SPELL_SHOW_HAND) return handReveal(seatId, [...datas], true);
  if (spellId === SPELL_SHOW_DECK && optType !== OPT_SKIP) return deckReveal([...datas], 'top');
  if (spellId === SPELL_SHOW_DECK_TYPED && optType === OPT_BOTTOM) return deckReveal([...datas], 'top');
  if (spellId === SPELL_DEFERRED_PILE) {
    pileShowLeft -= 0.5;
    if (!(pileShowLeft > 0)) return deckReveal([...datas], 'top');
  }
  if (spellId === SPELL_SHOW_DECK_BOTTOM && optType === OPT_BOTTOM) return deckReveal([...datas].reverse(), 'bottom');
  return [];
}

/** 座位和区都没变，且不是牌堆换位或装备区参数变化，按原地展示处理。 */
export function isInPlaceCardShow(move: MoveJudgeInput): boolean {
  const moved = move.fromId !== move.toId
    || move.fromZone !== move.toZone
    || (move.fromPosition !== move.toPosition && move.toZone === ZONE_DRAW)
    || (move.fromZoneParam !== move.toZoneParam && move.toZone === ZONE_SKILL);
  if (moved) return false;
  if (move.spellId === SPELL_PILE_PREVIEW[1] && move.moveType === MOVE_SWAP) return false;
  if (move.spellId === SPELL_SHOW_DECK && move.moveType === MOVE_REVEAL) return false;
  return move.cardIds.some((cardId) => cardId > 0);
}

/** 移牌入口：丢掉无效移动，纠正牌堆顶底，再给没带牌号的移动补上已经亮过的牌。 */
export function correctMoveCard(move: MoveJudgeInput, host: MoveJudgeHost): MoveJudgeResult {
  let cardIds = move.cardIds.slice();
  let fromPosition = move.fromPosition;
  let toPosition = move.toPosition;
  const count = move.cardCount;
  const spellId = move.spellId;
  const fromZone = move.fromZone;
  const toZone = move.toZone;
  const fromId = move.fromId;
  const toId = move.toId;
  const moveType = move.moveType;
  const ignored = count === 0 || moveType === ZONE_NONE || toZone === ZONE_RECYCLE || move.isSend === true;
  if (ignored) return { ignore: true, cardIds, fromPosition, toPosition, dropOtherTemporary: false };

  if (spellId === SPELL_INDEXED_CARDS && moveType === MOVE_REVEAL && count === cardIds.length - 2) {
    const index = cardIds.splice(0, 1)[0] ?? 0;
    cardIds.splice(index, 1);
  }
  const known = cardIds.filter((cardId) => cardId > 0).length;
  if (known !== count && known !== 0) cardIds = [];

  record3571Judgments(move, cardIds, host);

  if (fromZone === ZONE_DRAW && fromPosition === UNSPECIFIED && [SPELL_DROP_TEMP, SPELL_PILE_PREVIEW[1], SPELL_PARTIAL_TARGET_HAND[0], SPELL_PARTIAL_TARGET_HAND[1], SPELL_OWN_PILE_LOOK].includes(spellId)) {
    fromPosition = TOP;
  }
  if (fromZone === ZONE_DRAW && fromPosition === UNSPECIFIED && toZone === ZONE_TEMP && spellId === SPELL_DRAW_BOTTOM_THREE && count === 3) {
    fromPosition = BOTTOM;
  }
  // 位置没写是 0xff02。0 是牌堆底，许攸这类从底摸牌不能改成从顶上拿，否则刚放上顶的牌会被当成摸走。
  if (
    fromZone === ZONE_DRAW && toZone === ZONE_HAND && spellId === 0
    && (moveType === MOVE_DEAL || moveType === MOVE_DRAW)
    && fromPosition === UNSPECIFIED
  ) fromPosition = TOP;
  if (
    fromZone === ZONE_DRAW && fromPosition === UNSPECIFIED && moveType === MOVE_DRAW && count === 1
    && spellId !== SPELL_DRAW_BOTTOM_INSTEAD
  ) fromPosition = TOP;
  if (fromZone === ZONE_DRAW && fromPosition === UNSPECIFIED && toZone === ZONE_SKILL && moveType === MOVE_PUT && spellId === SPELL_DRAW_TOP_TO_SKILL && count === 1) {
    fromPosition = TOP;
  }
  if (fromZone === ZONE_DRAW && fromPosition === UNSPECIFIED && toZone === ZONE_HAND && spellId === SPELL_DRAW_BOTTOM_ONE && count === 1) {
    fromPosition = BOTTOM;
  }
  if (fromZone === ZONE_DRAW && toZone === ZONE_HAND && spellId === SPELL_DRAW_BOTTOM_INSTEAD) {
    fromPosition = BOTTOM;
  }
  if (
    fromZone === ZONE_DRAW && fromPosition === UNSPECIFIED && toZone === ZONE_HAND && !host.nationWar
    && [SPELL_SELF_HAND_GAIN[0], SPELL_SELF_HAND_GAIN[1]].includes(spellId) && count === 1
  ) fromPosition = TOP;
  if (
    fromZone === ZONE_DRAW && fromPosition === TOP + 1 && toZone === ZONE_HAND && spellId === 0 && moveType === MOVE_DEAL && count === 4
    && cardIds.every((cardId) => host.cardType(cardId) === 8)
  ) fromPosition = UNSPECIFIED;
  if (toZone === ZONE_DRAW && (spellId === 815 || spellId === 14163)) {
    toPosition = TOP;
  }
  if (toZone === ZONE_DRAW && toId === DRAW_PILE_OWNER && toPosition === TOP && cardIds.some((cardId) => cardId === SPECIAL_PILE_CARDS[0] || cardId === SPECIAL_PILE_CARDS[1])) {
    toPosition = UNSPECIFIED;
  }
  if (toZone === ZONE_DRAW && toId === DRAW_PILE_OWNER && toPosition === TOP) {
    cardIds = cardIds.filter((cardId) => cardId !== SPECIAL_PILE_CARDS[0] && cardId !== SPECIAL_PILE_CARDS[1]);
  }

  fillHiddenIds(move, cardIds, host);
  const adjusted = adjustZoneTransfer({ ...move, cardIds, fromPosition, toPosition });
  cardIds = adjusted.cardIds;
  fromPosition = adjusted.fromPosition;
  toPosition = adjusted.toPosition;
  // 普通摸牌没写从哪一头拿时从牌堆顶拿。技能已经改成底，或延时锦囊被标成未指定的，保持不动。
  if (move.fromPosition === UNSPECIFIED && fromZone === ZONE_DRAW && fromPosition === UNSPECIFIED && toZone !== ZONE_DRAW) {
    fromPosition = TOP;
  }
  // 摸牌协议里的 0 是缺省，本人是从牌堆顶摸的。按底摸会把底下的明牌换掉。
  // 寸目等会先改成从底摸，技能号不是 0，这里不动。
  if (
    fromZone === ZONE_DRAW
    && toZone === ZONE_HAND
    && spellId === 0
    && moveType === MOVE_DEAL
    && fromPosition === BOTTOM
  ) {
    fromPosition = TOP;
  }
  if (cardIds.length < count) cardIds = cardIds.concat(Array(count - cardIds.length).fill(0));
  return { ignore: false, cardIds, fromPosition, toPosition, dropOtherTemporary: adjusted.dropOtherTemporary };
}

/** 夺炁：弃牌堆暗置进手时，只有原主人的牌张数正好等于这次张数才补上。 */
export function takeQiDiscardCards(
  move: Pick<MoveJudgeInput, 'fromZone' | 'toZone' | 'cardCount' | 'cardIds'>,
  discardCardIds: readonly number[],
  ownerOf: (cardId: number) => number | null,
  victimSeatId: number | null
): number[] | null {
  if (move.fromZone !== ZONE_DISCARD || move.toZone !== ZONE_HAND) return null;
  if (move.cardIds.some((cardId) => cardId > 0)) return null;
  if (victimSeatId === null || move.cardCount <= 0) return null;
  const owned = discardCardIds.filter((cardId) => cardId > 0 && ownerOf(cardId) === victimSeatId);
  return owned.length === move.cardCount ? owned : null;
}

function adjustZoneTransfer(move: MoveJudgeInput): MoveJudgeResult {
  let fromPosition = move.fromPosition;
  let toPosition = move.toPosition;
  let cardIds = [...move.cardIds];
  let dropOtherTemporary = false;
  const hidden = !cardIds.some((cardId) => cardId > 0);
  const spellId = move.spellId;
  if (spellId === SPELL_FORCE_BOTTOM && move.fromZone === 0 && move.toZone === ZONE_DRAW && toPosition === TOP + 1 && move.moveType === MOVE_SWAP) {
    toPosition = BOTTOM;
    cardIds = cardIds.map(() => 0);
  }
  if (spellId === SPELL_DROP_TEMP && move.fromZone === ZONE_TEMP && move.toZone === ZONE_HAND && hidden) {
    fromPosition = BOTTOM;
    dropOtherTemporary = true;
  }
  if (spellId === SPELL_HAND_HOLD) {
    if (move.fromZone === ZONE_TEMP && move.toZone === ZONE_TEMP && hidden) {
      fromPosition = BOTTOM;
      toPosition = TOP;
    } else if (move.fromZone === ZONE_DRAW && move.toZone === ZONE_TEMP && fromPosition === UNSPECIFIED && hidden) {
      fromPosition = BOTTOM;
      pilePackCount3483 = 0;
    } else if (move.fromZone === ZONE_HAND && move.toZone === ZONE_TEMP) {
      storedHand3483 = cardIds.filter((cardId) => cardId > 0);
    } else if (move.fromZone === ZONE_TEMP && move.toZone === ZONE_DRAW && fromPosition === UNSPECIFIED) {
      if (toPosition === TOP) toPosition = BOTTOM;
      else if (toPosition === BOTTOM) toPosition = TOP;
      if (hidden) cardIds = cardIds.map(() => 0);
      storedHand3483 = [];
    } else if (move.fromZone === ZONE_TEMP && move.toZone === ZONE_HAND) {
      storedHand3483 = [];
    } else if (move.fromZone === ZONE_TEMP) {
      storedHand3483 = [];
    }
  }
  return { ignore: false, cardIds, fromPosition, toPosition, dropOtherTemporary };
}

/** 判定牌按座位颜色回手的技能：默认只有 3571，宿主可以放宽到椒遇等同类技能。 */
function isJudgeRecoverySpell(spellId: number, host: MoveJudgeHost): boolean {
  return host.isJudgeRecoverySpell ? host.isJudgeRecoverySpell(spellId) : spellId === SPELL_JUDGE_RECOVERY;
}

function record3571Judgments(move: MoveJudgeInput, cardIds: number[], host: MoveJudgeHost): void {
  if (!isJudgeRecoverySpell(move.spellId, host)
    || move.fromZone !== ZONE_JUDGE || move.toZone !== ZONE_SHOW) return;
  const seat = move.srcSeatId;
  const known = cardIds.map(Number).filter((cardId) => cardId > 0);
  if (seat === null || !Number.isInteger(seat) || seat < 0 || seat >= DRAW_PILE_OWNER || known.length !== move.cardCount) return;
  const previous = judgmentsBySeat.get(seat) ?? [];
  judgmentsBySeat.set(seat, [...new Set([...previous, ...known])]);
}

/** 判定牌已经在展示区里露面：判定颜色还没记上时也要留着，靠这张牌回手。 */
function noteShownJudgeCard(seatId: number, cardIds: readonly number[]): void {
  const known = cardIds.map(Number).filter((cardId) => cardId > 0);
  if (!known.length) return;
  lastJudgeCardId = known[known.length - 1] ?? null;
  if (!Number.isInteger(seatId) || seatId < 0 || seatId >= DRAW_PILE_OWNER) return;
  const previous = shownJudgeBySeat.get(seatId) ?? [];
  shownJudgeBySeat.set(seatId, [...new Set([...previous, ...known])]);
}

/**
 * 最近一次在展示区露面的判定牌。
 * 回手消息还没到、技能私有数据里也没带牌号时，就用它把牌认成确定牌。
 */
export function takeJudgeCardId(): number | null {
  const cardId = lastJudgeCardId;
  lastJudgeCardId = null;
  return cardId;
}

/** 这个座位现在有没有判定牌正在展示区里亮着。 */
export function hasShownJudgeCard(seatId: number): boolean {
  return (shownJudgeBySeat.get(seatId)?.length ?? 0) > 0 || lastJudgeCardId !== null;
}

/**
 * 判定牌收进手牌。
 * 颜色已知就挑同色的；颜色没记上（椒遇这类新技能不给私有颜色）就退回展示区里
 * 还在的判定牌。张数对不上时按从新到旧取够——宁可把展示区里的牌认成这张，
 * 也不能让它掉成「可能牌」。
 */
function recoverJudgeCard(move: MoveJudgeInput, host: MoveJudgeHost): number[] {
  const inZone = host.zoneCardIds(move.fromId, ZONE_SHOW).filter((cardId) => cardId > 0);
  if (!inZone.length) return [];
  const wanted = move.cardCount > 0 ? move.cardCount : inZone.length;
  const color = colorBySeat.get(move.toId);
  const matchesColor = (cardId: number): boolean => (
    color !== COLOR_RED && color !== COLOR_BLACK
      ? true
      : host.isRedCard(cardId) === (color === COLOR_RED)
  );
  const sameColor = inZone.filter(matchesColor);
  if (sameColor.length >= wanted) return sameColor.slice(0, wanted);
  const recorded = [...new Set([
    ...(judgmentsBySeat.get(move.toId) ?? []),
    ...(shownJudgeBySeat.get(move.toId) ?? [])
  ])].filter((cardId) => inZone.includes(cardId));
  if (recorded.length >= wanted) return recorded.slice(0, wanted);
  const ordered = [...new Set([...recorded, ...inZone])];
  return ordered.slice(0, wanted);
}

/** 判定牌回到手上、协议又不给卡号时，用这块座位色补号。技能私有数据没颜色就只留个座位色。 */
export function recordJudgeColorGain(seatId: number, datas: readonly number[]): number | null {
  if (!Number.isInteger(seatId) || seatId < 0 || seatId >= DRAW_PILE_OWNER) return null;
  const values = datas.map(Number).filter(Number.isFinite);
  const color = values[0];
  if (color === COLOR_RED || color === COLOR_BLACK) colorBySeat.set(seatId, color);
  const cardIds = values
    .filter((value, index) => index > 0 && Number.isInteger(value) && value > COLOR_BLACK);
  noteShownJudgeCard(seatId, cardIds);
  return cardIds[0] ?? null;
}

function fillHiddenIds(move: MoveJudgeInput, cardIds: number[], host: MoveJudgeHost): void {
  const spellId = move.spellId;
  const known = cardIds.filter((cardId) => cardId > 0).length;
  const hidden = known === 0;
  const count = move.cardCount;

  if (isJudgeRecoverySpell(spellId, host) && move.toZone === ZONE_SHOW) noteShownJudgeCard(move.srcSeatId ?? move.fromId, cardIds);

  if (spellId === SPELL_HAND_STACK && move.fromZone === ZONE_HAND && move.toZone === ZONE_HAND && move.moveType === MOVE_REVEAL && known === 1) {
    const shown = cardIds.find((cardId) => cardId > 0) ?? 0;
    if (shown) shownCard3488.set(move.fromId, shown);
  } else if (spellId === SPELL_HAND_STACK && move.fromZone === ZONE_HAND && move.toZone === ZONE_TEMP && move.moveType === MOVE_GAIN && hidden) {
    cardIds[0] = shownCard3488.get(move.fromId) ?? 0;
    stackedCard3488 = cardIds[0] ?? 0;
  } else if (
    spellId === SPELL_HAND_STACK && move.fromZone === ZONE_TEMP && (move.toZone === ZONE_DRAW || move.toZone === ZONE_DISCARD)
    && move.moveType === MOVE_GAIN && hidden
  ) {
    cardIds[0] = stackedCard3488 || 0;
    stackedCard3488 = 0;
  }

  const pending3511 = shownBySpell.get(SPELL_DISCARD_TO_HAND);
  if (spellId === SPELL_DISCARD_TO_HAND && move.fromZone === ZONE_DISCARD && move.toZone === ZONE_HAND && pending3511 && count === pending3511.length && hidden) {
    pending3511.forEach((cardId, index) => {
      cardIds[index] = cardId;
    });
    shownBySpell.delete(SPELL_DISCARD_TO_HAND);
  }

  if (spellId === SPELL_RED_BACK_TO_DRAW && move.fromZone === ZONE_DISCARD && move.toZone === ZONE_DRAW && hidden) {
    const reds = host.zoneCardIds(DRAW_PILE_OWNER, ZONE_DISCARD)
      .filter((cardId) => host.isRedCard(cardId) === true)
      .reverse()
      .slice(0, count);
    cardIds.splice(0, Infinity, ...reds);
  }

  if (isJudgeRecoverySpell(spellId, host) && move.fromZone === ZONE_SHOW && move.toZone === ZONE_HAND) {
    if (hidden) {
      const filled = recoverJudgeCard(move, host);
      if (filled.length === count) {
        cardIds.splice(0, Infinity, ...filled);
        host.onJudgeCardRecovered?.(move.toId, filled);
      }
    }
    judgmentsBySeat.delete(move.toId);
    shownJudgeBySeat.delete(move.toId);
  }

  if ([SPELL_SELF_HAND_GAIN[0], SPELL_SELF_HAND_GAIN[1]].includes(spellId) && move.toZone === ZONE_HAND && count === 1 && move.srcSeatId === host.myId) {
    const pending = shownBySpell.get(spellId);
    if (cardIds[0] && pending?.includes(cardIds[0])) {
      pending.splice(pending.indexOf(cardIds[0]), 1);
    } else if (hidden && pending && (move.fromZone === ZONE_HAND || pending.length === 2 || pending.length === 1)) {
      cardIds[0] = pending.shift() ?? 0;
    }
  }

  if (
    move.fromZone === ZONE_HAND
    && host.myId !== null
    && move.fromId === host.myId
    && move.toId !== host.myId
    && count === 1
    && hidden
  ) {
    const knownHand = host.handCardIds(move.fromId).filter((cardId) => cardId > 0);
    if (knownHand.length === 1) cardIds[0] = knownHand[0];
  }

  if (move.fromZone === ZONE_EQUIP && move.toZone === ZONE_HAND && hidden && count === 1) {
    const equipIds = host.equipmentCardIds?.(move.fromId)?.filter((cardId) => cardId > 0) ?? [];
    if (equipIds.length === 1) cardIds[0] = equipIds[0];
  }

  if (
    move.spellId === SPELL_SNATCH
    && move.fromZone === ZONE_HAND
    && move.toZone === ZONE_HAND
    && hidden
    && count === 1
  ) {
    const equipIds = host.equipmentCardIds?.(move.fromId)?.filter((cardId) => cardId > 0) ?? [];
    if (equipIds.length === 1) cardIds[0] = equipIds[0];
  }

  fillClueIds(move, cardIds, host);
}

/** 暗牌离开某区：只有整区被拿走，或位置明确指向顶/下标时，才带走该区里已经确定的牌。 */
export function takeHiddenZoneCards(
  move: Pick<MoveJudgeInput, 'cardCount' | 'cardIds' | 'fromPosition' | 'fromZone' | 'toZone' | 'spellId' | 'moveType'>,
  zoneCardIds: readonly number[],
  zoneLength: number
): number[] {
  if (move.cardIds.some((cardId) => cardId > 0)) return [...move.cardIds];
  const count = move.cardCount;
  if (count <= 0) return [...move.cardIds];
  const cards = zoneCardIds.filter((cardId) => cardId > 0);
  const position = move.fromPosition;
  // 牌堆顶的暗牌不能用已知牌列表的末尾去填。观星放在底下的牌会因此被当成从顶上摸走。
  if (position === TOP && move.fromZone !== ZONE_DRAW && cards.length >= count) return cards.slice(-count);
  if (position !== UNSPECIFIED && position !== TOP && position >= 0 && position + count <= cards.length) {
    return cards.slice(position, position + count);
  }
  // 牌堆里大部分牌没看过。已看到的张数对上这次摸牌，不能把牌堆底的明牌整把写进手里。
  if (move.fromZone === ZONE_DRAW) return [...move.cardIds];
  const clearsZone = count === zoneLength || zoneLength === 1;
  const allianceHand = move.spellId === 121 && move.moveType === MOVE_GAIN && move.fromZone === ZONE_HAND && move.toZone === ZONE_TEMP;
  if ((clearsZone || allianceHand) && cards.length > 0 && cards.length <= count) {
    return [...cards, ...Array.from({ length: count - cards.length }, () => 0)];
  }
  return [...move.cardIds];
}

function fillClueIds(move: MoveJudgeInput, cardIds: number[], host: MoveJudgeHost): void {
  const known = cardIds.filter((cardId) => cardId > 0);
  const hidden = known.length === 0;
  const count = move.cardCount;
  if (handExchange361 && move.spellId === SPELL_HAND_EXCHANGE) {
    if (
      move.moveType === MOVE_REVEAL && move.fromZone === ZONE_HAND && move.toZone === ZONE_HAND
      && move.fromId === handExchange361.targetSeatId && move.toId === handExchange361.targetSeatId
      && known.length === count
    ) {
      handExchange361.shown = known;
    } else if (
      move.moveType === MOVE_GIVE && move.fromZone === ZONE_HAND && move.toZone === ZONE_HAND
      && move.fromId === handExchange361.targetSeatId && move.toId === handExchange361.casterSeatId
    ) {
      const state = handExchange361;
      handExchange361 = null;
      if (hidden && (state.choice === 1 || state.choice === 2) && state.shown.length) {
        const hand = host.handCardIds(state.targetSeatId).filter((cardId) => cardId > 0);
        const shownInHand = state.shown.filter((cardId) => hand.includes(cardId));
        if (shownInHand.length === state.shown.length) {
          const picked = state.choice === 1
            ? shownInHand
            : hand.filter((cardId) => !state.shown.includes(cardId));
          if (picked.length === count) cardIds.splice(0, Infinity, ...picked);
        }
      }
    }
  }
  if (
    KNOWN_PILE_PLACEMENT_SPELLS.has(move.spellId)
    && move.moveType === MOVE_PLACE
    && move.toZone === ZONE_SKILL
    && move.toZoneParam === move.spellId
    && move.toId === move.fromId
    && (move.fromZone === ZONE_HAND || (move.spellId === SPELL_KNOWN_PILE_FROM_EQUIP && move.fromZone === ZONE_EQUIP))
  ) {
    const pendingKey = knownPilePlacementKey(move.spellId, move.toId);
    const pending = knownPilePendingPlacements.get(pendingKey);
    knownPilePendingPlacements.delete(pendingKey);
    if (hidden && pending && pending.length === count) cardIds.splice(0, Infinity, ...pending);
  }
  if (move.spellId === SPELL_DISCARD_GAIN && move.fromZone === ZONE_DISCARD && move.toZone === ZONE_HAND) {
    const pending = qingyiPending.get(move.toId);
    qingyiPending.delete(move.toId);
    if (hidden && pending && pending.length === count) cardIds.splice(0, Infinity, ...pending);
  }
  if ((move.spellId === SPELL_DISCARD_TO_TOP[0] || move.spellId === SPELL_DISCARD_TO_TOP[1]) && move.fromZone === ZONE_DISCARD && move.toZone === ZONE_DRAW && move.toPosition === TOP && move.moveType === MOVE_PLACE && move.srcSeatId !== null) {
    const key = `${move.spellId}-${move.srcSeatId}`;
    const pending = qianfuPending.get(key);
    qianfuPending.delete(key);
    if (hidden && pending && pending.length === count) cardIds.splice(0, Infinity, ...pending);
  }
  if (move.spellId === SPELL_GIVE_ONE && move.fromZone === ZONE_HAND && move.fromPosition === UNSPECIFIED && count === 1) {
    if (move.toZone === ZONE_HAND && move.fromId === currentSeatId) {
      givenCardBy780 = known[0] ?? null;
    } else if (move.toZone === ZONE_DRAW && move.fromId !== currentSeatId && givenCardBy780 !== null && host.handCardIds(move.fromId).includes(givenCardBy780)) {
      if (hidden) cardIds[0] = givenCardBy780;
      givenCardBy780 = null;
    }
  }
}


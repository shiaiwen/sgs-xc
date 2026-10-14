/**
 * 看牌、移牌卡号、暗牌补号。
 * 条件与技能号保持混淆脚本里的原分支，只把「亮牌」收成明牌条能吃的结果。
 * 分区对象的增删仍由现有引擎做。
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

const SPELL_3571 = 0xdf3;
/** 这些技能号的看牌消息只是面板提示，参数不是牌号，兜底时要排除。 */
const PANEL_ONLY_OPT_TARGET_IDS = new Set([945, 3440, 11003, 2900, 2022]);
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
const shown3488 = new Map<number, number>();
let stack3488 = 0;
let pileShowLeft = 0;
let currentSeatId: number | null = null;
let given780: number | null = null;
let xiashu: { casterSeatId: number; targetSeatId: number; shown: number[]; choice: number } | null = null;
const zhouxuanPending = new Map<number, number[]>();
const qingyiPending = new Map<number, number[]>();
const qianfuPending = new Map<string, number[]>();
/**
 * 3483 的两半状态：`count3483` 是「牌堆顶要打包几张」，`handCards3483` 是暂存到技能区的那批手牌。
 * 目前只有写入端；对应的读取端（牌堆归还的暂存计划与按 key 换回）还没接，
 * 见 `graph/temporary-zone-grid.ts` 里已备好的 planPendingDeckReturn / applyPendingDeckReturn / swapZoneCardsByKey。
 */
let count3483 = 0;
let handCards3483: number[] = [];

export function resetObfuscatedJudge(): void {
  judgmentsBySeat.clear();
  colorBySeat.clear();
  shownJudgeBySeat.clear();
  lastJudgeCardId = null;
  shownBySpell.clear();
  shown3488.clear();
  stack3488 = 0;
  pileShowLeft = 0;
  currentSeatId = null;
  given780 = null;
  xiashu = null;
  zhouxuanPending.clear();
  qingyiPending.clear();
  qianfuPending.clear();
  count3483 = 0;
  handCards3483 = [];
}

export function noteObfuscatedCurrentSeat(seatId: number): void {
  currentSeatId = seatId;
}

/** 3483：牌堆顶这一步要打包几张；由看牌回报写，移牌管线在牌堆 → 技能区那一步取。 */
export function getObfuscated3483PileCount(): number {
  return count3483;
}

export function noteObfuscatedSeatColor(seatId: number, color: number): void {
  if (color === COLOR_RED || color === COLOR_BLACK) colorBySeat.set(seatId, color);
}

/** UseSpell 亮出的牌，供后面的暗置移动补号。 */
export function noteObfuscatedUseSpell(
  spellId: number,
  srcSeatId: number,
  cardIds: readonly number[],
  myId: number | null,
  targetSeatIds: readonly number[] = [],
  effectIndex: number | null = null
): void {
  const known = cardIds.filter((cardId) => cardId > 0);
  if (spellId === 0xdb7 && known.length && srcSeatId === myId) shownBySpell.set(spellId, known);
  // 7016 / 7017：自己亮出的牌随后暗置进手牌，一次一张，按亮出的顺序取。
  if ((spellId === 0x1b68 || spellId === 0x1b69) && known.length && srcSeatId === myId) {
    shownBySpell.set(spellId, known);
  }
  if (spellId === 0x169) {
    const targets = targetSeatIds.filter((seatId) => seatId !== srcSeatId);
    if (targetSeatIds.length === 1 && targets.length === 1) {
      xiashu = { casterSeatId: srcSeatId, targetSeatId: targets[0] ?? srcSeatId, shown: [], choice: 0 };
    }
  }
  if (spellId === 0xbf9 && effectIndex === 1 && known.length) zhouxuanPending.set(srcSeatId, known);
  if (spellId === 0xc55 && known.length) qingyiPending.set(srcSeatId, known);
  if (spellId === 0xea6 || spellId === 0xea9) {
    const key = `${spellId}-${srcSeatId}`;
    qianfuPending.delete(key);
    if (effectIndex === 2 && targetSeatIds.length === 0 && known.length) qianfuPending.set(key, known);
  }
}

export function judgeOptTarget(input: OptJudgeInput): CardReveal[] {
  const spellId = input.spellId;
  const param = input.param;
  const params = input.params;
  const src = input.srcSeatId;
  const target = input.targetSeatId;
  const myId = input.myId;
  if ([0x1b68, 0x1b69].includes(spellId) && params.length > 0 && src === myId) {
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
    ([0x4, 0x5, 0x399, 0x174, 0x32b, 0x165, 0xc2f, 0x1f5, 0xd6d, 0xfb9].includes(spellId) && lookIds.length > 0
      || [0x353, 0x169, 0x306, 0xcee, 0xf24].includes(spellId) && param === 0 && params.length > 0
      || input.isHandLookSpell?.(spellId) === true && lookIds.length > 0)
  ) {
    showHand(target, lookIds, false);
  } else if (spellId === 0x3af && param === 0 && params.length === 1) {
    showDeck(params);
  } else if (spellId === 0x382 && param === 0 && params.length > 2) {
    showHand(src, params.slice(1, (params[0] ?? 0) + 1), true);
  } else if ((spellId === 0x3db || spellId === 0x3dc) && param === 1 && params.length > 2) {
    showHand(target, params.slice(-(params[1] ?? 0)), true);
  } else if (spellId === 0xf3f && param === 0 && params.length > 2 && target === DRAW_PILE_OWNER && src === myId) {
    const count = params[0] ?? 0;
    showDeck(params.slice(2, 2 + count));
  } else if (spellId === 0xcc2 && param === 0 && params.length > 0 && target !== null && src === myId) {
    const ids = params.filter((_, index) => index % 3 === 1);
    if (target === DRAW_PILE_OWNER) showDeck(ids);
    else showHand(target, ids, true);
  } else if (spellId === 0xd9b && param === 1 && params.length > 2) {
    showHand(target, params.slice(-(params[1] ?? 0)), true);
  } else if (spellId === 0xd9b && param === 1 && (params[0] ?? 0) > 0) {
    count3483 = params[0] ?? 0;
  } else if ((spellId === 0x1b62 || spellId === 0x1b63) && params.length > 0 && target === DRAW_PILE_OWNER && src === myId) {
    pileShowLeft = params.length;
    showDeck(params, true);
  }
  // 新技能兜底：我自己发动、有明确的目标座位、参数全是正数牌号，就按「看目标手牌」处理。
  // 已知属于面板提示的技能号排除在外，避免把提示文案当牌号。
  if (!reveals.length
    && !PANEL_ONLY_OPT_TARGET_IDS.has(spellId)
    && src !== null && myId !== null && (src === myId || input.mySeats.includes(src))
    && target !== null && target !== undefined && target !== DRAW_PILE_OWNER
    && lookIds.length > 0
    && lookIds.every((value) => Number.isInteger(value) && value > 0)) {
    showHand(target, lookIds, false);
  }
  return reveals;
}

export function judgeSpellOpt(spellId: number, optType: number, seatId: number, datas: readonly number[]): CardReveal[] {
  if (spellId === 0x169 && xiashu && optType === 0x16 && seatId === xiashu.casterSeatId && (datas[0] === 1 || datas[0] === 2)) {
    xiashu.choice = datas[0] ?? 0;
  }
  if (spellId === 0xe4b) return handReveal(seatId, [...datas], true);
  if (spellId === 0xea0 && optType !== 0x49) return deckReveal([...datas], 'top');
  if (spellId === 0xf1c && optType === 0x32) return deckReveal([...datas], 'top');
  if (spellId === 0x1b61) {
    pileShowLeft -= 0.5;
    if (!(pileShowLeft > 0)) return deckReveal([...datas], 'top');
  }
  if (spellId === 0xd08 && optType === 0x32) return deckReveal([...datas].reverse(), 'bottom');
  return [];
}

/** 座位和区都没变，且不是牌堆换位或装备区参数变化，按原地展示处理。 */
export function isObfuscatedSameZoneShow(move: MoveJudgeInput): boolean {
  const moved = move.fromId !== move.toId
    || move.fromZone !== move.toZone
    || (move.fromPosition !== move.toPosition && move.toZone === 0x1)
    || (move.fromZoneParam !== move.toZoneParam && move.toZone === 0x4);
  if (moved) return false;
  if (move.spellId === 0x1b63 && move.moveType === 0x13) return false;
  if (move.spellId === 0xea0 && move.moveType === 0x15) return false;
  return move.cardIds.some((cardId) => cardId > 0);
}

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
  const ignored = count === 0 || moveType === 0 || toZone === 0xb || move.isSend === true;
  if (ignored) return { ignore: true, cardIds, fromPosition, toPosition, dropOtherTemporary: false };

  if (spellId === 0x2c9 && moveType === 0x15 && count === cardIds.length - 2) {
    const index = cardIds.splice(0, 1)[0] ?? 0;
    cardIds.splice(index, 1);
  }
  const known = cardIds.filter((cardId) => cardId > 0).length;
  if (known !== count && known !== 0) cardIds = [];

  record3571Judgments(move, cardIds, host);

  if (fromZone === 0x1 && fromPosition === UNSPECIFIED && [0xc88, 0x1b63, 0x3db, 0x3dc, 0xf3f].includes(spellId)) {
    fromPosition = TOP;
  }
  if (fromZone === 0x1 && fromPosition === UNSPECIFIED && toZone === 0xa && spellId === 0xec0 && count === 3) {
    fromPosition = BOTTOM;
  }
  if (fromZone === 0x1 && fromPosition === UNSPECIFIED && moveType === 0xd && count === 1) fromPosition = TOP;
  if (fromZone === 0x1 && fromPosition === UNSPECIFIED && toZone === 0x4 && moveType === 0x8 && spellId === 0x31b && count === 1) {
    fromPosition = TOP;
  }
  if (fromZone === 0x1 && fromPosition === UNSPECIFIED && toZone === 0x5 && spellId === 0xc1d && count === 1) {
    fromPosition = BOTTOM;
  }
  if (
    fromZone === 0x1 && fromPosition === UNSPECIFIED && toZone === 0x5 && !host.nationWar
    && [0x1b68, 0x1b69].includes(spellId) && count === 1
  ) fromPosition = TOP;
  if (
    fromZone === 0x1 && fromPosition === TOP + 1 && toZone === 0x5 && spellId === 0 && moveType === 1 && count === 4
    && cardIds.every((cardId) => host.cardType(cardId) === 8)
  ) fromPosition = UNSPECIFIED;
  if (toZone === 0x1 && toId === DRAW_PILE_OWNER && toPosition === TOP && cardIds.some((cardId) => cardId === 0x1130 || cardId === 0x1131)) {
    toPosition = UNSPECIFIED;
  }
  if (toZone === 0x1 && toId === DRAW_PILE_OWNER && toPosition === TOP) {
    cardIds = cardIds.filter((cardId) => cardId !== 0x1130 && cardId !== 0x1131);
  }

  fillHiddenIds(move, cardIds, host);
  const adjusted = adjustZoneTransfer({ ...move, cardIds, fromPosition, toPosition });
  cardIds = adjusted.cardIds;
  fromPosition = adjusted.fromPosition;
  toPosition = adjusted.toPosition;
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
  if (move.fromZone !== 0x2 || move.toZone !== 0x5) return null;
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
  if (spellId === 0xe6e && move.fromZone === 0 && move.toZone === 0x1 && toPosition === TOP + 1 && move.moveType === 0x13) {
    toPosition = BOTTOM;
    cardIds = cardIds.map(() => 0);
  }
  if (spellId === 0xc88 && move.fromZone === 0xa && move.toZone === 0x5 && hidden) {
    fromPosition = BOTTOM;
    dropOtherTemporary = true;
  }
  if (spellId === 0xd9b) {
    if (move.fromZone === 0xa && move.toZone === 0xa && hidden) {
      fromPosition = BOTTOM;
      toPosition = TOP;
    } else if (move.fromZone === 0x1 && move.toZone === 0xa && fromPosition === UNSPECIFIED && hidden) {
      fromPosition = BOTTOM;
      count3483 = 0;
    } else if (move.fromZone === 0x5 && move.toZone === 0xa) {
      handCards3483 = cardIds.filter((cardId) => cardId > 0);
    } else if (move.fromZone === 0xa && move.toZone === 0x1 && fromPosition === UNSPECIFIED) {
      if (toPosition === TOP) toPosition = BOTTOM;
      else if (toPosition === BOTTOM) toPosition = TOP;
      if (hidden) cardIds = cardIds.map(() => 0);
      handCards3483 = [];
    } else if (move.fromZone === 0xa && move.toZone === 0x5) {
      handCards3483 = [];
    } else if (move.fromZone === 0xa) {
      handCards3483 = [];
    }
  }
  return { ignore: false, cardIds, fromPosition, toPosition, dropOtherTemporary };
}

/** 判定牌按座位颜色回手的技能：默认只有 3571，宿主可以放宽到椒遇等同类技能。 */
function isJudgeRecoverySpell(spellId: number, host: MoveJudgeHost): boolean {
  return host.isJudgeRecoverySpell ? host.isJudgeRecoverySpell(spellId) : spellId === SPELL_3571;
}

function record3571Judgments(move: MoveJudgeInput, cardIds: number[], host: MoveJudgeHost): void {
  if (!isJudgeRecoverySpell(move.spellId, host)
    || move.fromZone !== 0x3 || move.toZone !== 0x8) return;
  const seat = move.srcSeatId;
  const known = cardIds.map(Number).filter((cardId) => cardId > 0);
  if (seat === null || !Number.isInteger(seat) || seat < 0 || seat >= 0xff || known.length !== move.cardCount) return;
  const previous = judgmentsBySeat.get(seat) ?? [];
  judgmentsBySeat.set(seat, [...new Set([...previous, ...known])]);
}

/** 判定牌已经在展示区里露面：判定颜色还没记上时也要留着，靠这张牌回手。 */
function noteShownJudgeCard(seatId: number, cardIds: readonly number[]): void {
  const known = cardIds.map(Number).filter((cardId) => cardId > 0);
  if (!known.length) return;
  lastJudgeCardId = known[known.length - 1] ?? null;
  if (!Number.isInteger(seatId) || seatId < 0 || seatId >= 0xff) return;
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
  const inZone = host.zoneCardIds(move.fromId, 0x8).filter((cardId) => cardId > 0);
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
  if (!Number.isInteger(seatId) || seatId < 0 || seatId >= 0xff) return null;
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

  if (isJudgeRecoverySpell(spellId, host) && move.toZone === 0x8) noteShownJudgeCard(move.srcSeatId ?? move.fromId, cardIds);

  if (spellId === 0xda0 && move.fromZone === 0x5 && move.toZone === 0x5 && move.moveType === 0x15 && known === 1) {
    const shown = cardIds.find((cardId) => cardId > 0) ?? 0;
    if (shown) shown3488.set(move.fromId, shown);
  } else if (spellId === 0xda0 && move.fromZone === 0x5 && move.toZone === 0xa && move.moveType === 0xb && hidden) {
    cardIds[0] = shown3488.get(move.fromId) ?? 0;
    stack3488 = cardIds[0] ?? 0;
  } else if (
    spellId === 0xda0 && move.fromZone === 0xa && (move.toZone === 0x1 || move.toZone === 0x2)
    && move.moveType === 0xb && hidden
  ) {
    cardIds[0] = stack3488 || 0;
    stack3488 = 0;
  }

  const pending3511 = shownBySpell.get(0xdb7);
  if (spellId === 0xdb7 && move.fromZone === 0x2 && move.toZone === 0x5 && pending3511 && count === pending3511.length && hidden) {
    pending3511.forEach((cardId, index) => {
      cardIds[index] = cardId;
    });
    shownBySpell.delete(0xdb7);
  }

  if (spellId === 0xdd7 && move.fromZone === 0x2 && move.toZone === 0x1 && hidden) {
    const reds = host.zoneCardIds(DRAW_PILE_OWNER, 0x2)
      .filter((cardId) => host.isRedCard(cardId) === true)
      .reverse()
      .slice(0, count);
    cardIds.splice(0, Infinity, ...reds);
  }

  if (isJudgeRecoverySpell(spellId, host) && move.fromZone === 0x8 && move.toZone === 0x5) {
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

  if ([0x1b68, 0x1b69].includes(spellId) && move.toZone === 0x5 && count === 1 && move.srcSeatId === host.myId) {
    const pending = shownBySpell.get(spellId);
    if (cardIds[0] && pending?.includes(cardIds[0])) {
      pending.splice(pending.indexOf(cardIds[0]), 1);
    } else if (hidden && pending && (move.fromZone === 0x5 || pending.length === 2 || pending.length === 1)) {
      cardIds[0] = pending.shift() ?? 0;
    }
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
  if (position === TOP && cards.length >= count) return cards.slice(-count);
  if (position !== UNSPECIFIED && position !== TOP && position >= 0 && position + count <= cards.length) {
    return cards.slice(position, position + count);
  }
  const clearsZone = count === zoneLength || zoneLength === 1;
  const allianceHand = move.spellId === 121 && move.moveType === 11 && move.fromZone === 5 && move.toZone === 10;
  if ((clearsZone || allianceHand) && cards.length > 0 && cards.length <= count) {
    return [...cards, ...Array.from({ length: count - cards.length }, () => 0)];
  }
  return [...move.cardIds];
}

function fillClueIds(move: MoveJudgeInput, cardIds: number[], host: MoveJudgeHost): void {
  const known = cardIds.filter((cardId) => cardId > 0);
  const hidden = known.length === 0;
  const count = move.cardCount;
  if (xiashu && move.spellId === 0x169) {
    if (
      move.moveType === 0x15 && move.fromZone === 0x5 && move.toZone === 0x5
      && move.fromId === xiashu.targetSeatId && move.toId === xiashu.targetSeatId
      && known.length === count
    ) {
      xiashu.shown = known;
    } else if (
      move.moveType === 0x12 && move.fromZone === 0x5 && move.toZone === 0x5
      && move.fromId === xiashu.targetSeatId && move.toId === xiashu.casterSeatId
    ) {
      const state = xiashu;
      xiashu = null;
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
  if (move.spellId === 0xbf9 && move.moveType === 0xf && move.fromZone === 0x5 && move.toZone === 0x4 && move.toZoneParam === 0xbf9 && move.toId === move.fromId) {
    const pending = zhouxuanPending.get(move.fromId);
    zhouxuanPending.delete(move.fromId);
    if (hidden && pending && pending.length === count) cardIds.splice(0, Infinity, ...pending);
  }
  if (move.spellId === 0xc55 && move.fromZone === 0x2 && move.toZone === 0x5) {
    const pending = qingyiPending.get(move.toId);
    qingyiPending.delete(move.toId);
    if (hidden && pending && pending.length === count) cardIds.splice(0, Infinity, ...pending);
  }
  if ((move.spellId === 0xea6 || move.spellId === 0xea9) && move.fromZone === 0x2 && move.toZone === 0x1 && move.toPosition === TOP && move.moveType === 0xf && move.srcSeatId !== null) {
    const key = `${move.spellId}-${move.srcSeatId}`;
    const pending = qianfuPending.get(key);
    qianfuPending.delete(key);
    if (hidden && pending && pending.length === count) cardIds.splice(0, Infinity, ...pending);
  }
  if (move.spellId === 0x30c && move.fromZone === 0x5 && move.fromPosition === UNSPECIFIED && count === 1) {
    if (move.toZone === 0x5 && move.fromId === currentSeatId) {
      given780 = known[0] ?? null;
    } else if (move.toZone === 0x1 && move.fromId !== currentSeatId && given780 !== null && host.handCardIds(move.fromId).includes(given780)) {
      if (hidden) cardIds[0] = given780;
      given780 = null;
    }
  }
}


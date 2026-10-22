/**
 * 山河图战法次数。
 * 神龙摆尾按摸到的张数累加，三板斧按打出的杀累加。
 * 多多益善按摸牌次数累加，手到擒来按打出的牌累加，这两项在自己回合结束后清零。
 */

export const ZONE_DRAW = 1;
export const ZONE_HAND = 5;
/** 发牌类移牌。 */
export const MOVE_DEAL = 1;
/** 杀。 */
export const SHA_SPELL_ID = 1;

/** 三板斧，显示为次数除以 3 的余数。 */
export const SANBAN_PLOT_IDS = [0x7fa, 0x7fb, 0x7fc] as const;
/** 神龙摆尾，显示为次数除以 6 的余数。 */
export const DRAGON_MOD6_PLOT_ID = 0x85f;
/** 神龙摆尾，显示为次数除以 9 的余数。 */
export const DRAGON_MOD9_PLOT_ID = 0x838;
/**
 * 手到擒来一、二、三。分别在打出第 2、4、6 张时多摸，数字随即清掉。
 * 没到张数前显示已打出的张数。
 */
export const HANDY_TRIGGER_COUNTS: Readonly<Record<number, number>> = {
  0x81f: 2,
  0x820: 4,
  0x821: 6
};
/**
 * 多多益善一、二、三。分别在第 2、4、6 次摸牌时多摸，数字随即清掉。
 * 没到次数前显示已经摸过的次数。
 */
export const PLENTY_TRIGGER_COUNTS: Readonly<Record<number, number>> = {
  0x822: 2,
  0x823: 4,
  0x824: 6
};

export interface ZhanfaCounts {
  dragon: number;
  axe: number;
  handy: number;
  plenty: number;
  playing: boolean;
  /** 当前回合座位。用来判断自己的回合是否已经过去。 */
  turnSeat: number | null;
}

export function createZhanfaCounts(): ZhanfaCounts {
  return { dragon: 0, axe: 0, handy: 0, plenty: 0, playing: false, turnSeat: null };
}

/** 新的一局清零并开始计。已经在计的普通开局通知不再清。 */
export function noteZhanfaGameStarted(state: ZhanfaCounts, freshGame: boolean): void {
  if (freshGame || !state.playing) {
    state.dragon = 0;
    state.axe = 0;
    state.handy = 0;
    state.plenty = 0;
    state.turnSeat = null;
  }
  state.playing = true;
}

export function noteZhanfaGameEnded(state: ZhanfaCounts): void {
  state.dragon = 0;
  state.axe = 0;
  state.handy = 0;
  state.plenty = 0;
  state.turnSeat = null;
  state.playing = false;
}

/** 新座位开始回合时，若上一回合是自己，清掉手到擒来和多多益善。 */
export function noteTurnSeat(state: ZhanfaCounts, seatId: number, selfSeatId: number | null): boolean {
  const endedOwnTurn = state.turnSeat !== null
    && seatId !== state.turnSeat
    && selfSeatId !== null
    && state.turnSeat === selfSeatId;
  state.turnSeat = seatId;
  if (!endedOwnTurn) return false;
  state.handy = 0;
  state.plenty = 0;
  return true;
}

export function noteDragonDraw(
  state: ZhanfaCounts,
  move: {
    selfSeatId: number | null;
    toId: number;
    fromZone: number;
    toZone: number;
    moveType: number;
    cardCount: number;
  }
): boolean {
  if (!state.playing || move.selfSeatId === null || move.toId !== move.selfSeatId) return false;
  if (move.fromZone !== ZONE_DRAW || move.toZone !== ZONE_HAND || move.moveType !== MOVE_DEAL) return false;
  if (move.cardCount <= 0) return false;
  state.dragon += move.cardCount;
  state.plenty += 1;
  return true;
}

export function noteAxeSha(
  state: ZhanfaCounts,
  used: {
    selfSeatId: number | null;
    seatId: number;
    source: 'use-card' | 'use-spell';
    useType: number | null;
    spellId: number | null;
    isSend: boolean;
  }
): boolean {
  if (!state.playing || used.selfSeatId === null || used.seatId !== used.selfSeatId) return false;
  if (used.source !== 'use-card' || used.isSend || used.useType !== 1) return false;
  if (used.spellId === null || used.spellId <= 0) return false;
  state.handy += 1;
  if (used.spellId === SHA_SPELL_ID) state.axe += 1;
  return true;
}

/** 这条战法要显示的数字。不是这四项时返回 null。 */
export function zhanfaDisplayValue(plotId: number, state: ZhanfaCounts): number | null {
  if ((SANBAN_PLOT_IDS as readonly number[]).includes(plotId)) return state.axe % 3;
  if (plotId === DRAGON_MOD6_PLOT_ID) return state.dragon % 6;
  if (plotId === DRAGON_MOD9_PLOT_ID) return state.dragon % 9;
  const handyTrigger = HANDY_TRIGGER_COUNTS[plotId];
  if (handyTrigger) return state.handy > 0 && state.handy < handyTrigger ? state.handy : 0;
  const plentyTrigger = PLENTY_TRIGGER_COUNTS[plotId];
  if (plentyTrigger) return state.plenty > 0 && state.plenty < plentyTrigger ? state.plenty : 0;
  return null;
}

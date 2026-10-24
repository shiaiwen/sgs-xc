/**
 * 山河图战法次数，与参考脚本 BL.record / BL.enter 一致。
 * 神龙摆尾只累加发牌张数，三板斧累加打出的杀，多多益善按发牌次数加一，手到擒来累加出牌次数。
 * 后两项在回合开始阶段清零。
 */

export const ZONE_DRAW = 1;
export const ZONE_HAND = 5;
/** 发牌、摸牌进手。 */
export const MOVE_DEAL = 1;
export const MOVE_DRAW = 13;
/** 杀。 */
export const SHA_SPELL_ID = 1;

export const SANBAN_PLOT_IDS = [0x7fa, 0x7fb, 0x7fc] as const;
export const DRAGON_MOD6_PLOT_ID = 0x85f;
export const DRAGON_MOD9_PLOT_ID = 0x838;
export const HANDY_PLOT_IDS = [0x81f, 0x820, 0x821] as const;
export const PLENTY_PLOT_IDS = [0x822, 0x823, 0x824] as const;

export interface ZhanfaCounts {
  dragon: number;
  axe: number;
  handy: number;
  plenty: number;
  playing: boolean;
  /** 开局发牌阶段不计数，第一次阶段变化后才开始。 */
  dragonArmed: boolean;
}

export function createZhanfaCounts(): ZhanfaCounts {
  return { dragon: 0, axe: 0, handy: 0, plenty: 0, playing: false, dragonArmed: false };
}

export function noteZhanfaGameStarted(state: ZhanfaCounts, freshGame: boolean): void {
  if (freshGame || !state.playing) {
    state.dragon = 0;
    state.axe = 0;
    state.handy = 0;
    state.plenty = 0;
    state.dragonArmed = false;
  }
  state.playing = true;
}

/** 阶段协议到达后才允许累加神龙摆尾，开局发到手的牌不计入。 */
export function noteDragonCountingStarted(state: ZhanfaCounts): void {
  if (!state.playing) return;
  state.dragonArmed = true;
}

export function noteZhanfaGameEnded(state: ZhanfaCounts): void {
  state.dragon = 0;
  state.axe = 0;
  state.handy = 0;
  state.plenty = 0;
  state.playing = false;
  state.dragonArmed = false;
}

/** 回合开始阶段：自己行动时清手到擒来、多多益善计数。 */
export function notePhaseRoundStart(state: ZhanfaCounts, seatId: number, selfSeatId: number | null): boolean {
  if (!state.playing || selfSeatId === null || seatId !== selfSeatId) return false;
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
  if (!state.playing || !state.dragonArmed || move.selfSeatId === null || move.toId !== move.selfSeatId) return false;
  if (move.fromZone !== ZONE_DRAW || move.toZone !== ZONE_HAND) return false;
  if (move.moveType !== MOVE_DEAL) return false;
  if (move.cardCount <= 0) return false;
  state.dragon += move.cardCount;
  state.plenty += 1;
  return true;
}

/** use 为技能号；三板斧仅在 spellId 为杀时加一。 */
export function noteCardUsed(
  state: ZhanfaCounts,
  used: {
    selfSeatId: number | null;
    seatId: number;
    useType: number | null;
    spellId: number | null;
    isSend: boolean;
  }
): boolean {
  if (!state.playing || used.selfSeatId === null || used.seatId !== used.selfSeatId) return false;
  if (used.isSend || used.useType !== 1) return false;
  if (used.spellId === null || used.spellId <= 0) return false;
  state.handy += 1;
  if (used.spellId === SHA_SPELL_ID) state.axe += 1;
  return true;
}

export function zhanfaDisplayValue(plotId: number, state: ZhanfaCounts): number | null {
  if ((SANBAN_PLOT_IDS as readonly number[]).includes(plotId)) return state.axe % 3;
  if (plotId === DRAGON_MOD6_PLOT_ID) return state.dragon % 6;
  if (plotId === DRAGON_MOD9_PLOT_ID) return state.dragon % 9;
  if ((HANDY_PLOT_IDS as readonly number[]).includes(plotId)) return state.handy;
  if ((PLENTY_PLOT_IDS as readonly number[]).includes(plotId)) return state.plenty;
  return null;
}

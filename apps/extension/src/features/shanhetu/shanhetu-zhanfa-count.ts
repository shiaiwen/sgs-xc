/**
 * 山河图战法计数：与参考脚本 Bs.record / Bs.enter 对齐。
 * 神龙摆尾在 isGameStart 或 isPassed 为真时，只累计 moveType=1 的发牌张数。
 * 摸牌阶段摸牌不计入。手到擒来累计出牌次数；三板斧累计出杀次数；多多益善累计摸牌次数。
 * 手到擒来 / 多多益善在自己回合开始阶段清零。
 */

export const ZONE_DRAW = 1;
export const ZONE_HAND = 5;
/** 发牌进手；摸牌 moveType=13，按参考不计入神龙摆尾 */
export const MOVE_DEAL = 1;
export const MOVE_DRAW = 13;
/** 杀 */
export const SHA_SPELL_ID = 1;

/** 战法 PlotID 与界面 Value 的对应；新增或改档只改此表。 */
const ZHANFA_PLOT_DISPLAY_RULES: ReadonlyArray<{
  plotIds: readonly number[];
  value: (state: ZhanfaCounts) => number;
}> = [
  { plotIds: [0x7fa, 0x7fb, 0x7fc], value: (s) => s.axe % 3 },
  { plotIds: [0x85f], value: (s) => s.dragon % 6 },
  { plotIds: [0x838], value: (s) => s.dragon % 9 },
  { plotIds: [0x81f, 0x820, 0x821], value: (s) => s.handy },
  { plotIds: [0x822, 0x823, 0x824], value: (s) => s.plenty },
];

const zhanfaPlotDisplayById = new Map<number, (state: ZhanfaCounts) => number>();
for (const rule of ZHANFA_PLOT_DISPLAY_RULES) {
  for (const plotId of rule.plotIds) {
    zhanfaPlotDisplayById.set(plotId, rule.value);
  }
}

export interface ZhanfaCounts {
  dragon: number;
  axe: number;
  handy: number;
  plenty: number;
  playing: boolean;
  /** 参考 Bs.isGameStart：正式开局后为 true，发牌阶段前为 false。 */
  isGameStart: boolean;
  /** 参考 Bs.isPassed：局后洗牌等阶段为 true，仍允许 record mo。 */
  isPassed: boolean;
}

function clearZhanfaTallies(state: ZhanfaCounts): void {
  state.dragon = 0;
  state.axe = 0;
  state.handy = 0;
  state.plenty = 0;
}

export function createZhanfaCounts(): ZhanfaCounts {
  return {
    dragon: 0,
    axe: 0,
    handy: 0,
    plenty: 0,
    playing: false,
    isGameStart: false,
    isPassed: false
  };
}

/**
 * 开局 / 重新进盘：计数一律从 0。
 * freshGame（MsgGameStart）时先待命，等 phase0 再 start；座位恢复类开局视为已在局中。
 */
export function noteZhanfaGameStarted(state: ZhanfaCounts, freshGame: boolean): void {
  clearZhanfaTallies(state);
  state.playing = true;
  state.isPassed = false;
  state.isGameStart = !freshGame;
}

/** 参考 Bs.ready(CardList)：新牌堆就绪时清零并待命。 */
export function noteZhanfaReady(state: ZhanfaCounts): void {
  clearZhanfaTallies(state);
  state.playing = true;
  state.isGameStart = false;
  state.isPassed = false;
}

function hasZhanfaTallies(state: ZhanfaCounts): boolean {
  return state.dragon > 0 || state.axe > 0 || state.handy > 0 || state.plenty > 0;
}

/**
 * 新一盘 / 重新挑战未走 game-ended 时的兜底清零。
 * - TurnCnt 回落到 1（含仅打到第 1 回合就重开：1→1 且仍有计数）
 * - 或 TurnCnt 相对上一记变小（回合数回绕）
 * - 或局已结束 / 未在局中后又见到 TurnCnt=1
 * 返回是否清零并重新挂上。
 */
export function noteZhanfaNewDealTurn(state: ZhanfaCounts, turnCount: number, previousTurnCount: number): boolean {
  if (turnCount <= 0) return false;
  const turnWentBackwards = previousTurnCount > 0 && turnCount < previousTurnCount;
  const rematchAtTurnOne = turnCount === 1 && (
    previousTurnCount > 1
    || (previousTurnCount === 1 && hasZhanfaTallies(state))
  );
  const afterEnded = turnCount === 1 && (state.isPassed || !state.playing);
  if (!turnWentBackwards && !rematchAtTurnOne && !afterEnded) return false;
  noteZhanfaReady(state);
  noteZhanfaPlayStarted(state);
  return true;
}

/** 参考 Bs.start：进入可计数的对局阶段。 */
export function noteZhanfaPlayStarted(state: ZhanfaCounts): boolean {
  if (state.isGameStart) return false;
  if (!state.playing) {
    clearZhanfaTallies(state);
    state.playing = true;
  }
  state.isGameStart = true;
  state.isPassed = false;
  return true;
}

export function noteZhanfaGameEnded(state: ZhanfaCounts): void {
  clearZhanfaTallies(state);
  state.playing = false;
  state.isGameStart = false;
  state.isPassed = true;
}

/** 回合开始阶段（参考 enter phase 0）：自己行动时清手到擒来 / 多多益善。 */
export function notePhaseRoundStart(state: ZhanfaCounts, seatId: number, selfSeatId: number | null): boolean {
  if (!state.playing || selfSeatId === null || seatId !== selfSeatId) return false;
  state.handy = 0;
  state.plenty = 0;
  return true;
}

/** 阶段 0：兼作 start / 清零手到擒来与多多益善。 */
export function noteZhanfaPhase0(state: ZhanfaCounts, seatId: number, selfSeatId: number | null): boolean {
  let changed = noteZhanfaPlayStarted(state);
  if (notePhaseRoundStart(state, seatId, selfSeatId)) changed = true;
  return changed;
}

function canRecordDragonDraw(state: ZhanfaCounts): boolean {
  return state.playing && (state.isGameStart || state.isPassed);
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
  if (!canRecordDragonDraw(state) || move.selfSeatId === null || move.toId !== move.selfSeatId) return false;
  if (move.fromZone !== ZONE_DRAW || move.toZone !== ZONE_HAND) return false;
  if (move.moveType !== MOVE_DEAL) return false;
  if (move.cardCount <= 0) return false;
  state.dragon += move.cardCount;
  state.plenty += 1;
  return true;
}

/** 参考 record use：手到擒来每次出牌加一；三板斧在 spellId 为杀时加一。 */
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
  const compute = zhanfaPlotDisplayById.get(plotId);
  return compute === undefined ? null : compute(state);
}

/**
 * 技能临时区的多层网格。
 *
 * 处理区（3）、判定展示区（8）、技能临时区（10）里的牌可能分上下两层摆放，
 * 协议只会回报「把第 a 张挪到第 b 格、落在第 c 位」这样的三元组，
 * 所以这里用一张「牌 → 格子」的映射把层内顺序推回来：
 * - 上半层格子范围 `[0, topGridNum)`，下半层 `[topGridNum, topGridNum*2)`。
 * - 目标格被占用时两牌互换；跨层移动时同层后面的格子整体前移一格。
 * - 目标格落在牌数之外时算「外部置换格」，单独记账。
 *
 * 取回时按顶 / 底半区、按格子顺序挑牌；少一张时按外部置换格补偿。
 */

import {
  CardSlot,
  CardZone,
  DRAW_PILE_BOTTOM,
  DRAW_PILE_TOP,
  getSlotsByKey,
  packSlots,
  refreshZone
} from './card-graph.ts';

/** 这两个技能用的是「外部置换格」那套算法。 */
const EXTERNAL_SWAP_SPELL_IDS = [987, 988];
/** 牌堆底三张进临时区：取回时优先按未返还牌挑。 */
const DECK_BOTTOM_SPELL_ID = 3776;

export interface TempZoneGrid {
  key: string;
  seatId: number;
  spellId: number;
  tempZone: string;
  cards: CardSlot[];
  /** 逻辑顺序，取回时按它定位。 */
  logicalCards: CardSlot[];
  gridByCard: Map<CardSlot, number>;
  /** 上 / 下两层分界：上半层的格子数。 */
  topGridNum: number;
  traceSeen: boolean;
  traceClosed: boolean;
  externalTargetGrids: Set<number>;
  externalDisplacedCards: Set<CardSlot>;
  valid: boolean;
  downgraded: boolean;
  returnedCards: Set<CardSlot>;
}

const tempZoneGrids = new Map<string, TempZoneGrid>();
let tempZoneSerial = 0;

export function createTempZoneGrid(
  cards: readonly CardSlot[],
  extra: Partial<Pick<TempZoneGrid, 'key' | 'seatId' | 'spellId' | 'tempZone'>> = {}
): TempZoneGrid {
  const list = cards.filter(Boolean);
  return {
    key: extra.key ?? '',
    seatId: extra.seatId ?? -1,
    spellId: extra.spellId ?? 0,
    tempZone: extra.tempZone ?? '',
    cards: list,
    logicalCards: list.slice(),
    gridByCard: new Map(list.map((card, index) => [card, index])),
    topGridNum: list.length,
    traceSeen: false,
    traceClosed: false,
    externalTargetGrids: new Set(),
    externalDisplacedCards: new Set(),
    valid: list.length > 1,
    downgraded: false,
    returnedCards: new Set()
  };
}

export function isExternalSwapSpell(state: Pick<TempZoneGrid, 'spellId'>): boolean {
  return EXTERNAL_SWAP_SPELL_IDS.includes(Number(state?.spellId));
}

/** 临时区只追踪处理区与技能临时区。 */
export function isTrackedTempZone(zone: number): boolean {
  return zone === 8 || zone === 10;
}

function cardAtGrid(state: TempZoneGrid, grid: number): CardSlot | null {
  for (const [card, position] of state.gridByCard) {
    if (position === grid) return card;
  }
  return null;
}

/** 987 / 988 专用：把牌在同一格与一个外部置换格之间对调。 */
function advanceExternalSwapTrace(state: TempZoneGrid, sourceIndex: number, targetGrid: number): boolean {
  const half = state.topGridNum;
  const isExternal = sourceIndex >= state.logicalCards.length;
  let fromGrid = -1;
  let toGrid = -1;
  let card: CardSlot | null = null;
  if (isExternal && targetGrid < half) {
    fromGrid = targetGrid;
    toGrid = sourceIndex;
    card = cardAtGrid(state, fromGrid);
    if (!card && state.externalTargetGrids.has(fromGrid) && state.externalDisplacedCards.size === 1) {
      card = [...state.externalDisplacedCards][0];
    }
  } else if (!isExternal) {
    const candidate = state.logicalCards[sourceIndex];
    const candidateGrid = state.gridByCard.get(candidate);
    if (Number.isInteger(candidateGrid) && (candidateGrid as number) < half && targetGrid >= half) {
      fromGrid = candidateGrid as number;
      toGrid = targetGrid;
      card = candidate;
    }
  }
  if (fromGrid >= 0 && card) {
    state.externalDisplacedCards.forEach((displaced) => {
      if (displaced !== card && state.cards.includes(displaced)) {
        state.gridByCard.set(displaced, state.cards.indexOf(displaced));
      }
    });
    state.externalTargetGrids.clear();
    state.externalDisplacedCards.clear();
    state.externalTargetGrids.add(fromGrid);
    state.externalDisplacedCards.add(card);
    state.gridByCard.set(card, toGrid);
  }
  state.traceSeen = true;
  return true;
}

/**
 * 推进一次「操作回报」。单元素回报表示追踪结束。
 * 三元组不合法时把这个 state 标成不可信，之后不再用于取回。
 */
export function advanceGridTrace(state: TempZoneGrid | null | undefined, data: unknown): boolean {
  if (!state?.valid || !Array.isArray(data)) return false;
  if (data.length === 1) {
    state.traceClosed = true;
    return true;
  }
  if (data.length !== 3) {
    state.valid = false;
    return false;
  }
  const [sourceIndex, targetGrid, finalIndex] = (data as unknown[]).map(Number);
  const half = state.topGridNum * 2;
  if (![sourceIndex, targetGrid, finalIndex].every(Number.isInteger)
    || sourceIndex < 0 || sourceIndex >= half || targetGrid < 0 || targetGrid >= half
    || finalIndex < 0) {
    state.valid = false;
    return false;
  }
  if (isExternalSwapSpell(state)) return advanceExternalSwapTrace(state, sourceIndex, targetGrid);
  if (sourceIndex >= state.logicalCards.length) {
    state.externalTargetGrids.add(targetGrid);
    for (const [card, grid] of state.gridByCard) {
      if (grid === targetGrid) {
        state.externalDisplacedCards.add(card);
        state.gridByCard.set(card, sourceIndex);
        break;
      }
    }
    state.traceSeen = true;
    return true;
  }
  const card = state.logicalCards[sourceIndex];
  const fromGrid = state.gridByCard.get(card);
  if (!Number.isInteger(fromGrid)) {
    state.valid = false;
    return false;
  }
  const occupied = cardAtGrid(state, targetGrid);
  if (occupied) {
    state.gridByCard.set(occupied, fromGrid as number);
  } else {
    const fromTop = (fromGrid as number) < state.topGridNum;
    const targetTop = targetGrid < state.topGridNum;
    if (fromTop !== targetTop) {
      for (const [other, grid] of state.gridByCard) {
        if (other !== card && (grid < state.topGridNum) === fromTop && grid > (fromGrid as number)) {
          state.gridByCard.set(other, grid - 1);
        }
      }
    }
  }
  state.gridByCard.set(card, targetGrid);
  const slot = ((finalIndex % state.topGridNum) + state.topGridNum) % state.topGridNum;
  state.logicalCards.splice(sourceIndex, 1);
  state.logicalCards.splice(slot, 0, card);
  state.traceSeen = true;
  return true;
}

/**
 * 按顶 / 底半区取回若干张。
 * 候选只差一张时，用落在网格外的那张按缺少的格子补上。
 */
export function takeGridCards(
  state: TempZoneGrid | null | undefined,
  position: number,
  count: number,
  sourceCards: readonly CardSlot[] | null = null
): CardSlot[] | null {
  if (!state?.valid || !(state.traceSeen || state.traceClosed) || !(count > 0)) return null;
  const isTop = position === DRAW_PILE_TOP;
  const isBottom = position === DRAW_PILE_BOTTOM;
  if (!isTop && !isBottom) return null;
  const filter = Array.isArray(sourceCards) ? new Set(sourceCards) : null;
  const low = isTop ? 0 : state.topGridNum;
  const high = isTop ? state.topGridNum : state.topGridNum * 2;
  const gridOf = (card: CardSlot) => state.gridByCard.get(card) as number;
  const candidates = state.cards.filter((card) => {
    if (state.returnedCards.has(card)) return false;
    if (filter && !filter.has(card)) return false;
    const grid = state.gridByCard.get(card);
    return Number.isInteger(grid) && (isTop ? (grid as number) < state.topGridNum : (grid as number) >= state.topGridNum);
  }).sort((left, right) => gridOf(left) - gridOf(right));
  if (candidates.length >= count) return candidates.slice(0, count);
  if (!filter || !sourceCards || candidates.length !== count - 1) return null;
  const heldBack = sourceCards.filter((card) => (
    state.cards.includes(card) && !state.returnedCards.has(card) && !candidates.includes(card)
  ));
  if (sourceCards.length !== count && !(sourceCards.length === count + 1 && heldBack.length === 1)) return null;
  const outside = sourceCards.filter((card) => !state.cards.includes(card));
  if (outside.length !== 1) return null;
  const usedGrids = new Set(candidates.map(gridOf));
  const freeGrids: number[] = [];
  for (let grid = low; grid < high; grid += 1) if (!usedGrids.has(grid)) freeGrids.push(grid);
  if (freeGrids.length !== 1) return null;
  const freeGrid = freeGrids[0];
  if (state.externalTargetGrids.size > 0 && !state.externalTargetGrids.has(freeGrid)) return null;
  const effectiveGrid = (card: CardSlot) => (card === outside[0] ? freeGrid : gridOf(card));
  return candidates.concat(outside).sort((left, right) => effectiveGrid(left) - effectiveGrid(right));
}

/** 注册一次临时区追踪；同一座位 + 技能 + 目标区只保留最新的一个。 */
export function registerTempZoneGrid(input: {
  seatId: number;
  spellId: number;
  tempZone: string;
  cards: readonly CardSlot[];
}): TempZoneGrid {
  const seatId = Number(input.seatId);
  const spellId = Number(input.spellId);
  for (const [key, state] of tempZoneGrids) {
    if (state.seatId === seatId && state.spellId === spellId && state.tempZone === input.tempZone) {
      tempZoneGrids.delete(key);
    }
  }
  tempZoneSerial += 1;
  const key = `${seatId}:${spellId}:${input.tempZone}:${tempZoneSerial}`;
  const state = createTempZoneGrid(input.cards, {
    key, seatId, spellId, tempZone: input.tempZone
  });
  tempZoneGrids.set(key, state);
  return state;
}

/** 找最近注册、且与来源区还有未返还交集的追踪。 */
export function findTempZoneGrid(
  seatId: number,
  spellId: number,
  sourceZone: CardZone | null = null
): TempZoneGrid | null {
  const seat = Number(seatId);
  const spell = Number(spellId);
  return [...tempZoneGrids.values()].reverse().find((state) => {
    if (state.seatId !== seat || state.spellId !== spell) return false;
    if (sourceZone && state.tempZone !== sourceZone.zone) return false;
    return !sourceZone || state.cards.some((card) => (
      !state.returnedCards.has(card) && sourceZone.cards.includes(card)
    ));
  }) ?? null;
}

/** 操作回报入口：按座位 + 技能找追踪并推进。 */
export function advanceSeatGridTrace(seatId: number, spellId: number, data: unknown): TempZoneGrid | null {
  const state = findTempZoneGrid(seatId, spellId);
  if (state) advanceGridTrace(state, data);
  return state;
}

/** 该座位只有一个还没返完的追踪时，用它的回报推进。 */
export function advanceUniqueSeatGridTrace(seatId: number, data: unknown): TempZoneGrid | null {
  const seat = Number(seatId);
  const open = [...tempZoneGrids.values()].filter((state) => (
    state.seatId === seat && state.returnedCards.size < state.cards.length
  ));
  if (open.length !== 1) return null;
  advanceGridTrace(open[0], data);
  return open[0];
}

/** 追踪拿不到顺序时把未返还的牌打包，之后不再按格子取回。 */
export function downgradeTempZoneGrid(state: TempZoneGrid | null, sourceZone: CardZone): void {
  if (!state || state.downgraded) return;
  const unreturned = state.cards.filter((card) => (
    !state.returnedCards.has(card) && sourceZone.cards.includes(card)
  ));
  packSlots(unreturned);
  state.downgraded = true;
}

/** 从区域里摘掉这些牌。任一牌不在区域里就整体放弃。 */
export function removeZoneCards(zone: CardZone | null, cards: readonly CardSlot[] | null): CardSlot[] | null {
  if (!zone || !Array.isArray(cards) || !cards.length) return null;
  if (cards.some((card) => !zone.cards.includes(card))) return null;
  cards.forEach((card) => zone.cards.splice(zone.cards.indexOf(card), 1));
  refreshZone(zone.zoneID);
  return [...cards];
}

/** 调整区域的取牌方向；牌堆区要翻一下。 */
export function retargetZonePosition(zone: CardZone | null, position: number): CardZone | null {
  if (!zone) return null;
  zone.pos = Number(zone.zone) === 1
    ? (position === DRAW_PILE_TOP ? DRAW_PILE_BOTTOM : position === DRAW_PILE_BOTTOM ? DRAW_PILE_TOP : position)
    : position;
  return zone;
}

/** 按 key 把临时区里的牌与目标区里同 key 的牌两两对调位置。 */
export function swapZoneCardsByKey(
  zone: CardZone | null,
  cards: readonly CardSlot[] | null,
  cardIds: readonly number[] | null
): boolean {
  if (!zone || !Array.isArray(cards) || !Array.isArray(cardIds)) return false;
  if (cards.length !== cardIds.length || cardIds.some((cardId) => !(Number(cardId) > 0))) return false;
  const pairs = cards.map((card, index) => {
    const key = Number(cardIds[index]);
    const partner = zone.cards.find((entry) => !cards.includes(entry) && entry?.key === key);
    return card?.key > 0 && partner && zone.cards.includes(card) ? [card, partner] as const : null;
  });
  if (pairs.some((pair) => !pair) || new Set(pairs.flat()).size !== pairs.length * 2) return false;
  pairs.forEach(([card, partner]) => {
    const left = zone.cards.indexOf(card as CardSlot);
    const right = zone.cards.indexOf(partner as CardSlot);
    zone.cards[left] = partner as CardSlot;
    zone.cards[right] = card as CardSlot;
  });
  refreshZone(zone.zoneID);
  return true;
}

export interface PendingDeckReturn {
  sourceZoneID: string;
  targetZone: CardZone;
  returnCount: number;
}

/** 3483：手牌先暂存，牌堆回手时按原张数把手牌还回去。 */
export function planPendingDeckReturn(
  zone: CardZone | null,
  targetZone: CardZone,
  count: number,
  handCards: readonly CardSlot[]
): PendingDeckReturn | null {
  const returnCount = Number(count);
  if (!zone || !(returnCount > 0) || !Array.isArray(handCards) || !handCards.length) return null;
  if (!handCards.some((card) => card?.key > 0)) return null;
  if (handCards.some((card) => !zone.cards.includes(card))) return null;
  if (zone.length !== returnCount + handCards.length) return null;
  return { sourceZoneID: zone.zoneID, targetZone, returnCount };
}

export function applyPendingDeckReturn(
  plan: PendingDeckReturn | null,
  zone: CardZone | null
): CardSlot[] | null {
  if (!plan || !zone || plan.sourceZoneID !== zone.zoneID || zone.length !== plan.returnCount) return null;
  const taken = removeZoneCards(zone, zone.cards.slice());
  if (taken) plan.targetZone.add(taken);
  return taken;
}

/** 从来源区按顶 / 底取回若干张。 */
export function takeGridCardsByPosition(
  state: TempZoneGrid | null,
  sourceZone: CardZone | null,
  position: number,
  count: number
): CardSlot[] | null {
  const picked = takeGridCards(state, position, count, sourceZone?.cards ?? null);
  if (!picked || !sourceZone || picked.some((card) => !sourceZone.cards.includes(card))) return null;
  return removeZoneCards(sourceZone, position === DRAW_PILE_TOP ? picked.slice().reverse() : picked);
}

/** 3776 这类技能：优先按未返还牌或外部置换格整批取回，否则退回归位取回。 */
export function takeGridCardsForSpell(
  state: TempZoneGrid | null,
  sourceZone: CardZone | null,
  count: number
): CardSlot[] | null {
  if (!state || !sourceZone || !(count > 0)) return null;
  if (Number(state.spellId) === DECK_BOTTOM_SPELL_ID) {
    const unreturned = state.cards.filter((card) => (
      !state.returnedCards.has(card) && sourceZone.cards.includes(card)
    ));
    if (unreturned.length === count) return removeZoneCards(sourceZone, unreturned);
  }
  const displaced = [...state.externalDisplacedCards].filter((card) => (
    !state.returnedCards.has(card) && sourceZone.cards.includes(card)
  ));
  if (displaced.length === count) return removeZoneCards(sourceZone, displaced);
  return takeGridCardsByPosition(state, sourceZone, DRAW_PILE_BOTTOM, count);
}

/** 取回的牌认不出来时，用同牌号的其它槽位换一下再认。 */
export function correctIdentifiedCards(found: CardSlot[] | null, cardIds: readonly number[] | null): CardSlot[] | null {
  if (!Array.isArray(found) || !Array.isArray(cardIds) || found.length !== cardIds.length) return found;
  if (cardIds.some((cardId) => !(Number(cardId) > 0))) return found;
  found.forEach((card, index) => {
    const cardId = Number(cardIds[index]);
    if (!card?.identify?.(cardId)) {
      const partner = getSlotsByKey(cardId).find((entry) => entry !== card);
      if (partner) card?.swap?.(partner)?.identify?.(cardId);
    }
  });
  return found;
}

/** 标注已返还；返完或来源区已经不相交时注销追踪。 */
export function markGridCardsReturned(
  state: TempZoneGrid | null,
  moved: readonly CardSlot[] | null,
  sourceZone: CardZone | null = null
): void {
  if (!state) return;
  (moved || []).forEach((card) => {
    if (state.cards.includes(card)) state.returnedCards.add(card);
  });
  const stillIntersects = Array.isArray(sourceZone?.cards)
    && state.cards.some((card) => (sourceZone as CardZone).cards.includes(card));
  if (state.returnedCards.size >= state.cards.length || (sourceZone && !stillIntersects)) {
    tempZoneGrids.delete(state.key);
  }
}

export function clearTempZoneGrids(): void {
  tempZoneGrids.clear();
}

export function getTempZoneGrids(): TempZoneGrid[] {
  return [...tempZoneGrids.values()];
}

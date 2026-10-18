/**
 * 明牌查询：按引擎归属把候选牌分为手牌/牌堆，供宴戏等面板求交。
 */

import { CardZone, packSlots } from './graph/card-graph.ts';
import { formatZoneId, type MingpaiEngine } from './mingpai-engine.ts';
import { MINGPAI_ZONE } from './mingpai-zones.ts';

const HAND_ZONE = 5;
const DRAW_PILE_ZONE = 1;
const GLOBAL_OWNER = 0xff;

/**
 * 用明牌引擎按卡号查找归属，把候选牌分成「手牌」与「牌堆」两组（宴戏面板求交用）。
 * `deckTopCount` 给数字时，只有落在牌堆顶部这么多张之内的候选才算「牌堆侧」
 * （旧版宴戏只看牌堆顶前两张，国战看整副牌堆）；未知槽位不参与判定。
 */
export function partitionCandidatesByMingpai(
  engine: MingpaiEngine,
  candidateIds: readonly number[],
  options: { deckTopCount?: number | null } = {}
): {
  handCardIds: number[];
  deckCardIds: number[];
} {
  const handZonePrefix = `${HAND_ZONE}-`;
  const deckZoneId = formatZoneId(GLOBAL_OWNER, DRAW_PILE_ZONE);
  const deckTopKeys = typeof options.deckTopCount === 'number'
    ? new Set(engine.getSnapshot().drawPile.top.slice(0, Math.max(0, options.deckTopCount)).filter(Boolean))
    : null;
  const handCardIds: number[] = [];
  const deckCardIds: number[] = [];

  for (const cardId of uniquePositive(candidateIds)) {
    const { keys, zones } = engine.findKZ(cardId);
    const inHand = zones.some((zone) => zone.startsWith(handZonePrefix));
    const inDeck = deckTopKeys
      ? keys.some((key) => deckTopKeys.has(key))
      : zones.includes(deckZoneId) || zones.some((zone) => zone.startsWith(`${DRAW_PILE_ZONE}-`));
    if (inHand) handCardIds.push(cardId);
    if (inDeck) deckCardIds.push(cardId);
  }

  // 原版归约
  let hand = handCardIds;
  let deck = deckCardIds;
  const candidates = uniquePositive(candidateIds);
  if (deck.length === 2) {
    hand = candidates.filter((id) => !deck.includes(id));
  } else if (hand.length === 1) {
    deck = candidates.filter((id) => !hand.includes(id));
  }
  const pile = engine.getSnapshot().drawPile;
  const order = new Map<number, number>();
  pile.top.forEach((cardId, index) => {
    if (cardId > 0) order.set(cardId, index);
  });
  pile.bottom.forEach((cardId, index) => {
    if (cardId > 0 && !order.has(cardId)) order.set(cardId, pile.top.length + index);
  });
  deck.sort((left, right) => (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER));
  return { handCardIds: hand, deckCardIds: deck };
}

/**
 * 宴戏亮牌时把候选按手牌、牌堆顶的相对顺序捆在一起。
 * 不从区域里摘走，页面上的牌还在原处，之后摸牌会按这个顺序认。
 */
export function anchorYanxiCandidates(
  seatId: number,
  candidateIds: readonly number[],
  handIds: readonly number[]
): void {
  if (handIds.length !== 1 && handIds.length !== 2 && handIds.length !== 3) return;
  const ordered = handIds.length < 3
    ? [...handIds, ...candidateIds.filter((cardId) => !handIds.includes(cardId))]
    : [...candidateIds];
  const handZoneId = `${HAND_ZONE}-${seatId}`;
  const pileZoneId = formatZoneId(GLOBAL_OWNER, DRAW_PILE_ZONE);
  const handSlots = ordered.slice(0, handIds.length)
    .map((cardId) => findZoneSlot(handZoneId, cardId))
    .filter((slot): slot is NonNullable<typeof slot> => Boolean(slot));
  const pileSlots = ordered.slice(-2)
    .map((cardId) => findZoneSlot(pileZoneId, cardId))
    .filter((slot): slot is NonNullable<typeof slot> => Boolean(slot));
  const linked = [...handSlots, ...pileSlots];
  if (handIds.length === 3) packSlots(linked);
  else if (handIds.length === 1) packSlots(linked.slice(1, 3));
  else {
    packSlots(linked.slice(0, 2));
    packSlots(linked.slice(1, 3));
  }
}

function findZoneSlot(zoneId: string, cardId: number) {
  return new CardZone(zoneId).cards.find((slot) => slot.key === cardId || slot.id === cardId) ?? null;
}

/** 兼容旧签名：显式传入已知面 ID 集合。 */
export function partitionCandidatesByKnownFaces(input: {
  candidateIds: readonly number[];
  handCardIds: readonly number[];
  deckCardIds: readonly number[];
}): {
  handCardIds: number[];
  deckCardIds: number[];
} {
  const candidates = uniquePositive(input.candidateIds);
  const handSet = new Set(uniquePositive(input.handCardIds));
  const deckSet = new Set(uniquePositive(input.deckCardIds));
  let handCardIds = candidates.filter((cardId) => handSet.has(cardId));
  let deckCardIds = candidates.filter((cardId) => deckSet.has(cardId));
  if (deckCardIds.length === 2) {
    handCardIds = candidates.filter((cardId) => !deckCardIds.includes(cardId));
  } else if (handCardIds.length === 1) {
    deckCardIds = candidates.filter((cardId) => !handCardIds.includes(cardId));
  }
  return { handCardIds, deckCardIds };
}

/** 收集手牌和牌堆里已经知道牌面的牌。 */
export function collectHandAndDeckFaces(engine: MingpaiEngine): {
  handCardIds: number[];
  deckCardIds: number[];
} {
  const snapshot = engine.getSnapshot();
  const handCardIds: number[] = [];
  const deckCardIds: number[] = [];
  for (const [zoneId, cardIds] of Object.entries(snapshot.zones)) {
    if (zoneId.startsWith(`${HAND_ZONE}-`)) handCardIds.push(...cardIds);
    if (zoneId.startsWith(`${DRAW_PILE_ZONE}-`) || zoneId === formatZoneId(GLOBAL_OWNER, DRAW_PILE_ZONE)) {
      deckCardIds.push(...cardIds);
    }
  }
  // 也并入引擎便捷 API
  deckCardIds.push(...engine.getDrawPileCardIds());
  return {
    handCardIds: uniquePositive(handCardIds),
    deckCardIds: uniquePositive(deckCardIds)
  };
}

function uniquePositive(cardIds: readonly number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const raw of cardIds) {
    const cardId = Number(raw);
    if (!Number.isInteger(cardId) || cardId <= 0 || seen.has(cardId)) continue;
    seen.add(cardId);
    result.push(cardId);
  }
  return result;
}

export { MINGPAI_ZONE };

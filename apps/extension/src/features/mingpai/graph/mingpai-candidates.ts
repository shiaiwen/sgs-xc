/**
 * 明牌候选推导：把「一组看不清的牌」展开成可能的具体牌号。
 *
 * 槽位 key 为负奇数时是一组内容可枚举的牌（明组），负偶数或 0 是看不见内容的组。
 * 展开规则：
 * - key > 0：就是这张牌。
 * - key 为 0、负偶数、或已经洗回牌堆的组：只可能是一张未知牌，用 0 占位。
 * - 负奇数：顺着组里每个槽位的 next 继续展开。
 *
 * 「这一组还有没有未知候选」按同样规则递归判断：组里只要有一个槽位没有 next，
 * 或者它往下能碰到未知，就算还有未知。
 */

import {
  CardSlot,
  CardZone,
  getMingpaiGroupIndex,
  getSlotsByKey,
  getZoneIds,
  hasReshufflePoolKey,
  parseZoneId,
  registerMingpaiGroups
} from './card-graph.ts';

/** 组标签池：天干排完就用「组N」。 */
const GROUP_LABELS = Array.from('甲乙丙丁戊己庚辛壬癸');
/** 明牌组可能出现在手牌区与技能标记区。 */
const GROUP_ZONE_IDS = new Set([4, 5]);

export interface UncertainGroup {
  /** 组号（负奇数）。 */
  key: number;
  /** 展示用标签。 */
  label: string;
  /** 这一组在这批牌里出现的次数。 */
  count: number;
  /** 这一组可能包含的具体牌号。 */
  candidateCardIds: number[];
  /** 候选里还有看不见内容的牌。 */
  hasUnknownCandidate: boolean;
}

/** 这一组往下还能不能碰到看不见内容的牌。 */
export function groupHasUnknownCandidate(
  key: number,
  cache: Map<number, boolean> = new Map(),
  visiting: Set<number> = new Set()
): boolean {
  if (key > 0) return false;
  if (key === 0 || (key < 0 && key % 2 === 0)) return true;
  if (hasReshufflePoolKey(key)) return true;
  if (!Number.isFinite(key) || visiting.has(key)) return true;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const slots = getSlotsByKey(key);
  if (!slots.length) return true;
  visiting.add(key);
  const result = slots.some((slot) => !slot.next || groupHasUnknownCandidate(slot.next.key, cache, visiting));
  visiting.delete(key);
  cache.set(key, result);
  return result;
}

/** 把一组槽位展开成可能的具体牌号；看不清的部分用 0 占位。 */
export function expandGroupCandidates(
  key: number,
  found: Set<number> = new Set(),
  visiting: Set<number> = new Set()
): Set<number> {
  if (key > 0) {
    found.add(key);
    return found;
  }
  if (!Number.isFinite(key) || visiting.has(key)) return found;
  if (key === 0 || key % 2 === 0 || hasReshufflePoolKey(key)) {
    found.add(0);
    return found;
  }
  visiting.add(key);
  getSlotsByKey(key).forEach((slot) => {
    if (slot.next) expandGroupCandidates(slot.next.key, found, visiting);
  });
  visiting.delete(key);
  return found;
}

/** 手牌区与技能标记区里所有「内容可枚举」的组号，降序。 */
export function collectOpenGroupKeys(): number[] {
  const keys: number[] = [];
  for (const zoneId of getZoneIds()) {
    const zone = parseZoneId(zoneId)?.zone;
    if (zone === undefined || !GROUP_ZONE_IDS.has(zone)) continue;
    for (const slot of new CardZone(zoneId).cards) {
      const key = Number(slot?.key);
      if (key < 0 && key % 2 !== 0 && !hasReshufflePoolKey(key)) keys.push(key);
    }
  }
  return [...new Set(keys)].sort((left, right) => right - left);
}

/** 组标签：先登记本轮出现过的所有明组，再按登记顺序取天干。 */
export function getGroupLabel(key: number): string {
  registerMingpaiGroups(collectOpenGroupKeys());
  const index = getMingpaiGroupIndex(Number(key));
  const resolved = Number.isInteger(index) && (index as number) >= 0
    ? index as number
    : Math.max(0, Math.floor((Math.abs(Number(key)) - 3) / 2));
  return GROUP_LABELS[resolved] ?? `组${resolved + 1}`;
}

/** 这批槽位里所有不确定组。候选全都不具体的组不报。 */
export function getUncertainGroups(cards: readonly CardSlot[]): UncertainGroup[] {
  const counts = new Map<number, number>();
  for (const slot of cards) {
    const key = Number(slot?.key);
    if (!(key < 0) || key % 2 === 0) continue;
    if (hasReshufflePoolKey(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const candidates = [...expandGroupCandidates(key)].map(Number);
      const candidateCardIds = candidates.filter((cardId) => Number.isFinite(cardId) && cardId > 0);
      return {
        key,
        label: getGroupLabel(key),
        count,
        candidateCardIds,
        hasUnknownCandidate: candidates.some((cardId) => !(cardId > 0)) || groupHasUnknownCandidate(key)
      };
    })
    .filter((group) => group.candidateCardIds.length > 0)
    .sort((left, right) => right.key - left.key);
}

/** 某个座位手牌区里的不确定组。 */
export function getSeatUncertainGroups(seatId: number): UncertainGroup[] {
  return getUncertainGroups(new CardZone(seatId, 5).cards);
}

/** 某个座位手牌区的可能牌集合（由不确定组展开而来）。 */
export function getSeatPossibleCardIds(seatId: number): number[] {
  const ids = new Set<number>();
  for (const group of getSeatUncertainGroups(seatId)) {
    group.candidateCardIds.forEach((cardId) => ids.add(cardId));
  }
  return [...ids];
}

/** 某个座位手牌区里能确定牌面的牌号（手牌区 key>0 的槽位）。 */
export function getSeatKnownCardIds(seatId: number): number[] {
  return CardZone.shoupai(seatId);
}

export interface Zone4Row {
  zoneId: string;
  spellId: number;
  knownCardIds: number[];
  possibleCardIds: number[];
  uncertainGroups: UncertainGroup[];
}

/** 技能标记区的区域键：`4-座位-技能号`，没有技能号时只有座位。 */
export function parseZone4Key(zoneId: string): { seatId: number; spellId: number } | null {
  const match = /^4-(\d+)(?:-(-?\d+))?$/.exec(zoneId);
  if (!match) return null;
  return { seatId: Number(match[1]), spellId: match[2] === undefined ? 0 : Number(match[2]) };
}

/**
 * 某个座位的技能标记行。
 * 每行给出手牌区之外那批标记牌里能确定的牌、由明组展开出的可能牌，以及这些组。
 */
export function getZone4Rows(seatId: number): Zone4Row[] {
  const seat = Number(seatId);
  const rows: Zone4Row[] = [];
  for (const zoneId of getZoneIds()) {
    const info = parseZone4Key(zoneId);
    if (!info || info.seatId !== seat) continue;
    const cards = new CardZone(zoneId).cards;
    const knownCardIds = [...new Set(cards
      .filter((slot) => Number(slot?.key) > 0)
      .map((slot) => Number(slot.id))
      .filter((cardId) => Number.isFinite(cardId) && cardId > 0))];
    const uncertainGroups = getUncertainGroups(cards);
    const possibleCardIds = [...new Set(uncertainGroups.flatMap((group) => group.candidateCardIds))]
      .filter((cardId) => !knownCardIds.includes(cardId));
    if (!knownCardIds.length && !possibleCardIds.length) continue;
    rows.push({ zoneId, spellId: info.spellId, knownCardIds, possibleCardIds, uncertainGroups });
  }
  return rows.sort((left, right) => left.spellId - right.spellId
    || left.zoneId.localeCompare(right.zoneId));
}

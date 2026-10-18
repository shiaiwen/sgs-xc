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
  UNKNOWN_ZONE,
  getSlotsByKey,
  getZoneIds,
  hasReshufflePoolKey,
  parseZoneId
} from './card-graph.ts';

const GROUP_STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];

export interface UncertainGroup {
  /** 组号（负奇数）。 */
  key: number;
  /** 按手牌区和技能标记区里明组的出现顺序分配，甲乙丙丁，超出用组N。 */
  label: string;
  /** 这一组在这批牌里出现的次数。 */
  count: number;
  /** 这一组可能包含的具体牌号。 */
  candidateCardIds: number[];
  /** 候选里还有看不见内容的牌。 */
  hasUnknownCandidate: boolean;
}

/** 手牌区和技能标记区里还看得见的明组，组号从大到小。 */
function visibleGroupKeys(): number[] {
  const keys = new Set<number>();
  for (const zoneId of getZoneIds()) {
    const parsed = parseZoneId(zoneId);
    if (parsed?.zone !== 5 && !zoneId.startsWith('4-')) continue;
    for (const slot of new CardZone(zoneId).cards) {
      const key = Number(slot?.key);
      if (!(key < 0) || key % 2 === 0 || hasReshufflePoolKey(key)) continue;
      keys.add(key);
    }
  }
  return [...keys].sort((left, right) => right - left);
}

function groupLabel(key: number, order: readonly number[]): string {
  const index = order.indexOf(key);
  const stemIndex = index >= 0
    ? index
    : Math.max(0, Math.floor((Math.abs(key) - 3) / 2));
  return GROUP_STEMS[stemIndex] ?? `组${stemIndex + 1}`;
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

/**
 * 已经落在具体牌号上的牌：某个区里有 key 等于自己牌号的槽位。
 * 这样的牌已经是确定牌，不该再算进任何一组的候选。
 * 判定展示区、处理区、技能临时区同样要算：那里的牌本来就是明着的
 * （椒遇、3571 把判定牌按颜色收进手牌时，牌会先在展示区里确定）。
 * unknown 区不算，那里挂的是组的链尾，不代表牌的位置。
 */
function placedCardIds(): Set<number> {
  const placed = new Set<number>();
  for (const zoneId of getZoneIds()) {
    if (zoneId === UNKNOWN_ZONE) continue;
    for (const slot of new CardZone(zoneId).cards) {
      const key = Number(slot?.key);
      if (key > 0) placed.add(key);
    }
  }
  return placed;
}

/** 某座位手牌区里已经确定牌面的牌号。 */
function knownHandIds(seatId: number): Set<number> {
  return new Set(CardZone.shoupai(seatId));
}

/** 牌面本来就公开的区域：判定展示区、处理区、技能临时区。 */
const REVEALED_CARD_ZONES = new Set([3, 8, 10]);

/**
 * 这批槽位里所有不确定组。候选全都不具体的组不报。
 * `excludeCardIds` 用于把「牌的本身已经确定在手上」的牌号从候选里去掉：
 * 手牌区里剩下的那个组还挂着这张牌，但它已经被认定为确定牌，不能再报成可能牌。
 */
export function getUncertainGroups(
  cards: readonly CardSlot[],
  excludeCardIds: ReadonlySet<number> = new Set<number>()
): UncertainGroup[] {
  const counts = new Map<number, number>();
  for (const slot of cards) {
    const key = Number(slot?.key);
    if (!(key < 0) || key % 2 === 0) continue;
    if (hasReshufflePoolKey(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const placed = placedCardIds();
  const order = visibleGroupKeys();
  return [...counts.entries()]
    .map(([key, count]) => {
      const candidates = [...expandGroupCandidates(key)].map(Number);
      // 顺走、换走之后这张牌已经落在别处，从候选里去掉，免得和确定牌重复。
      const candidateCardIds = candidates.filter((cardId) => (
        Number.isFinite(cardId) && cardId > 0 && !placed.has(cardId)
      ));
      return {
        key,
        label: groupLabel(key, order),
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
  return getUncertainGroups(new CardZone(seatId, 5).cards, knownHandIds(seatId));
}

/**
 * 某个座位手牌区的可能牌集合（由不确定组展开而来）。
 * 判定牌、技能临时区里的牌牌面本来就是公开的（郭照的判定牌一律明牌），
 * 手上那一组如果还挂着这些牌号，也不再算可能牌。
 */
export function getSeatPossibleCardIds(seatId: number): number[] {
  const known = knownHandIds(seatId);
  const revealed = revealedCardIds();
  const ids = new Set<number>();
  for (const group of getSeatUncertainGroups(seatId)) {
    group.candidateCardIds.forEach((cardId) => {
      if (known.has(cardId) || revealed.has(cardId)) return;
      ids.add(cardId);
    });
  }
  return [...ids];
}

/** 判定展示区、处理区、技能临时区里已经确定牌面的牌号。 */
function revealedCardIds(): Set<number> {
  const revealed = new Set<number>();
  for (const zoneId of getZoneIds()) {
    const zone = parseZoneId(zoneId)?.zone;
    if (zone === undefined || !REVEALED_CARD_ZONES.has(zone)) continue;
    for (const slot of new CardZone(zoneId).cards) {
      const key = Number(slot?.key);
      if (key > 0) revealed.add(key);
    }
  }
  return revealed;
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
  const inHand = knownHandIds(seat);
  for (const zoneId of getZoneIds()) {
    const info = parseZone4Key(zoneId);
    if (!info || info.seatId !== seat) continue;
    const cards = new CardZone(zoneId).cards;
    const knownCardIds = [...new Set(cards
      .filter((slot) => Number(slot?.key) > 0)
      .map((slot) => Number(slot.id))
      .filter((cardId) => Number.isFinite(cardId) && cardId > 0))];
    const uncertainGroups = getUncertainGroups(cards, inHand);
    const possibleCardIds = [...new Set(uncertainGroups.flatMap((group) => group.candidateCardIds))]
      .filter((cardId) => !knownCardIds.includes(cardId));
    if (!knownCardIds.length && !possibleCardIds.length) continue;
    rows.push({ zoneId, spellId: info.spellId, knownCardIds, possibleCardIds, uncertainGroups });
  }
  return rows.sort((left, right) => left.spellId - right.spellId
    || left.zoneId.localeCompare(right.zoneId));
}

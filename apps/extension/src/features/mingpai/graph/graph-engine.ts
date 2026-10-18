/**
 * 牌位图驱动的明牌引擎。
 *
 * 与位置登记表那套的区别：分区的「第几格是哪张牌」完全由牌位图（槽位链）维护，
 * 移牌走 `applyGraphMove` 的分区调度，查询直接读区域数组与槽位。
 * 标签、炁归属、官方公开手牌本来就由牌位图管理，这里不再另存一份。
 */

import {
  CardSlot,
  CardZone,
  DRAW_PILE_BOTTOM,
  DRAW_PILE_TOP,
  filterSlots,
  findSlotZones,
  forgetMingpaiCardTag,
  listCardIdsWithPersistentTag,
  formatZoneId,
  getMingpaiCardTags,
  getMingpaiQiOwner,
  getMutableZoneCards,
  getOfficialMingpaiHandCards,
  getPersistentMingpaiCardTags,
  getSlotsByKey,
  getUnknownZoneSlots,
  getZoneIds,
  initCardGraph,
  mergeMingpaiCardTags,
  parseZoneId,
  rememberMingpaiCardTags,
  rememberMingpaiQiCards,
  retainPersistentMingpaiCardTags,
  syncOfficialMingpaiHandCards,
  unpackSlots
} from './card-graph.ts';
import { applyGraphMove, type GraphMoveMessage, type GraphMoveState } from './move-pipeline.ts';
import { MINGPAI_ZONE } from '../mingpai-zones.ts';
import type {
  KnownCardMovement,
  MingpaiEngine,
  MingpaiEngineSnapshot,
  MingpaiFindResult
} from '../mingpai-engine.ts';

const HAND_ZONE = 5;
const DRAW_PILE_ZONE = 1;
const DISCARD_ZONE = 2;
const RECYCLE_ZONE = 12;
const GLOBAL_OWNER = 0xff;
const DEFAULT_ZONE = formatZoneId(GLOBAL_OWNER, RECYCLE_ZONE);
const DRAW_PILE_ZONE_ID = formatZoneId(GLOBAL_OWNER, DRAW_PILE_ZONE);
const TEMPORARY_CARD_ZONES = new Set([3, 8, 10]);

type EngineMovement = KnownCardMovement & { spellId?: number; moveType?: number; srcSeatId?: number | null };

/** 整张图的槽位放在 zones 里的投影长度上限，避免快照无限长。 */
const MAX_SNAPSHOT_PILE = 64;

/** 顶上只数放到顶上的明牌，底下只数放到底下的明牌。中间隔着未知牌就停下。 */
function pileEdgeRuns(cards: readonly CardSlot[]): { top: number[]; bottom: number[] } {
  const top: number[] = [];
  for (const slot of cards) {
    if (!(slot.key > 0) || slot.pileEdge === 'bottom') break;
    top.push(slot.key);
    if (top.length >= MAX_SNAPSHOT_PILE) break;
  }
  const bottom: number[] = [];
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    const slot = cards[index];
    if (!slot || !(slot.key > 0) || slot.pileEdge === 'top') break;
    if (top.includes(slot.key)) break;
    bottom.push(slot.key);
    if (bottom.length >= MAX_SNAPSHOT_PILE) break;
  }
  return { top, bottom };
}

export function createGraphMingpaiEngine(storage: Storage | null = getSessionStorage()): MingpaiEngine {
  void storage;
  // 牌位图是模块级共享状态；新建引擎等同于开一局，先清干净。
  initCardGraph([], DEFAULT_ZONE);
  const skillZones = new Map<string, number[]>();
  const listeners = new Set<(snapshot: Readonly<MingpaiEngineSnapshot>) => void>();
  /** 寸目：这个座位摸牌从牌堆底拿，不能抽走牌堆顶的明牌。 */
  const bottomDrawSeats = new Set<number>();
  /** 刚有一张牌放到牌堆顶，紧接着的摸牌也从底上拿。 */
  let skipTopOnNextDraw = false;
  /** 还在这一局里：洗牌要把已不可信的牌打包成不可知组。 */
  let isGameStart = true;
  /** 这一局已经结算过一次。 */
  let isPassed = false;
  /** 跨移牌保留的管线状态（3483 的暂存手牌与牌堆归还计划）。 */
  const moveState: GraphMoveState = {};
  let snapshot = buildSnapshot();

  function buildSnapshot(): Readonly<MingpaiEngineSnapshot> {
    const zones: Record<string, readonly number[]> = {};
    for (const zoneId of getZoneIds()) {
      if (zoneId === 'unknown') continue;
      const known = new CardZone(zoneId).cards
        .filter((slot) => slot.key > 0)
        .map((slot) => slot.key);
      if (known.length) zones[zoneId] = Object.freeze(known);
    }
    // unknown 表示「身份已知、归属还没定」：当前在临时区里的已知牌，
    // 加上技能自己投影进来的候选。整副牌的未知槽位不算进来。
    const unknown = uniquePositive([
      ...[...TEMPORARY_CARD_ZONES].flatMap((zone) => {
        const ownerless = getZoneIds().filter((zoneId) => parseZoneId(zoneId)?.zone === zone);
        return ownerless.flatMap((zoneId) => new CardZone(zoneId).cards
          .filter((slot) => slot.key > 0)
          .map((slot) => slot.key));
      }),
      ...(skillZones.get(MINGPAI_ZONE.UNKNOWN) ?? [])
    ]);
    if (unknown.length) zones[MINGPAI_ZONE.UNKNOWN] = Object.freeze(unknown);
    for (const [zoneId, cardIds] of skillZones) zones[zoneId] = Object.freeze([...cardIds]);

    const records = filterSlots((slot) => slot.key > 0).map((slot) => {
      const cardId = slot.key;
      const location = parseZoneId(String(slot.zone));
      return Object.freeze({
        cardId,
        tags: Object.freeze([...getMingpaiCardTags(cardId)]) as readonly string[],
        persistentTags: Object.freeze([...getPersistentMingpaiCardTags(cardId)]) as readonly string[],
        originalOwnerSeatId: getMingpaiQiOwner(cardId),
        location: location
          ? Object.freeze({
              seatId: location.ownerId,
              zone: location.zone,
              position: slot.position,
              zoneParam: slot.zoneParam
            })
          : null,
        zoneId: String(slot.zone)
      });
    });

    const pileCards = new CardZone(DRAW_PILE_ZONE_ID).cards;
    const { top, bottom } = pileEdgeRuns(pileCards);
    return Object.freeze({
      zones: Object.freeze(zones),
      records: Object.freeze(records),
      drawPile: Object.freeze({ top: Object.freeze(top), bottom: Object.freeze(bottom) })
    });
  }

  function publish(): void {
    const next = buildSnapshot();
    if (JSON.stringify(snapshot) === JSON.stringify(next)) return;
    snapshot = next;
    listeners.forEach((listener) => listener(snapshot));
  }

  /**
   * 找到或建立这张牌对应的槽位，并保证它挂在 cardId 这个 key 上。
   * 已经有槽位时优先用落在目标区里的那一个：判定牌这类牌会同时在展示区和别处
   * 各留一个格，挑错了会把展示区那一格搬进手牌，真正的格留在原处。
   * 同一牌号多余的格降回占位，免得同一张牌在图上登记成两处。
   */
  function slotFor(cardId: number, preferredZoneId?: string): CardSlot {
    const existing = getSlotsByKey(cardId);
    const preferred = preferredZoneId
      ? existing.filter((entry) => String(entry.zone) === preferredZoneId)
      : [];
    const slot = preferred[0] ?? existing[0] ?? new CardSlot(cardId, cardId, DEFAULT_ZONE);
    existing.forEach((entry) => {
      if (entry !== slot && entry.key > 0) entry.key = 0;
    });
    slot.key = cardId;
    return slot;
  }

  /** 把槽位从它当前所在的区域数组里摘掉。 */
  function detachFromZones(slot: CardSlot): void {
    for (const zoneId of getZoneIds()) {
      if (zoneId === 'unknown') continue;
      const cards = getMutableZoneCards(zoneId);
      const index = cards.indexOf(slot);
      if (index >= 0) cards.splice(index, 1);
    }
  }

  /** 把槽位放进目标区域，并同步它的明牌账本。 */
  function placeInZone(slot: CardSlot, zoneId: string, position = 0, zoneParam = 0): void {
    detachFromZones(slot);
    const cards = getMutableZoneCards(zoneId);
    if (!cards.includes(slot)) cards.push(slot);
    slot.zone = zoneId;
    slot.position = position;
    slot.zoneParam = zoneParam;
    getUnknownZoneSlots().delete(slot);
  }

  function seatFrom(movement: EngineMovement): number | null {
    const src = movement.srcSeatId;
    if (typeof src === 'number' && src >= 0 && src < 255) return src;
    if (movement.fromId >= 0 && movement.fromId < 255) return movement.fromId;
    return null;
  }

  function rememberBottomDraw(movement: EngineMovement): void {
    if (movement.spellId === 816 || movement.spellId === 815 || movement.spellId === 14163) {
      const seat = seatFrom(movement) ?? (movement.toId >= 0 && movement.toId < 255 ? movement.toId : null);
      if (seat !== null) bottomDrawSeats.add(seat);
    }
    if (movement.toZone === DRAW_PILE_ZONE && movement.toPosition === DRAW_PILE_TOP && movement.cardCount === 1) {
      skipTopOnNextDraw = true;
    }
  }

  /** 寸目摸牌改从牌堆底，并丢掉刚放上顶的那张牌号，避免被当成摸走。 */
  function drawFromBottom(movement: EngineMovement, cardIds: number[]): { movement: EngineMovement; cardIds: number[] } {
    const drawing = movement.fromZone === DRAW_PILE_ZONE && movement.toZone === 5 && movement.toId >= 0 && movement.toId < 255;
    const cunmu = drawing && (movement.spellId === 816 || bottomDrawSeats.has(movement.toId) || skipTopOnNextDraw);
    if (!cunmu) return { movement, cardIds };
    skipTopOnNextDraw = false;
    const topKeys = new Set(
      new CardZone(DRAW_PILE_ZONE_ID).cards
        .filter((slot) => slot.pileEdge === 'top' && slot.key > 0)
        .map((slot) => slot.key)
    );
    return {
      movement: { ...movement, fromPosition: DRAW_PILE_BOTTOM },
      cardIds: cardIds.map((cardId) => topKeys.has(cardId) ? 0 : cardId)
    };
  }

  function payloadFor(movement: EngineMovement): GraphMoveMessage {
    return {
      cardCount: movement.cardCount,
      cardIds: [...movement.cardIds],
      fromId: movement.fromId,
      fromZone: movement.fromZone,
      fromPosition: movement.fromPosition,
      fromZoneParam: movement.fromZoneParam,
      toId: movement.toId,
      toZone: movement.toZone,
      toPosition: movement.toPosition,
      toZoneParam: movement.toZoneParam,
      moveType: movement.moveType ?? 1,
      spellId: movement.spellId ?? 0,
      srcSeatId: movement.srcSeatId ?? null,
      pilePackCount: movement.pilePackCount
    };
  }

  return {
    getSnapshot: () => snapshot,

    getZoneCardIds(zoneId) {
      return snapshot.zones[zoneId] ?? EMPTY;
    },

    setZoneCardIds(zoneId, cardIds) {
      const normalized = uniquePositive(cardIds);
      if (!normalized.length) skillZones.delete(zoneId);
      else skillZones.set(zoneId, normalized);
      publish();
    },

    addZoneCardIds(zoneId, cardIds) {
      const incoming = uniquePositive(cardIds);
      if (!incoming.length) return;
      skillZones.set(zoneId, uniquePositive([...(skillZones.get(zoneId) ?? []), ...incoming]));
      publish();
    },

    removeZoneCardIds(zoneId, cardIds) {
      const removing = new Set(uniquePositive(cardIds));
      if (!removing.size) return;
      const next = (skillZones.get(zoneId) ?? []).filter((cardId) => !removing.has(cardId));
      if (next.length) skillZones.set(zoneId, next);
      else skillZones.delete(zoneId);
      publish();
    },

    clearZone(zoneId) {
      skillZones.delete(zoneId);
      publish();
    },

    findKZ(cardIdOrNode): MingpaiFindResult {
      const cardId = Number(cardIdOrNode);
      if (!Number.isInteger(cardId) || cardId <= 0) {
        return { keys: Object.freeze([0]), zones: Object.freeze(['?']) };
      }
      const { keys, zones } = findSlotZones(cardId);
      if (!zones.length) {
        return { keys: Object.freeze([cardId]), zones: Object.freeze([]) };
      }
      const mapped = zones.map((zone) => (zone === '?' ? MINGPAI_ZONE.UNKNOWN : zone));
      return { keys: Object.freeze(keys), zones: Object.freeze(mapped) };
    },

    getHandCardIds(seatId) {
      return CardZone.shoupai(seatId);
    },

    clearKnownHandCards(seatId) {
      const zoneId = formatZoneId(seatId, HAND_ZONE);
      const stale = new CardZone(zoneId).cards;
      if (!stale.length) return;
      const recycle = getMutableZoneCards(DEFAULT_ZONE);
      stale.forEach((slot) => {
        if (slot.key > 0) retainPersistentMingpaiCardTags(slot.key);
        slot.key = 0;
        recycle.push(slot);
        slot.zone = DEFAULT_ZONE;
        getUnknownZoneSlots().add(slot);
      });
      getMutableZoneCards(zoneId).length = 0;
      publish();
    },

    getDrawPileCardIds() {
      // 只报「牌堆区里已经确认牌面」的牌；未知槽位的占位号不参与推演。
      return new CardZone(DRAW_PILE_ZONE_ID).cards
        .filter((slot) => slot.key > 0)
        .map((slot) => slot.key);
    },

    clearKnownDrawPileOrder() {
      const cards = new CardZone(DRAW_PILE_ZONE_ID).cards;
      cards.forEach((slot) => {
        if (slot.key > 0) slot.destroy(0);
        else if (slot.key < 0) unpackSlots(slot.key);
      });
      publish();
    },

    reconcileVisibleHands(hands) {
      for (const hand of hands) {
        const cardIds = uniquePositive(hand.cardIds);
        syncOfficialMingpaiHandCards(hand.seatId, cardIds);
        const zoneId = formatZoneId(hand.seatId, HAND_ZONE);
        getMutableZoneCards(zoneId).length = 0;
        cardIds.forEach((cardId) => placeInZone(slotFor(cardId), zoneId));
      }
      publish();
    },

    observeKnownHandCard(cardId, seatId, tags = []) {
      if (!(cardId > 0)) return;
      const zoneId = formatZoneId(seatId, HAND_ZONE);
      placeInZone(slotFor(cardId, zoneId), zoneId);
      if (tags.length) mergeMingpaiCardTags(cardId, tags);
      publish();
    },

    rememberPersistentCardTag(cardId, tag, originalOwnerSeatId = null) {
      if (!(cardId > 0)) return;
      if (tag === '炁' && originalOwnerSeatId !== null) rememberMingpaiQiCards(originalOwnerSeatId, [cardId]);
      else rememberMingpaiCardTags(cardId, [tag]);
      publish();
    },

    forgetPersistentCardTag(cardId, tag) {
      const normalized = String(tag).trim();
      if (!normalized) return;
      forgetMingpaiCardTag(cardId, normalized);
      publish();
    },

    listCardIdsWithPersistentTag(tag) {
      return listCardIdsWithPersistentTag(tag);
    },

    syncOfficialHand(seatId, cardIds) {
      syncOfficialMingpaiHandCards(seatId, cardIds);
      publish();
    },

    getOfficialHandCardIds(seatId) {
      return getOfficialMingpaiHandCards(seatId);
    },

    observeKnownDrawPileCards(cardIds, position) {
      const ids = uniquePositive(cardIds);
      if (!ids.length) return;
      const cards = getMutableZoneCards(DRAW_PILE_ZONE_ID);
      const placed = ids.map((cardId) => {
        const slot = slotFor(cardId);
        detachFromZones(slot);
        slot.zone = DRAW_PILE_ZONE_ID;
        slot.position = position;
        getUnknownZoneSlots().delete(slot);
        return slot;
      });
      const edge = position === DRAW_PILE_TOP ? 'top' : 'bottom';
      placed.forEach((slot) => { slot.pileEdge = edge; });
      if (position === DRAW_PILE_TOP) cards.unshift(...placed);
      else cards.push(...placed);
      publish();
    },

    getPersistentTags(cardId) {
      return getPersistentMingpaiCardTags(cardId);
    },

    getOriginalOwnerSeatId(cardId) {
      return getMingpaiQiOwner(cardId);
    },

    resolveHiddenMovement(movement) {
      const isPile = movement.fromId === GLOBAL_OWNER && movement.fromZone === DRAW_PILE_ZONE;
      const hasKnownId = movement.cardIds.some((cardId) => cardId > 0);
      if (isPile && !hasKnownId
        && (movement.fromPosition === DRAW_PILE_TOP || movement.fromPosition === DRAW_PILE_BOTTOM)) {
        const cards = new CardZone(DRAW_PILE_ZONE_ID).cards;
        const count = Math.max(0, Math.min(movement.cardCount, cards.length));
        const fromTop = cards.filter((slot) => !(slot.pileEdge === 'bottom' && slot.key > 0));
        const picked = movement.fromPosition === DRAW_PILE_TOP
          ? fromTop.slice(0, count)
          : cards.slice(-count).reverse();
        return picked.map((slot) => (slot.key > 0 ? slot.key : 0));
      }
      return [...movement.cardIds];
    },

    applyMovement(movement, effectiveCardIds) {
      const resolved = effectiveCardIds.some((cardId) => cardId > 0)
        ? [...effectiveCardIds]
        : [...movement.cardIds];
      const adjusted = drawFromBottom(movement, resolved);
      rememberBottomDraw(adjusted.movement);
      const message = payloadFor({ ...adjusted.movement, cardIds: adjusted.cardIds });
      moveState.isGameStart = isGameStart;
      moveState.isPassed = isPassed;
      const result = applyGraphMove(message, moveState);
      result.moved.forEach((slot) => {
        slot.position = movement.toPosition;
        slot.zoneParam = movement.toZoneParam;
        if (movement.toZone === DRAW_PILE_ZONE && movement.toPosition === DRAW_PILE_TOP) slot.pileEdge = 'top';
        else if (movement.toZone === DRAW_PILE_ZONE && movement.toPosition === DRAW_PILE_BOTTOM) slot.pileEdge = 'bottom';
      });
      // unknown 投影跟随临时区进出。
      const known = uniquePositive(effectiveCardIds);
      if (known.length && TEMPORARY_CARD_ZONES.has(movement.toZone)) {
        skillZones.set(MINGPAI_ZONE.UNKNOWN, uniquePositive([
          ...(skillZones.get(MINGPAI_ZONE.UNKNOWN) ?? []), ...known
        ]));
      }
      if (known.length && TEMPORARY_CARD_ZONES.has(movement.fromZone)) {
        const next = (skillZones.get(MINGPAI_ZONE.UNKNOWN) ?? [])
          .filter((cardId) => !known.includes(cardId));
        if (next.length) skillZones.set(MINGPAI_ZONE.UNKNOWN, next);
        else skillZones.delete(MINGPAI_ZONE.UNKNOWN);
      }
      publish();
      return result.moved.map((slot) => (slot.key > 0 ? slot.key : 0));
    },

    projectSkillCards(zoneId, cardIds) {
      const normalized = uniquePositive(cardIds);
      if (!normalized.length) skillZones.delete(zoneId);
      else skillZones.set(zoneId, normalized);
      publish();
    },

    resetAllCardsUnknown(cardIds) {
      initCardGraph(uniquePositive(cardIds), formatZoneId(GLOBAL_OWNER, DISCARD_ZONE));
      bottomDrawSeats.clear();
      skipTopOnNextDraw = false;
      skillZones.clear();
      isGameStart = true;
      isPassed = false;
      moveState.spell3483 = null;
      publish();
    },

    resetAllCardsToDrawPile(cardIds) {
      initCardGraph(uniquePositive(cardIds), DRAW_PILE_ZONE_ID);
      bottomDrawSeats.clear();
      skipTopOnNextDraw = false;
      skillZones.clear();
      isGameStart = true;
      isPassed = false;
      moveState.spell3483 = null;
      publish();
    },

    noteGameSettled() {
      isGameStart = false;
      isPassed = true;
    },

    hasRestoredRecords() {
      return false;
    },

    clear() {
      initCardGraph([], DEFAULT_ZONE);
      skillZones.clear();
      isGameStart = true;
      isPassed = false;
      moveState.spell3483 = null;
      publish();
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    }
  };
}

const EMPTY: readonly number[] = Object.freeze([]);

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

function getSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export { HAND_ZONE, DRAW_PILE_ZONE, DISCARD_ZONE, TEMPORARY_CARD_ZONES, GLOBAL_OWNER };

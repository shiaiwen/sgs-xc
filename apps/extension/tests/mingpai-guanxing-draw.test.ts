import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGraphMingpaiEngine } from '../src/features/mingpai/graph/graph-engine.ts';
import { formatZoneId } from '../src/features/mingpai/graph/card-graph.ts';
import { correctMoveCard, takeHiddenZoneCards } from '../src/features/mingpai/spell-move-judge.ts';
import type { EngineMovement } from '../src/features/mingpai/mingpai-engine.ts';

const host = {
  myId: 0,
  nationWar: false,
  cardType: () => 1,
  isRedCard: () => false,
  zoneCardIds: () => [] as number[],
  handCardIds: () => [] as number[]
};

function pileCounts(engine: ReturnType<typeof createGraphMingpaiEngine>): { top: number; bottom: number } {
  const pile = engine.getSnapshot().drawPile;
  return {
    top: pile.top.filter((cardId) => cardId > 0).length,
    bottom: pile.bottom.filter((cardId) => cardId > 0).length
  };
}

function draw(engine: ReturnType<typeof createGraphMingpaiEngine>, raw: EngineMovement): void {
  const corrected = correctMoveCard({ ...raw, srcSeatId: 0 }, host);
  const event = { ...raw, cardIds: corrected.cardIds, fromPosition: corrected.fromPosition, toPosition: corrected.toPosition };
  const pileCardIds = engine.resolveHiddenMovement(event);
  const resolved = pileCardIds.some((cardId) => cardId > 0) ? pileCardIds : [...event.cardIds];
  const zoneKnown = [...engine.getZoneCardIds(formatZoneId(event.fromId, event.fromZone))];
  const recovered = takeHiddenZoneCards(
    { ...event, cardIds: resolved },
    zoneKnown,
    zoneKnown.filter((cardId) => cardId > 0).length
  );
  engine.applyMovement(event, recovered);
}

test('牌堆里只有放到底下的 3 张时，顶是 0 底是 3，摸 2 张后不变', () => {
  const engine = createGraphMingpaiEngine(null);
  engine.observeKnownDrawPileCards([3, 4, 5], 0);
  assert.deepEqual(pileCounts(engine), { top: 0, bottom: 3 });
  draw(engine, {
    cardCount: 2,
    cardIds: [0, 0],
    fromId: 255,
    fromZone: 1,
    fromPosition: 0,
    fromZoneParam: 0,
    toId: 2,
    toZone: 5,
    toPosition: 0,
    toZoneParam: 0,
    moveType: 1,
    spellId: 0
  });
  assert.deepEqual(pileCounts(engine), { top: 0, bottom: 3 });
});

test('观星放底 3 张后，从顶摸 2 张，底下仍是这 3 张', () => {
  const engine = createGraphMingpaiEngine(null);
  const deck = Array.from({ length: 40 }, (_, index) => index + 1);
  engine.resetAllCardsToDrawPile(deck);

  const looked = [1, 2, 3, 4, 5];
  engine.applyMovement({
    cardCount: 5,
    cardIds: looked,
    fromId: 255,
    fromZone: 1,
    fromPosition: 0xff00,
    fromZoneParam: 0,
    toId: 1,
    toZone: 10,
    toPosition: 0,
    toZoneParam: 0,
    moveType: 1,
    spellId: 37
  }, looked);
  const bottomCards = [3, 4, 5];
  engine.applyMovement({
    cardCount: 3,
    cardIds: bottomCards,
    fromId: 1,
    fromZone: 10,
    fromPosition: 0,
    fromZoneParam: 0,
    toId: 255,
    toZone: 1,
    toPosition: 0,
    toZoneParam: 0,
    moveType: 1,
    spellId: 37
  }, bottomCards);

  assert.deepEqual(pileCounts(engine), { top: 0, bottom: 3 });

  draw(engine, {
    cardCount: 2,
    cardIds: [6, 7],
    fromId: 255,
    fromZone: 1,
    fromPosition: 0,
    fromZoneParam: 0,
    toId: 2,
    toZone: 5,
    toPosition: 0,
    toZoneParam: 0,
    moveType: 1,
    spellId: 0
  });

  assert.deepEqual(pileCounts(engine), { top: 0, bottom: 3 });
});

test('观星放底 3 张后，协议不带牌号的摸 2 张也不动牌堆底', () => {
  const engine = createGraphMingpaiEngine(null);
  const deck = Array.from({ length: 40 }, (_, index) => index + 1);
  engine.resetAllCardsToDrawPile(deck);
  const looked = [1, 2, 3, 4, 5];
  engine.applyMovement({
    cardCount: 5,
    cardIds: looked,
    fromId: 255,
    fromZone: 1,
    fromPosition: 0xff00,
    fromZoneParam: 0,
    toId: 1,
    toZone: 10,
    toPosition: 0,
    toZoneParam: 0,
    moveType: 1,
    spellId: 37
  }, looked);
  const bottomCards = [3, 4, 5];
  engine.applyMovement({
    cardCount: 3,
    cardIds: bottomCards,
    fromId: 1,
    fromZone: 10,
    fromPosition: 0,
    fromZoneParam: 0,
    toId: 255,
    toZone: 1,
    toPosition: 0,
    toZoneParam: 0,
    moveType: 1,
    spellId: 37
  }, bottomCards);
  assert.deepEqual(pileCounts(engine), { top: 0, bottom: 3 });

  draw(engine, {
    cardCount: 2,
    cardIds: [0, 0],
    fromId: 255,
    fromZone: 1,
    fromPosition: 0,
    fromZoneParam: 0,
    toId: 2,
    toZone: 5,
    toPosition: 0,
    toZoneParam: 0,
    moveType: 1,
    spellId: 0
  });
  assert.deepEqual(pileCounts(engine), { top: 0, bottom: 3 });
});

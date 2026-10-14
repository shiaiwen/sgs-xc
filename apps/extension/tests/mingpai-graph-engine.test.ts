import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initCardGraph } from '../src/features/mingpai/graph/card-graph.ts';
import { createGraphMingpaiEngine } from '../src/features/mingpai/graph/graph-engine.ts';
import { clearTempZoneGrids } from '../src/features/mingpai/graph/temporary-zone-grid.ts';

function freshEngine() {
  initCardGraph([], '12-255');
  clearTempZoneGrids();
  return createGraphMingpaiEngine(null);
}

function move(partial: Record<string, number> = {}) {
  return {
    cardCount: 1,
    cardIds: [] as number[],
    fromId: 1,
    fromZone: 5,
    fromPosition: 0,
    fromZoneParam: 0,
    toId: 1,
    toZone: 5,
    toPosition: 0,
    toZoneParam: 0,
    spellId: 0,
    moveType: 1,
    ...partial
  };
}

test('登记的已知手牌能查到座位与分区', () => {
  const engine = freshEngine();
  engine.observeKnownHandCard(11, 2, []);
  assert.deepEqual(engine.getHandCardIds(2), [11]);
  assert.deepEqual(engine.findKZ(11).zones, ['5-2']);
  const record = engine.getSnapshot().records.find((entry) => entry.cardId === 11);
  assert.equal(record?.location?.seatId, 2);
  assert.equal(record?.location?.zone, 5);
});

test('移牌把已知牌从手牌区搬到弃牌堆', () => {
  const engine = freshEngine();
  engine.observeKnownHandCard(11, 2, []);
  engine.applyMovement(move({
    fromId: 2, toId: 255, fromZone: 5, toZone: 2, cardIds: [11], spellId: 4
  }), [11]);
  assert.deepEqual(engine.getHandCardIds(2), []);
  assert.deepEqual(engine.getZoneCardIds('2-255'), [11]);
  assert.equal(engine.findKZ(11).zones.includes('2-255'), true);
});

test('整手暗牌离场时，来源区按张数补齐占位', () => {
  const engine = freshEngine();
  engine.observeKnownHandCard(11, 2, []);
  engine.applyMovement(move({
    fromId: 2, toId: 3, fromZone: 5, toZone: 5, cardIds: [0, 0, 0], cardCount: 3, spellId: 121, moveType: 11
  }), [11, 0, 0]);
  assert.deepEqual(engine.getHandCardIds(2), []);
  assert.deepEqual(engine.getHandCardIds(3), [11]);
});

test('牌堆看牌后能按顶底推算暗牌，清掉顺序后不再推算', () => {
  const engine = freshEngine();
  engine.observeKnownDrawPileCards([31, 32], 0xff00);
  assert.deepEqual(engine.getDrawPileCardIds().includes(31), true);
  const peeked = engine.resolveHiddenMovement({
    cardCount: 2, cardIds: [], fromId: 0xff, fromZone: 1, fromPosition: 0xff00,
    fromZoneParam: 0, toId: 3, toZone: 5, toPosition: 0, toZoneParam: 0
  }, null);
  assert.deepEqual(peeked, [31, 32]);

  engine.clearKnownDrawPileOrder();
  assert.deepEqual(engine.getDrawPileCardIds(), []);
});

test('标签与炁归属走牌位图，清空后一起消失', () => {
  const engine = freshEngine();
  engine.observeKnownHandCard(11, 2, []);
  engine.rememberPersistentCardTag(11, '心幽');
  engine.rememberPersistentCardTag(11, '炁', 2);
  assert.deepEqual(engine.getPersistentTags(11).sort(), ['心幽', '炁'].sort());
  assert.equal(engine.getOriginalOwnerSeatId(11), 2);

  engine.forgetPersistentCardTag(11, '心幽');
  assert.deepEqual(engine.getPersistentTags(11), ['炁']);

  engine.clear();
  assert.deepEqual(engine.getPersistentTags(11), []);
  assert.equal(engine.getOriginalOwnerSeatId(11), null);
});

test('手牌判定为空时清掉该座位残留的牌号', () => {
  const engine = freshEngine();
  engine.observeKnownHandCard(11, 2, []);
  engine.observeKnownHandCard(12, 2, []);
  engine.clearKnownHandCards(2);
  assert.deepEqual(engine.getHandCardIds(2), []);
});

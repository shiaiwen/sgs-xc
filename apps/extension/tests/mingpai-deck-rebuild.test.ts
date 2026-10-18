import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DRAW_PILE_BOTTOM,
  DRAW_PILE_TOP,
  getReshufflePoolKeys,
  initCardGraph
} from '../src/features/mingpai/graph/card-graph.ts';
import { createGraphMingpaiEngine } from '../src/features/mingpai/graph/graph-engine.ts';
import { clearTempZoneGrids } from '../src/features/mingpai/graph/temporary-zone-grid.ts';

function freshEngine() {
  initCardGraph([], '12-255');
  clearTempZoneGrids();
  return createGraphMingpaiEngine(null);
}

test('牌堆方向：顶在数组头，看牌按给的顺序落到顶，底端顺序相反', () => {
  const engine = freshEngine();
  engine.observeKnownDrawPileCards([31, 32], DRAW_PILE_TOP);
  assert.deepEqual(engine.getSnapshot().drawPile.top, [31, 32]);
  assert.deepEqual(engine.getSnapshot().drawPile.bottom, []);

  const peek = (position: number) => engine.resolveHiddenMovement({
    cardCount: 2,
    cardIds: [],
    fromId: 0xff,
    fromZone: 1,
    fromPosition: position,
    fromZoneParam: 0,
    toId: 3,
    toZone: 5,
    toPosition: 0,
    toZoneParam: 0
  }, null);
  assert.deepEqual(peek(DRAW_PILE_TOP), [31, 32]);
  assert.deepEqual(peek(DRAW_PILE_BOTTOM), [32, 31]);
});

test('开局按整副牌重建后，整副牌都是未知槽位，不进入 unknown 投影', () => {
  const engine = freshEngine();
  engine.resetAllCardsUnknown([1, 2, 3, 4, 5]);
  assert.deepEqual(engine.getDrawPileCardIds(), []);
  assert.deepEqual(engine.getHandCardIds(1), []);
  // unknown 只表示「身份已知、归属未定」，整副牌的未知槽位不算。
  assert.equal(engine.getSnapshot().zones.unknown, undefined);
  assert.deepEqual(engine.getSnapshot().records, []);
});

test('重连按整副牌重建后牌的组成仍在，归位靠后续移牌', () => {
  const engine = freshEngine();
  engine.resetAllCardsToDrawPile([1, 2, 3, 4, 5]);
  assert.deepEqual(engine.getDrawPileCardIds(), []);
  engine.observeKnownHandCard(3, 2);
  assert.deepEqual(engine.getHandCardIds(2), [3]);
  assert.deepEqual(engine.findKZ(3).zones, ['5-2']);
  assert.equal(engine.getDrawPileCardIds().includes(3), false);
});

test('对局中洗牌把全部牌收回牌堆，弃牌桶与手牌区清空', () => {
  const engine = freshEngine();
  engine.resetAllCardsUnknown([1, 2, 3]);
  // 先让一张未知牌散到手牌区，模拟牌已经分布在多个区。
  engine.applyMovement({
    cardCount: 1, cardIds: [0],
    fromId: 0xff, fromZone: 2, fromPosition: 0, fromZoneParam: 0,
    toId: 2, toZone: 5, toPosition: 0, toZoneParam: 0,
    spellId: 0, moveType: 1
  }, []);
  assert.deepEqual(engine.getHandCardIds(2), []);

  engine.applyMovement({
    cardCount: 3, cardIds: [],
    fromId: 0xff, fromZone: 2, fromPosition: 0, fromZoneParam: 0,
    toId: 0xff, toZone: 9, toPosition: 0, toZoneParam: 0,
    spellId: 0, moveType: 255
  }, []);
  // 牌堆区（9 区归一成 1 区）收下弃牌桶里的牌，桶清空；身份仍然是未知。
  assert.deepEqual(engine.getDrawPileCardIds(), []);
  assert.deepEqual(engine.getSnapshot().zones['2-255'], undefined);
});

test('一局结算之后，洗牌不再把未知牌打包成不可知组', () => {
  const engine = freshEngine();
  engine.resetAllCardsUnknown([1, 2, 3]);
  engine.noteGameSettled();
  engine.applyMovement({
    cardCount: 1, cardIds: [0],
    fromId: 0xff, fromZone: 2, fromPosition: 0, fromZoneParam: 0,
    toId: 2, toZone: 5, toPosition: 0, toZoneParam: 0,
    spellId: 0, moveType: 1
  }, []);
  engine.applyMovement({
    cardCount: 3, cardIds: [],
    fromId: 0xff, fromZone: 2, fromPosition: 0, fromZoneParam: 0,
    toId: 0xff, toZone: 9, toPosition: 0, toZoneParam: 0,
    spellId: 0, moveType: 255
  }, []);
  assert.deepEqual(getReshufflePoolKeys(), []);
  assert.deepEqual(engine.getHandCardIds(2), []);
});

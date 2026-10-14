import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CardSlot,
  CardZone,
  initCardGraph
} from '../src/features/mingpai/graph/card-graph.ts';
import { applyGraphMove, type GraphMoveMessage } from '../src/features/mingpai/graph/move-pipeline.ts';
import { clearTempZoneGrids } from '../src/features/mingpai/graph/temporary-zone-grid.ts';

function freshGraph(): void {
  initCardGraph([], '12-255');
  clearTempZoneGrids();
}

/** 在某个区里摆好若干未知槽位，返回这些槽位。 */
function occupy(id: number, zone: number, slotIds: number[]): CardSlot[] {
  const container = new CardZone(id, zone);
  const created = slotIds.map((slotId) => new CardSlot(0, slotId, container.zoneID));
  container.cards.push(...created);
  return created;
}

function move(partial: Partial<GraphMoveMessage>): GraphMoveMessage {
  return {
    cardCount: 1,
    cardIds: [],
    fromId: 1,
    fromZone: 5,
    fromPosition: 0,
    fromZoneParam: 0,
    toId: 1,
    toZone: 5,
    toPosition: 0,
    toZoneParam: 0,
    moveType: 1,
    spellId: 0,
    ...partial
  };
}

test('同区同主人就地亮牌，把手牌槽位认成具体牌号', () => {
  freshGraph();
  occupy(1, 5, [101, 102, 103]);
  const result = applyGraphMove(move({ cardIds: [102], spellId: 4 }));
  assert.equal(result.handling, 'same-zone-show');
  assert.deepEqual(CardZone.shoupai(1), [102]);
});

test('换区时来源区摘牌、目标区加入，弃牌堆能查到牌号', () => {
  freshGraph();
  occupy(1, 5, [101]);
  const result = applyGraphMove(move({ fromId: 1, toId: 255, toZone: 2, cardIds: [101], spellId: 4 }));
  assert.equal(result.handling, 'zone-move');
  assert.equal(result.moved.length, 1);
  assert.deepEqual(CardZone.qipai, [101]);
  assert.deepEqual(CardZone.shoupai(1), []);
});

test('早退条件：空移、类型 0、目标 11 区、自发包都整条跳过', () => {
  freshGraph();
  occupy(1, 5, [101]);
  assert.equal(applyGraphMove(move({ cardCount: 0 })).handling, 'ignored');
  assert.equal(applyGraphMove(move({ moveType: 0 })).handling, 'ignored');
  assert.equal(applyGraphMove(move({ toZone: 11, cardIds: [101] })).handling, 'ignored');
  assert.equal(applyGraphMove(move({ cardIds: [101], isSend: true })).handling, 'ignored');
});

test('回收区只改牌位账本，不搬区域数组', () => {
  freshGraph();
  occupy(1, 5, [101]);
  const result = applyGraphMove(move({ toId: 255, toZone: 12, cardIds: [101], spellId: 4 }));
  assert.equal(result.handling, 'recycled');
  assert.equal(result.moved.length, 1);
  assert.equal(result.moved[0].zone, '12-255');
  assert.deepEqual(new CardZone(255, 12).cards, []);
});

test('整手亮牌把没亮的推进回收区，亮的留手牌', () => {
  freshGraph();
  occupy(1, 5, [101, 102, 103]);
  const result = applyGraphMove(move({ moveType: 24, cardIds: [102], cardCount: 1 }));
  assert.equal(result.handling, 'whole-hand-show');
  assert.deepEqual(CardZone.shoupai(1), [102]);
  assert.equal(new CardZone(255, 12).cards.length, 2);
});

test('手牌回牌堆先把牌堆未知段打包，再把回来的牌挂到那一格后面', () => {
  freshGraph();
  occupy(1, 5, [101]);
  const pile = new CardZone(255, 1);
  pile.cards.push(new CardSlot(0, 201, '1-255'), new CardSlot(0, 202, '1-255'));

  const result = applyGraphMove(move({
    fromZone: 5, toZone: 1, toId: 255, moveType: 19, spellId: 0, cardIds: [101]
  }));
  assert.equal(result.handling, 'hand-to-pile');
  assert.equal(result.moved.length, 1);
  assert.equal(pile.cards.length, 3);
});

test('3208 从技能临时区取回时先打包其余牌', () => {
  freshGraph();
  occupy(1, 10, [301, 302, 303]);
  const result = applyGraphMove(move({
    fromZone: 10, toZone: 5, fromId: 1, toId: 1, cardCount: 1, cardIds: [], spellId: 3208
  }));
  assert.equal(result.handling, 'zone-move');
  assert.equal(result.moved.length, 1);
  assert.equal(new CardZone(1, 10).cards.length, 2);
});

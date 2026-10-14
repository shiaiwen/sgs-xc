import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CardZone,
  getSlotsByKey,
  initCardGraph
} from '../src/features/mingpai/graph/card-graph.ts';
import { applyGraphMove, type GraphMoveMessage } from '../src/features/mingpai/graph/move-pipeline.ts';
import { clearTempZoneGrids } from '../src/features/mingpai/graph/temporary-zone-grid.ts';

/** 开局从区外把牌铺进牌堆顶。 */
const DEAL_MOVE_TYPE = 19;
const PLACEHOLDER_SPELL_ID = 3694;

function move(partial: Partial<GraphMoveMessage>): GraphMoveMessage {
  return {
    cardCount: 1,
    cardIds: [],
    fromId: 0,
    fromZone: 0,
    fromPosition: 0,
    fromZoneParam: 0,
    toId: 0xff,
    toZone: 1,
    toPosition: 0,
    toZoneParam: 0,
    moveType: DEAL_MOVE_TYPE,
    spellId: 0,
    ...partial
  };
}

function fresh(): void {
  initCardGraph([], '12-255');
  clearTempZoneGrids();
}

test('3694 的「顶+1」铺牌只往牌堆补未知占位槽位', () => {
  fresh();
  const result = applyGraphMove(move({
    spellId: PLACEHOLDER_SPELL_ID,
    toPosition: 0xff01,
    cardCount: 3,
    cardIds: [301, 302, 303]
  }), { isGameStart: true });

  assert.equal(result.handling, 'zone-move');
  assert.deepEqual(result.moved.map((slot) => slot.key), [0, 0, 0]);
  assert.equal(new CardZone(0xff, 1).cards.length, 3);
  assert.equal(getSlotsByKey(0).length, 3);
  // 占了槽位但不算明牌。
  assert.deepEqual([...new CardZone(0xff, 1).cards.map((slot) => slot.id)], [301, 302, 303]);
});

test('开局阶段的「顶」铺牌身份写 0，结算之后的同一条移牌才认牌', () => {
  fresh();
  const duringGameStart = applyGraphMove(move({
    toPosition: 0xff00,
    cardCount: 1,
    cardIds: [401]
  }), { isGameStart: true });
  assert.deepEqual(duringGameStart.moved.map((slot) => slot.key), [0]);

  fresh();
  const afterStart = applyGraphMove(move({
    toPosition: 0xff00,
    cardCount: 1,
    cardIds: [402]
  }), { isGameStart: false });
  assert.deepEqual(afterStart.moved.map((slot) => slot.key), [402]);
});

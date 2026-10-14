import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DRAW_PILE_BOTTOM,
  DRAW_PILE_TOP,
  CardSlot,
  getSlotsByKey,
  initCardGraph
} from '../src/features/mingpai/graph/card-graph.ts';
import {
  advanceGridTrace,
  advanceSeatGridTrace,
  advanceUniqueSeatGridTrace,
  clearTempZoneGrids,
  createTempZoneGrid,
  findTempZoneGrid,
  markGridCardsReturned,
  registerTempZoneGrid,
  takeGridCards
} from '../src/features/mingpai/graph/temporary-zone-grid.ts';

/** 造 n 张互相独立的槽位。 */
function slots(count: number): CardSlot[] {
  initCardGraph(Array.from({ length: Math.max(count, 1) }, (_, index) => index + 1), '10-1');
  const created = getSlotsByKey(0);
  return created.slice(0, count);
}

test('同层换位时两张牌互换格子，逻辑顺序跟着更新', () => {
  const [a, b] = slots(2);
  const state = createTempZoneGrid([a, b], { seatId: 1, spellId: 100, tempZone: '10-1' });
  assert.equal(advanceGridTrace(state, [0, 1, 1]), true);
  assert.equal(state.gridByCard.get(a), 1);
  assert.equal(state.gridByCard.get(b), 0);
  assert.deepEqual(state.logicalCards, [b, a]);
});

test('跨层移动把同层后面的格子整体前移一格', () => {
  const [a, b, c] = slots(3);
  const state = createTempZoneGrid([a, b, c], { seatId: 1, spellId: 100, tempZone: '10-1' });
  assert.equal(advanceGridTrace(state, [0, 3, 0]), true);
  assert.equal(state.gridByCard.get(a), 3);
  assert.equal(state.gridByCard.get(b), 0);
  assert.equal(state.gridByCard.get(c), 1);
  assert.deepEqual(state.logicalCards, [a, b, c]);
});

test('单元素回报表示追踪结束，非法三元组让追踪失效', () => {
  const [a, b] = slots(2);
  const closed = createTempZoneGrid([a, b], { seatId: 1, spellId: 100, tempZone: '10-1' });
  assert.equal(advanceGridTrace(closed, [0]), true);
  assert.equal(closed.traceClosed, true);

  const broken = createTempZoneGrid([a, b], { seatId: 1, spellId: 100, tempZone: '10-1' });
  assert.equal(advanceGridTrace(broken, [0, 1]), false);
  assert.equal(broken.valid, false);

  const outOfRange = createTempZoneGrid([a, b], { seatId: 1, spellId: 101, tempZone: '10-1' });
  assert.equal(advanceGridTrace(outOfRange, [0, 99, 0]), false);
  assert.equal(outOfRange.valid, false);
});

test('落在牌数之外的格子记成外部置换格', () => {
  const [a, b, c] = slots(3);
  const state = createTempZoneGrid([a, b, c], { seatId: 1, spellId: 100, tempZone: '10-1' });
  assert.equal(advanceGridTrace(state, [3, 1, 0]), true);
  assert.equal(state.externalTargetGrids.has(1), true);
  assert.equal(state.externalDisplacedCards.has(b), true);
  assert.equal(state.gridByCard.get(b), 3);
});

test('按顶 / 底半区取回，顶半区少一张时用网格外那张补位', () => {
  const [a, b, c] = slots(3);
  const state = createTempZoneGrid([a, b, c], { seatId: 1, spellId: 100, tempZone: '10-1' });
  advanceGridTrace(state, [0, 0, 0]);
  assert.deepEqual(takeGridCards(state, DRAW_PILE_TOP, 1), [a]);
  // 刚建好的网格上半层就装了全部牌，下半层是空的。
  assert.equal(takeGridCards(state, DRAW_PILE_BOTTOM, 1), null);
  assert.equal(takeGridCards(state, 12345, 1), null);

  // c 挪到下半区，底半区就能取回。
  advanceGridTrace(state, [2, 3, 0]);
  assert.deepEqual(takeGridCards(state, DRAW_PILE_BOTTOM, 1), [c]);

  // 顶半区只剩 a、b；网格外那张补第 3 个位置。
  const outside = new CardSlot(9001, 9001, '10-1');
  const picked = takeGridCards(state, DRAW_PILE_TOP, 3, [a, b, outside]);
  assert.deepEqual(picked, [a, b, outside]);
});

test('追踪注册表按座位与技能找回，返完就注销', () => {
  clearTempZoneGrids();
  const [a, b] = slots(2);
  const state = registerTempZoneGrid({ seatId: 5, spellId: 100, tempZone: '10-5', cards: [a, b] });
  assert.equal(findTempZoneGrid(5, 100)?.key, state.key);
  assert.equal(findTempZoneGrid(6, 100), null);

  assert.equal(advanceSeatGridTrace(5, 100, [0, 1, 1])?.key, state.key);
  assert.equal(advanceUniqueSeatGridTrace(5, [0])?.key, state.key);

  markGridCardsReturned(state, [a, b]);
  assert.equal(findTempZoneGrid(5, 100), null);
});

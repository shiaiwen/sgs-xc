import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DRAW_PILE_TOP, initCardGraph } from '../src/features/mingpai/graph/card-graph.ts';
import { createGraphMingpaiEngine } from '../src/features/mingpai/graph/graph-engine.ts';
import { partitionCandidatesByMingpai } from '../src/features/mingpai/mingpai-queries.ts';

function setup() {
  initCardGraph([], '12-255');
  const engine = createGraphMingpaiEngine(null);
  engine.observeKnownHandCard(11, 1);
  // 牌堆顶依次是 31、32，33 在更深处。
  engine.observeKnownDrawPileCards([31, 32, 33], DRAW_PILE_TOP);
  return engine;
}

test('给了牌堆窗口时，只有窗口内的候选算「牌堆侧」', () => {
  const engine = setup();
  const narrow = partitionCandidatesByMingpai(engine, [11, 31, 32, 33], { deckTopCount: 2 });
  assert.deepEqual([...narrow.deckCardIds].sort((a, b) => a - b), [31, 32]);
  // 旧版归约：牌堆侧正好两张时，其余都算手牌侧。
  assert.deepEqual([...narrow.handCardIds].sort((a, b) => a - b), [11, 33]);
});

test('不给窗口时按「在牌堆区里」判定，深处的牌也算牌堆侧', () => {
  const engine = setup();
  const wide = partitionCandidatesByMingpai(engine, [11, 31, 32, 33]);
  assert.deepEqual([...wide.deckCardIds].sort((a, b) => a - b), [31, 32, 33]);
  assert.deepEqual(wide.handCardIds, [11]);
});

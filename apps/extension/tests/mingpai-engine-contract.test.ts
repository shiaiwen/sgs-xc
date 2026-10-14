import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initCardGraph } from '../src/features/mingpai/graph/card-graph.ts';
import { createGraphMingpaiEngine } from '../src/features/mingpai/graph/graph-engine.ts';
import { MINGPAI_ZONE } from '../src/features/mingpai/mingpai-zones.ts';
import { clearTempZoneGrids } from '../src/features/mingpai/graph/temporary-zone-grid.ts';

function freshEngine() {
  initCardGraph([], '12-255');
  clearTempZoneGrids();
  return createGraphMingpaiEngine(null);
}

test('技能分区可以整体替换、追加、移除与清空', () => {
  const engine = freshEngine();
  engine.setZoneCardIds(MINGPAI_ZONE.YANXI, [11, 12]);
  assert.deepEqual(engine.getZoneCardIds(MINGPAI_ZONE.YANXI), [11, 12]);

  engine.addZoneCardIds(MINGPAI_ZONE.YANXI, [12, 13]);
  assert.deepEqual(engine.getZoneCardIds(MINGPAI_ZONE.YANXI), [11, 12, 13]);

  engine.removeZoneCardIds(MINGPAI_ZONE.YANXI, [12]);
  assert.deepEqual(engine.getZoneCardIds(MINGPAI_ZONE.YANXI), [11, 13]);

  engine.clearZone(MINGPAI_ZONE.YANXI);
  assert.deepEqual(engine.getZoneCardIds(MINGPAI_ZONE.YANXI), []);

  engine.setZoneCardIds(MINGPAI_ZONE.YANXI, [21]);
  engine.setZoneCardIds(MINGPAI_ZONE.YANXI, []);
  assert.deepEqual(engine.getSnapshot().zones[MINGPAI_ZONE.YANXI], undefined);
});

test('技能投影写进 unknown 分区，供权变类面板读取', () => {
  const engine = freshEngine();
  engine.projectSkillCards(MINGPAI_ZONE.YANXI, [31, 32]);
  assert.deepEqual(engine.getZoneCardIds(MINGPAI_ZONE.YANXI), [31, 32]);

  engine.projectSkillCards('custom-zone', [41]);
  assert.deepEqual(engine.getZoneCardIds('custom-zone'), [41]);
});

test('订阅时先给一次当前快照，之后每次状态变化都通知', () => {
  const engine = freshEngine();
  const seen: number[] = [];
  const unsubscribe = engine.subscribe(() => seen.push(1));
  assert.equal(seen.length, 1, '订阅时应立即回调一次');

  engine.observeKnownHandCard(11, 2);
  assert.equal(seen.length, 2);

  // 状态没变就不重复通知。
  const before = seen.length;
  engine.observeKnownHandCard(11, 2);
  assert.equal(seen.length, before);

  unsubscribe();
  engine.observeKnownHandCard(12, 2);
  assert.equal(seen.length, before);
});

test('重连对账：手牌区按场上公开的手牌重建，未公开的老牌不再留在手牌区', () => {
  const engine = freshEngine();
  engine.resetAllCardsToDrawPile([11, 12, 13, 14]);
  engine.observeKnownHandCard(11, 2);
  engine.observeKnownHandCard(12, 2);
  assert.deepEqual(engine.getHandCardIds(2).sort((a, b) => a - b), [11, 12]);

  engine.reconcileVisibleHands([{ seatId: 2, cardIds: [12, 13] }]);
  assert.deepEqual(engine.getHandCardIds(2).sort((a, b) => a - b), [12, 13]);
  assert.deepEqual(engine.getOfficialHandCardIds(2).sort((a, b) => a - b), [12, 13]);
  // 没出现在快照里的 11 不再是「手牌区已确定」。
  assert.equal(engine.getHandCardIds(2).includes(11), false);
});

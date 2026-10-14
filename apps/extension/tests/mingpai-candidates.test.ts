import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CardZone,
  initCardGraph,
  packSlots
} from '../src/features/mingpai/graph/card-graph.ts';
import {
  expandGroupCandidates,
  getGroupLabel,
  getSeatKnownCardIds,
  getSeatPossibleCardIds,
  getSeatUncertainGroups
} from '../src/features/mingpai/graph/mingpai-candidates.ts';
import { clearTempZoneGrids } from '../src/features/mingpai/graph/temporary-zone-grid.ts';

/** 手牌区里摆两张牌，认掉一张，另一张留作未知槽位。 */
function handWithMixedGroup() {
  initCardGraph([101, 102], '5-1');
  clearTempZoneGrids();
  const zone = new CardZone(1, 5);
  zone.show([101]);
  return zone;
}

test('明组展开出可能的具体牌号，未知槽位算「还有未知候选」', () => {
  const zone = handWithMixedGroup();
  const groupKey = packSlots(zone.cards, false);
  assert.ok(groupKey < 0 && groupKey % 2 !== 0, `明组 key 应为负奇数，实际 ${groupKey}`);
  assert.deepEqual([...expandGroupCandidates(groupKey)].sort(), [0, 101].sort());

  const groups = getSeatUncertainGroups(1);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].candidateCardIds, [101]);
  assert.equal(groups[0].hasUnknownCandidate, true);
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].label, '甲');
  assert.deepEqual(getSeatPossibleCardIds(1), [101]);
});

test('暗组只有未知候选，不报成可能牌', () => {
  const zone = handWithMixedGroup();
  const groupKey = packSlots(zone.cards, true);
  assert.ok(groupKey < 0 && groupKey % 2 === 0, `暗组 key 应为负偶数，实际 ${groupKey}`);
  assert.deepEqual(getSeatUncertainGroups(1), []);
  assert.deepEqual(getSeatPossibleCardIds(1), []);
  // 暗组不在明组登记里，标签按组号回落。
  assert.equal(getGroupLabel(groupKey), '甲');
});

test('打包成组后，牌不再算手牌区已确定，而是落到可能牌里', () => {
  const zone = handWithMixedGroup();
  assert.deepEqual(getSeatKnownCardIds(1), [101]);
  packSlots(zone.cards, false);
  assert.deepEqual(getSeatKnownCardIds(1), []);
  assert.deepEqual(getSeatPossibleCardIds(1), [101]);
});

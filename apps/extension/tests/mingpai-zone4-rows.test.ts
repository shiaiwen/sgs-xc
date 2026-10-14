import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CardZone,
  initCardGraph,
  packSlots
} from '../src/features/mingpai/graph/card-graph.ts';
import {
  getZone4Rows,
  parseZone4Key
} from '../src/features/mingpai/graph/mingpai-candidates.ts';
import { clearTempZoneGrids } from '../src/features/mingpai/graph/temporary-zone-grid.ts';

test('技能标记区键按「4-座位-技能号」解析', () => {
  assert.deepEqual(parseZone4Key('4-3-3065'), { seatId: 3, spellId: 3065 });
  assert.deepEqual(parseZone4Key('4-3'), { seatId: 3, spellId: 0 });
  assert.deepEqual(parseZone4Key('4-255-3065'), { seatId: 255, spellId: 3065 });
  assert.equal(parseZone4Key('5-3'), null);
});

test('技能标记行给出手牌之外的确定牌与明组展开出的可能牌', () => {
  initCardGraph([201, 202], '4-3-3065');
  clearTempZoneGrids();
  const zone = new CardZone('4-3-3065');
  zone.show([201]);

  const [row] = getZone4Rows(3);
  assert.equal(row.zoneId, '4-3-3065');
  assert.equal(row.spellId, 3065);
  assert.deepEqual(row.knownCardIds, [201]);
  assert.deepEqual(row.possibleCardIds, []);
  assert.deepEqual(getZone4Rows(4), []);
});

test('技能标记行被整组打包时，具体牌落到可能牌里', () => {
  initCardGraph([201, 202], '4-3-3065');
  clearTempZoneGrids();
  const zone = new CardZone('4-3-3065');
  zone.show([201]);
  packSlots(zone.cards, false);

  const [row] = getZone4Rows(3);
  assert.deepEqual(row.knownCardIds, []);
  assert.deepEqual(row.possibleCardIds, [201]);
  assert.equal(row.uncertainGroups.length, 1);
});

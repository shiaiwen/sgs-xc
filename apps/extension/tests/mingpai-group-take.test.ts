import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CardSlot,
  CardZone,
  getSlotsByKey,
  initCardGraph,
  packSlots
} from '../src/features/mingpai/graph/card-graph.ts';
import {
  getSeatKnownCardIds,
  getSeatPossibleCardIds,
  getSeatUncertainGroups
} from '../src/features/mingpai/graph/mingpai-candidates.ts';
import { clearTempZoneGrids } from '../src/features/mingpai/graph/temporary-zone-grid.ts';

/** 座位 2 手牌区五张全认出来再打成一个明组。 */
function fiveCardGroup(): number {
  initCardGraph([101, 102, 103, 104, 105], '5-2');
  clearTempZoneGrids();
  const zone = new CardZone(2, 5);
  zone.show([101, 102, 103, 104, 105]);
  return packSlots(zone.cards, false);
}

test('明组里的牌被顺走后，不再算原主人的可能牌', () => {
  const groupKey = fiveCardGroup();
  assert.deepEqual(getSeatPossibleCardIds(2).sort((left, right) => left - right), [101, 102, 103, 104, 105]);

  // 顺走：我手里多了一张认出来的 105，原来那组还挂着他。
  const hand = new CardZone(1, 5);
  hand.cards.push(new CardSlot(105, 105, hand.zoneID));

  assert.deepEqual(getSeatKnownCardIds(1), [105]);
  const possible = getSeatPossibleCardIds(2).sort((left, right) => left - right);
  assert.deepEqual(possible, [101, 102, 103, 104]);
  assert.ok(getSlotsByKey(groupKey).length >= 5, '组本身不受影响');
});

test('已经确定在别处的牌不会同时出现在可能牌里', () => {
  const groupKey = fiveCardGroup();
  getSlotsByKey(groupKey).find((slot) => slot.id === 103)?.identify(103);

  const candidates = getSeatUncertainGroups(2).flatMap((group) => group.candidateCardIds);
  assert.ok(!candidates.includes(103), `103 已经是具体牌，不该还在候选里，实际 ${candidates.join(',')}`);
});

test('判定展示区里已经确定的牌，不再算这个座位的可能牌', () => {
  fiveCardGroup();
  // 判定牌 105 在展示区里是明牌。
  const judgeZone = new CardZone(2, 8);
  judgeZone.cards.push(new CardSlot(105, 105, judgeZone.zoneID));

  const possible = getSeatPossibleCardIds(2);
  assert.ok(
    !possible.includes(105),
    `105 已经在判定展示区确定，不该再算可能牌，实际 ${JSON.stringify(possible)}`
  );
});

test('展示五张被顺走一张后：确定牌剩四张，可能牌整行消失', () => {
  const groupKey = fiveCardGroup();
  // 那五张同时也是确定牌，和明组重复登记，就是截图里的样子。
  const zone = new CardZone(2, 5);
  [101, 102, 103, 104].forEach((cardId) => zone.cards.push(new CardSlot(cardId, cardId, zone.zoneID)));
  assert.deepEqual(getSeatKnownCardIds(2), [101, 102, 103, 104]);
  assert.deepEqual(getSeatPossibleCardIds(2), [105]);

  // 顺走 105：我手里认成具体牌号。
  const hand = new CardZone(1, 5);
  hand.cards.push(new CardSlot(105, 105, hand.zoneID));

  assert.deepEqual(getSeatKnownCardIds(2), [101, 102, 103, 104]);
  assert.deepEqual(getSeatPossibleCardIds(2), [], '顺走之后不该还有可能牌');
  assert.deepEqual(getSeatUncertainGroups(2), [], '候选空了，整组不报');
  assert.deepEqual(getSeatKnownCardIds(1), [105]);
  assert.ok(getSlotsByKey(groupKey).length >= 5, '组本身不受影响');
});

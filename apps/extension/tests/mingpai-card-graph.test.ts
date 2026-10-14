import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CardZone,
  findSlotZones,
  getMingpaiCardTags,
  getMingpaiQiOwner,
  getSlotsByKey,
  initCardGraph,
  packSlots,
  rememberMingpaiCardTags,
  rememberMingpaiQiCards,
  retainPersistentMingpaiCardTags,
  syncOfficialMingpaiHandCards,
  unpackSlots,
  moveSlots
} from '../src/features/mingpai/graph/card-graph.ts';

/** 让新开的区域写进 fresh 的图状态。 */
function freshGraph(cardIds: number[], zone = '5-1') {
  initCardGraph(cardIds, zone);
  return new CardZone(1, 5);
}

test('看牌把槽位认成具体牌号，手牌区只列已确定的牌', () => {
  const zone = freshGraph([11, 12, 13]);
  const shown = zone.show([12]);
  assert.equal(shown[0].key, 12);
  assert.deepEqual(CardZone.shoupai(1), [12]);
  assert.equal(zone.length, 3);
});

test('暗牌打包成偶数 key，明牌打包成奇数 key，解锁后恢复原槽位', () => {
  const zone = freshGraph([11, 12, 13]);
  zone.show([11]);
  const before = zone.cards.map((slot) => slot.key).sort((a, b) => a - b);
  assert.deepEqual(before, [0, 0, 11]);

  const hidden = packSlots(zone.cards, true);
  assert.ok(hidden < 0 && hidden % 2 === 0, `暗组 key 应为负偶数，实际 ${hidden}`);
  assert.equal(getSlotsByKey(hidden).length, 3);
  assert.equal(unpackSlots(hidden), false);
  assert.deepEqual(zone.cards.map((slot) => slot.key).sort((a, b) => a - b), [0, 0, 11]);

  const open = packSlots(getSlotsByKey(0).concat(getSlotsByKey(11)), false);
  assert.ok(open < 0 && open % 2 !== 0, `明组 key 应为负奇数，实际 ${open}`);
  // 明组的组尾进了 unknown 区，解锁时 unknown 成员会变，所以要返回 true。
  assert.equal(unpackSlots(open), true);
  assert.deepEqual(zone.cards.map((slot) => slot.key).sort((a, b) => a - b), [0, 0, 11]);
});

test('单个槽位不打包，直接返回它自己的 key', () => {
  freshGraph([11, 12]);
  assert.equal(packSlots(getSlotsByKey(0).slice(0, 1)), 0);
});

test('未知槽位查到的是「?」，已确定的槽位查到所属区域', () => {
  const zone = freshGraph([11, 12]);
  assert.deepEqual(findSlotZones(11).zones, ['?']);
  zone.show([12]);
  assert.deepEqual(findSlotZones(12).zones, ['5-1']);
});

test('炁会沉淀成持久标签，普通标签会在牌离开手牌时掉', () => {
  freshGraph([11]);
  rememberMingpaiCardTags(11, ['来源:杀']);
  assert.deepEqual(getMingpaiCardTags(11), ['来源:杀']);

  rememberMingpaiQiCards(3, [11]);
  assert.equal(getMingpaiQiOwner(11), 3);
  assert.deepEqual(getMingpaiCardTags(11), ['炁']);

  rememberMingpaiCardTags(11, ['来源:顺手牵羊']);
  assert.deepEqual(getMingpaiCardTags(11).sort(), ['来源:顺手牵羊', '炁'].sort());
  assert.deepEqual(retainPersistentMingpaiCardTags(11), ['炁']);

  const slot = getSlotsByKey(0)[0];
  slot.zone = '5-4';
  moveSlots(slot, '2-255');
  assert.deepEqual(getMingpaiCardTags(11), ['炁']);
});

test('没有持久标签的牌在离开公开手牌集合时清空标签', () => {
  freshGraph([21, 22]);
  rememberMingpaiCardTags(21, ['来源:借刀杀人']);
  syncOfficialMingpaiHandCards(2, [21, 22]);
  syncOfficialMingpaiHandCards(2, [22]);
  assert.deepEqual(getMingpaiCardTags(21), []);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seatIsGuozhao } from '../src/features/mingpai/native-mingpai-preview-controller.ts';

/** 郭照的判定牌一律明牌，她手上不再报可能牌，识别武将名是这条规则的前提。 */
test('按武将名认出郭照的座位', () => {
  assert.equal(seatIsGuozhao({ seat: { General: { cardName: '郭照' } } }), true);
  assert.equal(seatIsGuozhao({ seat: { general2: { name: '郭照' } } }), true);
  assert.equal(seatIsGuozhao({ seat: { General: { cardName: '曹丕' } } }), false);
  assert.equal(seatIsGuozhao({ seat: {} }), false);
});

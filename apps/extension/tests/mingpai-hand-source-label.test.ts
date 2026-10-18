import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legacyIncomingHandLabel } from '../src/features/mingpai/rules/legacy-hand-label.ts';

/** 技能表按技能号取名字；这里塞一个最小替身。 */
(globalThis as { jI?: unknown }).jI = { spellDict: { 4: { name: '顺手牵羊' }, 605: { name: '密诏' } } };

const base = {
  spellId: 4,
  moveType: 18,
  fromZone: 5,
  fromId: 2,
  toZone: 5,
  toId: 1,
  selfSeatId: 1,
  seatLabel: (seatId: number) => `${seatId}号位`
};

test('来源是别人的手牌时，标签带上来源座位', () => {
  assert.equal(legacyIncomingHandLabel(base), '[顺手]2号位');
});

test('来源是公共区或自己时不带座位', () => {
  assert.equal(legacyIncomingHandLabel({ ...base, fromId: 0xff }), '[顺手]');
  assert.equal(legacyIncomingHandLabel({ ...base, fromId: 1 }), '[顺手]');
});

test('进别人手牌也标来源，回收区和越界移动不标', () => {
  assert.equal(legacyIncomingHandLabel({ ...base, toId: 3 }), '[顺手]2号位');
  assert.equal(legacyIncomingHandLabel({ ...base, fromZone: 12 }), null);
  assert.equal(legacyIncomingHandLabel({ ...base, moveType: 1 }), null);
  assert.equal(legacyIncomingHandLabel({ ...base, moveType: 255 }), null);
  assert.equal(legacyIncomingHandLabel({ ...base, spellId: 0 }), null);
  assert.equal(legacyIncomingHandLabel({ ...base, spellId: 999999 }), null);
});

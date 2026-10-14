import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  correctMoveCard,
  noteObfuscatedUseSpell,
  resetObfuscatedJudge,
  type MoveJudgeInput
} from '../src/features/mingpai/obfuscated-judge.ts';

/** 7016 / 7017：自己亮出的牌随后暗置进手牌。 */
const SELF_HAND_GAIN = 7016;

const host = {
  myId: 1,
  nationWar: false,
  cardType: () => 1,
  isRedCard: () => null,
  zoneCardIds: () => [],
  handCardIds: () => []
};

function move(partial: Partial<MoveJudgeInput>): MoveJudgeInput {
  return {
    cardCount: 1,
    cardIds: [],
    fromId: 0xff,
    fromZone: 1,
    fromPosition: 0,
    fromZoneParam: 0,
    toId: 1,
    toZone: 5,
    toPosition: 0,
    toZoneParam: 0,
    moveType: 1,
    spellId: 0,
    srcSeatId: 1,
    ...partial
  };
}

test('7016 暗置进手牌时，用自己刚亮出的牌号按顺序补上', () => {
  resetObfuscatedJudge();
  noteObfuscatedUseSpell(SELF_HAND_GAIN, 1, [21, 22], 1, [], 0);

  const first = correctMoveCard(move({
    cardCount: 1, cardIds: [0], spellId: SELF_HAND_GAIN, srcSeatId: 1
  }), host);
  assert.deepEqual(first.cardIds, [21]);

  const second = correctMoveCard(move({
    cardCount: 1, cardIds: [0], spellId: SELF_HAND_GAIN, srcSeatId: 1
  }), host);
  assert.deepEqual(second.cardIds, [22]);
});

test('别人亮出的 7016 不记入自己的补号表', () => {
  resetObfuscatedJudge();
  noteObfuscatedUseSpell(SELF_HAND_GAIN, 2, [31, 32], 1, [], 0);
  const gained = correctMoveCard(move({
    cardCount: 1, cardIds: [0], spellId: SELF_HAND_GAIN, srcSeatId: 1
  }), host);
  assert.deepEqual(gained.cardIds, [0]);
});

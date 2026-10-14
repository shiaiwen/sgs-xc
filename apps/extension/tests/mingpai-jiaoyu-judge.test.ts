import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  correctMoveCard,
  noteObfuscatedSeatColor,
  resetObfuscatedJudge,
  type MoveJudgeInput
} from '../src/features/mingpai/obfuscated-judge.ts';

/** 椒遇：判定牌也按座位颜色回手，技能号由宿主放宽。 */
const JIAOYU = 8801;

const host = {
  myId: 0,
  nationWar: false,
  cardType: () => 1,
  isRedCard: (cardId: number) => cardId === 11,
  zoneCardIds: () => [11],
  handCardIds: () => [],
  isJudgeRecoverySpell: (spellId: number) => spellId === JIAOYU
};

function move(partial: Partial<MoveJudgeInput>): MoveJudgeInput {
  return {
    cardCount: 1,
    cardIds: [],
    fromId: 0,
    fromZone: 1,
    fromPosition: 0,
    fromZoneParam: 0,
    toId: 0,
    toZone: 5,
    toPosition: 0,
    toZoneParam: 0,
    moveType: 1,
    spellId: 0,
    srcSeatId: 0,
    ...partial
  };
}

test('宿主放宽后，椒遇的判定牌也按颜色补回手牌', () => {
  resetObfuscatedJudge();
  noteObfuscatedSeatColor(2, 1);
  correctMoveCard(move({
    cardCount: 1,
    cardIds: [11],
    fromId: 2,
    fromZone: 3,
    toId: 2,
    toZone: 8,
    moveType: 6,
    spellId: JIAOYU,
    srcSeatId: 2
  }), host);
  const gained = correctMoveCard(move({
    cardCount: 1,
    cardIds: [0],
    fromId: 2,
    fromZone: 8,
    toId: 2,
    toZone: 5,
    moveType: 8,
    spellId: JIAOYU,
    srcSeatId: 2
  }), host);
  assert.deepEqual(gained.cardIds, [11]);
});

test('没有放宽的宿主只认 3571，椒遇的判定牌补不回来', () => {
  resetObfuscatedJudge();
  noteObfuscatedSeatColor(2, 1);
  const strictHost = { ...host, isJudgeRecoverySpell: undefined };
  correctMoveCard(move({
    cardCount: 1,
    cardIds: [11],
    fromId: 2,
    fromZone: 3,
    toId: 2,
    toZone: 8,
    moveType: 6,
    spellId: JIAOYU,
    srcSeatId: 2
  }), strictHost);
  const gained = correctMoveCard(move({
    cardCount: 1,
    cardIds: [0],
    fromId: 2,
    fromZone: 8,
    toId: 2,
    toZone: 5,
    moveType: 8,
    spellId: JIAOYU,
    srcSeatId: 2
  }), strictHost);
  assert.deepEqual(gained.cardIds, [0]);
});

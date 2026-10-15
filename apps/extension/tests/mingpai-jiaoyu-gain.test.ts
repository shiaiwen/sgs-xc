import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  correctMoveCard,
  recordJudgeColorGain,
  resetSpellMoveState,
  takeJudgeCardId,
  type MoveJudgeInput
} from '../src/features/mingpai/spell-move-judge.ts';

/** 椒遇：判定牌按座位颜色回手，技能号由宿主放宽。 */
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

test('判定牌进展示区时记下牌号，私有数据不给牌号也能认出来', () => {
  resetSpellMoveState();
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

  assert.equal(takeJudgeCardId(), 11, '展示区里露面的判定牌要能被取出来补号');
  assert.equal(takeJudgeCardId(), null, '取过一次就清掉，不能重复补同一张');
});

test('私有数据只有颜色时，回手照样按展示区里的判定牌补号', () => {
  resetSpellMoveState();
  recordJudgeColorGain(2, [2]);
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
  assert.deepEqual(gained.cardIds, [11], '判定牌必须按确定牌补出来，不能留成可能牌');
});

test('展示区里张数比这次回手多时也要补出牌号', () => {
  resetSpellMoveState();
  const twoCardHost = { ...host, zoneCardIds: () => [11, 12], isRedCard: (cardId: number) => cardId === 11 };
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
  }), twoCardHost);
  assert.equal(gained.cardIds.length, 1);
  assert.ok((gained.cardIds[0] ?? 0) > 0, `张数对不上时也要补出正数牌号：${JSON.stringify(gained.cardIds)}`);
});

test('没有放宽的宿主只认 3571，椒遇的判定牌不补', () => {
  resetSpellMoveState();
  const strictHost = { ...host, isJudgeRecoverySpell: undefined };
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

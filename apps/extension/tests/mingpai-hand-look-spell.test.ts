import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  judgeOptTarget,
  resetSpellMoveState,
  type OptJudgeInput
} from '../src/features/mingpai/spell-move-judge.ts';

/** 谋周瑜醉锋：看别人的手牌。 */
const ZUIFENG = 8802;

function input(partial: Partial<OptJudgeInput>): OptJudgeInput {
  return {
    spellId: ZUIFENG,
    param: 0,
    params: [31, 32],
    cardIds: [],
    srcSeatId: 1,
    targetSeatId: 2,
    optType: null,
    myId: 1,
    mySeats: [1],
    ...partial
  };
}

test('按技能名放行的看手牌技能会记成明牌', () => {
  resetSpellMoveState();
  const reveals = judgeOptTarget(input({
    isHandLookSpell: (spellId: number) => spellId === ZUIFENG
  }));
  assert.equal(reveals.length, 1);
  assert.deepEqual(reveals[0].cardIds, [31, 32]);
  assert.equal(reveals[0].ownerId, 2);
  assert.equal(reveals[0].zone, 'hand');
});

test('名单里没有、名字也认不出的新技能，只要是我发动就看目标手牌', () => {
  resetSpellMoveState();
  const reveals = judgeOptTarget(input({ spellId: 8803 }));
  assert.equal(reveals.length, 1);
  assert.deepEqual(reveals[0].cardIds, [31, 32]);
  assert.equal(reveals[0].ownerId, 2);
});

test('面板提示类技能号走兜底也不显示', () => {
  resetSpellMoveState();
  assert.deepEqual(judgeOptTarget(input({ spellId: 945 })), []);
  assert.deepEqual(judgeOptTarget(input({ spellId: 3440 })), []);
  assert.deepEqual(judgeOptTarget(input({ spellId: 11003 })), []);
});

test('别人发动的看牌不显示', () => {
  resetSpellMoveState();
  assert.deepEqual(judgeOptTarget(input({ srcSeatId: 3 })), []);
});

test('参数里有非正数或目标不是座位时不显示', () => {
  resetSpellMoveState();
  assert.deepEqual(judgeOptTarget(input({ params: [31, 0] })), []);
  assert.deepEqual(judgeOptTarget(input({ targetSeatId: 255 })), []);
  assert.deepEqual(judgeOptTarget(input({ targetSeatId: null })), []);
  assert.deepEqual(judgeOptTarget(input({ params: [] })), []);
});

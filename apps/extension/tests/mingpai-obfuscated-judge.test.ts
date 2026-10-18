import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  correctMoveCard,
  isInPlaceCardShow,
  judgeOptTarget,
  judgeSpellOpt,
  noteSeatCardColor,
  resetSpellMoveState
} from '../src/features/mingpai/spell-move-judge.ts';

const host = {
  myId: 0,
  nationWar: false,
  cardType: () => 1,
  isRedCard: (cardId: number) => cardId === 11,
  zoneCardIds: () => [11],
  handCardIds: () => []
};

function move(partial: Partial<import('../src/features/mingpai/spell-move-judge.ts').MoveJudgeInput>): import('../src/features/mingpai/spell-move-judge.ts').MoveJudgeInput {
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

test('整段看牌记入目标手牌', () => {
  resetSpellMoveState();
  const reveals = judgeOptTarget({
    spellId: 4,
    param: 0,
    params: [11, 12],
    cardIds: [],
    srcSeatId: 0,
    targetSeatId: 1,
    optType: null,
    myId: 0,
    mySeats: [0]
  });
  assert.deepEqual(reveals[0]?.cardIds, [11, 12]);
  assert.equal(reveals[0]?.ownerId, 1);
});

test('目标不是牌堆时，放到牌堆顶的看牌不进手牌', () => {
  resetSpellMoveState();
  const reveals = judgeOptTarget({
    spellId: 0xf3f,
    param: 0,
    params: [1, 0, 21],
    cardIds: [],
    srcSeatId: 0,
    targetSeatId: 1,
    optType: null,
    myId: 0,
    mySeats: [0]
  });
  assert.equal(reveals.length, 0);
});

test('3571 暗置回手时，只补仍在展示区且颜色相符的牌', () => {
  resetSpellMoveState();
  noteSeatCardColor(2, 1);
  correctMoveCard(move({
    cardCount: 1,
    cardIds: [11],
    fromId: 2,
    fromZone: 3,
    toId: 2,
    toZone: 8,
    moveType: 6,
    spellId: 0xdf3,
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
    spellId: 0xdf3,
    srcSeatId: 2
  }), host);
  assert.deepEqual(gained.cardIds, [11]);
});

test('操作回报里展示自己的手牌', () => {
  resetSpellMoveState();
  const reveals = judgeSpellOpt(0xe4b, 0, 1, [8, 9]);
  assert.equal(reveals[0]?.zone, 'hand');
  assert.deepEqual(reveals[0]?.cardIds, [8, 9]);
});

test('3694 放进牌堆的牌不记成明牌，位置改到底', () => {
  resetSpellMoveState();
  const moved = correctMoveCard(move({
    cardCount: 1,
    cardIds: [8],
    fromZone: 0,
    toId: 255,
    toZone: 1,
    toPosition: 0xff01,
    moveType: 0x13,
    spellId: 0xe6e
  }), host);
  assert.equal(moved.toPosition, 0);
  assert.equal(moved.cardIds.some((cardId) => cardId > 0), false);
});

test('3483 从临时区进牌堆时，顶底对调，暗牌不沿用手牌号', () => {
  resetSpellMoveState();
  const moved = correctMoveCard(move({
    cardCount: 1,
    cardIds: [0],
    fromZone: 10,
    toId: 255,
    toZone: 1,
    fromPosition: 0xff02,
    toPosition: 0xff00,
    spellId: 0xd9b
  }), host);
  assert.equal(moved.toPosition, 0);
  assert.equal(moved.cardIds[0], 0);
});

test('普通摸两张没写位置时从牌堆顶摸，写明牌堆底则留在底', () => {
  resetSpellMoveState();
  const omitted = correctMoveCard(move({
    cardCount: 2,
    cardIds: [21, 22],
    fromId: 255,
    toId: 1,
    fromPosition: 0xff02,
    moveType: 1,
    spellId: 0
  }), host);
  assert.equal(omitted.fromPosition, 0xff00);
  const fromBottom = correctMoveCard(move({
    cardCount: 1,
    cardIds: [0],
    fromId: 255,
    toId: 1,
    fromPosition: 0,
    moveType: 1,
    spellId: 0
  }), host);
  assert.equal(fromBottom.fromPosition, 0);
});

test('牌堆上换了位置不算原地展示', () => {
  const shown = isInPlaceCardShow(move({
    fromId: 255,
    toId: 255,
    fromZone: 1,
    toZone: 1,
    fromPosition: 0,
    toPosition: 0xff00,
    cardIds: [3]
  }));
  assert.equal(shown, false);
});

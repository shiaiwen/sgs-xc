import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  correctMoveCard,
  noteSpellShownCards,
  resetSpellMoveState,
  type MoveJudgeInput
} from '../src/features/mingpai/spell-move-judge.ts';
import { createSeatStateStore } from '../src/features/seat-display/seat-state-store.ts';

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
  resetSpellMoveState();
  noteSpellShownCards(SELF_HAND_GAIN, 1, [21, 22], 1, [], 0);

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
  resetSpellMoveState();
  noteSpellShownCards(SELF_HAND_GAIN, 2, [31, 32], 1, [], 0);
  const gained = correctMoveCard(move({
    cardCount: 1, cardIds: [0], spellId: SELF_HAND_GAIN, srcSeatId: 1
  }), host);
  assert.deepEqual(gained.cardIds, [0]);
});

/** 郭照的判定牌是明牌，拿到手就是确定牌，不能同时留在「可能牌」那一栏。 */
test('已经确定在手上的牌，不出现在同一座位的可能牌里', () => {
  const store = createSeatStateStore(null);
  store.replace({
    inGame: true,
    selfSeatId: 2,
    controlledSeatIds: [2],
    mode: 'normal',
    seats: [{
      seatId: 2,
      displayOrder: 1,
      playerName: '郭照',
      isSelf: true,
      isAlive: true,
      knownCards: [],
      equipmentCards: [],
      unknownCardCount: 1
    }]
  } as never);

  // 判定牌 11 先被记成确定牌，随后手牌暗置一次，11 落进可能位置。
  store.mergeKnownHand(2, [11]);
  store.applyHiddenHandMovement({ fromSeatId: 2, toSeatId: 2, wholeHand: false });

  const seat = store.getSnapshot().seats[0];
  assert.deepEqual(seat?.knownCards.map((card) => card.cardId), [11]);
  assert.deepEqual(
    (seat?.possibleCards ?? []).map((card) => card.cardId),
    [],
    '同一张牌不能既是确定牌又是可能牌'
  );
});

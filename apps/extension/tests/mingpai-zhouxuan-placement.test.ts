import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  correctMoveCard,
  noteSpellShownCards,
  resetSpellMoveState,
  type MoveJudgeInput
} from '../src/features/mingpai/spell-move-judge.ts';

/** 周旋：亮出的牌随后暗置到武将牌上。 */
const ZHOUXUAN = 0xbf9;
/** 暗置到武将牌那一支的移动类型。 */
const PLACE_MOVE_TYPE = 0xf;

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
    cardCount: 2,
    cardIds: [],
    fromId: 2,
    fromZone: 5,
    fromPosition: 0,
    fromZoneParam: 0,
    toId: 2,
    toZone: 4,
    toPosition: 0,
    toZoneParam: ZHOUXUAN,
    moveType: PLACE_MOVE_TYPE,
    spellId: ZHOUXUAN,
    srcSeatId: 2,
    ...partial
  };
}

test('周旋亮出的牌暗置到武将牌时，按记录补回牌号', () => {
  resetSpellMoveState();
  noteSpellShownCards(ZHOUXUAN, 2, [31, 32], 1, [], 1);
  const placed = correctMoveCard(move({ cardIds: [0, 0] }), host);
  assert.deepEqual(placed.cardIds, [31, 32]);
});

test('记录用过一次就清掉，第二条同技能移牌不再补号', () => {
  resetSpellMoveState();
  noteSpellShownCards(ZHOUXUAN, 2, [31, 32], 1, [], 1);
  correctMoveCard(move({ cardIds: [0, 0] }), host);
  const again = correctMoveCard(move({ cardIds: [0, 0] }), host);
  assert.deepEqual(again.cardIds, [0, 0]);
});

test('张数对不上或目标区参数不是技能号时不补号', () => {
  resetSpellMoveState();
  noteSpellShownCards(ZHOUXUAN, 2, [31, 32], 1, [], 1);
  const wrongCount = correctMoveCard(move({ cardCount: 1, cardIds: [0] }), host);
  assert.deepEqual(wrongCount.cardIds, [0]);

  resetSpellMoveState();
  noteSpellShownCards(ZHOUXUAN, 2, [31, 32], 1, [], 1);
  const wrongParam = correctMoveCard(move({ cardIds: [0, 0], toZoneParam: 0 }), host);
  assert.deepEqual(wrongParam.cardIds, [0, 0]);
});

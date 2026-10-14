import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CardSlot,
  CardZone,
  initCardGraph
} from '../src/features/mingpai/graph/card-graph.ts';
import {
  applyGraphMove,
  type GraphMoveMessage,
  type GraphMoveState
} from '../src/features/mingpai/graph/move-pipeline.ts';
import { clearTempZoneGrids } from '../src/features/mingpai/graph/temporary-zone-grid.ts';

/** 3483：手牌暂存到技能区，牌堆回手时按 key 换回。 */
const SPELL_3483 = 0xd9b;

function move(partial: Partial<GraphMoveMessage>): GraphMoveMessage {
  return {
    cardCount: 1,
    cardIds: [],
    fromId: 1,
    fromZone: 5,
    fromPosition: 0,
    fromZoneParam: 0,
    toId: 1,
    toZone: 5,
    toPosition: 0,
    toZoneParam: 0,
    moveType: 1,
    spellId: 0,
    ...partial
  };
}

function setup(): GraphMoveState {
  initCardGraph([201, 202], '5-1');
  clearTempZoneGrids();
  const pile = new CardZone(0xff, 1);
  [301, 302, 303].forEach((cardId) => pile.cards.push(new CardSlot(0, cardId, '1-255')));
  return {};
}

test('3483：手牌先进技能区暂存，牌堆顶按回报张数取出', () => {
  const state = setup();

  const toTemp = applyGraphMove(move({
    spellId: SPELL_3483, cardCount: 2, cardIds: [201, 202],
    fromZone: 5, toZone: 10, fromId: 1, toId: 1, moveType: 11
  }), state);
  assert.equal(toTemp.handling, 'zone-move');
  assert.equal(toTemp.moved.length, 2);
  assert.equal(state.spell3483?.handCards.length, 2);
  assert.deepEqual(CardZone.shoupai(1), []);

  const fromPile = applyGraphMove(move({
    spellId: SPELL_3483, cardCount: 2, cardIds: [],
    fromZone: 1, toZone: 10, fromId: 0xff, toId: 1,
    fromPosition: 0xff02, moveType: 19, pilePackCount: 2
  }), state);
  assert.equal(fromPile.handling, 'zone-move');
  assert.equal(fromPile.moved.length, 2);
});

test('3483：牌堆顶进技能区、手牌暂存、技能区回牌堆时建归还计划', () => {
  const state = setup();
  // 牌堆顶一张进技能区。
  applyGraphMove(move({
    spellId: SPELL_3483, cardCount: 1, cardIds: [],
    fromZone: 1, toZone: 10, fromId: 0xff, toId: 1,
    fromPosition: 0xff02, moveType: 19
  }), state);
  // 两张手牌也暂存进去。
  applyGraphMove(move({
    spellId: SPELL_3483, cardCount: 2, cardIds: [201, 202],
    fromZone: 5, toZone: 10, fromId: 1, toId: 1, moveType: 11
  }), state);
  assert.equal(state.spell3483?.handCards.length, 2);

  // 技能区回牌堆：张数与暂存手牌正好补满技能区，于是建出归还计划。
  applyGraphMove(move({
    spellId: SPELL_3483, cardCount: 1, cardIds: [],
    fromZone: 10, toZone: 1, fromId: 1, toId: 0xff,
    fromPosition: 0xff02, moveType: 15
  }), state);
  assert.ok(state.spell3483?.pendingDeckReturn, '应建出归还计划');
});

test('3483：技能区回手牌时按计划把手牌还回，并清空暂存状态', () => {
  const state = setup();
  applyGraphMove(move({
    spellId: SPELL_3483, cardCount: 1, cardIds: [],
    fromZone: 1, toZone: 10, fromId: 0xff, toId: 1,
    fromPosition: 0xff02, moveType: 19
  }), state);
  applyGraphMove(move({
    spellId: SPELL_3483, cardCount: 2, cardIds: [201, 202],
    fromZone: 5, toZone: 10, fromId: 1, toId: 1, moveType: 11
  }), state);
  applyGraphMove(move({
    spellId: SPELL_3483, cardCount: 1, cardIds: [],
    fromZone: 10, toZone: 1, fromId: 1, toId: 0xff,
    fromPosition: 0xff02, moveType: 15
  }), state);
  assert.ok(state.spell3483?.pendingDeckReturn);

  applyGraphMove(move({
    spellId: SPELL_3483, cardCount: 2, cardIds: [],
    fromZone: 10, toZone: 5, fromId: 1, toId: 1, moveType: 11
  }), state);
  assert.equal(state.spell3483, null);
  // 技能区里的牌被计划清空并还回牌堆。
  assert.deepEqual(new CardZone(1, 10).cards, []);
});

test('3483：暂存的手牌从技能区回到手牌后，暂存状态清空', () => {
  const state = setup();
  applyGraphMove(move({
    spellId: SPELL_3483, cardCount: 2, cardIds: [201, 202],
    fromZone: 5, toZone: 10, fromId: 1, toId: 1, moveType: 11
  }), state);
  assert.ok(state.spell3483);

  applyGraphMove(move({
    spellId: SPELL_3483, cardCount: 2, cardIds: [],
    fromZone: 10, toZone: 5, fromId: 1, toId: 1, moveType: 11
  }), state);
  assert.equal(state.spell3483, null);
  assert.deepEqual(CardZone.shoupai(1).sort((a, b) => a - b), [201, 202]);
});

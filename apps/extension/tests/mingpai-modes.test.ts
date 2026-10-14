import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isInitialPileLoad, remapDrawPileFromPosition, type MoveCardFields } from '../src/features/mingpai/rules/move-card-rules.ts';
import { DRAW_PILE_POSITION } from '../src/features/mingpai/rules/reveal-types.ts';
import { isNationWarMode, resolveGameMode, type GameMode } from '../src/features/seat-display/seat-state.ts';

const MODES: readonly GameMode[] = [
  'identity', 'nation-war', 'doudizhu', 'rogue', 'rogue-1v1', 'swjg', 'spectator', 'unknown'
];

function move(partial: Partial<MoveCardFields>): MoveCardFields {
  return {
    cardCount: 1,
    cardIds: [1],
    fromId: 0xff,
    fromZone: 1,
    fromPosition: DRAW_PILE_POSITION.UNSPECIFIED,
    toId: 1,
    toZone: 5,
    toPosition: 0,
    moveType: 1,
    spellId: 7016,
    ...partial
  };
}

test('场景标记能区分多种模式，国战优先于其他玩法', () => {
  assert.equal(resolveGameMode({}), 'identity');
  assert.equal(resolveGameMode({ doudizhu: true }), 'doudizhu');
  assert.equal(resolveGameMode({ rogue: true }), 'rogue');
  assert.equal(resolveGameMode({ rogue1v1: true }), 'rogue-1v1');
  assert.equal(resolveGameMode({ swjg: true }), 'swjg');
  assert.equal(resolveGameMode({ nationWar: true, doudizhu: true }), 'nation-war');
  assert.equal(resolveGameMode({ spectating: true, nationWar: true }), 'spectator');
});

test('只有国战关闭 7016/7017 的牌堆顶纠偏', () => {
  for (const mode of MODES) {
    const position = remapDrawPileFromPosition(move({}), { nationWar: isNationWarMode(mode) });
    if (mode === 'nation-war') assert.equal(position, DRAW_PILE_POSITION.UNSPECIFIED, mode);
    else assert.equal(position, DRAW_PILE_POSITION.TOP, mode);
  }
});

test('开局洗入牌堆顶不算明牌', () => {
  assert.equal(isInitialPileLoad({
    fromZone: 0,
    toZone: 1,
    moveType: 19,
    toPosition: DRAW_PILE_POSITION.TOP
  }), true);
  assert.equal(isInitialPileLoad({
    fromZone: 5,
    toZone: 1,
    moveType: 19,
    toPosition: DRAW_PILE_POSITION.TOP
  }), false);
});

test('四张类型 8 的特殊摸牌在各模式都不计入牌堆顶底', () => {
  const delayed = move({
    spellId: 0,
    cardCount: 4,
    cardIds: [11, 12, 13, 14],
    fromPosition: DRAW_PILE_POSITION.TOP + 1
  });
  for (const mode of MODES) {
    const position = remapDrawPileFromPosition(delayed, {
      nationWar: isNationWarMode(mode),
      cardType: () => 8
    });
    assert.equal(position, DRAW_PILE_POSITION.UNSPECIFIED, mode);
  }
});

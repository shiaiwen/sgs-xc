import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMingpaiEngine } from '../src/features/mingpai/mingpai-engine.ts';

const HAND_MOVE = {
  cardCount: 1,
  fromId: 1,
  fromZone: 5,
  fromPosition: 0,
  fromZoneParam: 0,
  toId: 0xff,
  toZone: 2,
  toPosition: 0,
  toZoneParam: 0
};

function tagsOf(engine: ReturnType<typeof createMingpaiEngine>, cardId: number): readonly string[] {
  return engine.getSnapshot().records.find((record) => record.cardId === cardId)?.tags ?? [];
}

test('粘性标签跟着牌走，普通标签在离开手牌时掉', () => {
  const engine = createMingpaiEngine(null);
  engine.observeKnownHandCard(11, 1, []);
  engine.rememberPersistentCardTag(11, '心幽');
  engine.rememberPersistentCardTag(11, '顺手');
  assert.deepEqual(engine.getPersistentTags(11), ['心幽']);
  assert.ok(tagsOf(engine, 11).includes('顺手'));

  engine.applyMovement({ ...HAND_MOVE, cardIds: [11] }, [11]);
  assert.deepEqual(engine.getPersistentTags(11), ['心幽']);
  assert.ok(tagsOf(engine, 11).includes('心幽'));
  assert.equal(tagsOf(engine, 11).includes('顺手'), false);
});

test('炁记下原本属于哪个座位', () => {
  const engine = createMingpaiEngine(null);
  engine.observeKnownHandCard(21, 2, []);
  engine.rememberPersistentCardTag(21, '炁', 2);
  assert.equal(engine.getOriginalOwnerSeatId(21), 2);
  assert.deepEqual(engine.getPersistentTags(21), ['炁']);
});

test('离开官方公开手牌集合的牌回收普通标签', () => {
  const engine = createMingpaiEngine(null);
  engine.observeKnownHandCard(31, 3, ['顺手']);
  engine.syncOfficialHand(3, [31]);
  assert.ok(tagsOf(engine, 31).includes('顺手'));

  engine.syncOfficialHand(3, []);
  assert.equal(tagsOf(engine, 31).includes('顺手'), false);
});

test('清空引擎时标签一起清掉', () => {
  const engine = createMingpaiEngine(null);
  engine.observeKnownHandCard(41, 4, []);
  engine.rememberPersistentCardTag(41, '心幽');
  engine.clear();
  assert.deepEqual(engine.getPersistentTags(41), []);
  assert.equal(engine.getOriginalOwnerSeatId(41), null);
});

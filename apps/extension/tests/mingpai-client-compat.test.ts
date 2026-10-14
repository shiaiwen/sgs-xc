import assert from 'node:assert/strict';
import { test } from 'node:test';
import { translateGameMessages } from '../src/adapters/game-message-adapter.ts';
import { readShownHandEntries } from '../src/features/seat-display/seat-game-adapter.ts';

const moveFields = {
  CardCount: 1,
  MoveType: 1,
  CardIDs: [41],
  FromZone: 1,
  ToZone: 5,
  ToID: 2,
  FromID: 0,
  SpellID: 0
};

test('网页端移牌和看牌字段在 ProtoObj 里也能翻成明牌事件', () => {
  const moved = translateGameMessages([{
    ClassName: 'PubGsCMoveCard',
    ProtoObj: moveFields
  }]);
  assert.equal(moved[0]?.type, 'cards-moved');
  if (moved[0]?.type === 'cards-moved') assert.deepEqual(moved[0].cardIds, [41]);

  const looked = translateGameMessages([{
    ClassName: 'GsCRoleOptTargetNtf',
    Data: { ProtoObj: { SpellID: 12, SeatID: 3, Params: [1, 2] } }
  }]);
  assert.equal(looked[0]?.type, 'opt-target');
  if (looked[0]?.type === 'opt-target') assert.deepEqual(looked[0].params, [1, 2]);
});

test('网页端外层空牌号列表时仍读 ProtoObj 里的弃牌', () => {
  const moved = translateGameMessages([{
    ClassName: 'PubGsCMoveCard',
    CardIDs: [],
    ProtoObj: {
      CardCount: 2,
      MoveType: 1,
      CardIDs: { 0: 11, 1: 12, length: 2 },
      FromZone: 5,
      FromID: 1,
      ToZone: 2,
      ToID: 0
    }
  }]);
  assert.equal(moved[0]?.type, 'cards-moved');
  if (moved[0]?.type !== 'cards-moved') return;
  assert.deepEqual(moved[0].cardIds, [11, 12]);
  assert.equal(moved[0].toZone, 2);
  assert.equal(moved[0].toId, 0xff);
});

test('微端移牌和队友手牌字段在 data.protoObj 里也能翻成明牌事件', () => {
  const moved = translateGameMessages([{
    ClassName: 'PubGsCMoveCard',
    data: { protoObj: moveFields }
  }]);
  assert.equal(moved[0]?.type, 'cards-moved');
  if (moved[0]?.type === 'cards-moved') assert.equal(moved[0].toId, 2);

  const tags = translateGameMessages([{
    ClassName: 'ClientHappyGetFriendHandcardRep',
    data: { protoObj: { error_id: 0, seat_id: 1, card_list: [7, 8] } }
  }]);
  assert.equal(tags[0]?.type, 'friend-hand-tags-updated');
  if (tags[0]?.type === 'friend-hand-tags-updated') assert.deepEqual(tags[0].cardIds, [7, 8]);
});

test('网页端有展示牌面时不叠只增不减的卡号，空列表仍读卡号', () => {
  const bridge = (globalThis as { electron?: { openExternal?: unknown } }).electron;
  delete (globalThis as { electron?: unknown }).electron;
  const withFaces = readShownHandEntries({
    HandShowCards: [{ CardId: 3 }],
    HandShowCardIDs: [3, 9]
  });
  assert.deepEqual(withFaces.map((card) => (card as { CardId: number }).CardId), [3]);
  const idsOnly = readShownHandEntries({
    HandShowCards: [],
    HandShowCardIDs: [9]
  });
  assert.deepEqual(idsOnly, [9]);
  if (bridge) (globalThis as { electron?: unknown }).electron = bridge;
});

test('微端观星卡号和牌面列表一起读', () => {
  const previous = (globalThis as { electron?: unknown }).electron;
  (globalThis as { electron?: { openExternal: () => void } }).electron = { openExternal: () => undefined };
  try {
    const shown = readShownHandEntries({
      HandShowCards: [],
      HandShowCardIDs: [15, 16]
    });
    assert.deepEqual(shown, [15, 16]);
  } finally {
    if (previous) (globalThis as { electron?: unknown }).electron = previous;
    else delete (globalThis as { electron?: unknown }).electron;
  }
});

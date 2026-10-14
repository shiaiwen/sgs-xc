import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameEventBus } from '../src/runtime/game-event-bus.ts';
import { createSeatStateStore } from '../src/features/seat-display/seat-state-store.ts';
import { installMingpaiController } from '../src/features/mingpai/mingpai-controller.ts';

globalThis.window = {} as Window & typeof globalThis;

test('断线重连丢掉标签，按整副牌重建并用公开手牌归位', () => {
  const store = createSeatStateStore(null);
  const events = createGameEventBus();
  const controller = installMingpaiController(store, events);
  events.publish({ type: 'card-list-ready', cardIds: [1, 2, 3, 4, 5] });
  store.replace({
    inGame: true,
    seats: [{
      seatId: 1, displayOrder: 0, playerName: '', isSelf: false, isAlive: true,
      anchor: null, unknownCardCount: 0,
      knownCards: [{ cardId: 3, name: '', tags: [] }]
    }]
  });
  controller.engine.rememberPersistentCardTag(3, '心幽');
  assert.deepEqual(controller.engine.getPersistentTags(3), ['心幽']);
  assert.deepEqual(controller.engine.getHandCardIds(1), [3]);

  events.publish({ type: 'game-reconnected' });
  assert.deepEqual(controller.engine.getPersistentTags(3), []);
  assert.deepEqual(controller.engine.getHandCardIds(1), [3]);
  // 没露过面的牌在重连后是「位置未知」，不是「不存在」。
  assert.deepEqual(controller.engine.findKZ(1).zones, ['unknown']);
  controller.dispose();
});

test('开局总牌表到达后牌位图知道整副牌的组成', () => {
  const store = createSeatStateStore(null);
  const events = createGameEventBus();
  const controller = installMingpaiController(store, events);
  events.publish({ type: 'game-started' });
  events.publish({ type: 'card-list-ready', cardIds: [7, 8, 9] });
  assert.deepEqual(controller.engine.getSnapshot().records, []);
  assert.equal(controller.engine.getSnapshot().zones.unknown, undefined);
  controller.dispose();
});

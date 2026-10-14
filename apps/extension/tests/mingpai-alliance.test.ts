import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameEventBus } from '../src/runtime/game-event-bus.ts';
import { createSeatStateStore } from '../src/features/seat-display/seat-state-store.ts';
import { installMingpaiController } from '../src/features/mingpai/mingpai-controller.ts';

globalThis.window = {} as Window & typeof globalThis;

for (const reverse of [false, true]) {
  test(`缔盟双向暗牌交换保留原明牌归属，反向顺序=${reverse}`, () => {
    const store = createSeatStateStore(null);
    const events = createGameEventBus();
    const controller = installMingpaiController(store, events);
    const seats = [1, 2].map((seatId) => ({
      seatId, displayOrder: seatId, playerName: String(seatId), isSelf: false,
      isAlive: true, anchor: null, unknownCardCount: 2,
      knownCards: [{ cardId: seatId * 10, name: '', tags: [] }]
    }));
    store.replace({ inGame: true, seats });
    const order = reverse ? [2, 1] : [1, 2];
    for (const fromId of order) {
      events.publish({
        type: 'cards-moved', fromId, toId: fromId, fromZone: 5, toZone: 10,
        fromPosition: 0, toPosition: 0, fromZoneParam: 0, toZoneParam: 0,
        cardCount: 3, cardIds: [], moveType: 11, spellId: 121
      });
    }
    for (const fromId of order) {
      events.publish({
        type: 'cards-moved', fromId, toId: 3 - fromId, fromZone: 10, toZone: 5,
        fromPosition: 65282, toPosition: 65280, fromZoneParam: 0, toZoneParam: 0,
        cardCount: 3, cardIds: [], moveType: 11, spellId: 121
      });
    }
    // 场景轮询仍返回旧明牌时，也不能把已经转出的牌填回来源座位。
    store.replace({ inGame: true, seats });
    for (const seatId of [1, 2]) {
      assert.deepEqual(controller.engine.getHandCardIds(seatId), [(3 - seatId) * 10]);
      assert.deepEqual(store.getSnapshot().seats.find((seat) => seat.seatId === seatId)
        ?.knownCards.map((card) => card.cardId), [(3 - seatId) * 10]);
    }
    controller.dispose();
  });
}

test('实机缔盟：八张手牌中四张明牌经临时区交给四张暗牌的座位', () => {
  const store = createSeatStateStore(null);
  const events = createGameEventBus();
  const controller = installMingpaiController(store, events);
  const known = [107, 96, 73, 119];
  store.replace({ inGame: true, seats: [2, 3].map((seatId) => ({
    seatId, displayOrder: seatId + 1, playerName: '', isSelf: false, isAlive: true,
    anchor: null, unknownCardCount: seatId === 2 ? 8 : 4,
    knownCards: seatId === 2 ? known.map(cardId => ({ cardId, name: '', tags: [] })) : []
  })) });
  for (const [fromId, fromZone, toId, toZone, cardCount] of [
    [2, 5, 2, 10, 8], [3, 5, 3, 10, 4], [3, 10, 2, 5, 4], [2, 10, 3, 5, 8]
  ]) {
    events.publish({ type: 'cards-moved', fromId, fromZone, toId, toZone, cardCount,
      cardIds: [], spellId: 121, moveType: 11, fromPosition: 65282,
      toPosition: 65280, fromZoneParam: 0, toZoneParam: 0 });
  }
  assert.deepEqual(controller.engine.getHandCardIds(2), []);
  assert.deepEqual(controller.engine.getHandCardIds(3), known);
  assert.deepEqual(store.getSnapshot().seats.find(s => s.seatId === 3)?.knownCards.map(c => c.cardId), known);
  controller.dispose();
});

test('顺手牵羊的类型18不能被当成缔盟整手转移', () => {
  const store = createSeatStateStore(null);
  const events = createGameEventBus();
  const controller = installMingpaiController(store, events);
  store.replace({ inGame: true, seats: [1, 2].map(seatId => ({
    seatId, displayOrder: seatId, playerName: '', isSelf: false, isAlive: true,
    anchor: null, unknownCardCount: 3,
    knownCards: seatId === 1 ? [{ cardId: 107, name: '', tags: [] }] : []
  })) });
  events.publish({ type: 'cards-moved', fromId: 1, toId: 2, fromZone: 5, toZone: 5,
    cardCount: 1, cardIds: [], spellId: 4, moveType: 18, fromPosition: 65282,
    toPosition: 65280, fromZoneParam: 0, toZoneParam: 0 });
  assert.deepEqual(store.getSnapshot().seats.find(s => s.seatId === 2)?.knownCards, []);
  controller.dispose();
});

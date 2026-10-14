import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameEventBus } from '../src/runtime/game-event-bus.ts';
import { createSeatStateStore } from '../src/features/seat-display/seat-state-store.ts';
import { installMingpaiController, JIAOYU_TAG } from '../src/features/mingpai/mingpai-controller.ts';
import { clearTempZoneGrids } from '../src/features/mingpai/graph/temporary-zone-grid.ts';

const SEAT = 2;
const JIAOYU = 8801;

(globalThis as Record<string, unknown>).window = {
  __XIAOCHAO_GAME_SCENE__: {
    seatContainer: { seatUIs: [] },
    spellDict: { [String(JIAOYU)]: { id: JIAOYU, name: '椒遇' } }
  }
};

/** 椒遇收来的判定牌要带「椒遇」标签，牌打出去后标签去掉。 */
test('判定牌收进手牌时打上椒遇标签，牌用掉后去掉', () => {
  clearTempZoneGrids();
  const store = createSeatStateStore(null);
  const bus = createGameEventBus();
  const { engine } = installMingpaiController(store, bus, {
    isRedCard: (cardId: number) => cardId === 11,
    cardType: () => 1
  });
  bus.publish({ type: 'game-started' });
  bus.publish({ type: 'card-list-ready', cardIds: [11, 12, 13] });
  store.replace({
    inGame: true,
    selfSeatId: SEAT,
    controlledSeatIds: [SEAT],
    mode: 'normal',
    seats: [{
      seatId: SEAT,
      displayOrder: 1,
      playerName: '郭照',
      isSelf: true,
      isAlive: true,
      knownCards: [],
      equipmentCards: [],
      unknownCardCount: 1
    }]
  } as never);

  // 判定牌先公开进展示区，椒遇再把它收进手牌。
  bus.publish({
    type: 'cards-moved',
    cardCount: 1,
    cardIds: [11],
    fromId: SEAT,
    fromZone: 3,
    fromPosition: 0,
    fromZoneParam: 0,
    toId: SEAT,
    toZone: 8,
    toPosition: 0,
    toZoneParam: 0,
    moveType: 6,
    spellId: JIAOYU,
    srcSeatId: SEAT
  });
  bus.publish({
    type: 'cards-moved',
    cardCount: 1,
    cardIds: [11],
    fromId: SEAT,
    fromZone: 8,
    fromPosition: 0,
    fromZoneParam: 0,
    toId: SEAT,
    toZone: 5,
    toPosition: 0,
    toZoneParam: 0,
    moveType: 8,
    spellId: JIAOYU,
    srcSeatId: SEAT
  });

  assert.ok(
    engine.getPersistentTags(11).includes(JIAOYU_TAG),
    `收到的判定牌要带椒遇标签，实际 ${JSON.stringify(engine.getPersistentTags(11))}`
  );

  bus.publish({ type: 'cards-used', seatId: SEAT, cardIds: [11], source: 'use-card', useType: 1, isSend: false });
  assert.equal(
    engine.getPersistentTags(11).includes(JIAOYU_TAG),
    false,
    '牌用掉后椒遇标签要去掉'
  );
});

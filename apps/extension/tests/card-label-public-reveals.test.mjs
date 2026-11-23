import assert from 'node:assert/strict';
import test from 'node:test';
import { translateGameMessages } from '../src/adapters/game-message-adapter.ts';
import { installCardLabelController } from '../src/features/cards/card-label-controller.ts';
import { createPublicCardOrigins } from '../src/features/cards/public-card-origins.ts';
import { installMingpaiController } from '../src/features/mingpai/mingpai-controller.ts';
import { createGameEventBus } from '../src/runtime/game-event-bus.ts';

function move(cardIds, overrides = {}) {
  return {
    type: 'cards-moved', cardIds, cardCount: cardIds.length,
    fromId: 0, fromZone: 5, fromPosition: 0, fromZoneParam: 0,
    toId: 0, toZone: 5, toPosition: 0, toZoneParam: 0,
    moveType: 21, spellId: 0, ...overrides
  };
}

test('公开展示才给原地手牌加标签，并保留已有来源', (t) => {
  const cardUis = [21, 22, 23, 24].map((id) => ({
    Card: { CardId: id },
    getCardTagBtn: () => ({}),
    addDrawChild(button) { this.labelButton = button; },
    removeDrawChild() { delete this.labelButton; }
  }));
  const events = createGameEventBus();
  let refresh;
  const host = {
    setTimeout(callback, delay) { if (delay === 0) refresh = callback; return 1; },
    clearTimeout() {},
    __XIAOCHAO_GAME_SCENE__: {
      seatContainer: { seatUIs: [] },
      SelfSeatUi: { seat: {}, cardContainer: { cardUis } }
    }
  };
  const labels = installCardLabelController(
    { get: () => true, subscribe: () => () => {} }, host, events, { getCard: () => null }
  );
  t.after(() => labels.dispose());
  const record = (event, source = null) => labels.recordMovement(event, event.cardIds, 0, source);

  record(move([21], { fromZone: 1, fromId: 255, moveType: 1, spellId: 7 }), '[无中]');
  refresh();
  assert.equal(cardUis[0].labelButton, undefined);

  record(move([21], { spellId: 83 }));
  record(move([22], { fromId: 1, moveType: 18, spellId: 4 }), '[顺手]来源');
  record(move([22], { moveType: 6 }));
  record(move([23], { spellId: 12345 }));
  events.publish({ type: 'hand-cards-revealed', seatId: 0, cardIds: [24] });
  refresh();
  assert.equal(cardUis[0].labelButton?.label, '[明牌]');
  assert.equal(cardUis[1].labelButton?.label, '[顺手]来源');
  assert.equal(cardUis[2].labelButton, undefined);
  assert.equal(cardUis[3].labelButton, undefined);

  record(move([21], { toZone: 2, toId: 255, moveType: 4 }));
  refresh();
  assert.equal(cardUis[0].labelButton, undefined);
});

test('五谷展示后按牌号关联入手，技能区的私有看牌不关联', () => {
  const origins = createPublicCardOrigins();
  const display = (ids, spellId) => move(ids, {
    fromZone: 1, fromId: 255, toZone: 8, toId: 1, toZoneParam: spellId, spellId
  });
  const take = (ids, pool, overrides) => move(ids, {
    fromZone: 8, fromId: 1, fromZoneParam: pool, moveType: 18, ...overrides
  });
  const observe = (event) => [...origins.observe(event, event.cardIds)];

  observe(display([31, 32], 6));
  observe(display([33], 12345));
  assert.deepEqual(observe(take([31], 6, { spellId: 6 })), [31]);
  assert.deepEqual(observe(take([32], 6)), [32]);
  assert.deepEqual(observe(take([33], 12345)), []);
  assert.deepEqual(observe(take([34], 6, { spellId: 6 })), []);

  observe(display([35], 6));
  observe(take([35], 6, { toZone: 1, toId: 255 }));
  assert.deepEqual(observe(move([35], { fromZone: 1, fromId: 255, moveType: 1 })), []);
});

test('节言公开摸牌和捷悟原地亮牌通过移牌消息上标签', (t) => {
  const cardUis = [51, 52, 53, 54, 55].map((id) => ({
    Card: { CardId: id },
    getCardTagBtn: () => ({}),
    addDrawChild(button) { this.labelButton = button; }
  }));
  const noOp = () => {};
  const callbacks = [];
  const host = {
    setTimeout(fn, delay) { if (delay === 0) callbacks.push(fn); return 1; },
    clearTimeout: noOp,
    __XIAOCHAO_GAME_SCENE__: {
      seatContainer: { seatUIs: [] }, SelfSeatUi: { seat: {}, cardContainer: { cardUis } }
    }
  };
  const previousWindow = globalThis.window;
  globalThis.window = host;
  const events = createGameEventBus();
  const labels = installCardLabelController(
    { get: () => true, subscribe: () => noOp }, host, events, { getCard: () => null }
  );
  const mingpai = installMingpaiController({
    getSnapshot: () => ({ selfSeatId: 0, seats: [], controlledSeatIds: [] }),
    subscribe: () => noOp,
    applyKnownHandMovement: noOp,
    applyHiddenHandMovement: noOp,
    mergeKnownHand: noOp,
    revealKnownHand: noOp
  }, events, { onCardLabelMovement: labels.recordMovement });
  t.after(() => {
    mingpai.dispose();
    labels.dispose();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const receive = (cardId, fields) => {
    const payload = {
      ClassName: 'PubGsCMoveCard', CardCount: 1, CardIDs: [cardId],
      FromID: 0, FromZone: 5, ToZone: 5, ToID: 0, ...fields
    };
    for (const event of translateGameMessages([payload])) events.publish(event);
  };

  receive(51, { FromZone: 1, FromID: 255, SpellID: 3638, MoveType: 1 });
  receive(52, { SpellID: 3659, MoveType: 21 });
  receive(53, { SpellID: 3659, MoveType: 0 });
  receive(54, { SpellID: 3659, MoveType: 21, IsSend: true });
  events.publish({ type: 'spell-opt-rep', seatId: 0, spellId: 3659, optType: 61, datas: [55] });
  while (callbacks.length) callbacks.shift()();
  assert.deepEqual(cardUis.map((ui) => ui.labelButton?.label), ['[节言]', '[捷悟]', '[捷悟]', undefined, undefined]);
});

test('无中摸牌和手牌重排保留来源、镜花和水月，牌离手或技能移除才清掉', (t) => {
  function makeUi(id) {
    const childs = [];
    return {
      Card: { CardId: id }, isFlat: true,
      textureContainer: {
        childs,
        removeDrawChild(button) { childs.splice(childs.indexOf(button), 1); }
      },
      getCardTagBtn: () => ({}),
      addDrawChild(button) { childs.push(button); },
      layoutTagUI() {},
      Clear() { childs.length = 0; }
    };
  }
  const [source, mirror, moon, drawn] = [41, 42, 43, 44].map(makeUi);
  const outside = new Map([[3640, [moon.Card]]]);
  const states = new Map([[36391, { Value: 1, Targets: [42] }]]);
  const seat = {
    SeatStateDic: { getNumberKey: (id) => states.get(id) },
    GetSkillOutsideCards: (id) => outside.get(id),
    ClearSkillOutsideCards(id) { outside.delete(id); },
    UpdateState(id, value, targets) { states.set(id, { Value: value, Targets: targets }); }
  };
  mirror.cardTagBtn3 = { label: '镜花', visible: true };
  const cardContainer = { cardUis: [source, mirror, moon], layoutHandCard() {}, skillOrStateDataChange() {} };
  let deferred;
  const host = {
    setTimeout(fn, delay) { if (delay === 0) deferred = fn; return 1; },
    clearTimeout() {},
    __XIAOCHAO_GAME_SCENE__: {
      seatContainer: { seatUIs: [] }, SelfSeatUi: { seat, cardContainer }
    }
  };
  const labels = installCardLabelController(
    { get: () => true, subscribe: () => () => {} }, host, createGameEventBus(), { getCard: () => null }
  );
  t.after(() => labels.dispose());
  const text = (ui) => ui.textureContainer.childs.filter((button) => button.visible).map((button) => button.label);

  labels.recordMovement(move([41], { fromId: 1, moveType: 18, spellId: 4 }), [41], 0, '[顺手]A');
  deferred();
  const sourceButton = source.textureContainer.childs[0];
  assert.deepEqual(text(mirror), []);
  assert.deepEqual(text(moon), ['水月']);

  // 无中只给出新牌号和暗牌占位，牌堆推算结果可能包含旧牌号。
  labels.recordMovement(move([44, 0], { fromZone: 1, fromId: 255, moveType: 1, spellId: 7 }), [44, 41], 0, '[无中]');
  source.textureContainer.childs.length = 0;
  mirror.cardTagBtn3.visible = false;
  moon.Clear();
  cardContainer.cardUis.push(drawn);
  cardContainer.layoutHandCard();
  assert.equal(source.textureContainer.childs[0], sourceButton);
  assert.deepEqual(text(source), ['[顺手]A']);
  assert.deepEqual(text(mirror), ['镜花']);
  assert.deepEqual(text(moon), ['水月']);
  assert.deepEqual(text(drawn), []);
  deferred();
  assert.equal(source.textureContainer.childs[0], sourceButton);

  mirror.cardTagBtn3.visible = true;
  mirror.layoutTagUI();
  assert.deepEqual(text(mirror), []);

  // 新版座位状态是权威来源，也会在未触发手牌重排时主动刷新；旧技能牌名单可能滞后。
  mirror.cardTagBtn3.visible = false;
  outside.set(3639, [mirror.Card]);
  seat.UpdateState(36391, 0, []);
  cardContainer.skillOrStateDataChange();
  assert.deepEqual(text(mirror), []);
  seat.UpdateState(36401, 1, [42]);
  cardContainer.skillOrStateDataChange();
  assert.deepEqual(text(mirror), ['水月']);
  assert.deepEqual(text(moon), []);

  seat.UpdateState(36401, 0, []);
  seat.ClearSkillOutsideCards(3640);
  labels.recordMovement(move([41], { toZone: 2, toId: 255, moveType: 4 }), [41], 0, null);
  deferred();
  assert.deepEqual(text(source), []);
  assert.deepEqual(text(moon), []);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameEventBus } from '../src/runtime/game-event-bus.ts';
import { installShanhetuWuxieController } from '../src/features/shanhetu/shanhetu-wuxie-controller.ts';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('card list identifies Shanhetu and cancels only enabled Wuxie prompts', async () => {
  let barClicks = 0;
  let selectorClicks = 0;
  const cancelButton = { name: 'btnCancel', _enabled: true, onClick() { barClicks++; } };
  const bar = { visible: true, btns: [cancelButton], Show() {}, Update() {} };
  const selector = {
    visible: false,
    btnList: [{ _enabled: true, data: { sendData: 255 } }],
    btnClick() { selectorClicks++; },
    Show() {}, UpdateBtnState() {}
  };
  const context = { SpecifySkillId: 13 };
  const self = { buttonBar: bar, spellSelector: selector, cardContainer: { selectCardContext: context }, StartSelectSkillItem() {} };
  const scene = { SceneName: 'TableScene', SelfSeatUi: self };
  const locator = { gameScene: () => scene, scene: () => scene, gameContext: () => null };
  const events = createGameEventBus();
  const host = { setTimeout, clearTimeout };
  const stop = installShanhetuWuxieController(
    { get: () => true },
    { globalObject: host, locator, gameEvents: events }
  );
  try {
    events.publish({ type: 'card-list-ready', cardIds: [1, 2] });
    await wait(350);
    assert.equal(barClicks, 0, '普通模式不能取消无懈');

    events.publish({ type: 'card-list-ready', cardIds: [1, 20100] });
    await wait(50);
    assert.equal(barClicks, 1, '山河图卡表应允许取消');

    context.SpecifySkillId = 0;
    await wait(300);
    context.SpecifySkillId = 13;
    cancelButton._enabled = false;
    bar.Show();
    await wait(50);
    assert.equal(barClicks, 1, '按钮禁用时不能点击');

    cancelButton._enabled = true;
    bar.Update();
    await wait(50);
    assert.equal(barClicks, 2, '按钮重新可用后点击');

    context.SpecifySkillId = 0;
    selector.visible = true;
    selector.spell = { SkillId: 13 };
    selector.Show();
    await wait(50);
    assert.equal(selectorClicks, 1, '选项弹窗应点取消选项');

    events.publish({ type: 'card-list-ready', cardIds: [1, 2] });
    selector.Show();
    await wait(50);
    assert.equal(selectorClicks, 1, '切回普通模式后不能点击');
  } finally {
    stop();
  }
});

test('binds the operation bar when it appears after the seat UI', async () => {
  let clicks = 0;
  const self = { cardContainer: { selectCardContext: { SpecifySkillId: 0 } }, StartSelectSkillItem() {} };
  const scene = { SceneName: 'TableScene', SelfSeatUi: self };
  const events = createGameEventBus();
  const stop = installShanhetuWuxieController(
    { get: () => true },
    {
      globalObject: { setTimeout, clearTimeout },
      locator: { gameScene: () => scene, scene: () => scene, gameContext: () => null },
      gameEvents: events
    }
  );
  try {
    events.publish({ type: 'card-list-ready', cardIds: [20100] });
    await wait(300);
    self.buttonBar = {
      visible: true,
      btns: [{ name: 'btnCancel', _enabled: true, onClick() { clicks++; } }],
      Show() {}, Update() {}
    };
    await wait(300);
    self.cardContainer.selectCardContext.SpecifySkillId = 13;
    self.buttonBar.Show();
    await wait(50);
    assert.equal(clicks, 1);
  } finally {
    stop();
  }
});

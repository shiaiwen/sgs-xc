import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectManagedMarqueeNodes,
  createMarqueeVisibilityBlocker,
  findMarqueeManagerFromEvents
} from '../src/features/block-effects/marquee-visibility.ts';

test('hides only managed banners regardless of their wording and restores them', () => {
  const drawChild = { visible: true };
  const banner = {
    get visible() { return drawChild.visible; },
    set visible(value) { drawChild.visible = value; }
  };
  const activityBanner = { _visible: true, text: 'A new notice format' };
  const roomChat = { _visible: true, text: activityBanner.text };
  const guildChat = { _visible: true, text: activityBanner.text };
  const manager = {
    ShowMarquee() {},
    HideAllMarquee() {},
    marqueeUI: banner,
    marqueeUIActList: { forEach: (visit) => visit(123, activityBanner) },
    roomChat,
    guildChat
  };
  const blocker = createMarqueeVisibilityBlocker();

  blocker.sync(collectManagedMarqueeNodes(manager));
  assert.equal(drawChild.visible, false);
  assert.equal(activityBanner._visible, false);
  assert.equal(roomChat._visible, true);
  assert.equal(guildChat._visible, true);
  blocker.restoreAll();
  assert.equal(drawChild.visible, true);
  assert.equal(activityBanner._visible, true);
});

test('finds the marquee caller directly even after many unrelated events', () => {
  const manager = { ShowMarquee() {}, HideAllMarquee() {} };
  const events = Object.fromEntries(Array.from({ length: 150 }, (_, index) => [`other${index}`, {}]));
  events.CHAT_MARQUEE2023_ACT_ADD = [{ caller: {} }, { caller: manager }];
  assert.equal(findMarqueeManagerFromEvents({ _events: events }), manager);
});

test('ignores a container without the marquee manager methods', () => {
  const chat = { _visible: true };
  assert.equal(collectManagedMarqueeNodes({ marqueeUI: chat }).size, 0);
});

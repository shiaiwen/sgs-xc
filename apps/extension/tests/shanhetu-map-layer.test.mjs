import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearCityOverlays,
  hasMountedCityOverlay,
  mountCityOverlays,
  syncCityOverlayHost
} from '../src/features/shanhetu/shanhetu-map-view.ts';

/** 模拟 Laya 节点的父子层级与位移，验证透视层级和坐标，而不依赖游戏进度。 */
class FakeNode {
  children = [];
  addChild(child) { child.parent = this; this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parent = null; }
  getChildAt(index) { return this.children[index]; }
  get numChildren() { return this.children.length; }
  pos(x, y) { this.x = x; this.y = y; }
  localToGlobal(point) {
    const result = { ...point };
    for (let node = this; node; node = node.parent) {
      result.x += node.x ?? 0;
      result.y += node.y ?? 0;
    }
    return result;
  }
  globalToLocal(point) {
    const origin = this.localToGlobal({ x: 0, y: 0 });
    return { x: point.x - origin.x, y: point.y - origin.y };
  }
  destroy() { this.destroyed = true; }
}

test('山河地图透视在手牌之上且不接收鼠标事件', (t) => {
  const previousLaya = globalThis.Laya;
  globalThis.Laya = { Sprite: FakeNode };
  t.after(() => { globalThis.Laya = previousLaya; });

  const layer = new FakeNode();
  const mapScene = layer.addChild(new FakeNode());
  mapScene.pos(10, 20);
  const cityView = mapScene.addChild(new FakeNode());
  cityView.pos(30, 40);
  const handScene = layer.addChild(new FakeNode());
  handScene.zOrder = 3000;
  const panel = new FakeNode();
  panel.name = 'city';

  mountCityOverlays(cityView, layer, [panel]);
  const overlay = layer.children.find((child) => child.name === 'xcShanhetuMapOverlay');
  assert.ok(overlay);
  assert.ok(overlay.zOrder > handScene.zOrder);
  assert.equal(overlay.mouseEnabled, false);
  assert.equal(overlay.mouseChildren, false);
  assert.deepEqual([overlay.x, overlay.y], [40, 60]);
  assert.equal(hasMountedCityOverlay(cityView), true);

  // 地图移动和新场景入层时，只更新透视容器，手牌节点自身保持原样。
  cityView.pos(35, 45);
  handScene.zOrder = overlay.zOrder + 1;
  syncCityOverlayHost(cityView);
  assert.deepEqual([overlay.x, overlay.y], [45, 65]);
  assert.ok(overlay.zOrder > handScene.zOrder);

  clearCityOverlays(cityView);
  assert.equal(hasMountedCityOverlay(cityView), false);
  assert.equal(layer.children.includes(overlay), false);
});

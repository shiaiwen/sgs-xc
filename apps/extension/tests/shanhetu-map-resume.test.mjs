import assert from 'node:assert/strict';
import test from 'node:test';
import { installShanhetuMapController } from '../src/features/shanhetu/shanhetu-map-controller.ts';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 用最小 Laya 节点模拟面板挂载，测试检查真实子节点而非只看调试状态。 */
class FakeNode {
  children = [];
  graphics = { clear() {}, drawPath() {}, drawRect() {}, drawLine() {} };
  addChild(child) { this.children.push(child); child.parent = this; return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parent = null; }
  getChildAt(index) { return this.children[index]; }
  get numChildren() { return this.children.length; }
  pos(x, y) { this.x = x; this.y = y; }
  /** 只模拟本次层级调整需要的位移，让 cityView 与 SceneLayer 坐标可互换。 */
  localToGlobal(point) {
    let node = this;
    const result = { ...point };
    while (node) { result.x += node.x ?? 0; result.y += node.y ?? 0; node = node.parent; }
    return result;
  }
  globalToLocal(point) {
    const origin = this.localToGlobal({ x: 0, y: 0 });
    return { x: point.x - origin.x, y: point.y - origin.y };
  }
  destroy() { this.destroyed = true; }
}

const config = {
  Rcity: { 1: { x: 100, y: 100 }, 2: { x: 300, y: 100 } },
  Rfight: { 11: { name: '模拟关卡', get: '模拟奖励' }, 12: { name: '下一关', get: '下一关奖励' } },
  Radventure: {}, RadventureChoices: {}, Rchoose: {}, text: {}, Rplot: {},
  Rreward: {}, Rgrow: {}, RnumGrow: {}, RdiffGrow: {}, Rdiff: {}, RchapBoss: {}, RcurSeason: 1
};

/** 继续征程无新协议：CurrentScene 是大地图，绘制用 cityView 在 SceneLayer 小地图。 */
test('继续征程在大地图场景下从小地图节点补绘', async (t) => {
  const previousLaya = globalThis.Laya;
  globalThis.Laya = { VBox: FakeNode, Sprite: FakeNode, Label: FakeNode };
  t.after(() => { globalThis.Laya = previousLaya; });

  let currentScene = { SceneName: 'HomeScene' };
  const cityView = new FakeNode();
  cityView.width = 2048;
  cityView.height = 1200;
  cityView.GetCityItemById = () => ({ x: 100, y: 100, HasEvent: true });
  const sceneLayer = new FakeNode();
  const mapScene = new FakeNode();
  mapScene.SceneName = 'RogueSmallMapScene';
  mapScene.cityView = cityView;
  mapScene.addChild(cityView);
  sceneLayer.addChild(mapScene);
  const hand = new FakeNode();
  hand.name = 'hand';
  hand.zOrder = 2000;
  sceneLayer.addChild(hand);
  let requests = 0;
  const manager = {
    RogueLikeDataReq() {
      requests += 1;
      this.allData = { chapterData: { locations: [{ location: 1, event: 11 }] } };
    }
  };
  const host = { setTimeout, clearTimeout };
  const locator = {
    scene: () => currentScene,
    layer: (name) => name === 'SceneLayer' ? sceneLayer : null,
    findInLayer: (_layer, name) => name === 'RogueSmallMapScene' && currentScene.SceneName === 'RogueLikeBigMapScene'
      ? [mapScene] : [],
    manager: (name) => name === 'RogueLikePveManager' ? manager : null,
    findManagerByPredicate: () => manager
  };
  const controller = installShanhetuMapController(
    { get: () => true, subscribe: () => () => {} },
    { globalObject: host, locator, configSource: { get: () => config, ready: () => true, dispose() {} } }
  );
  t.after(() => controller.dispose());

  // 安装时仍在大厅；切到大地图只靠场景观察触发，没有 filterMessage 调用。
  currentScene = { SceneName: 'RogueLikeBigMapScene' };
  // 场景检查最多 1 秒，缺数据后的首次补绘再等 0.5 秒。
  await wait(2100);
  assert.ok(requests >= 1, '缺少城池缓存时应主动请求同步');
  assert.equal(host.__XIAOCHAO_SHANHETU_MAP_DEBUG__?.reason, 'fingerprint-hit');
  const overlay = sceneLayer.children.find((child) => child.name === 'xcShanhetuMapOverlay');
  assert.ok(overlay?.children.some((child) => child.name === 'city'), '透视面板应实际挂在 SceneLayer');
  assert.ok(overlay.zOrder > hand.zOrder, '透视层应高于手牌所在场景');
  assert.equal(overlay.mouseEnabled, false);
  assert.equal(overlay.mouseChildren, false);
});

/** 过关同步先到旧地图，动画结束后换 cityView：补绘必须落在新地图。 */
test('同步包先于新地图出现时仍补绘新 cityView', async (t) => {
  const previousLaya = globalThis.Laya;
  globalThis.Laya = { VBox: FakeNode, Sprite: FakeNode, Label: FakeNode };
  t.after(() => { globalThis.Laya = previousLaya; });

  const oldView = new FakeNode();
  oldView.GetCityItemById = () => ({ x: 100, y: 100, HasEvent: true });
  const newView = new FakeNode();
  newView.GetCityItemById = () => ({ x: 300, y: 100, HasEvent: true });
  const sceneLayer = new FakeNode();
  const oldScene = new FakeNode();
  oldScene.SceneName = 'RogueSmallMapScene';
  oldScene.cityView = oldView;
  oldScene.addChild(oldView);
  sceneLayer.addChild(oldScene);
  let currentScene = oldScene;
  const manager = {
    allData: { chapterData: { locations: [{ location: 1, event: 11 }] } },
    RogueLikeDataReq() {}
  };
  const host = { setTimeout, clearTimeout };
  const locator = {
    scene: () => currentScene,
    layer: (name) => name === 'SceneLayer' ? sceneLayer : null,
    findInLayer: () => [],
    manager: (name) => name === 'RogueLikePveManager' ? manager : null,
    findManagerByPredicate: () => manager
  };
  const controller = installShanhetuMapController(
    { get: () => true, subscribe: () => () => {} },
    { globalObject: host, locator, configSource: { get: () => config, ready: () => true, dispose() {} } }
  );
  t.after(() => controller.dispose());

  // 新章协议在旧地图仍可见时到达；游戏随后更新管理器并切换地图实例。
  controller.filterMessage({ allData: { chapterData: { locations: [{ location: 2, event: 12 }] } } }, 'decodeRogueLikeDataSync');
  await wait(1100);
  manager.allData = { chapterData: { locations: [{ location: 2, event: 12 }] } };
  const newScene = new FakeNode();
  newScene.SceneName = 'RogueSmallMapScene';
  newScene.cityView = newView;
  newScene.addChild(newView);
  sceneLayer.removeChild(oldScene);
  sceneLayer.addChild(newScene);
  currentScene = newScene;
  await wait(1300);
  assert.ok(sceneLayer.children.some((child) => child.name === 'xcShanhetuMapOverlay'
    && child.children.some((panel) => panel.name === 'city')), '新地图应重新挂上透视面板');
  assert.equal(host.__XIAOCHAO_SHANHETU_MAP_DEBUG__?.cityCount, 1);
});

/**
 * 山河地图透视控制器：读取配置表与场景城市数据，生成面板文案并驱动地图视图。
 */

import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import {
  SHANHETU_MANAGER_RETRY_MS,
  SHANHETU_SHOP_DATA_REQUEST_COOLDOWN_MS
} from '../../const/poll-intervals.ts';
import { ROGUE_SHOP_DATA_REQ_MARK, SHANHETU_MAP_KEY } from './shanhetu-settings.ts';
import {
  createShanhetuMapConfigSourceFromCardConfig,
  type ShanhetuMapConfigSource
} from './shanhetu-map-config-source.ts';
import type { CardConfigSource } from '../../adapters/card-config-source.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import { everyInterval } from '../../runtime/shared-ticker.ts';
import { buildPanelDrafts } from './shanhetu-map-event-text.ts';
import {
  cityImageReady,
  fingerprintCities,
  needsRaidGate,
  readCityHasEvent,
  readMapViewport,
  readHandBoundsInCityView,
  readRaidItem,
  readRaidObstacle,
  resolveCityGeometry
} from './shanhetu-map-geometry.ts';
import { estimatePanelHeight, layoutMapPanels } from './shanhetu-map-layout.ts';
import {
  ROGUE_MAP_STYLE,
  EMPTY_ROGUE_MAP_RUNTIME,
  type RogueCitySpot,
  type RogueMapPanelLayout,
  type RogueMapRuntime,
  type RogueRect
} from './shanhetu-map-types.ts';
import {
  clearCityOverlays,
  createCityOverlayNodes,
  hasMountedCityOverlay,
  getOverlayMountDebug,
  mountCityOverlays,
  measureCityOverlayHeight
} from './shanhetu-map-view.ts';
import {
  collectRogueInventoryFromMapScene,
  createRogueManagerLookup,
  extractRogueCitySpots,
  extractRogueMapRuntime,
  mergeRogueInventoryPlotIds,
  resolveRogueLikeSyncBody
} from './shanhetu-rogue-sync.ts';
import { isShanHeTuMode } from './shanhetu-shop-controller.ts';

const MAP_SCENE_NAMES = ['RogueSmallMapScene', 'RogueLikeBigMapScene'] as const;
const MAP_SCENE_CHECK_MS = 1000;

type UnknownRecord = Record<string, unknown>;

export interface ShanhetuMapController {
  /** 协议分发前：从山河同步包抽出 cities / difficulty。 */
  filterMessage(payload: UnknownRecord, className: string): void;
  dispose(): void;
}

export interface ShanhetuMapOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  configSource?: ShanhetuMapConfigSource;
  /** 与卡牌配置同源；未显式传入 configSource 时使用。 */
  cardConfigSource?: Pick<CardConfigSource, 'getShanhetuMapData'>;
  gameEvents?: GameEventBus;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

/**
 * 山河地图透视：以 `cityView` 计算位置，挂在地图场景内高于手牌区绘制城池事件面板。
 * 数据来自卡牌包山河配置、`decodeRogueLikeDataSync` 和进图时的管理器缓存。
 */
export function installShanhetuMapController(
  configStore: XiaochaoConfigStore,
  options: ShanhetuMapOptions = {}
): ShanhetuMapController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const configSource = options.configSource
    ?? (options.cardConfigSource
      ? createShanhetuMapConfigSourceFromCardConfig(options.cardConfigSource)
      : null);
  if (!configSource) {
    throw new Error('[xiaochao] 山河地图需要 cardConfigSource 或 configSource');
  }
  let disposed = false;
  let cities: RogueCitySpot[] = [];
  /** 已收到过 locations 同步后，禁止再用 manager 旧缓存把空列表填回来。 */
  let citiesSynced = false;
  let runtime: RogueMapRuntime = { ...EMPTY_ROGUE_MAP_RUNTIME, seedItem: [] };
  let lastFingerprint = '';
  let drawToken = 0;
  /** 离开地图后 findCityView 为空，靠这个清掉已挂的面板。 */
  let lastCityView: UnknownRecord | null = null;
  let lastRogueSyncBody: UnknownRecord | null = null;
  let lastInventoryRequestAt = 0;
  /** 过关或继续征程时，地图、配置和城池贴图可能稍后才就绪。 */
  let retryUntil = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** 禁用、离图或销毁时撤销待执行的补绘，避免旧场景定时任务残留。 */
  function stopRetry(): void {
    retryUntil = 0;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  }

  /** 同步后的短窗口持续检查场景切换；到期后停止，避免在大厅长期扫描。 */
  function retryWhenReady(): void {
    if (disposed || !enabled() || retryTimer !== null || Date.now() >= retryUntil) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      redraw();
    }, 500);
  }

  /** 收到同步或切入地图后，在场景加载窗口内补绘并观察 cityView 是否被替换。 */
  function startMapRetry(): void {
    stopRetry();
    retryUntil = Date.now() + 30_000;
    redraw(true);
  }

  function enabled(): boolean {
    return configStore.get(SHANHETU_MAP_KEY) === true;
  }

  function isNodeVisible(node: UnknownRecord | null): boolean {
    if (!node || node.destroyed) return false;
    if (typeof node._visible === 'boolean') return node._visible;
    return node.visible !== false;
  }

  function sceneNameOf(scene: UnknownRecord | null): string {
    return String(scene?.SceneName ?? scene?.sceneName ?? scene?.name ?? '');
  }

  function sceneNameMatchesMap(scene: UnknownRecord | null): boolean {
    const name = sceneNameOf(scene);
    return (MAP_SCENE_NAMES as readonly string[]).includes(name);
  }

  function invokeNode(node: UnknownRecord | null, method: string, ...args: unknown[]): unknown {
    const fn = node?.[method];
    return typeof fn === 'function' ? (fn as Function).apply(node, args) : undefined;
  }

  function displayChildren(node: UnknownRecord | null): UnknownRecord[] {
    if (!node || typeof node.numChildren !== 'number') return [];
    const count = Number(node.numChildren);
    if (!Number.isFinite(count) || count <= 0) return [];
    const list: UnknownRecord[] = [];
    for (let index = 0; index < count; index += 1) {
      const child = asRecord(invokeNode(node, 'getChildAt', index));
      if (child && !child.destroyed) list.push(child);
    }
    return list;
  }

  /** 城池节点可能在实例上才挂上 GetCityItemById，继续征程时还要注意方法在原型上。 */
  function nodeHasCityLookup(node: UnknownRecord | null): boolean {
    if (!node || node.destroyed) return false;
    if (typeof node.GetCityItemById === 'function') return true;
    return typeof asRecord(Object.getPrototypeOf(node))?.GetCityItemById === 'function';
  }

  function searchCityViewDescendants(root: UnknownRecord, depth: number): UnknownRecord | null {
    if (depth <= 0) return null;
    for (const child of displayChildren(root)) {
      if (nodeHasCityLookup(child)) return child;
      const nested = searchCityViewDescendants(child, depth - 1);
      if (nested) return nested;
    }
    return null;
  }

  function readCityViewFromScene(scene: UnknownRecord | null): UnknownRecord | null {
    if (!scene || scene.destroyed) return null;
    for (const key of ['cityView', 'CityView', 'm_cityView']) {
      const cityView = asRecord(scene[key]);
      if (cityView && !cityView.destroyed && nodeHasCityLookup(cityView)) return cityView;
    }
    if (nodeHasCityLookup(scene)) return scene;
    return searchCityViewDescendants(scene, 5);
  }

  /** 收集 SceneLayer 与 CurrentScene 中的山河地图场景；勿只认 layer 内 name 字段。 */
  function collectMapScenes(): UnknownRecord[] {
    const seen = new Set<UnknownRecord>();
    const ordered: UnknownRecord[] = [];
    const push = (scene: UnknownRecord | null) => {
      if (!scene || scene.destroyed || seen.has(scene)) return;
      seen.add(scene);
      ordered.push(scene);
    };
    const current = asRecord(locator.scene());
    if (sceneNameMatchesMap(current)) push(current);
    for (const sceneName of MAP_SCENE_NAMES) {
      for (const scene of locator.findInLayer('SceneLayer', sceneName)) {
        push(asRecord(scene));
      }
    }
    const sceneLayer = locator.layer('SceneLayer');
    for (const child of displayChildren(sceneLayer)) {
      if (sceneNameMatchesMap(child)) push(child);
    }
    return ordered;
  }

  /**
   * 继续征程时 CurrentScene 常是 RogueLikeGameScene 等，小地图在 SceneLayer 里单独挂着；
   * 不能只看 CurrentScene 名，必须先扫层内地图场景。
   */
  function findMapScene(): UnknownRecord | null {
    const candidates = collectMapScenes();
    return candidates.find((scene) => readCityViewFromScene(scene))
      ?? candidates.find((scene) => isNodeVisible(scene))
      ?? candidates[0]
      ?? null;
  }

  function findCityView(): UnknownRecord | null {
    for (const scene of collectMapScenes()) {
      const cityView = readCityViewFromScene(scene);
      if (cityView) return cityView;
    }
    return null;
  }

  /** 优先沿当前地图父链寻找底栏，仅用于布局投影，不改变面板挂载位置。 */
  function resolveHandUiLayoutScene(cityView: UnknownRecord | null): UnknownRecord | null {
    const seen = new Set<UnknownRecord>();
    const candidates: UnknownRecord[] = [];
    const push = (scene: unknown) => {
      const record = asRecord(scene);
      if (!record || record.destroyed || seen.has(record)) return;
      seen.add(record);
      candidates.push(record);
    };
    let parent = asRecord(cityView?.parent);
    while (parent && !seen.has(parent)) {
      push(parent);
      parent = asRecord(parent.parent);
    }
    for (const scene of collectMapScenes()) push(scene);
    push(locator.scene());
    for (const scene of candidates) {
      const bottomBar = asRecord(scene.bottomView) ?? asRecord(scene.BottomView);
      if (!bottomBar) continue;
      if (isNodeVisible(bottomBar) || isNodeVisible(scene)) return scene;
    }
    return findMapScene();
  }

  const rogueManager = createRogueManagerLookup(locator, SHANHETU_MANAGER_RETRY_MS);

  function roguePveManager(): UnknownRecord | null {
    return rogueManager.get();
  }

  function inventoryPayloads(extra: UnknownRecord | null = null): UnknownRecord[] {
    const manager = roguePveManager();
    const mapScene = findMapScene();
    return [
      lastRogueSyncBody,
      extra,
      manager,
      asRecord(manager?.allData),
      asRecord(manager?.AllData),
      asRecord(manager?.data),
      asRecord(manager?.gameData),
      asRecord(manager?.GameData),
      mapScene
    ].filter((entry): entry is UnknownRecord => Boolean(entry));
  }

  function syncInventoryRuntime(extra: UnknownRecord | null = null): void {
    const payloads = inventoryPayloads(extra);
    for (const payload of payloads) {
      runtime = extractRogueMapRuntime(payload, runtime);
    }
    const inventorySources = [...payloads];
    const sceneIds = collectRogueInventoryFromMapScene(findMapScene());
    if (sceneIds?.length) inventorySources.push({ itemId: sceneIds });
    const inventory = mergeRogueInventoryPlotIds(inventorySources);
    if (inventory?.length) {
      runtime = { ...runtime, itemIds: inventory };
    }
  }

  function sendRogueLikeDataRequest(): void {
    const now = Date.now();
    if (now - lastInventoryRequestAt < SHANHETU_SHOP_DATA_REQUEST_COOLDOWN_MS) return;
    const manager = roguePveManager();
    const method = manager?.RogueLikeDataReq;
    if (typeof method !== 'function') return;
    try {
      lastInventoryRequestAt = now;
      method.call(manager, ROGUE_SHOP_DATA_REQ_MARK);
    } catch {
      // 请求失败时等下一轮补绘。
    }
  }

  /** 继续征程缺 locations 时补一次同步；与背包请求共用冷却。 */
  function requestRogueCitiesIfNeeded(): void {
    if (cities.length || !findMapScene()) return;
    if (citiesSynced) return;
    sendRogueLikeDataRequest();
  }

  /** 透视绘制阶段背包仍空时补同步；已有 cities 才请求，避免与缺城列表抢同一次冷却。 */
  function requestRogueInventoryIfNeeded(): void {
    if (runtime.itemIds?.length) return;
    if (!cities.length && findMapScene()) return;
    sendRogueLikeDataRequest();
  }

  function cityListKey(list: RogueCitySpot[]): string {
    return list.map((city) => `${city.id}:${city.event}`).join(',');
  }

  function extractCities(payload: UnknownRecord): RogueCitySpot[] | null {
    return extractRogueCitySpots(resolveRogueLikeSyncBody(payload));
  }

  function extractRuntime(payload: UnknownRecord, previous: RogueMapRuntime): RogueMapRuntime {
    const body = resolveRogueLikeSyncBody(payload);
    lastRogueSyncBody = body;
    return extractRogueMapRuntime(body, previous);
  }

  /** 漏接同步包时，从 PveManager / 地图场景缓存回填或对齐 cities。 */
  function pullCitiesFromRuntime(mode: 'fill-empty' | 'reconcile', preferManager = false): void {
    if (mode === 'fill-empty') {
      if (cities.length) return;
      // 已收到过空 locations 时，禁止用 manager 旧缓存把面板填回来；
      // 重新进入地图时走 reconcile / allow 分支。
      if (citiesSynced) return;
    }
    // 不在山河地图时没有城池可回填，也不去找山河管理器。
    if (!findMapScene()) return;
    const candidates = inventoryPayloads();
    if (preferManager && lastRogueSyncBody) {
      // 重新入图先读 manager 当前局缓存，旧同步包可能仍属于上一张地图。
      const oldSyncIndex = candidates.indexOf(lastRogueSyncBody);
      if (oldSyncIndex >= 0) candidates.push(...candidates.splice(oldSyncIndex, 1));
    }
    for (const candidate of candidates) {
      if (!candidate) continue;
      const next = extractRogueCitySpots(candidate);
      if (next == null) continue;
      // 空 locations 只表示该份缓存无效，不能把已有 cities 清掉。
      if (!next.length) continue;
      if (mode === 'reconcile' && cities.length && cityListKey(next) === cityListKey(cities)) return;
      cities = next;
      citiesSynced = true;
      runtime = extractRogueMapRuntime(candidate, runtime);
      return;
    }
  }

  function syncRuntimeFromManager(): void {
    requestRogueInventoryIfNeeded();
    syncInventoryRuntime();
  }

  function recoverCitiesFromRuntime(allowWhenSyncedEmpty = false): void {
    if (allowWhenSyncedEmpty) {
      // 继续征程 / 回图：优先用 manager 当前局 locations 对齐。
      pullCitiesFromRuntime('reconcile', true);
      return;
    }
    pullCitiesFromRuntime('fill-empty');
  }

  function clear(target?: UnknownRecord | null): void {
    drawToken += 1;
    lastFingerprint = '';
    const view = target ?? lastCityView ?? findCityView();
    clearCityOverlays(view);
    if (!findCityView()) lastCityView = null;
  }

  let mapWasLive = false;

  function redraw(force = false): void {
    if (disposed) return;
    if (!enabled()) {
      stopRetry();
      clear();
      mapWasLive = false;
      publishDebug({ reason: 'disabled' });
      return;
    }

    const cityView = findCityView();
    const mapLive = Boolean(cityView);
    // 刚回到地图优先对齐 manager；留在同一张地图时保留最新协议数据，
    // 以免 manager 的旧缓存反向覆盖刚收到的 locations。
    const justEnteredMap = mapLive && !mapWasLive;
    if (justEnteredMap) recoverCitiesFromRuntime(true);
    else if (mapLive && cities.length) pullCitiesFromRuntime('reconcile');
    else recoverCitiesFromRuntime(false);
    mapWasLive = mapLive;

    const config = configSource.get();
    if (!config || !Object.keys(config.Rcity).length) {
      clear();
      publishDebug({ reason: 'no-config' });
      retryWhenReady();
      return;
    }

    if (!cityView) {
      clear();
      publishDebug({ reason: 'no-cityView', cities });
      retryWhenReady();
      return;
    }
    if (!cities.length) {
      pullCitiesFromRuntime('reconcile', true);
      requestRogueCitiesIfNeeded();
      if (!cities.length) {
        clear();
        publishDebug({ reason: 'no-cities', cities });
        retryWhenReady();
        return;
      }
    }
    lastCityView = cityView;

    // 难度未同步前不按 raid 门控清空；只在已知 difficulty≤100 时等待 raid。
    if (runtime.difficulty > 0 && needsRaidGate(runtime.difficulty) && !readRaidItem(cityView)) {
      clear(cityView);
      publishDebug({ reason: 'raid-gate', cities, difficulty: runtime.difficulty });
      retryWhenReady();
      return;
    }

    const fingerprint = fingerprintCities(cityView, cities);
    // 已领取 / 已打完：HasEvent 显式 false（含 0）不再画；unknown 仍画以免贴图未就绪误伤。
    const activeCities = cities.filter((city) => readCityHasEvent(cityView, city.id) !== 'false');
    if (!activeCities.length) {
      clear(cityView);
      lastFingerprint = fingerprint;
      publishDebug({ reason: 'no-active-cities', cities, fingerprint });
      retryWhenReady();
      return;
    }

    const paintCities = activeCities.filter((city) => (
      !config.Rcity[String(city.id)] || cityImageReady(cityView, city.id)
    ));
    const waitingConfigured = activeCities.filter((city) => (
      config.Rcity[String(city.id)] && !cityImageReady(cityView, city.id)
    ));
    if (!paintCities.length && waitingConfigured.length) {
      if (force || fingerprint !== lastFingerprint) {
        clearCityOverlays(cityView);
        lastFingerprint = '';
      }
      publishDebug({
        reason: 'pending-images',
        cities,
        activeCities,
        waitingConfigured: waitingConfigured.map((city) => city.id)
      });
      retryWhenReady();
      return;
    }
    const layoutScene = resolveHandUiLayoutScene(cityView);
    const viewport = readMapViewport(cityView, layoutScene);
    const handBoundsInCityView = readHandBoundsInCityView(cityView, layoutScene);
    const geometryKey = paintCities.map(city => resolveCityGeometry(cityView, city.id, config.Rcity[String(city.id)] ?? { x: 0, y: 0 }));
    const layoutFingerprint = JSON.stringify([fingerprintCities(cityView, paintCities), viewport, handBoundsInCityView, geometryKey]);
    if (!force && layoutFingerprint === lastFingerprint && hasMountedCityOverlay(cityView)) {
      publishDebug({
        reason: 'fingerprint-hit',
        cities,
        fingerprint: layoutFingerprint,
        waitingConfigured: waitingConfigured.map((city) => city.id),
        ...getOverlayMountDebug(cityView)
      });
      retryWhenReady();
      return;
    }

    const token = ++drawToken;
    const obstacles: RogueRect[] = [];
    const raid = readRaidObstacle(cityView);
    if (raid) obstacles.push(raid);

    syncRuntimeFromManager();
    const drafts = buildPanelDrafts(config, paintCities, runtime);
    if (!drafts.length) {
      clear(cityView);
      lastFingerprint = layoutFingerprint;
      publishDebug({ reason: 'no-drafts', cities, activeCities: paintCities, fingerprint: layoutFingerprint });
      retryWhenReady();
      return;
    }

    const laidOutSeed = drafts.map((draft) => {
      const meta = config.Rcity[String(draft.id)] ?? { x: 0, y: 0 };
      const geometry = resolveCityGeometry(cityView, draft.id, meta);
      const visual = geometry.visualArea || geometry;
      if (readCityHasEvent(cityView, draft.id) === 'true') {
        obstacles.push({
          id: draft.id,
          x: visual.x,
          y: visual.y,
          w: visual.w,
          h: visual.h,
          centerX: geometry.centerX,
          centerY: geometry.centerY
        });
      }
      const height = measureCityOverlayHeight({ ...draft, x0: 0, y0: 0, x: 0, y: 0, w: ROGUE_MAP_STYLE.panelWidth,
        h: estimatePanelHeight(draft.title, draft.lines), centerX: geometry.centerX, centerY: geometry.centerY });
      // 盖在城池中心上，贴近说明；mouseEnabled=false 不挡点击。
      return {
        ...draft,
        x0: geometry.centerX - ROGUE_MAP_STYLE.panelWidth / 2,
        y0: geometry.centerY - height / 2,
        x: geometry.centerX - ROGUE_MAP_STYLE.panelWidth / 2,
        y: geometry.centerY - height / 2,
        w: ROGUE_MAP_STYLE.panelWidth,
        h: height,
        centerX: geometry.centerX,
        centerY: geometry.centerY
      } satisfies RogueMapPanelLayout;
    });

    const panels = layoutMapPanels(laidOutSeed, obstacles, ROGUE_MAP_STYLE.layoutGap, viewport);
    if (token !== drawToken) return;

    const nodes = panels.flatMap((panel) => createCityOverlayNodes(panel));
    mountCityOverlays(cityView, nodes);
    const mountMode = 'city-view';
    if (!hasMountedCityOverlay(cityView)) {
      lastFingerprint = '';
      publishDebug({ reason: 'mount-failed', cities, mountMode, nodeCount: nodes.length });
      retryWhenReady();
      return;
    }
    lastFingerprint = layoutFingerprint;
    publishDebug({
      reason: 'mounted',
      mountMode,
      handBoundsInCityView, viewport, pendingImages: waitingConfigured.length > 0,
      panelBottomVsHandTop: panels.map(p => ({ id: p.id, panelBottom: p.y+p.h, handTop: handBoundsInCityView?.top ?? null,
        clearance: handBoundsInCityView ? handBoundsInCityView.top-p.y-p.h : null })),
      ...getOverlayMountDebug(cityView),
      cities,
      waitingConfigured: waitingConfigured.map((city) => city.id),
      drafts: drafts.map((d) => ({
        id: d.id,
        title: d.title,
        lineCount: d.lines.length,
        kinds: d.lines.map((l) => l.kind)
      })),
      panels: panels.map((p) => ({ id: p.id, title: p.title, x: p.x, y: p.y, w: p.w, h: p.h })),
      fingerprint
    });
    // 同步包可能先在旧地图绘制成功，过关动画结束后才换成新 cityView。
    retryWhenReady();
  }

  function publishDebug(detail: Record<string, unknown>): void {
    try {
      (globalObject as UnknownRecord).__XIAOCHAO_SHANHETU_MAP_DEBUG__ = {
        at: Date.now(),
        enabled: enabled(),
        // 现场诊断区分“没认出地图”和“认出大地图但没找到小地图 cityView”。
        currentSceneName: sceneNameOf(asRecord(locator.scene())),
        mapSceneName: sceneNameOf(findMapScene()),
        mapSceneCount: collectMapScenes().length,
        hasCityView: Boolean(findCityView()),
        cityCount: cities.length,
        synced: citiesSynced,
        difficulty: runtime.difficulty,
        inventoryCount: runtime.itemIds?.length ?? 0,
        rogueManagerFound: Boolean(rogueManager.peek()),
        hasLastRogueSync: Boolean(lastRogueSyncBody),
        ...detail
      };
    } catch {
      // 忽略异常
    }
  }

  // 协议同步负责刷新数据；低频场景检查只在切入地图时触发短时补绘，
  // 大厅中不会持续扫描山河管理器或重建面板。

  const unsubscribe = configStore.subscribe(SHANHETU_MAP_KEY, ({ value }) => {
    if (!value) {
      stopRetry();
      clear();
    } else {
      if (findMapScene()) startMapRetry();
      else redraw(true);
    }
  });

  if (enabled()) {
    redraw(true);
  }

  const stopGameEvents = options.gameEvents?.subscribe((event) => {
    if (event.type === 'game-started' || event.type === 'game-reconnected') {
      if (findMapScene()) startMapRetry();
      else redraw(true);
    }
  }) ?? (() => {});

  /** 地图场景或 cityView 实例变化时补绘；避免只盯 CurrentScene 名漏掉继续征程。 */
  let lastMapWatchKey = '';
  const stopSceneCheck = everyInterval('山河地图场景切换', MAP_SCENE_CHECK_MS, () => {
    if (disposed) return;
    const mapScene = findMapScene();
    const cityView = mapScene ? readCityViewFromScene(mapScene) : null;
    const watchKey = mapScene
      ? `${sceneNameOf(mapScene)}:${String(cityView?._id ?? cityView?.id ?? '')}:${cityView ? 1 : 0}`
      : '';
    if (watchKey === lastMapWatchKey) {
      if (mapScene && enabled() && cityView) {
        if (hasMountedCityOverlay(cityView)) {
          redraw();
        } else if (cities.length) {
          redraw();
        }
      }
      return;
    }
    const previousHadCityView = lastMapWatchKey.endsWith(':1');
    lastMapWatchKey = watchKey;

    if (mapScene && enabled()) {
      if (cityView && lastCityView && lastCityView !== cityView) clearCityOverlays(lastCityView);
      if (cityView && !previousHadCityView) {
        mapWasLive = false;
        startMapRetry();
      } else if (cityView) {
        redraw();
      }
    } else if (!mapScene && !isShanHeTuMode(locator, globalObject) && (mapWasLive || retryUntil > 0)) {
      mapWasLive = false;
      stopRetry();
      clear(lastCityView);
      lastMapWatchKey = '';
    }
  }, { visualOnly: true }, globalObject);

  return {
    filterMessage(payload, className) {
      if (className !== 'decodeRogueLikeDataSync') return;
      const nextCities = extractCities(payload);
      if (nextCities) {
        cities = nextCities;
        citiesSynced = true;
      }
      runtime = extractRuntime(payload, runtime);
      syncInventoryRuntime(resolveRogueLikeSyncBody(payload));
      if (enabled()) {
        // 新章切图时间不固定；在短窗口内一直等到地图和贴图可绘制。
        startMapRetry();
      }
    },
    dispose() {
      disposed = true;
      stopRetry();
      stopSceneCheck();
      stopGameEvents();
      unsubscribe();
      clear();
      configSource.dispose();
    }
  };
}

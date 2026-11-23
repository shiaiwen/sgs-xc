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
import { SHANHETU_MAP_KEY } from './shanhetu-settings.ts';
import { ROGUE_SHOP_DATA_REQ_MARK } from './shanhetu-shop-controller.ts';
import {
  createShanhetuMapConfigSourceFromCardConfig,
  type ShanhetuMapConfigSource
} from './shanhetu-map-config-source.ts';
import type { CardConfigSource } from '../../adapters/card-config-source.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import { buildPanelDrafts } from './shanhetu-map-event-text.ts';
import {
  cityImageReady,
  fingerprintCities,
  needsRaidGate,
  readCityHasEvent,
  readMapViewport,
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
  mountCityOverlays
} from './shanhetu-map-view.ts';
import {
  collectRogueInventoryFromMapScene,
  createRogueManagerLookup,
  extractRogueCitySpots,
  extractRogueMapRuntime,
  mergeRogueInventoryPlotIds,
  resolveRogueLikeSyncBody
} from './shanhetu-rogue-sync.ts';

const MAP_SCENE_NAMES = ['RogueSmallMapScene', 'RogueLikeBigMapScene'] as const;

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
 * 山河地图透视：在 `RogueSmallMapScene.cityView` 上绘制城池事件面板。
 * 数据来自卡牌包山河配置 + `decodeRogueLikeDataSync`，不依赖旧脚本 DOM/开关。
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

  function enabled(): boolean {
    return configStore.get(SHANHETU_MAP_KEY) === true;
  }

  function isNodeVisible(node: UnknownRecord | null): boolean {
    if (!node || node.destroyed) return false;
    if (typeof node._visible === 'boolean') return node._visible;
    return node.visible !== false;
  }

  function sceneNameOf(scene: UnknownRecord | null): string {
    return String(scene?.SceneName ?? scene?.sceneName ?? '');
  }

  /** 只认地图场景；层里找不到时用当前场景名兜底。 */
  function findMapScene(): UnknownRecord | null {
    for (const sceneName of MAP_SCENE_NAMES) {
      const scenes = locator.findInLayer('SceneLayer', sceneName);
      const scene = asRecord(scenes[0]);
      if (scene && !scene.destroyed) return scene;
    }
    const current = asRecord(locator.scene());
    if (current && !current.destroyed && MAP_SCENE_NAMES.includes(sceneNameOf(current) as typeof MAP_SCENE_NAMES[number])) {
      return current;
    }
    return null;
  }

  function readCityViewFromScene(scene: UnknownRecord | null): UnknownRecord | null {
    if (!scene || scene.destroyed) return null;
    for (const key of ['cityView', 'CityView', 'm_cityView']) {
      const cityView = asRecord(scene[key]);
      if (cityView && !cityView.destroyed && typeof cityView.GetCityItemById === 'function') {
        return cityView;
      }
    }
    return null;
  }

  function findCityView(): UnknownRecord | null {
    const scene = findMapScene();
    if (!scene || !isNodeVisible(scene)) return null;
    return readCityViewFromScene(scene);
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

  /** 背包仍空时向山河管理器要一次全量同步，与集市透视同掩码。 */
  function requestRogueInventoryIfNeeded(): void {
    if (runtime.itemIds?.length) return;
    const now = Date.now();
    if (now - lastInventoryRequestAt < SHANHETU_SHOP_DATA_REQUEST_COOLDOWN_MS) return;
    const manager = roguePveManager();
    const method = manager?.RogueLikeDataReq;
    if (typeof method !== 'function') return;
    try {
      lastInventoryRequestAt = now;
      method.call(manager, ROGUE_SHOP_DATA_REQ_MARK);
    } catch {
      // 请求失败时等下一轮轮询。
    }
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
  function pullCitiesFromRuntime(mode: 'fill-empty' | 'reconcile'): void {
    if (mode === 'fill-empty') {
      if (cities.length) return;
      // 已收到过空 locations 时，禁止用 manager 旧缓存把面板填回来；
      // 重新进入地图时走 reconcile / allow 分支。
      if (citiesSynced) return;
    }
    // 不在山河地图时没有城池可回填，也不去找山河管理器。
    if (!findMapScene()) return;
    const candidates = inventoryPayloads();
    for (const candidate of candidates) {
      if (!candidate) continue;
      const next = extractRogueCitySpots(candidate);
      if (next == null) continue;
      if (mode === 'fill-empty' && !next.length) continue;
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
      // 回图：允许用 manager 最新 locations 覆盖（含非空）。
      const wasSynced = citiesSynced;
      citiesSynced = false;
      pullCitiesFromRuntime('fill-empty');
      if (!cities.length) citiesSynced = wasSynced;
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
      clear();
      mapWasLive = false;
      publishDebug({ reason: 'disabled' });
      return;
    }

    const cityView = findCityView();
    const mapLive = Boolean(cityView);
    // 刚回到地图：同步包可能没带 locations，允许从 manager 回填。
    const justEnteredMap = mapLive && !mapWasLive;
    if (justEnteredMap) recoverCitiesFromRuntime(true);
    else if (mapLive && cities.length) pullCitiesFromRuntime('reconcile');
    else recoverCitiesFromRuntime(false);
    mapWasLive = mapLive;

    const config = configSource.get();
    if (!config || !Object.keys(config.Rcity).length) {
      clear();
      publishDebug({ reason: 'no-config' });
      return;
    }

    // 无 cityView / 无 cities 时清面板（离开地图必须消失）。
    if (!cityView || !cities.length) {
      clear();
      publishDebug({ reason: !cityView ? 'no-cityView' : 'no-cities', cities });
      return;
    }
    lastCityView = cityView;

    // 难度未同步前不按 raid 门控清空；只在已知 difficulty≤100 时等待 raid。
    if (runtime.difficulty > 0 && needsRaidGate(runtime.difficulty) && !readRaidItem(cityView)) {
      clear(cityView);
      publishDebug({ reason: 'raid-gate', cities, difficulty: runtime.difficulty });
      return;
    }

    const fingerprint = fingerprintCities(cityView, cities);
    // 已领取 / 已打完：HasEvent 显式 false（含 0）不再画；unknown 仍画以免贴图未就绪误伤。
    const activeCities = cities.filter((city) => readCityHasEvent(cityView, city.id) !== 'false');
    if (!activeCities.length) {
      clear(cityView);
      lastFingerprint = fingerprint;
      publishDebug({ reason: 'no-active-cities', cities, fingerprint });
      return;
    }

    const pending = activeCities.some((city) => (
      config.Rcity[String(city.id)] && !cityImageReady(cityView, city.id)
    ));
    if (pending) {
      // 指纹变了（例如领取后 HasEvent 翻转）必须先清旧面板，否则会卡在「等贴图」分支里一直显示已领取内容。
      if (force || fingerprint !== lastFingerprint) {
        clearCityOverlays(cityView);
        lastFingerprint = '';
      }
      publishDebug({ reason: 'pending-images', cities, activeCities });
      return;
    }

    if (!force && fingerprint === lastFingerprint && hasMountedCityOverlay(cityView)) {
      publishDebug({ reason: 'fingerprint-hit', cities, fingerprint });
      return;
    }

    const token = ++drawToken;
    const obstacles: RogueRect[] = [];
    const raid = readRaidObstacle(cityView);
    if (raid) obstacles.push(raid);

    syncRuntimeFromManager();
    const drafts = buildPanelDrafts(config, activeCities, runtime);
    if (!drafts.length) {
      clear(cityView);
      lastFingerprint = fingerprint;
      publishDebug({ reason: 'no-drafts', cities, activeCities, fingerprint });
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
      const height = estimatePanelHeight(draft.title, draft.lines);
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

    const panels = layoutMapPanels(laidOutSeed, obstacles, ROGUE_MAP_STYLE.layoutGap, readMapViewport(cityView, findMapScene()));
    if (token !== drawToken) return;

    const nodes = panels.flatMap((panel) => createCityOverlayNodes(panel));
    mountCityOverlays(cityView, nodes);
    lastFingerprint = fingerprint;
    publishDebug({
      reason: 'mounted',
      cities,
      drafts: drafts.map((d) => ({
        id: d.id,
        title: d.title,
        lineCount: d.lines.length,
        kinds: d.lines.map((l) => l.kind)
      })),
      panels: panels.map((p) => ({ id: p.id, title: p.title, x: p.x, y: p.y, w: p.w, h: p.h })),
      fingerprint
    });
  }

  function publishDebug(detail: Record<string, unknown>): void {
    try {
      (globalObject as UnknownRecord).__XIAOCHAO_SHANHETU_MAP_DEBUG__ = {
        at: Date.now(),
        enabled: enabled(),
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

  // 透视改为事件驱动：进山河图 / 每把结束的 decodeRogueLikeDataSync 回包会触发 redraw，
  // 不再用固定间隔轮询，大厅里不空跑。

  const unsubscribe = configStore.subscribe(SHANHETU_MAP_KEY, ({ value }) => {
    if (!value) {
      clear();
    } else {
      redraw(true);
    }
  });

  if (enabled()) {
    redraw(true);
  }

  const stopGameEvents = options.gameEvents?.subscribe((event) => {
    if (event.type === 'game-started' || event.type === 'game-reconnected') redraw(true);
  }) ?? (() => {});

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
        redraw(true);
        // 地图场景可能晚于同步包就绪，稍后再补挂面板。
        setTimeout(() => { if (!disposed) redraw(true); }, 600);
        setTimeout(() => { if (!disposed) redraw(true); }, 1800);
      }
    },
    dispose() {
      disposed = true;
      stopGameEvents();
      unsubscribe();
      clear();
      configSource.dispose();
    }
  };
}

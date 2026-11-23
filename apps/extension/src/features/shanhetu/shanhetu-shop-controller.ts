/**
 * 山河商店预览：拦截/请求商店数据，生成可在面板展示的商品列表。
 */

import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import type { CardConfigSource } from '../../adapters/card-config-source.ts';
import {
  SHANHETU_MANAGER_RETRY_MS,
  SHANHETU_SHOP_DATA_REQUEST_COOLDOWN_MS,
  SHANHETU_SHOP_SYNC_MS
} from '../../const/poll-intervals.ts';
import { OPEN_WINDOW_EVENT } from '../../const/game-window-events.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { everyInterval } from '../../runtime/shared-ticker.ts';
import { showToast } from '../../ui/toast/show-toast.ts';
import type { RoguePlotMeta } from './shanhetu-map-types.ts';

type UnknownRecord = Record<string, unknown>;

/** 集市窗口名，对应 GameEventDispatcher.ShowWindow("RogueJiShiWindow")。 */
export const ROGUE_SHOP_WINDOW = 'RogueJiShiWindow';

/** 当前场景是山河图地图或山河图对局时，集市才允许打开和改数据。 */
const SHANHE_SCENE_NAMES = new Set([
  'RogueSmallMapScene',
  'RogueLikeBigMapScene',
  'RogueLikeGameScene'
]);

/**
 * 集市同步缺 shopData 时，用 RogueLikeDataReq 请求完整山河数据。
 * `0x3f` 为原版默认 dataMark 掩码。
 */
export const ROGUE_SHOP_DATA_REQ_MARK = 0x3f;

/** 商品 type 对应的标题前缀。 */
export const ROGUE_SHOP_TYPE_LABELS: Readonly<Record<number, string>> = Object.freeze({
  2: '战法',
  3: '技能',
  4: '手牌',
  5: '装备'
});

export interface ShanhetuShopPreviewItem {
  id: string;
  label: string;
  title: string;
  level: number;
}

export type ShanhetuShopPreviewListener = (items: readonly ShanhetuShopPreviewItem[]) => void;

export interface ShanhetuShopController {
  /** 打开山河图集市窗口，并启用集市透视（强制 shopData.bShow）。 */
  openShop(): boolean;
  /** 当前集市透视列表（商品或默认方案）。 */
  getPreview(): readonly ShanhetuShopPreviewItem[];
  /** 订阅透视列表变化。 */
  subscribePreview(listener: ShanhetuShopPreviewListener): () => void;
  /**
   * 协议分发前改写：
   * dataMark bit4 时强制 `shopData.bShow`；缺 shopData 则 `RogueLikeDataReq`；
   * 有 shopData 时刷新集市透视（`cD`）。
   */
  filterMessage(payload: UnknownRecord, className: string): void;
  dispose(): void;
}

export interface ShanhetuShopOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  cardConfigSource?: Pick<CardConfigSource, 'getShanhetuMapData'>;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 当前游戏的 ShopData 缓存将协议 itemId 转成按类别分组的 goodList。 */
function shopItemIds(shopData: UnknownRecord): unknown[] {
  const direct = asArray(shopData.itemId ?? shopData.ItemId);
  if (direct.length) return direct;
  return asArray(shopData.goodList ?? shopData.GoodList)
    .flatMap((group) => asArray(group))
    .map((item) => asRecord(item)?.goodId ?? asRecord(item)?.GoodId)
    .filter((id) => id !== undefined && id !== null);
}

function shopItemIdsFromWindow(win: UnknownRecord): unknown[] {
  const nested = asRecord(win.shopData) ?? asRecord(win.ShopData);
  const fromNested = nested ? shopItemIds(nested) : [];
  if (fromNested.length) return fromNested;
  const ids: unknown[] = [];
  for (const key of ['ShowItemList', 'showItemList', 'goodList', 'GoodList', 'itemList', 'ItemList']) {
    for (const item of asArray(win[key])) {
      const record = asRecord(item);
      const id = record?.goodId ?? record?.GoodId ?? record?.plotId ?? record?.PlotId
        ?? record?.id ?? record?.ID;
      if (id !== undefined && id !== null && id !== '') ids.push(id);
    }
  }
  return ids;
}

function mergeUniqueItemIds(sources: unknown[][]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const list of sources) {
    for (const rawId of list) {
      if (rawId == null || rawId === '') continue;
      const key = String(rawId);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(rawId);
    }
  }
  return result;
}

import {
  createRogueManagerLookup,
  readRogueMapLayoutFingerprint,
  readRogueRunFingerprint,
  extractRogueMapRuntime,
  resolveRogueLikeSyncBody
} from './shanhetu-rogue-sync.ts';
import { EMPTY_ROGUE_MAP_RUNTIME } from './shanhetu-map-types.ts';

export { resolveRogueLikeSyncBody } from './shanhetu-rogue-sync.ts';

/** dataMark 的 bit4 表示本次同步带集市数据。 */
export function hasRogueShopSyncFlag(payload: UnknownRecord): boolean {
  const body = resolveRogueLikeSyncBody(payload);
  const mark = Number(body.dataMark ?? body.DataMark ?? payload.dataMark ?? payload.DataMark);
  if (!Number.isFinite(mark)) return false;
  return ((mark >> 4) & 1) === 1;
}

/** 读取当前山河图商店数据。 */
export function readShopData(payload: UnknownRecord): UnknownRecord | null {
  const body = resolveRogueLikeSyncBody(payload);
  const direct = asRecord(body.shopData) ?? asRecord(body.ShopData)
    ?? asRecord(payload.shopData) ?? asRecord(payload.ShopData);
  if (direct) return direct;
  const allData = readRogueLikeAllData(body)
    ?? readRogueLikeAllData(payload);
  return asRecord(allData?.shopData) ?? asRecord(allData?.ShopData);
}

function sceneLabel(scene: UnknownRecord | null): string {
  return String(scene?.SceneName ?? scene?.sceneName ?? scene?.name ?? '');
}

function modeText(scene: UnknownRecord | null, globalObject: LayaRuntimeWindow): string {
  const parts: unknown[] = [scene?.modeName, scene?.ModeName, scene?.gameModeName];
  const context = asRecord(globalObject.GameContext)
    ?? asRecord(globalObject.Laya?.Browser?.window?.GameContext);
  try {
    const vo = typeof context?.GetModeVO === 'function' ? asRecord(context.GetModeVO()) : null;
    parts.push(vo?.ModeName, vo?.modeName, vo?.Name, vo?.name);
  } catch {
    // 读不到模式名时只认场景名。
  }
  return parts.filter((part) => typeof part === 'string').join(' ');
}

/** 只认山河图场景或模式名里带山河图。 */
export function isShanHeTuMode(locator: LayaObjectLocator, globalObject: LayaRuntimeWindow): boolean {
  const scene = locator.scene();
  if (SHANHE_SCENE_NAMES.has(sceneLabel(scene))) return true;
  return modeText(scene, globalObject).includes('山河图');
}

function isRplotReady(rplot: Record<string, RoguePlotMeta> | null | undefined): boolean {
  return Boolean(rplot && Object.keys(rplot).length > 0);
}

/**
 * 用 Rplot 解析 shopData.itemId。
 * 无数据 / 解析不出商品时返回空列表（界面不展示占位方案名）。
 */
export function buildShanhetuShopPreviewItems(
  itemIds: unknown,
  rplot: Record<string, RoguePlotMeta> | null | undefined
): ShanhetuShopPreviewItem[] {
  const ids = asArray(itemIds);
  const table = rplot && typeof rplot === 'object' ? rplot : {};
  const goods: ShanhetuShopPreviewItem[] = [];
  for (const rawId of ids) {
    if (rawId == null || rawId === '') continue;
    const id = String(rawId);
    const meta = table[id];
    if (!meta) {
      goods.push({
        id,
        label: `商品 ${id}`,
        title: '配置表暂无名称，同步后会补全',
        level: 0
      });
      continue;
    }
    const moneyText = meta.money != null && String(meta.money) !== ''
      ? ` ${String(meta.money)}铜`
      : '';
    const typeLabel = ROGUE_SHOP_TYPE_LABELS[Number(meta.type)] ?? '';
    const rawLevel = Number(meta.level) || 0;
    // 等级样式类 TkxdW9UzobK1~4，超出范围按 0（默认色）处理。
    const level = rawLevel >= 1 && rawLevel <= 4 ? rawLevel : 0;
    goods.push({
      id,
      label: `${meta.name || id}${moneyText}`,
      title: `${typeLabel}${meta.desc || ''}`,
      level
    });
  }
  return goods;
}

/**
 * 打开集市并启用透视：强制 bShow，并用商品 id 刷新列表。
 */
export function installShanhetuShopController(
  options: ShanhetuShopOptions = {}
): ShanhetuShopController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const cardConfigSource = options.cardConfigSource;
  const patcher = createMethodPatcher();
  const rogueManager = createRogueManagerLookup(locator, SHANHETU_MANAGER_RETRY_MS);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const previewListeners = new Set<ShanhetuShopPreviewListener>();
  let disposed = false;
  /** 同步包里原始 bShow；为 false 时购买提示改为“月份未到”。 */
  let originalShopVisible: boolean | null = null;
  let lastShopDataRequestAt = 0;
  let requestedInCurrentScene = false;
  let wasInShanheScene = false;
  let stopShopSync: (() => void) | null = null;
  let openWindowDispatcher: UnknownRecord | null = null;
  let openWindowHandler: ((event: unknown) => void) | null = null;
  let previewItems: ShanhetuShopPreviewItem[] = [];
  let syncedShopItemIds: unknown[] = [];
  let lastRogueRunKey = '';
  /** 新开一局后 manager 上 shopData 仍是上一局的；仅信同步包写入的 itemId。 */
  let managerShopUntrusted = true;
  let lastPassChapter = -1;
  let lastMapLayoutKey = '';
  /**
   * 同步包先于 Rplot 到达时暂存 itemId；Rplot 还是空对象时
   * 为 0 时解析不出商品——我们不展示占位方案，因此等配置就绪后再刷一次。
   */
  let pendingShopItemIds: unknown[] | null = null;
  let rplotWait: Promise<void> | null = null;

  function resetShopPreviewCache(): void {
    syncedShopItemIds = [];
    pendingShopItemIds = null;
    originalShopVisible = null;
    requestedInCurrentScene = false;
    managerShopUntrusted = true;
    lastMapLayoutKey = '';
    publishPreview([]);
  }

  function noteRogueRunFromPayload(payload: UnknownRecord): void {
    const body = resolveRogueLikeSyncBody(payload);
    const runtime = extractRogueMapRuntime(body, EMPTY_ROGUE_MAP_RUNTIME);
    const passChapter = runtime.passChapter;
    const passChapterDropped = lastPassChapter >= 0 && passChapter < lastPassChapter;
    lastPassChapter = passChapter;

    const layoutKey = readRogueMapLayoutFingerprint(payload);
    const layoutChanged = Boolean(layoutKey)
      && Boolean(lastMapLayoutKey)
      && layoutKey !== lastMapLayoutKey
      && passChapter <= 1;
    if (layoutKey) lastMapLayoutKey = layoutKey;

    const key = readRogueRunFingerprint(payload);
    const runChanged = Boolean(lastRogueRunKey)
      && (key !== lastRogueRunKey || passChapterDropped || layoutChanged);
    if (runChanged) {
      resetShopPreviewCache();
      lastShopDataRequestAt = 0;
      if (!disposed && isShanHeTuMode(locator, globalObject)) {
        later(() => syncShopPreviewFromSources(true), 0);
        later(() => syncShopPreviewFromSources(true), 600);
      }
    }
    lastRogueRunKey = key;
  }

  function publishPreview(next: ShanhetuShopPreviewItem[]): void {
    previewItems = next;
    for (const listener of previewListeners) {
      try {
        listener(previewItems);
      } catch (error) {
        console.warn('[山河图] 集市透视订阅回调失败', error);
      }
    }
  }

  function later(callback: () => void, delay = 0): void {
    if (disposed) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, delay);
    timers.add(timer);
  }

  function poll<T>(probe: () => T | null | undefined | false, retries = 40, interval = 500): Promise<T | null> {
    return new Promise((resolve) => {
      const attempt = (remaining: number) => {
        if (disposed) return resolve(null);
        let value: T | null | undefined | false = null;
        try {
          value = probe();
        } catch {
          value = null;
        }
        if (value) return resolve(value);
        if (remaining <= 0) return resolve(null);
        later(() => attempt(remaining - 1), interval);
      };
      attempt(retries);
    });
  }

  function ensureRplotThenRefresh(): void {
    if (rplotWait) return;
    rplotWait = poll(() => {
      const rplot = cardConfigSource?.getShanhetuMapData()?.Rplot ?? null;
      return isRplotReady(rplot) ? rplot : null;
    }).then((rplot) => {
      rplotWait = null;
      if (!rplot || !pendingShopItemIds || disposed) return;
      const ids = pendingShopItemIds;
      pendingShopItemIds = null;
      publishPreview(buildShanhetuShopPreviewItems(ids, rplot));
    });
  }

  function readShopWindow(): UnknownRecord | null {
    return asRecord(locator.window(ROGUE_SHOP_WINDOW))
      ?? asRecord(locator.findWindows(ROGUE_SHOP_WINDOW)[0]);
  }

  function gatherShopItemIds(): unknown[] {
    const win = readShopWindow();
  if (managerShopUntrusted) {
      const sources: unknown[][] = [syncedShopItemIds];
      if (win) sources.push(shopItemIdsFromWindow(win));
      return mergeUniqueItemIds(sources);
    }
    const managerData = readShopDataFromManager();
    if (managerData) {
      const sources: unknown[][] = [syncedShopItemIds, shopItemIds(managerData)];
      if (win) sources.push(shopItemIdsFromWindow(win));
      return mergeUniqueItemIds(sources);
    }
    const sources: unknown[][] = [syncedShopItemIds];
    if (win) sources.push(shopItemIdsFromWindow(win));
    return mergeUniqueItemIds(sources);
  }

  function refreshPreviewFromItemIds(ids: unknown[]): void {
    if (!ids.length) {
      pendingShopItemIds = null;
      publishPreview([]);
      return;
    }
    const rplot = cardConfigSource?.getShanhetuMapData()?.Rplot ?? null;
    if (ids.length && !isRplotReady(rplot)) {
      pendingShopItemIds = ids;
      ensureRplotThenRefresh();
      if (!previewItems.length) {
        publishPreview(buildShanhetuShopPreviewItems(ids, {}));
      }
      return;
    }
    pendingShopItemIds = null;
    publishPreview(buildShanhetuShopPreviewItems(ids, rplot));
  }

  function refreshPreviewFromShopData(shopData: UnknownRecord): void {
    refreshPreviewFromItemIds(shopItemIds(shopData));
  }

  /** 从 manager、已打开的集市窗汇总商品，并视情况请求同步。 */
  function syncShopPreviewFromSources(allowRequest = false): void {
    if (disposed) return;
    if (!isShanHeTuMode(locator, globalObject)) {
      if (wasInShanheScene) requestedInCurrentScene = false;
      wasInShanheScene = false;
      return;
    }
    const justEnteredShanhe = !wasInShanheScene;
    wasInShanheScene = true;
    if (justEnteredShanhe) {
      managerShopUntrusted = true;
      const manager = rogueManager.get();
      if (manager) noteRogueRunFromPayload(manager);
      lastShopDataRequestAt = 0;
      allowRequest = true;
    }
    const managerData = !managerShopUntrusted ? readShopDataFromManager() : null;
    if (managerData) forceShopVisible(managerData, originalShopVisible === null);
    const ids = gatherShopItemIds();
    if (ids.length) {
      refreshPreviewFromItemIds(ids);
      return;
    }
    publishPreview([]);
    // 参考脚本缺集市数据时请求一次完整山河同步；进入总地图也执行一次。
    if ((allowRequest || !requestedInCurrentScene) && requestShopData(ROGUE_SHOP_DATA_REQ_MARK, allowRequest)) {
      requestedInCurrentScene = true;
    }
  }

  /** 强制可见，并记下协议里的原始 bShow。 */
  function forceShopVisible(shopData: UnknownRecord, recordOriginal: boolean): void {
    if (recordOriginal) {
      originalShopVisible = shopData.bShow === true || shopData.BShow === true;
    }
    shopData.bShow = true;
    if ('BShow' in shopData) shopData.BShow = true;
  }

  function readShopDataFromManager(): UnknownRecord | null {
    const manager = rogueManager.get();
    if (!manager) return null;
    return readShopData(manager)
      ?? readShopData(asRecord(manager.allData) ?? {})
      ?? readShopData(asRecord(manager.AllData) ?? {});
  }

  /** 缺 shopData 时向 RogueLikePveManager 要一次完整同步。 */
  function requestShopData(mark = ROGUE_SHOP_DATA_REQ_MARK, ignoreCooldown = false): boolean {
    const now = Date.now();
    if (!ignoreCooldown && now - lastShopDataRequestAt < SHANHETU_SHOP_DATA_REQUEST_COOLDOWN_MS) return false;
    const manager = rogueManager.get();
    const method = manager?.RogueLikeDataReq;
    if (typeof method !== 'function') return false;
    try {
      lastShopDataRequestAt = now;
      method.call(manager, mark);
      return true;
    } catch (error) {
      console.warn('[山河图] 请求集市数据失败', error);
      return false;
    }
  }

  function resolveOpenWindowName(event: unknown): string {
    if (typeof event === 'string') return event;
    const record = asRecord(event);
    if (typeof record?.WindowName === 'string') return record.WindowName;
    if (typeof record?.windowName === 'string') return record.windowName;
    return '';
  }

  function unbindOpenWindowListener(): void {
    if (!openWindowDispatcher || !openWindowHandler) return;
    try {
      (openWindowDispatcher.off as (...args: unknown[]) => void)
        .call(openWindowDispatcher, OPEN_WINDOW_EVENT, null, openWindowHandler);
    } catch {
      // 分发器已销毁时忽略。
    }
    openWindowDispatcher = null;
    openWindowHandler = null;
  }

  function ensureOpenWindowListener(): void {
    const dispatcher = locator.dispatcher();
    if (!dispatcher || typeof dispatcher.on !== 'function') return;
    if (openWindowDispatcher === dispatcher && openWindowHandler) return;
    unbindOpenWindowListener();
    openWindowHandler = (event: unknown) => {
      const windowName = resolveOpenWindowName(event);
      if (windowName !== ROGUE_SHOP_WINDOW) return;
      later(() => syncShopPreviewFromSources(), 200);
      later(() => syncShopPreviewFromSources(), 800);
    };
    try {
      (dispatcher.on as (...args: unknown[]) => void)
        .call(dispatcher, OPEN_WINDOW_EVENT, null, openWindowHandler);
      openWindowDispatcher = dispatcher;
    } catch {
      unbindOpenWindowListener();
    }
  }

  /** 打开集市时启用透视：强制当前缓存可见并刷新预览。 */
  function enablePerspectiveFromManager(): void {
    syncShopPreviewFromSources(true);
  }

  function openShop(): boolean {
    if (!isShanHeTuMode(locator, globalObject)) {
      showToast('只有山河图里才能打开集市');
      return false;
    }
    enablePerspectiveFromManager();
    const dispatcher = locator.dispatcher();
    if (!dispatcher) {
      showToast('游戏尚未就绪，稍后再打开集市');
      return false;
    }
    const showWindowName = locator.listShowWindowMethodNames(dispatcher)[0];
    const method = showWindowName ? dispatcher[showWindowName] : null;
    if (typeof method !== 'function') {
      showToast('无法打开集市窗口');
      return false;
    }
    try {
      method.call(dispatcher, ROGUE_SHOP_WINDOW);
      return true;
    } catch (error) {
      console.warn('[山河图] 打开集市失败 via', showWindowName, error);
      showToast('打开集市失败');
      return false;
    }
  }

  function filterMessage(payload: UnknownRecord, className: string): void {
    if (className !== 'decodeRogueLikeDataSync') return;
    noteRogueRunFromPayload(payload);
    if (!isShanHeTuMode(locator, globalObject)) return;

    // ClassName 在外层；allData / dataMark / shopData 由 readShopData / hasRogueShopSyncFlag 解 ProtoObj。
    const shopFlag = hasRogueShopSyncFlag(payload);
    const shopData = readShopData(payload);

    // dataMark bit4 且无 shopData 时发 RogueLikeDataReq 后返回。
    if (shopFlag && !shopData) {
      if (!requestedInCurrentScene && requestShopData()) requestedInCurrentScene = true;
      return;
    }

    if (!shopData) return;
    requestedInCurrentScene = true;
    managerShopUntrusted = false;

    const syncedIds = shopItemIds(shopData);
    syncedShopItemIds = syncedIds;

    // bit4 时记下原始 bShow 并强制可见，同时复位数据请求锁。
    if (shopFlag) {
      forceShopVisible(shopData, true);
    }

    refreshPreviewFromItemIds(syncedIds);
    later(() => syncShopPreviewFromSources(), 0);
  }

  ensureOpenWindowListener();
  stopShopSync = everyInterval('山河集市透视', SHANHETU_SHOP_SYNC_MS, () => syncShopPreviewFromSources());
  syncShopPreviewFromSources();

  // 购买成功提示在集市提前显示且原 bShow=false 时改写文案。
  void poll(() => {
    const context = asRecord(locator.gameContext())
      ?? asRecord((globalObject as UnknownRecord).GameContext)
      ?? asRecord(asRecord(globalObject.Laya?.Browser?.window)?.GameContext);
    return context && typeof context.ShowTextPrompt === 'function' ? context : null;
  }).then((context) => {
    if (!context || disposed) return;
    patcher.wrap(context, 'ShowTextPrompt', (original) => function (this: unknown, message: unknown, ...rest: unknown[]) {
      const text = String(message || '');
      if (
        text === '购买成功'
        && originalShopVisible === false
        && locator.window(ROGUE_SHOP_WINDOW)
      ) {
        return original.call(
          this,
          '购买失败：小抄可提前显示山河图集市<br>但是目前还没到购买东西的月份。',
          ...rest
        );
      }
      return original.call(this, message, ...rest);
    });
  });

  return {
    openShop,
    getPreview: () => {
      syncShopPreviewFromSources();
      return previewItems;
    },
    subscribePreview(listener) {
      previewListeners.add(listener);
      syncShopPreviewFromSources();
      try {
        listener(previewItems);
      } catch {
        // 首次推送失败不影响后续订阅。
      }
      return () => {
        previewListeners.delete(listener);
      };
    },
    filterMessage,
    dispose() {
      disposed = true;
      stopShopSync?.();
      stopShopSync = null;
      unbindOpenWindowListener();
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      previewListeners.clear();
      patcher.restoreAll();
      originalShopVisible = null;
      lastShopDataRequestAt = 0;
      requestedInCurrentScene = false;
      pendingShopItemIds = null;
      rplotWait = null;
      lastRogueRunKey = '';
      managerShopUntrusted = true;
      lastPassChapter = -1;
      previewItems = [];
      syncedShopItemIds = [];
    }
  };
}

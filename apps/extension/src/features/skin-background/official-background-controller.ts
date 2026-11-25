/**
 * 官方壁纸/动态背景控制器：与 interceptor 本地资源及皮肤纸扩展菜单协同。
 */

import { createDedupedTrace } from './trace-dedupe.ts';
import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher, type PatchableFunction } from '../../runtime/method-patch.ts';
import { resolveGameAccountId } from '../../runtime/game-account-session.ts';
import {
  WALLPAPER_MENU_ATTACH_STAGE_DEPTH,
  WALLPAPER_MENU_HOOK_DELAY_MS,
  WALLPAPER_MENU_PREWARM_FOLLOWUP_MS,
  WALLPAPER_TOP_MENU_OPEN_METHODS,
  WALLPAPER_TOP_MENU_SKIN_BUTTON_KEY,
  WALLPAPER_TOP_MENU_SKIN_BTN_HOOKED_KEY
} from '../../const/wallpaper-menu.ts';
import {
  asRecord,
  callMethod,
  createTaskScope,
  prototypeOf,
  isBackgroundUiScene,
  isHallGameplayUiReady,
  readJson,
  findHallWallPaperMenuHost,
  findWallPaperMenuOnStage,
  findWallPaperTopMenu,
  findSceneTopMenu,
  hasVisibleWallPaperShirtEntry,
  resolveHallScene,
  topMenuCanOpenWallPaperMenu,
  resolveWallPaperTabGroup,
  skinTrace,
  retrySkinBackgroundEventHooks,
  watchSceneSwitch,
  watchSceneSwitchRequest,
  wallPaperTabButtons,
  writeJson,
  type UnknownRecord
} from './skin-runtime.ts';
import { readOfficialBackgroundChoice, saveOfficialBackgroundChoice } from './skin-background-document.ts';
import { PAPER_LOBBY_SCENE_NAMES } from '../../const/paper-all-paper-scene.ts';
import { mayAttachWallPaperMenuExtension } from './skin-background-session.ts';
import {
  paintWallpaperSelectionMarks,
  showWallpaperSelectedMark,
  wallpaperChoiceItems,
  wallpaperItemId
} from './wallpaper-selection-marks.ts';
import { preloadWallPaperUiResources } from './wallpaper-menu-ui-preload.ts';
const CHOICE_STORAGE_SUFFIX = '::XC_OFFICIAL_BACKGROUND_CHOICE';
/** 游戏背景层放静态图的方法，第二个参数表示是不是皮肤图。 */
const BACKGROUND_LAYER_IMAGE_METHOD = 'O';
const BACKGROUND_LAYER_LIVE_SKIN_METHOD = 'SetBgLiveEffect';
/** 背景层放静态图、主题骨骼动画、动态皮肤的三个方法。 */
const BACKGROUND_LAYER_SHOW_METHODS = [BACKGROUND_LAYER_IMAGE_METHOD, 'wt', BACKGROUND_LAYER_LIVE_SKIN_METHOD];
const BACKGROUND_REQUEST_URL = /\/sgs_ccon(?:[?#]|$)/;
const BACKGROUND_REQUEST_BODY = /GAME_BG_(?:STRUCT|USEID)/;
const LOCK_NODE_NAMES = ['maskLock', 'tagLock', 'lbPowerVal', 'vipImg'];
const ITEM_METHOD_OVERRIDE = Symbol.for('sgsxc.officialBackground.itemMethodOverride');
const USED_DATA_GETTERS = ['IsCanShow', 'IsCanUse', 'IsInPlatform', 'IsSamePower'];
const SKIN_TAB_VALUE = 1;
const LIVE_TAB_VALUE = 2;
const REQUEST_URL_KEY = '__xcOfficialBackgroundRequestUrl';
const LIVE_PANEL_NAME = 'WallLivePanel';
const LIVE_PANEL_CLICK_SEARCH_DEPTH = 6;

/** 皮肤做背景与背景面板的联动，由皮肤背景控制器提供。 */
export interface WallpaperMenuExtension {
  enabled(): boolean;
  /** 使用了官方背景，皮肤背景需让位。 */
  onOfficialWallpaperUsed(): void;
  /** 当前正在用小抄背景，官方列表里不应再有勾。 */
  usingXiaochaoBackground?(): boolean;
  /** 面板准备完成后挂上「小抄背景」页签；开关关闭时自行移除。 */
  attachMenu(menu: UnknownRecord): void;
  /** 移除「小抄背景」页签。 */
  detachMenu(menu: UnknownRecord): void;
}

export interface OfficialBackgroundController {
  /** 重新同步背景面板，皮肤做背景开关变化时调用。 */
  sync(): void;
  dispose(): void;
}

export interface OfficialBackgroundOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  menuExtension?: WallpaperMenuExtension;
}

/**
 * 官方背景解锁：
 * 背景面板里的锁定项全部可选；选择只保存在本地，不上报服务器，
 * 游戏下发当前背景 ID 时替换为本地保存的选择。
 */
export function installOfficialBackgroundController(
  configStore: XiaochaoConfigStore,
  options: OfficialBackgroundOptions = {}
): OfficialBackgroundController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const storage = options.storage ?? globalObject.localStorage;
  const extension = options.menuExtension;
  const patcher = createMethodPatcher();
  const tasks = createTaskScope('官方背景');
  const originalSelectHandlers = new WeakMap<UnknownRecord, PatchableFunction>();
  const itemMethodRestores: Array<() => void> = [];
  const preparedMenus = new Set<UnknownRecord>();
  const guardedLayers = new WeakSet<UnknownRecord>();
  /** 首页、房间列表各自的底图，按页面名记。 */
  const lobbyImages = new Map<string, string>();
  /** 进牌局前背景层上的图，要去的页面没记过底图时用它。 */
  let imageBeforeMatch: unknown;
  /** 背景层上是牌局放的图或动画，离开牌局时要撤掉。 */
  let layerShowsMatchWallpaper = false;
  /** 游戏已发出切到首页或大厅的通知、新页面还没换上。 */
  let leavingToLobby = false;
  /** 按官方背景开着整理过的列表。 */
  const unlockedMenus = new WeakSet<UnknownRecord>();
  const cleanups: Array<() => void> = [];
  let localWriteDepth = 0;
  let suppressChoiceSave = false;
  let syncCoalescing = false;
  let wallPaperHooksEnabled = false;
  const patchedTopMenus = new WeakSet<object>();
  const silentMenuCreated = new WeakSet<object>();
  const wallPaperMenuRefreshHooked = new WeakSet<object>();
  const wallPaperMenuInitHooked = new WeakSet<object>();
  let hookEnableQueued = false;
  let hallMenuPrewarmDone = false;
  const isOfficialBackgroundOn = () => configStore.get('skin.officialBackground') === true;
  const isSkinPaperOn = () => Boolean(extension?.enabled());

  /** 是否挂背景面板钩子：官方解锁或皮肤做背景任一开。 */
  function shouldEnableWallpaperMenuHooks(): boolean {
    return isOfficialBackgroundOn() || isSkinPaperOn();
  }

  /** 小抄背景页签只看皮肤做背景，与官方背景开关无关。 */
  function shouldAttachXiaochaoTab(): boolean {
    return isSkinPaperOn();
  }

  const traceDeduped = createDedupedTrace(skinTrace);

  function traceWallPaperAttach(phase: string, detail: Record<string, unknown> = {}): void {
    traceDeduped('wallpaper-menu', {
      phase,
      skinPaper: isSkinPaperOn(),
      officialBackground: isOfficialBackgroundOn(),
      ...detail
    });
  }

  // ---------- 本地保存的选择 ----------

  /** 按游戏账号编号分。读不到时返回空，这时不读也不写，背景用游戏默认的。 */
  function choiceAccountId(): string {
    return resolveGameAccountId(globalObject, locator);
  }

  function choiceStorageKey(): string {
    return `${choiceAccountId()}${CHOICE_STORAGE_SUFFIX}`;
  }

  let savedChoiceCache: { accountId: string; value: number } | null = null;

  function savedChoice(): number {
    const accountId = choiceAccountId();
    if (!accountId) return 0;
    if (savedChoiceCache && savedChoiceCache.accountId === accountId) return savedChoiceCache.value;
    const parsed = readJson<unknown>(storage, choiceStorageKey(), null);
    const id = Number(parsed && typeof parsed === 'object' ? (parsed as UnknownRecord).id : parsed);
    const value = Number.isFinite(id) && id > 0
      ? id
      // 单键没有时，账号文档里可能还留着（旧键迁进文档后会被删掉）。
      : readOfficialBackgroundChoice(documentStorage(), accountId)?.id ?? 0;
    savedChoiceCache = { accountId, value };
    return value;
  }

  function documentStorage(): Parameters<typeof readOfficialBackgroundChoice>[0] {
    return storage as Parameters<typeof readOfficialBackgroundChoice>[0];
  }

  function saveChoice(value: unknown): boolean {
    const id = Number(value);
    const accountId = choiceAccountId();
    if (suppressChoiceSave || !Number.isFinite(id) || id <= 0 || !accountId) return false;
    writeJson(storage, choiceStorageKey(), { id, savedAt: Date.now() });
    // 同时写进账号文档，文档一变才会触发上传。
    saveOfficialBackgroundChoice(documentStorage(), accountId, id);
    savedChoiceCache = { accountId, value: id };
    return true;
  }

  // ---------- 官方皮肤背景只在牌局里显示 ----------

  /**
   * 官方的皮肤背景、动态皮肤只在牌局和旁观里显示，首页和房间列表不放，全局背景开关管不到它们。
   * 正在退出牌局时牌局页面还在，也算牌局外。
   */
  function outsideMatch(): boolean {
    return leavingToLobby || !locator.gameScene();
  }

  /** 游戏放静态图时第二个参数表示是不是皮肤图；动态皮肤走单独的方法。 */
  function isSkinLayerCall(name: string, args: unknown[]): boolean {
    return name === BACKGROUND_LAYER_LIVE_SKIN_METHOD || (name === BACKGROUND_LAYER_IMAGE_METHOD && Boolean(args[1]));
  }

  /** 只包这一个背景层实例：游戏往上放图时分清主题和皮肤，牌局外不让皮肤图盖上去。 */
  function guardBackgroundLayer(): void {
    const layer = locator.layer('BackgroundLayer');
    if (!layer || guardedLayers.has(layer)) return;
    guardedLayers.add(layer);
    skinTrace('wallpaper-layer-guarded', { skin: asRecord(layer.bg)?.skin, scene: locator.scene()?.SceneName });
    for (const name of BACKGROUND_LAYER_SHOW_METHODS) {
      overrideItemInstanceMethod(layer, name, (original) => function (this: UnknownRecord, ...args: unknown[]) {
        const skinCall = isSkinLayerCall(name, args);
        skinTrace('wallpaper-layer-call', {
          name,
          url: args[0],
          skin: skinCall,
          outsideMatch: outsideMatch(),
          scene: locator.scene()?.SceneName
        });
        if (outsideMatch()) {
          // 只有牌局会放皮肤图和动态皮肤；主题动画别的页面也用来放自己的底图，不能挡。
          if (skinCall) return undefined;
          layerShowsMatchWallpaper = false;
          return original.apply(this, args);
        }
        if (!layerShowsMatchWallpaper) imageBeforeMatch = asRecord(this.bg)?.skin;
        layerShowsMatchWallpaper = true;
        return original.apply(this, args);
      });
    }
  }

  /** 首页、房间列表建好后记下它们自己的底图。 */
  function rememberLobbyImage(sceneName: string): void {
    if (!PAPER_LOBBY_SCENE_NAMES.includes(sceneName) || layerShowsMatchWallpaper) return;
    const skin = asRecord(locator.layer('BackgroundLayer')?.bg)?.skin;
    if (typeof skin === 'string' && skin) lobbyImages.set(sceneName, skin);
  }

  /**
   * 离开牌局时马上撤掉牌局放的皮肤图、动态皮肤和主题动画，换上要去的那一页的底图。
   * 游戏要等新页面加载完才换底图，这之前动态背景一直在放。
   */
  function dropMatchWallpaper(targetScene: string): void {
    guardBackgroundLayer();
    const layer = locator.layer('BackgroundLayer');
    if (!layer || !layerShowsMatchWallpaper || !outsideMatch()) return;
    layerShowsMatchWallpaper = false;
    callMethod(layer, 'RemovebgEffect');
    const image = lobbyImages.get(targetScene) ?? imageBeforeMatch;
    if (image) callMethod(layer, BACKGROUND_LAYER_IMAGE_METHOD, image);
  }

  function settleWallpaper(): void {
    const sceneName = String(locator.scene()?.SceneName ?? '');
    rememberLobbyImage(sceneName);
    dropMatchWallpaper(sceneName);
  }

  /** 游戏内部写背景时屏蔽其上报。 */
  function writeLocally<T>(write: () => T): T {
    installGlobalGuards();
    localWriteDepth += 1;
    try {
      return write();
    } finally {
      localWriteDepth -= 1;
    }
  }

  // ---------- 上报拦截与选择恢复 ----------

  function installRequestGuard(): void {
    const xhrPrototype = (globalObject as unknown as { XMLHttpRequest?: { prototype?: unknown } }).XMLHttpRequest?.prototype;
    patcher.wrap(xhrPrototype, 'open', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      this[REQUEST_URL_KEY] = String(args[1] ?? '');
      return original.apply(this, args);
    });
    patcher.wrap(xhrPrototype, 'send', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      if (isOfficialBackgroundOn() && isBackgroundReport(String(this[REQUEST_URL_KEY] ?? ''), args[0])) {
        try {
          (this.abort as () => void)();
        } catch {
          // 请求尚未发出时 abort 可能抛错，忽略即可。
        }
        return undefined;
      }
      return original.apply(this, args);
    });
  }

  function installSettingLogGuard(): void {
    const settingManager = locator.managerFromList((manager) => typeof manager.SendSettingLog === 'function');
    patcher.wrap(settingManager, 'SendSettingLog', (original) => function (this: unknown, ...args: unknown[]) {
      if (isOfficialBackgroundOn() && localWriteDepth > 0) return undefined;
      return original.apply(this, args);
    });
  }

  let selectListenerDispatcher: UnknownRecord | null = null;
  function installDispatcherGuards(): void {
    const dispatcher = locator.dispatcher();
    if (!dispatcher) return;
    if (selectListenerDispatcher !== dispatcher && typeof dispatcher.on === 'function') {
      const listenerOwner = {};
      const onSelect = (id: unknown) => {
        const saved = saveChoice(id);
        if (saved) {
          tasks.later(() => {
            preparedMenus.forEach(paintMenuMarks);
            // 牌桌要等服务器回当前背景才换图，那条请求被挡掉了，这里直接告诉牌桌换成刚点的这张。
            if (isOfficialBackgroundOn() && locator.gameScene()) callMethod(dispatcher, 'event', 'BACKGROUND_USEDID_GOT', [Number(id)]);
          }, 0);
        }
        return saved;
      };
      (dispatcher.on as PatchableFunction).call(dispatcher, 'SELECT_WALLPAPER', listenerOwner, onSelect);
      selectListenerDispatcher = dispatcher;
      cleanups.push(() => callMethod(dispatcher, 'off', 'SELECT_WALLPAPER', listenerOwner, onSelect));
    }
    patcher.wrap(dispatcher, 'event', (original) => function (this: unknown, type: unknown, data: unknown, ...rest: unknown[]) {
      if (type !== 'BACKGROUND_USEDID_GOT') return original.call(this, type, data, ...rest);
      guardBackgroundLayer();
      return original.call(this, type, restoreChosenBackground(data), ...rest);
    });
  }

  /** 背景只跟手动点选走：不管官方背景开没开，游戏下发当前背景时都换成最后一次点选的那张。 */
  function restoreChosenBackground(data: unknown): unknown {
    const chosen = savedChoice();
    if (!chosen) return data;
    if (Array.isArray(data) && data.length > 1 && data[1] === '') {
      return Number(data[0]) === chosen ? data : [chosen, ...data.slice(1)];
    }
    if (!Array.isArray(data) && locator.scene()?.SceneName === 'RogueLikeGameScene' && Number(data) > 0) {
      return Number(data) === chosen ? data : chosen;
    }
    return data;
  }

  function installGlobalGuards(): void {
    if (!isBackgroundUiScene(locator, globalObject)) return;
    installRequestGuard();
    installSettingLogGuard();
    installDispatcherGuards();
  }

  // ---------- 背景面板 ----------

  function forceTrueGetter(prototype: UnknownRecord | null, name: string): void {
    patcher.wrapGetter(prototype, name, (originalGet) => () => isOfficialBackgroundOn() || originalGet());
  }

  function unlockUsedData(usedData: unknown): void {
    const prototype = prototypeOf(usedData);
    USED_DATA_GETTERS.forEach((name) => forceTrueGetter(prototype, name));
  }

  function unlockSkinItemData(data: unknown): void {
    forceTrueGetter(prototypeOf(data), 'canUsed');
  }

  function hideLockNodes(item: UnknownRecord): void {
    if (!isOfficialBackgroundOn()) return;
    LOCK_NODE_NAMES.forEach((name) => {
      const node = asRecord(item[name]);
      if (node) node.visible = false;
    });
    const background = asRecord(item.bg);
    if (background && 'Gray' in background) background.Gray = false;
  }

  function overrideItemInstanceMethod(
    record: UnknownRecord,
    name: string,
    wrap: (original: PatchableFunction) => PatchableFunction
  ): void {
    const overrides = asRecord(record[ITEM_METHOD_OVERRIDE]);
    if (overrides?.[name]) return;
    const prototype = prototypeOf(record);
    const inherited = prototype?.[name];
    if (typeof inherited !== 'function') return;
    const original = inherited as PatchableFunction;
    const wrapped = wrap(original);
    Object.defineProperty(record, name, { value: wrapped, configurable: true, writable: true });
    if (!overrides) {
      record[ITEM_METHOD_OVERRIDE] = { [name]: true };
    } else {
      overrides[name] = true;
    }
    itemMethodRestores.push(() => {
      try {
        delete record[name];
        if (overrides) delete overrides[name];
      } catch {
        // 忽略恢复失败。
      }
    });
  }

  /**
   * 官方背景开着时，勾按本地选择画，不看游戏记的当前背景。
   * 返回 null 表示交给游戏；0 表示所有官方格子都不该有勾。
   */
  function localMarkChoice(): number | null {
    if (!isOfficialBackgroundOn()) return null;
    if (isSkinPaperOn() && extension?.usingXiaochaoBackground?.()) return 0;
    const chosen = savedChoice();
    return chosen > 0 ? chosen : null;
  }

  function paintItemMark(item: UnknownRecord): void {
    const chosen = localMarkChoice();
    if (chosen === null) return;
    showWallpaperSelectedMark(item, chosen > 0 && wallpaperItemId(item) === chosen);
  }

  function paintMenuMarks(menu: UnknownRecord): void {
    const chosen = localMarkChoice();
    if (chosen !== null) paintWallpaperSelectionMarks(menu, chosen);
  }

  /** 游戏每次刷新格子都会按它自己记的背景重画勾，这里改成按本地选择画。 */
  function keepLocalMark(record: UnknownRecord, methodNames: string[]): void {
    for (const name of methodNames) {
      overrideItemInstanceMethod(record, name, (original) => function (this: UnknownRecord, ...args: unknown[]) {
        const result = original.apply(this, args);
        paintItemMark(this);
        return result;
      });
    }
  }

  /** 背景项去锁，点击直接使用，使用时只写本地。 */
  function prepareItem(item: unknown, isSkinItem: boolean): void {
    const record = asRecord(item);
    const prototype = prototypeOf(record);
    if (!record || !prototype) return;
    for (const name of ['initUI', 'updateUI']) {
      overrideItemInstanceMethod(record, name, (original) => function (this: UnknownRecord, ...args: unknown[]) {
        const result = original.apply(this, args);
        hideLockNodes(this);
        paintItemMark(this);
        return result;
      });
    }
    keepLocalMark(record, ['UpdateSelectedUI']);
    overrideItemInstanceMethod(record, 'useWall', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      if (!isOfficialBackgroundOn()) return original.apply(this, args);
      const result = writeLocally(() => original.apply(this, args));
      saveChoice(wallpaperItemId(this));
      markWallpaperSelection(this);
      return result;
    });
    overrideItemInstanceMethod(record, 'onSelectedClicked', (original) => {
      originalSelectHandlers.set(record, original);
      return function (this: UnknownRecord, ...args: unknown[]) {
        const useWallMethod = this.useWall as PatchableFunction | undefined;
        const result = isOfficialBackgroundOn() && typeof useWallMethod === 'function'
          ? useWallMethod.apply(this, args)
          : original.apply(this, args);
        extension?.onOfficialWallpaperUsed();
        return result;
      };
    });
    rebindSelectButton(record, isSkinItem);
    hideLockNodes(record);
  }

  /** 选中按钮在补丁前已绑定原处理函数，需换绑为包装后的方法。 */
  function rebindSelectButton(item: UnknownRecord, isSkinItem: boolean): void {
    const button = asRecord(item.selectedBtn);
    const handler = item.onSelectedClicked;
    const layaEvent = asRecord(globalObject.Laya?.Event);
    const original = originalSelectHandlers.get(item);
    const eventName = boundEventName(button, original, [layaEvent?.CLICK, layaEvent?.MOUSE_DOWN])
      ?? (isSkinItem ? layaEvent?.CLICK : layaEvent?.MOUSE_DOWN);
    if (!button || typeof handler !== 'function' || !eventName) return;
    if (original) callMethod(button, 'off', eventName, item, original);
    callMethod(button, 'off', eventName, item, handler);
    callMethod(button, 'on', eventName, item, handler);
  }

  /** 皮肤背景页按是否拥有皮肤筛选；构建期间视为全部拥有。 */
  function withAllSkinsOwned<T>(build: () => T): T {
    const manager = locator.manager('GeneralSkinManager');
    if (!manager) return build();
    const overrides: Array<[string, PropertyDescriptor | undefined]> = [];
    const forever = { IsForever: true, Expirydate: Number.MAX_SAFE_INTEGER };
    for (const name of ['GetSkinInBagBySkinID', 'GetSkinListBySkinID']) {
      const original = manager[name];
      if (typeof original !== 'function') continue;
      overrides.push([name, Object.getOwnPropertyDescriptor(manager, name)]);
      manager[name] = name === 'GetSkinInBagBySkinID'
        ? function (this: unknown, ...args: unknown[]) {
          return (original as PatchableFunction).apply(this, args) || forever;
        }
        : function (this: unknown, ...args: unknown[]) {
          const list = (original as PatchableFunction).apply(this, args);
          return Array.isArray(list) && list[0] ? list : [forever];
        };
    }
    try {
      return build();
    } finally {
      for (const [name, descriptor] of overrides) {
        if (descriptor) Object.defineProperty(manager, name, descriptor);
        else delete manager[name];
      }
    }
  }

  function patchSkinItemsBuilder(menu: UnknownRecord): void {
    patchLiveItemsBuilder(menu);
    const proto = prototypeOf(menu);
    if (typeof menu.onShowSkinitems !== 'function' && typeof proto?.onShowSkinitems !== 'function') return;
    if (patcher.isWrapped(menu, 'onShowSkinitems')) return;
    patcher.wrap(menu, 'onShowSkinitems', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      if (this !== menu) return original.apply(this, args);
      const result = isOfficialBackgroundOn() ? withAllSkinsOwned(() => original.apply(this, args)) : original.apply(this, args);
      if (isOfficialBackgroundOn() || isSkinPaperOn()) {
        itemsOf(this, 'wallPaperSkinItems').forEach((item) => {
          if (isOfficialBackgroundOn()) unlockSkinItemData(item.data);
          prepareItem(item, true);
        });
        paintMenuMarks(this);
      }
      return result;
    });
  }

  /** 动态皮肤列表第一次打开时才会建出来，建好后接管格子的勾。 */
  function patchLiveItemsBuilder(menu: UnknownRecord): void {
    const proto = prototypeOf(menu);
    if (typeof menu.onShowLiveitems !== 'function' && typeof proto?.onShowLiveitems !== 'function') return;
    if (patcher.isWrapped(menu, 'onShowLiveitems')) return;
    patcher.wrap(menu, 'onShowLiveitems', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      if (this !== menu) return original.apply(this, args);
      const result = original.apply(this, args);
      if (isOfficialBackgroundOn() || isSkinPaperOn()) {
        prepareLiveItems(this);
        paintMenuMarks(this);
      }
      return result;
    });
  }

  function itemsOf(menu: UnknownRecord, key: 'wallPaperItems' | 'wallPaperSkinItems' | 'wallPaperLiveItems'): UnknownRecord[] {
    const list = menu[key];
    return Array.isArray(list) ? list.map(asRecord).filter((item): item is UnknownRecord => item !== null) : [];
  }

  /** 动态皮肤格子和静态皮肤格子一样，去锁、点击只写本地。 */
  function prepareLiveItems(menu: UnknownRecord): void {
    itemsOf(menu, 'wallPaperLiveItems').forEach((item) => prepareItem(item, true));
  }

  function prepareAllItems(menu: UnknownRecord): void {
    itemsOf(menu, 'wallPaperItems').forEach((item) => prepareItem(item, false));
    itemsOf(menu, 'wallPaperSkinItems').forEach((item) => {
      if (isOfficialBackgroundOn()) unlockSkinItemData(item.data);
      prepareItem(item, true);
    });
    prepareLiveItems(menu);
    paintMenuMarks(menu);
  }

  /** 游戏清格子时静态、动态皮肤一起清，两页的空壳都得拆掉，下次切过去才会重新建格子。 */
  function destroySkinPanel(menu: UnknownRecord): void {
    const panels = ['panel', 'livePanel'].filter((key) => asRecord(menu[key]));
    if (!panels.length) return;
    callMethod(menu, 'clearItems');
    for (const key of panels) {
      const panel = asRecord(menu[key]);
      callMethod(panel, 'removeSelf');
      callMethod(panel, 'destroy', true);
      menu[key] = null;
    }
  }

  /** 正停在动态皮肤页时，拆掉后要马上建回来，不然这一页是空的。 */
  function reshowLiveTab(menu: UnknownRecord): void {
    if (asRecord(menu.tabGroup)?.SelectedValue === LIVE_TAB_VALUE) callMethod(menu, 'onShowLiveitems');
  }

  /** 主题、静态皮肤、动态皮肤共用勾选图，点中的那一项才显示。 */
  function markWallpaperSelection(clicked: UnknownRecord): void {
    for (const menu of preparedMenus) {
      const items = wallpaperChoiceItems(menu);
      if (!items.includes(clicked)) continue;
      for (const item of items) showWallpaperSelectedMark(item, item === clicked);
    }
  }

  function selectedItemId(menu: UnknownRecord): number {
    const selected = [...itemsOf(menu, 'wallPaperItems'), ...itemsOf(menu, 'wallPaperSkinItems')]
      .find((item) => asRecord(item.selectedImg)?.visible);
    return selected ? wallpaperItemId(selected) : 0;
  }

  function findItem(menu: UnknownRecord, id: number): UnknownRecord | undefined {
    return [...itemsOf(menu, 'wallPaperItems'), ...itemsOf(menu, 'wallPaperSkinItems')]
      .find((item) => wallpaperItemId(item) === id);
  }

  function useWithoutSaving(item: UnknownRecord): void {
    suppressChoiceSave = true;
    try {
      writeLocally(() => callMethod(item, 'useWall'));
    } finally {
      suppressChoiceSave = false;
    }
  }

  /** 首次打开时重建列表并应用本地保存的背景。 */
  function unlockMenu(menu: UnknownRecord): boolean {
    if (!isOfficialBackgroundOn()) return false;
    installGlobalGuards();
    patchSkinItemsBuilder(menu);
    if (preparedMenus.has(menu)) {
      prepareAllItems(menu);
      return true;
    }
    itemsOf(menu, 'wallPaperItems').forEach((item) => prepareItem(item, false));
    destroySkinPanel(menu);
    menu.wallPaperSkinItems = [];
    callMethod(menu, 'onShowSkinitems');
    const currentId = selectedItemId(menu);
    callMethod(menu, 'initData');
    if (!menu.usedData) {
      const items = itemsOf(menu, 'wallPaperItems');
      const fallback = items.find((item) => (
        !asRecord(item.maskLock)?.visible && !asRecord(item.tagLock)?.visible
      )) ?? items[0];
      if (fallback) {
        useWithoutSaving(fallback);
        callMethod(menu, 'initData');
      }
    }
    unlockUsedData(menu.usedData);
    callMethod(menu, 'RefreList');
    callMethod(menu, 'loadMore');
    prepareAllItems(menu);
    const panel = asRecord(menu.panel);
    if (panel) panel.visible = asRecord(menu.tabGroup)?.SelectedValue === SKIN_TAB_VALUE;
    reshowLiveTab(menu);
    const chosenId = savedChoice();
    const target = findItem(menu, chosenId || currentId);
    if (target) {
      if (chosenId) callMethod(target, 'useWall');
      else {
        useWithoutSaving(target);
        saveChoice(currentId);
      }
    }
    preparedMenus.add(menu);
    unlockedMenus.add(menu);
    return true;
  }

  /** 官方背景关闭、仅开皮肤做背景时：只接管点击，选官方背景时清掉皮肤背景。 */
  function prepareMenuForExtension(menu: UnknownRecord): void {
    patchSkinItemsBuilder(menu);
    prepareAllItems(menu);
  }

  /** 关闭后让面板按游戏原逻辑重建。 */
  function restoreMenu(menu: unknown): void {
    const record = asRecord(menu);
    if (!record) return;
    callMethod(record, 'RefreList');
    if (record.panel || record.livePanel) {
      destroySkinPanel(record);
      record.wallPaperSkinItems = [];
      if (asRecord(record.tabGroup)?.SelectedValue === SKIN_TAB_VALUE) callMethod(record, 'onShowSkinitems');
      reshowLiveTab(record);
    }
    itemsOf(record, 'wallPaperItems').forEach((item) => callMethod(item, 'initUI'));
    itemsOf(record, 'wallPaperSkinItems').forEach((item) => callMethod(item, 'updateUI'));
    itemsOf(record, 'wallPaperLiveItems').forEach((item) => callMethod(item, 'updateUI'));
    preparedMenus.delete(record);
    unlockedMenus.delete(record);
  }

  function menuReady(topMenu: UnknownRecord): UnknownRecord | null {
    const menu = asRecord(topMenu.wallPaperUI);
    if (!menu) return null;
    const buttons = wallPaperTabButtons(resolveWallPaperTabGroup(menu) ?? {});
    return buttons.length ? menu : null;
  }

  function findReadyWallPaperMenu(topMenu: UnknownRecord): UnknownRecord | null {
    const direct = menuReady(topMenu);
    if (direct) return direct;
    return findWallPaperMenuOnStage(globalObject, WALLPAPER_MENU_ATTACH_STAGE_DEPTH);
  }

  function applyMenuExtension(menu: UnknownRecord, topMenu: UnknownRecord | null): void {
    // 列表是按整理时的官方背景开关建的，开关变了就按游戏原样重建一次再整理。
    if (preparedMenus.has(menu) && unlockedMenus.has(menu) !== isOfficialBackgroundOn()) restoreMenu(menu);
    if (isOfficialBackgroundOn() && !preparedMenus.has(menu)) unlockMenu(menu);
    else     if (isSkinPaperOn() && !preparedMenus.has(menu) && !isOfficialBackgroundOn()) {
      prepareMenuForExtension(menu);
      preparedMenus.add(menu);
    }
    if (shouldAttachXiaochaoTab()) {
      extension?.attachMenu(menu);
      traceWallPaperAttach('attached');
    } else {
      extension?.detachMenu(menu);
    }
    if (topMenu) watchVisibleWallPaperMenu(topMenu);
  }

  /** 背景面板就绪后挂小抄页签并解锁官方项。 */
  function prepareWallPaperMenu(menu: UnknownRecord, topMenu: UnknownRecord | null): void {
    if (!shouldEnableWallpaperMenuHooks()) return;
    if (!menuReady(menu) && !wallPaperTabButtons(resolveWallPaperTabGroup(menu) ?? {}).length) return;
    applyMenuExtension(menu, topMenu);
  }

  const WALLPAPER_MENU_INIT_METHODS = ['initData', 'loadMore', 'onShowSkinitems'] as const;

  function bindWallPaperMenuInitHooks(menu: UnknownRecord, topMenu: UnknownRecord | null): void {
    if (wallPaperMenuInitHooked.has(menu)) return;
    wallPaperMenuInitHooked.add(menu);
    for (const methodName of WALLPAPER_MENU_INIT_METHODS) {
      const proto = prototypeOf(menu);
      const hasMethod = typeof menu[methodName] === 'function' || typeof proto?.[methodName] === 'function';
      if (!hasMethod || patcher.isWrapped(menu, methodName)) continue;
      patcher.wrap(menu, methodName, (original) => function (this: UnknownRecord, ...args: unknown[]) {
        const result = original.apply(this, args);
        if (this !== menu) return result;
        if (menuReady(menu)) applyMenuExtension(menu, topMenu);
        return result;
      });
    }
  }

  function schedulePrepareTopMenuFollowUp(topMenu: UnknownRecord): void {
    for (const delay of WALLPAPER_MENU_PREWARM_FOLLOWUP_MS) {
      tasks.later(() => prepareTopMenu(topMenu), delay);
    }
  }

  /** 静默建面板后把「皮肤背景」页数据拉齐，页签才能挂上去。 */
  function primeHiddenWallPaperMenu(menu: UnknownRecord, topMenu: UnknownRecord): void {
    menu.visible = false;
    if (isSkinPaperOn() && !preparedMenus.has(menu) && !isOfficialBackgroundOn()) {
      prepareMenuForExtension(menu);
      preparedMenus.add(menu);
    }
    callMethod(menu, 'onShowSkinitems');
    callMethod(menu, 'RefreList');
    bindWallPaperMenuInitHooks(menu, topMenu);
    ensureWallPaperMenuReadyHook(menu, topMenu);
    prepareTopMenu(topMenu);
    schedulePrepareTopMenuFollowUp(topMenu);
  }

  /** 列表未就绪时包一层 RefreList，等游戏刷完页签再挂小抄页。 */
  function ensureWallPaperMenuReadyHook(menu: UnknownRecord, topMenu: UnknownRecord | null): void {
    if (menuReady(menu)) {
      applyMenuExtension(menu, topMenu);
      return;
    }
    if (wallPaperMenuRefreshHooked.has(menu)) return;
    const proto = prototypeOf(menu);
    const hasRefresh = typeof menu.RefreList === 'function' || typeof proto?.RefreList === 'function';
    if (!hasRefresh) return;
    wallPaperMenuRefreshHooked.add(menu);
    if (patcher.isWrapped(menu, 'RefreList')) return;
    patcher.wrap(menu, 'RefreList', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      const result = original.apply(this, args);
      if (this !== menu) return result;
      if (menuReady(menu)) applyMenuExtension(menu, topMenu);
      return result;
    });
  }

  /** 点开皮肤页后准备顶栏背景菜单。 */
  function prepareTopMenu(topMenu: UnknownRecord): void {
    if (!shouldEnableWallpaperMenuHooks()) return;
    const ready = menuReady(topMenu) ?? findReadyWallPaperMenu(topMenu);
    if (ready) {
      applyMenuExtension(ready, topMenu);
      return;
    }
    const openMenu = asRecord(topMenu.wallPaperUI);
    if (openMenu) ensureWallPaperMenuReadyHook(openMenu, topMenu);
    else traceWallPaperAttach('menu-not-ready');
  }

  /** 还没打开过背景面板时，静默创建一次以便挂上小抄页签。每个 topMenu 只做一次。 */
  function createHiddenMenu(topMenu: UnknownRecord): boolean {
    if (menuReady(topMenu)) return true;
    if (asRecord(topMenu.wallPaperUI)) return true;
    if (silentMenuCreated.has(topMenu)) return false;
    silentMenuCreated.add(topMenu);
    traceWallPaperAttach('create-hidden-menu');
    callMethod(topMenu, 'onClickSkin');
    const menu = asRecord(topMenu.wallPaperUI);
    if (!menu) {
      traceWallPaperAttach('create-hidden-menu-failed');
      return false;
    }
    const stage = asRecord(globalObject.Laya?.stage);
    const layaEvent = asRecord(globalObject.Laya?.Event);
    callMethod(stage, 'off', layaEvent?.CLICK, topMenu, topMenu.stageclickHandler);
    primeHiddenWallPaperMenu(menu, topMenu);
    return true;
  }

  function wallpaperMenuVisible(topMenu: UnknownRecord): boolean {
    const openMenu = asRecord(topMenu.wallPaperUI);
    return Boolean(openMenu && openMenu.visible !== false);
  }

  function maySyncWallPaperMenuNow(): boolean {
    return mayAttachWallPaperMenuExtension(
      locator,
      globalObject,
      shouldEnableWallpaperMenuHooks,
      () => {
        const topMenu = findTopMenu();
        return Boolean(topMenu && wallpaperMenuVisible(topMenu));
      }
    );
  }

  function tryEnsureWallPaperMenu(topMenu: UnknownRecord): void {
    if (!shouldEnableWallpaperMenuHooks() || !maySyncWallPaperMenuNow()) return;
    if (menuReady(topMenu)) {
      prepareTopMenu(topMenu);
      return;
    }
    const openMenu = asRecord(topMenu.wallPaperUI);
    if (openMenu?.visible !== false && wallPaperTabButtons(resolveWallPaperTabGroup(openMenu) ?? {}).length) {
      prepareWallPaperMenu(openMenu, topMenu);
      return;
    }
    if (hasVisibleWallPaperShirtEntry(locator, globalObject) || locator.gameScene()) return;
    if (createHiddenMenu(topMenu)) prepareTopMenu(topMenu);
  }

  /** 面板被用户打开后补挂页签，避免只走其它入口时漏挂。 */
  function watchVisibleWallPaperMenu(topMenu: UnknownRecord): void {
    const openMenu = asRecord(topMenu.wallPaperUI);
    if (!openMenu) return;
    if (menuReady(openMenu) && openMenu.visible !== false) {
      applyMenuExtension(openMenu, topMenu);
      return;
    }
    ensureWallPaperMenuReadyHook(openMenu, topMenu);
  }

  function wrapTopMenuOpenMethod(topMenu: UnknownRecord, methodName: string): void {
    if (patcher.isWrapped(topMenu, methodName)) return;
    const proto = prototypeOf(topMenu);
    const hasMethod = typeof topMenu[methodName] === 'function'
      || typeof proto?.[methodName] === 'function';
    if (!hasMethod) return;
    patcher.wrap(topMenu, methodName, (original) => function (this: UnknownRecord, ...args: unknown[]) {
      const result = original.apply(this, args);
      const host = asRecord(this);
      if (host && shouldEnableWallpaperMenuHooks()) {
        tasks.later(() => prepareTopMenu(host), 0);
        if (isSkinPaperOn()) schedulePrepareTopMenuFollowUp(host);
      }
      return result;
    });
  }

  /** 点在动态皮肤列表里时，不让游戏当成点了面板外面而把背景面板关掉。 */
  function keepLiveWallpaperClickInside(topMenu: UnknownRecord): void {
    const proto = prototypeOf(topMenu);
    if (typeof topMenu.stageclickHandler !== 'function' && typeof proto?.stageclickHandler !== 'function') return;
    if (patcher.isWrapped(topMenu, 'stageclickHandler')) return;
    patcher.wrap(topMenu, 'stageclickHandler', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      if (this === topMenu && shouldEnableWallpaperMenuHooks() && isInsideLiveWallpaperPanel(asRecord(args[0])?.target)) {
        return undefined;
      }
      return original.apply(this, args);
    });
  }

  function hookTopMenuSkinButton(topMenu: UnknownRecord): void {
    if (topMenu[WALLPAPER_TOP_MENU_SKIN_BTN_HOOKED_KEY]) return;
    const button = asRecord(topMenu[WALLPAPER_TOP_MENU_SKIN_BUTTON_KEY]);
    if (!button || typeof button.on !== 'function') return;
    topMenu[WALLPAPER_TOP_MENU_SKIN_BTN_HOOKED_KEY] = true;
    const layaClick = asRecord(globalObject.Laya?.Event)?.CLICK;
    if (!layaClick) return;
    const onShirtClick = () => {
      if (!isSkinPaperOn()) return;
      prepareTopMenu(topMenu);
      schedulePrepareTopMenuFollowUp(topMenu);
    };
    callMethod(button, 'on', layaClick, topMenu, onShirtClick);
  }

  function ensureTopMenuPatched(topMenu: UnknownRecord): void {
    if (patchedTopMenus.has(topMenu)) return;
    patchedTopMenus.add(topMenu);
    keepLiveWallpaperClickInside(topMenu);
    hookTopMenuSkinButton(topMenu);
    for (const methodName of WALLPAPER_TOP_MENU_OPEN_METHODS) {
      wrapTopMenuOpenMethod(topMenu, methodName);
    }
    watchVisibleWallPaperMenu(topMenu);
  }

  function enableWallPaperHooks(): void {
    if (wallPaperHooksEnabled) return;
    wallPaperHooksEnabled = true;
    traceWallPaperAttach('hooks-enabled', { hasTopMenu: Boolean(findTopMenu()) });
    scheduleSync();
  }

  function queueEnableWallPaperHooks(): void {
    if (wallPaperHooksEnabled || hookEnableQueued) return;
    hookEnableQueued = true;
    const delay = isHallGameplayUiReady(locator, globalObject) || hasVisibleWallPaperShirtEntry(locator, globalObject)
      ? 0
      : WALLPAPER_MENU_HOOK_DELAY_MS;
    tasks.later(() => {
      hookEnableQueued = false;
      if (!isBackgroundUiScene(locator, globalObject) || !shouldEnableWallpaperMenuHooks()) return;
      enableWallPaperHooks();
    }, delay);
  }

  function findTopMenu(): UnknownRecord | null {
    const ranked = findWallPaperTopMenu(locator, globalObject);
    if (ranked && topMenuCanOpenWallPaperMenu(ranked)) return ranked;
    const fromGame = asRecord(locator.gameScene()?.topMenu);
    if (fromGame && topMenuCanOpenWallPaperMenu(fromGame)) return fromGame;
    const fromScene = findSceneTopMenu(locator, globalObject);
    if (fromScene && topMenuCanOpenWallPaperMenu(fromScene)) return fromScene;
    return ranked ?? fromGame ?? fromScene
      ?? findHallWallPaperMenuHost(locator, globalObject);
  }

  function scheduleWallPaperMenuPrewarm(): void {
    if (!shouldAttachXiaochaoTab()) return;
    void preloadWallPaperUiResources(globalObject)
      .catch(() => undefined)
      .finally(() => {
        if (hasVisibleWallPaperShirtEntry(locator, globalObject)) {
          enableWallPaperHooks();
          syncWallPaperMenuAttach();
          return;
        }
        if (!isHallGameplayUiReady(locator, globalObject)) return;
        if (hallMenuPrewarmDone) return;
        hallMenuPrewarmDone = true;
        scheduleSync();
      });
  }

  function tryAttachFromStage(topMenu: UnknownRecord | null = null): void {
    if (!shouldEnableWallpaperMenuHooks()) return;
    // 顶栏已经挂着就绪面板时直接挂，别每次 sync 都深搜整棵舞台树（那是 31ms 尖峰来源）。
    if (topMenu) {
      const ready = menuReady(topMenu);
      if (ready) {
        applyMenuExtension(ready, topMenu);
        return;
      }
    }
    const menu = findWallPaperMenuOnStage(globalObject, WALLPAPER_MENU_ATTACH_STAGE_DEPTH);
    if (!menu) return;
    if (!wallPaperTabButtons(resolveWallPaperTabGroup(menu) ?? {}).length) return;
    applyMenuExtension(menu, topMenu ?? findTopMenu());
  }

  function scheduleSync(): void {
    if (isBackgroundUiScene(locator, globalObject) && shouldEnableWallpaperMenuHooks()) {
      queueEnableWallPaperHooks();
    }
    if (syncCoalescing) return;
    syncCoalescing = true;
    tasks.later(() => {
      syncCoalescing = false;
      sync();
    }, 0);
  }

  function syncWallPaperMenuAttach(): void {
    if (!shouldEnableWallpaperMenuHooks() || !maySyncWallPaperMenuNow()) return;
    const topMenu = findTopMenu();
    if (!topMenu) {
      tryAttachFromStage();
      return;
    }
    ensureTopMenuPatched(topMenu);
    tryEnsureWallPaperMenu(topMenu);
    tryAttachFromStage(topMenu);
  }

  /** 场景就绪后安装拦截；小抄页签在大厅就绪后静默挂上。 */
  function sync(): void {
    installGlobalGuards();
    if (!shouldEnableWallpaperMenuHooks()) {
      const topMenu = findTopMenu();
      if (topMenu) {
        if (!isOfficialBackgroundOn()) restoreMenu(topMenu.wallPaperUI);
        if (!shouldAttachXiaochaoTab()) {
          const openMenu = asRecord(topMenu.wallPaperUI);
          if (openMenu) extension?.detachMenu(openMenu);
        }
      }
      return;
    }
    syncWallPaperMenuAttach();
    if (!wallPaperHooksEnabled) return;
    if (!isBackgroundUiScene(locator, globalObject)) return;
    retrySkinBackgroundEventHooks(locator, patcher, tasks, globalObject);
  }

  const unsubscribes = [
    configStore.subscribe('skin.officialBackground', () => {
      scheduleSync();
      scheduleWallPaperMenuPrewarm();
    }),
    configStore.subscribe('skin.skinPaper', (detail) => {
      if (detail.value === true) {
        scheduleWallPaperMenuPrewarm();
        if (isHallGameplayUiReady(locator, globalObject) || hasVisibleWallPaperShirtEntry(locator, globalObject)) {
          enableWallPaperHooks();
        }
      }
      scheduleSync();
    })
  ];
  traceWallPaperAttach('installed');
  if (isBackgroundUiScene(locator, globalObject)) {
    installGlobalGuards();
    queueEnableWallPaperHooks();
  }
  tasks.later(() => scheduleSync(), 0);
  watchSceneSwitchRequest(locator, patcher, tasks, (sceneName) => {
    leavingToLobby = PAPER_LOBBY_SCENE_NAMES.includes(sceneName);
    if (leavingToLobby) dropMatchWallpaper(sceneName);
  }, globalObject);
  watchSceneSwitch(locator, patcher, tasks, () => {
    leavingToLobby = false;
    settleWallpaper();
    if (shouldAttachXiaochaoTab()) scheduleWallPaperMenuPrewarm();
    if (isBackgroundUiScene(locator, globalObject) && shouldEnableWallpaperMenuHooks()) {
      installGlobalGuards();
      enableWallPaperHooks();
    } else if (shouldAttachXiaochaoTab() && maySyncWallPaperMenuNow()) {
      syncWallPaperMenuAttach();
    } else {
      scheduleSync();
    }
  }, globalObject, undefined, () => true);
  if (shouldAttachXiaochaoTab()) scheduleWallPaperMenuPrewarm();
  retrySkinBackgroundEventHooks(locator, patcher, tasks, globalObject);
  return {
    sync,
    dispose() {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      tasks.dispose();
      cleanups.splice(0).forEach((cleanup) => cleanup());
      itemMethodRestores.splice(0).forEach((restore) => restore());
      patcher.restoreAll();
    }
  };
}

/** 点击落在动态皮肤列表里（含它的格子）。 */
export function isInsideLiveWallpaperPanel(target: unknown): boolean {
  let node = asRecord(target);
  for (let depth = 0; node && depth < LIVE_PANEL_CLICK_SEARCH_DEPTH; depth += 1) {
    if (node.name === LIVE_PANEL_NAME) return true;
    node = asRecord(node.parent) ?? asRecord(node._parent);
  }
  return false;
}

/** 按钮上这个处理函数实际挂在哪个事件上；找不到时返回 undefined。 */
export function boundEventName(
  button: UnknownRecord | null,
  method: unknown,
  eventNames: unknown[]
): unknown {
  const events = asRecord(button?._events);
  if (!events || typeof method !== 'function') return undefined;
  for (const name of eventNames) {
    if (typeof name !== 'string') continue;
    const entry = events[name];
    const handlers = Array.isArray(entry) ? entry : [entry];
    if (handlers.some((handler) => asRecord(handler)?.method === method)) return name;
  }
  return undefined;
}

/** 这条上报是不是背景设置结果。 */
export function isBackgroundReport(url: string, body: unknown): boolean {
  if (!BACKGROUND_REQUEST_URL.test(url)) return false;
  let text = String(body ?? '');
  try {
    text = decodeURIComponent(text);
  } catch {
    // 非 URL 编码内容按原文匹配。
  }
  return BACKGROUND_REQUEST_BODY.test(text);
}

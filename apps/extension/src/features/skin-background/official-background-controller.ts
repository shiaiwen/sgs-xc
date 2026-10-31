/**
 * 官方壁纸/动态背景控制器：与 interceptor 本地资源及皮肤纸扩展菜单协同。
 */

import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher, type PatchableFunction } from '../../runtime/method-patch.ts';
import {
  WALLPAPER_MENU_ATTACH_STAGE_DEPTH,
  WALLPAPER_MENU_HOOK_DELAY_MS,
  WALLPAPER_MENU_READY_POLL_ATTEMPTS,
  WALLPAPER_MENU_READY_POLL_MS,
  WALLPAPER_TOP_MENU_OPEN_METHODS,
  WALLPAPER_MENU_STAGE_SEARCH_DEPTH,
  WALLPAPER_VISIBLE_MENU_POLL_ATTEMPTS,
  WALLPAPER_VISIBLE_MENU_POLL_MS
} from '../../const/wallpaper-menu.ts';
import {
  accountStorageKey,
  asRecord,
  callMethod,
  createTaskScope,
  prototypeOf,
  isBackgroundUiScene,
  readJson,
  findHallWallPaperMenuHost,
  findWallPaperMenuOnStage,
  resolveHallScene,
  resolveWallPaperTabGroup,
  skinTrace,
  wallPaperTabButtons,
  writeJson,
  type UnknownRecord
} from './skin-runtime.ts';
const CHOICE_STORAGE_SUFFIX = '::XC_OFFICIAL_BACKGROUND_CHOICE';
const BACKGROUND_REQUEST_URL = /\/sgs_ccon(?:[?#]|$)/;
const BACKGROUND_REQUEST_BODY = /GAME_BG_(?:STRUCT|USEID)/;
const LOCK_NODE_NAMES = ['maskLock', 'tagLock', 'lbPowerVal', 'vipImg'];
const ITEM_METHOD_OVERRIDE = Symbol.for('sgsxc.officialBackground.itemMethodOverride');
const USED_DATA_GETTERS = ['IsCanShow', 'IsCanUse', 'IsInPlatform', 'IsSamePower'];
const SKIN_TAB_VALUE = 1;
const REQUEST_URL_KEY = '__xcOfficialBackgroundRequestUrl';

/** 皮肤做背景与背景面板的联动，由皮肤背景控制器提供。 */
export interface WallpaperMenuExtension {
  enabled(): boolean;
  /** 使用了官方背景，皮肤背景需让位。 */
  onOfficialWallpaperUsed(): void;
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
  const tasks = createTaskScope();
  const originalSelectHandlers = new WeakMap<UnknownRecord, PatchableFunction>();
  const itemMethodRestores: Array<() => void> = [];
  const preparedMenus = new Set<UnknownRecord>();
  const cleanups: Array<() => void> = [];
  let localWriteDepth = 0;
  let suppressChoiceSave = false;
  let topMenuWaiting = false;
  let syncCoalescing = false;
  let wallPaperHooksEnabled = false;
  const patchedTopMenus = new WeakSet<object>();
  const silentMenuCreated = new WeakSet<object>();
  const visibleMenuWatchStarted = new WeakSet<object>();
  let hookEnableQueued = false;
  let stageMenuWatchStarted = false;
  const isOn = () => configStore.get('skin.officialBackground') === true;
  const extensionOn = () => Boolean(extension?.enabled());

  function shouldSyncBackgroundUi(): boolean {
    return isOn() || extensionOn();
  }

  function traceWallPaperAttach(phase: string, detail: Record<string, unknown> = {}): void {
    skinTrace('wallpaper-menu', {
      phase,
      skinPaper: extensionOn(),
      officialBackground: isOn(),
      ...detail
    });
  }

  // ---------- 本地保存的选择 ----------

  function choiceStorageKey(): string {
    return `${accountStorageKey(storage)}${CHOICE_STORAGE_SUFFIX}`;
  }

  function savedChoice(): number {
    const parsed = readJson<unknown>(storage, choiceStorageKey(), null);
    const id = Number(parsed && typeof parsed === 'object' ? (parsed as UnknownRecord).id : parsed);
    return Number.isFinite(id) && id > 0 ? id : 0;
  }

  function saveChoice(value: unknown): boolean {
    const id = Number(value);
    if (suppressChoiceSave || !isOn() || !Number.isFinite(id) || id <= 0) return false;
    writeJson(storage, choiceStorageKey(), { id, savedAt: Date.now() });
    return true;
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
      if (isOn() && isBackgroundReport(String(this[REQUEST_URL_KEY] ?? ''), args[0])) {
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
      if (isOn() && localWriteDepth > 0) return undefined;
      return original.apply(this, args);
    });
  }

  let selectListenerDispatcher: UnknownRecord | null = null;
  function installDispatcherGuards(): void {
    const dispatcher = locator.dispatcher();
    if (!dispatcher) return;
    if (selectListenerDispatcher !== dispatcher && typeof dispatcher.on === 'function') {
      const listenerOwner = {};
      const onSelect = (id: unknown) => saveChoice(id);
      (dispatcher.on as PatchableFunction).call(dispatcher, 'SELECT_WALLPAPER', listenerOwner, onSelect);
      selectListenerDispatcher = dispatcher;
      cleanups.push(() => callMethod(dispatcher, 'off', 'SELECT_WALLPAPER', listenerOwner, onSelect));
    }
    patcher.wrap(dispatcher, 'event', (original) => function (this: unknown, type: unknown, data: unknown, ...rest: unknown[]) {
      return original.call(this, type, restoreChosenBackground(type, data), ...rest);
    });
  }

  function restoreChosenBackground(type: unknown, data: unknown): unknown {
    if (type !== 'BACKGROUND_USEDID_GOT' || !isOn()) return data;
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
    patcher.wrapGetter(prototype, name, (originalGet) => () => isOn() || originalGet());
  }

  function unlockUsedData(usedData: unknown): void {
    const prototype = prototypeOf(usedData);
    USED_DATA_GETTERS.forEach((name) => forceTrueGetter(prototype, name));
  }

  function unlockSkinItemData(data: unknown): void {
    forceTrueGetter(prototypeOf(data), 'canUsed');
  }

  function hideLockNodes(item: UnknownRecord): void {
    if (!isOn()) return;
    LOCK_NODE_NAMES.forEach((name) => {
      const node = asRecord(item[name]);
      if (node) node.visible = false;
    });
    const background = asRecord(item.bg);
    if (background && 'Gray' in background) background.Gray = false;
  }

  function itemId(item: UnknownRecord): number {
    return Number(item.ID ?? item.Id ?? item.id ?? asRecord(item.data)?.ID ?? 0);
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

  /** 背景项去锁，点击直接使用，使用时只写本地。 */
  function prepareItem(item: unknown, isSkinItem: boolean): void {
    const record = asRecord(item);
    const prototype = prototypeOf(record);
    if (!record || !prototype) return;
    for (const name of ['initUI', 'updateUI']) {
      overrideItemInstanceMethod(record, name, (original) => function (this: UnknownRecord, ...args: unknown[]) {
        const result = original.apply(this, args);
        hideLockNodes(this);
        return result;
      });
    }
    overrideItemInstanceMethod(record, 'useWall', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      if (!isOn()) return original.apply(this, args);
      const result = writeLocally(() => original.apply(this, args));
      saveChoice(itemId(this));
      markWallpaperSelection(this);
      return result;
    });
    overrideItemInstanceMethod(record, 'onSelectedClicked', (original) => {
      originalSelectHandlers.set(record, original);
      return function (this: UnknownRecord, ...args: unknown[]) {
        const useWallMethod = this.useWall as PatchableFunction | undefined;
        const result = isOn() && typeof useWallMethod === 'function'
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
    const eventName = isSkinItem ? layaEvent?.CLICK : layaEvent?.MOUSE_DOWN;
    if (!button || typeof handler !== 'function' || !eventName) return;
    const original = originalSelectHandlers.get(item);
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
    const proto = prototypeOf(menu);
    if (typeof menu.onShowSkinitems !== 'function' && typeof proto?.onShowSkinitems !== 'function') return;
    if (patcher.isWrapped(menu, 'onShowSkinitems')) return;
    patcher.wrap(menu, 'onShowSkinitems', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      if (this !== menu) return original.apply(this, args);
      const result = isOn() ? withAllSkinsOwned(() => original.apply(this, args)) : original.apply(this, args);
      if (isOn() || extensionOn()) {
        itemsOf(this, 'wallPaperSkinItems').forEach((item) => {
          if (isOn()) unlockSkinItemData(item.data);
          prepareItem(item, true);
        });
        const chosen = findItem(this, savedChoice());
        if (chosen) markWallpaperSelection(chosen);
      }
      return result;
    });
  }

  function itemsOf(menu: UnknownRecord, key: 'wallPaperItems' | 'wallPaperSkinItems'): UnknownRecord[] {
    const list = menu[key];
    return Array.isArray(list) ? list.map(asRecord).filter((item): item is UnknownRecord => item !== null) : [];
  }

  function prepareAllItems(menu: UnknownRecord): void {
    itemsOf(menu, 'wallPaperItems').forEach((item) => prepareItem(item, false));
    itemsOf(menu, 'wallPaperSkinItems').forEach((item) => {
      if (isOn()) unlockSkinItemData(item.data);
      prepareItem(item, true);
    });
  }

  function destroySkinPanel(menu: UnknownRecord): void {
    const panel = asRecord(menu.panel);
    if (!panel) return;
    callMethod(menu, 'clearItems');
    callMethod(panel, 'removeSelf');
    callMethod(panel, 'destroy', true);
    menu.panel = null;
  }

  /** 皮肤背景和主题背景共用勾选图，点中的那一项才显示。 */
  function markWallpaperSelection(clicked: UnknownRecord): void {
    for (const menu of preparedMenus) {
      const skins = itemsOf(menu, 'wallPaperSkinItems');
      const themes = itemsOf(menu, 'wallPaperItems');
      if (!skins.includes(clicked) && !themes.includes(clicked)) continue;
      for (const item of [...themes, ...skins]) showSelectedMark(item, item === clicked);
    }
  }

  function showSelectedMark(item: UnknownRecord, selected: boolean): void {
    const mark = asRecord(item.selectedImg);
    if (!mark) return;
    mark.visible = selected;
    mark.zOrder = 999;
    if (selected) callMethod(item, 'setChildIndex', mark, Number(item.numChildren) || 0);
  }

  function selectedItemId(menu: UnknownRecord): number {
    const selected = [...itemsOf(menu, 'wallPaperItems'), ...itemsOf(menu, 'wallPaperSkinItems')]
      .find((item) => asRecord(item.selectedImg)?.visible);
    return selected ? itemId(selected) : 0;
  }

  function findItem(menu: UnknownRecord, id: number): UnknownRecord | undefined {
    return [...itemsOf(menu, 'wallPaperItems'), ...itemsOf(menu, 'wallPaperSkinItems')]
      .find((item) => itemId(item) === id);
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
    if (!isOn()) return false;
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
    if (record.panel) {
      destroySkinPanel(record);
      record.wallPaperSkinItems = [];
      if (asRecord(record.tabGroup)?.SelectedValue === SKIN_TAB_VALUE) callMethod(record, 'onShowSkinitems');
    }
    itemsOf(record, 'wallPaperItems').forEach((item) => callMethod(item, 'initUI'));
    itemsOf(record, 'wallPaperSkinItems').forEach((item) => callMethod(item, 'updateUI'));
    preparedMenus.delete(record);
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
    if (isOn() && !preparedMenus.has(menu)) unlockMenu(menu);
    else if (extensionOn() && !preparedMenus.has(menu)) {
      prepareMenuForExtension(menu);
      preparedMenus.add(menu);
    }
    if (extensionOn()) {
      extension?.attachMenu(menu);
      traceWallPaperAttach('attached');
    }
    if (topMenu) watchVisibleWallPaperMenu(topMenu);
  }

  /** 背景面板就绪后挂小抄页签并解锁官方项。 */
  function prepareWallPaperMenu(menu: UnknownRecord, topMenu: UnknownRecord | null): void {
    if (!shouldSyncBackgroundUi()) return;
    if (!menuReady(menu) && !wallPaperTabButtons(resolveWallPaperTabGroup(menu) ?? {}).length) return;
    applyMenuExtension(menu, topMenu);
  }

  /** 点开皮肤页后准备顶栏背景菜单。 */
  function prepareTopMenu(topMenu: UnknownRecord): void {
    if (!shouldSyncBackgroundUi()) return;
    void tasks.poll(() => menuReady(topMenu), WALLPAPER_MENU_READY_POLL_MS, WALLPAPER_MENU_READY_POLL_ATTEMPTS)
      .then((menu) => {
        if (menu) {
          applyMenuExtension(menu, topMenu);
          return;
        }
        const fallback = findReadyWallPaperMenu(topMenu);
        if (fallback) applyMenuExtension(fallback, topMenu);
        else traceWallPaperAttach('menu-not-ready');
      });
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
    menu.visible = false;
    const stage = asRecord(globalObject.Laya?.stage);
    const layaEvent = asRecord(globalObject.Laya?.Event);
    callMethod(stage, 'off', layaEvent?.CLICK, topMenu, topMenu.stageclickHandler);
    return true;
  }

  function tryEnsureWallPaperMenu(topMenu: UnknownRecord): void {
    if (!shouldSyncBackgroundUi()) return;
    if (menuReady(topMenu)) {
      prepareTopMenu(topMenu);
      return;
    }
    const openMenu = asRecord(topMenu.wallPaperUI);
    if (openMenu?.visible !== false && wallPaperTabButtons(resolveWallPaperTabGroup(openMenu) ?? {}).length) {
      prepareWallPaperMenu(openMenu, topMenu);
      return;
    }
    if (createHiddenMenu(topMenu)) prepareTopMenu(topMenu);
  }

  /** 面板被用户打开后补挂页签，避免只走其它入口时漏挂。 */
  function watchVisibleWallPaperMenu(topMenu: UnknownRecord): void {
    if (visibleMenuWatchStarted.has(topMenu)) return;
    visibleMenuWatchStarted.add(topMenu);
    void tasks.poll(() => {
      const menu = menuReady(topMenu);
      if (menu && menu.visible !== false) return menu;
      const fallback = findReadyWallPaperMenu(topMenu);
      if (fallback && fallback.visible !== false) return fallback;
      return null;
    }, WALLPAPER_VISIBLE_MENU_POLL_MS, WALLPAPER_VISIBLE_MENU_POLL_ATTEMPTS).then((menu) => {
      if (menu) applyMenuExtension(menu, topMenu);
    });
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
      if (host) tasks.later(() => prepareTopMenu(host), 0);
      return result;
    });
  }

  function ensureTopMenuPatched(topMenu: UnknownRecord): void {
    if (patchedTopMenus.has(topMenu)) return;
    patchedTopMenus.add(topMenu);
    for (const methodName of WALLPAPER_TOP_MENU_OPEN_METHODS) {
      wrapTopMenuOpenMethod(topMenu, methodName);
    }
    watchVisibleWallPaperMenu(topMenu);
  }

  function enableWallPaperHooks(): void {
    if (wallPaperHooksEnabled) return;
    wallPaperHooksEnabled = true;
    traceWallPaperAttach('hooks-enabled', { hasTopMenu: Boolean(findTopMenu()) });
    watchStageWallPaperMenu();
    scheduleSync();
  }

  function queueEnableWallPaperHooks(): void {
    if (wallPaperHooksEnabled || hookEnableQueued) return;
    hookEnableQueued = true;
    tasks.later(() => {
      hookEnableQueued = false;
      if (!isBackgroundUiScene(locator, globalObject) || !shouldSyncBackgroundUi()) return;
      enableWallPaperHooks();
    }, WALLPAPER_MENU_HOOK_DELAY_MS);
  }

  function findTopMenu(): UnknownRecord | null {
    const fromScene = asRecord(locator.scene()?.topMenu);
    if (fromScene) return fromScene;
    const hall = resolveHallScene(locator, globalObject);
    const fromHall = asRecord(hall?.topMenu);
    if (fromHall) return fromHall;
    return findHallWallPaperMenuHost(locator, globalObject);
  }

  function tryAttachFromStage(): void {
    if (!shouldSyncBackgroundUi()) return;
    const menu = findWallPaperMenuOnStage(globalObject, WALLPAPER_MENU_STAGE_SEARCH_DEPTH);
    if (!menu) return;
    if (!wallPaperTabButtons(resolveWallPaperTabGroup(menu) ?? {}).length) return;
    applyMenuExtension(menu, findTopMenu());
  }

  /** 无 topMenu 或面板挂在舞台其它节点时，轮询挂上小抄页签。 */
  function watchStageWallPaperMenu(): void {
    if (stageMenuWatchStarted) return;
    stageMenuWatchStarted = true;
    void tasks.poll(() => {
      if (!wallPaperHooksEnabled || !shouldSyncBackgroundUi()) return null;
      const menu = findWallPaperMenuOnStage(globalObject, WALLPAPER_MENU_ATTACH_STAGE_DEPTH);
      if (!menu) return null;
      if (!wallPaperTabButtons(resolveWallPaperTabGroup(menu) ?? {}).length) return null;
      return menu;
    }, 500, 240).then((menu) => {
      if (menu) applyMenuExtension(menu, findTopMenu());
    });
  }

  function scheduleSync(): void {
    if (isBackgroundUiScene(locator, globalObject) && shouldSyncBackgroundUi()) {
      queueEnableWallPaperHooks();
    }
    if (syncCoalescing) return;
    syncCoalescing = true;
    tasks.later(() => {
      syncCoalescing = false;
      sync();
    }, 0);
  }

  /** 场景就绪后安装拦截；小抄页签只在用户打开背景面板时挂上。 */
  function sync(): void {
    if (!wallPaperHooksEnabled) return;
    if (!shouldSyncBackgroundUi()) {
      const topMenu = findTopMenu();
      if (topMenu) {
        if (!isOn()) restoreMenu(topMenu.wallPaperUI);
        const openMenu = asRecord(topMenu.wallPaperUI);
        if (openMenu) extension?.detachMenu(openMenu);
      }
      return;
    }
    if (!isBackgroundUiScene(locator, globalObject)) return;
    const topMenu = findTopMenu();
    if (!topMenu) {
      tryAttachFromStage();
      waitForTopMenu();
      return;
    }
    ensureTopMenuPatched(topMenu);
    tryEnsureWallPaperMenu(topMenu);
    tryAttachFromStage();
  }

  function waitForTopMenu(): void {
    if (topMenuWaiting) return;
    topMenuWaiting = true;
    void tasks.poll(() => findTopMenu(), 100, 50).then((topMenu) => {
      topMenuWaiting = false;
      if (topMenu) scheduleSync();
    });
  }

  const unsubscribes = [
    configStore.subscribe('skin.officialBackground', () => scheduleSync()),
    configStore.subscribe('skin.skinPaper', () => scheduleSync())
  ];
  traceWallPaperAttach('installed');
  void tasks.poll(() => (isBackgroundUiScene(locator, globalObject) ? 'ready' : null), Infinity, 1000).then((token) => {
    if (token) queueEnableWallPaperHooks();
  });
  void tasks.poll(() => {
    if (wallPaperHooksEnabled) return 'done';
    if (!shouldSyncBackgroundUi() || !isBackgroundUiScene(locator, globalObject)) return null;
    return 'enable';
  }, Infinity, 1500).then((token) => {
    if (token === 'enable') enableWallPaperHooks();
  });
  tasks.later(() => scheduleSync(), 0);

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

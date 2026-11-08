/**
 * 皮肤收藏 Tab：在游戏皮肤相关界面扩展收藏列表交互。
 */

import type { LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { skinFavoritesGridPosition } from '../../const/skin-favorites-grid.ts';
import {
  WALLPAPER_BACKGROUND_TAB_LAYOUT_KEY,
  WALLPAPER_FAVORITES_TAB_DEFAULT_HEIGHT,
  WALLPAPER_TAB_TEXTURE_SHADOW_WIDTH
} from '../../const/wallpaper-favorites-tab-layout.ts';
import { WALLPAPER_LIVE_PANEL_KEY, isWallpaperMenuLiveTabValue } from '../../const/wallpaper-menu.ts';
import type { MethodPatcher, PatchableFunction } from '../../runtime/method-patch.ts';
import type { BackgroundFavorite, BackgroundResource, SkinBackgroundStore } from './skin-background-store.ts';
import { raiseWallpaperSelectedMark } from './wallpaper-selection-marks.ts';
import {
  asRecord,
  callMethod,
  resolveWallPaperTabGroup,
  skinTrace,
  wallPaperTabButtons,
  type UnknownRecord
} from './skin-runtime.ts';

const TAB_VALUE = 'xcSkinBackgroundFavorites';
const TAB_MARKER = '__xcSkinBackgroundFavoritesTab';
const TAB_FLEX_LOOP_KEY = '__xcTabFlexLoop';
const TAB_KEEP_KEY = '__xcFavoritesTabButton';
const TAB_DETACHED_KEY = '__xcFavoritesTabDetached';
const TAB_NATIVE_WIDTH_KEY = '__xcTabNativeWidth';
const PREVIEW_WIDTH = 95;
const PREVIEW_HEIGHT = 40;

export interface FavoritesTabOptions {
  globalObject: LayaRuntimeWindow;
  store: SkinBackgroundStore;
  patcher: MethodPatcher;
  enabled(): boolean;
  /** 点击收藏项时设为背景。 */
  applyFavorite(resource: BackgroundResource): Promise<boolean>;
  /** 收藏项是否为当前背景。 */
  isCurrent(favorite: BackgroundFavorite): boolean;
}

export interface FavoritesTab {
  attach(menu: UnknownRecord): void;
  detach(menu: UnknownRecord): void;
  /** 当前背景变化后刷新选中态。 */
  refreshSelection(): void;
  dispose(): void;
}

interface MenuState {
  panel?: UnknownRecord;
  items: UnknownRecord[];
  empty?: UnknownRecord;
  loadMoreVisibility?: { text: unknown; background: unknown };
  /** 显示小抄列表时被藏起来的动态皮肤列表，回到动态皮肤页时还回去。 */
  hiddenLivePanel?: UnknownRecord;
  tabEvent?: string;
  tabBound?: boolean;
}

/** 背景面板中的「小抄背景」页签。 */
export function createFavoritesTab(options: FavoritesTabOptions): FavoritesTab {
  const { globalObject, store, patcher } = options;
  const states = new WeakMap<object, MenuState>();
  const menus = new Set<UnknownRecord>();
  const previewTextures = new WeakMap<object, UnknownRecord>();
  const nativeTabClick = new WeakMap<object, PatchableFunction>();
  let itemConstructor: (new () => UnknownRecord) | null = null;
  let panelConstructor: (new () => UnknownRecord) | null = null;

  const laya = () => asRecord(globalObject.Laya);
  const layaEvent = () => asRecord(laya()?.Event);

  function stateOf(menu: UnknownRecord): MenuState {
    let state = states.get(menu);
    if (!state) {
      state = { items: [] };
      states.set(menu, state);
    }
    return state;
  }

  function isSelected(menu: UnknownRecord): boolean {
    const group = resolveWallPaperTabGroup(menu);
    return group?.SelectedValue === TAB_VALUE;
  }

  function mutableTabButtons(group: UnknownRecord): UnknownRecord[] | null {
    if (Array.isArray(group.BtnList)) return group.BtnList as UnknownRecord[];
    const normalized = wallPaperTabButtons(group);
    if (!normalized.length) return null;
    group.BtnList = normalized;
    return normalized;
  }

  function favoritesTabIndex(group: UnknownRecord): number {
    const buttons = mutableTabButtons(group);
    if (!buttons) return -1;
    return buttons.findIndex((button) => button.value === TAB_VALUE || button[TAB_MARKER]);
  }

  function isCurrentFromFavorites(): boolean {
    return store.favorites().some((favorite) => options.isCurrent(favorite));
  }

  /** 选中「小抄背景」页签并展示收藏列表面板。 */
  function activateFavoritesTab(menu: UnknownRecord): void {
    if (!options.enabled()) return;
    bindTabSwitch(menu);
    if (!ensureTab(menu)) return;
    const group = resolveWallPaperTabGroup(menu);
    callMethod(group, 'LayoutBtn');
    const index = group ? favoritesTabIndex(group) : -1;
    if (index >= 0) callMethod(group, 'SelectTab', index);
    const prototype = Object.getPrototypeOf(menu) as UnknownRecord | null;
    const onTabClick = prototype?.onTabClick;
    if (typeof onTabClick === 'function') {
      callMethod(menu, 'onTabClick', TAB_VALUE);
      return;
    }
    showPanel(menu, true);
  }

  function rememberConstructors(menu: UnknownRecord): void {
    const skinItems = Array.isArray(menu.wallPaperSkinItems) ? menu.wallPaperSkinItems as unknown[] : [];
    const item = skinItems.map(asRecord).find((entry) => typeof entry?.constructor === 'function');
    if (item) itemConstructor = item.constructor as new () => UnknownRecord;
    const panel = asRecord(menu.panel);
    if (typeof panel?.constructor === 'function') panelConstructor = panel.constructor as new () => UnknownRecord;
  }

  // ---------- 列表项 ----------

  function clearItems(menu: UnknownRecord): void {
    const state = stateOf(menu);
    state.items.splice(0).forEach((item) => callMethod(item, 'destroy', true));
    callMethod(state.empty, 'destroy', true);
    state.empty = undefined;
  }

  function ensurePanel(menu: UnknownRecord): UnknownRecord | null {
    const state = stateOf(menu);
    if (state.panel && state.panel !== menu.panel && !state.panel.destroyed) return state.panel;
    const nativePanel = asRecord(menu.panel);
    if (typeof nativePanel?.constructor === 'function') panelConstructor = nativePanel.constructor as new () => UnknownRecord;
    const PanelClass = panelConstructor;
    if (!PanelClass) return null;
    let panel: UnknownRecord;
    try {
      panel = new PanelClass();
    } catch {
      return null;
    }
    panel.name = 'WallSkinPanel';
    callMethod(panel, 'size',
      Number(nativePanel?.width) || 311,
      Number(nativePanel?.height) || Math.max(200, Number(menu.panelHeight) - 20 || 400));
    callMethod(panel, 'pos', Number(nativePanel?.x) || 0, Number(nativePanel?.y) || 10);
    panel.visible = false;
    panel.mouseEnabled = true;
    const tabIndex = Number(callMethod(menu, 'getChildIndex', menu.tabGroup));
    if (Number.isInteger(tabIndex) && tabIndex >= 0 && typeof menu.addChildAt === 'function') callMethod(menu, 'addChildAt', panel, tabIndex);
    else callMethod(menu, 'addChild', panel);
    state.panel = panel;
    return panel;
  }

  function previewUrl(favorite: BackgroundFavorite): string {
    return favorite.resource.type === 0 && favorite.resource.url ? favorite.resource.url : favorite.previewUrl;
  }

  function textureAlive(texture: unknown): boolean {
    const bitmap = asRecord(asRecord(texture)?.bitmap);
    return Boolean(bitmap) && bitmap!.destroyed !== true && bitmap!._destroyed !== true && bitmap!.released !== true;
  }

  function releasePreview(item: UnknownRecord): void {
    const background = asRecord(item.bg);
    const cropped = background ? previewTextures.get(background) : undefined;
    if (!background || !cropped) return;
    previewTextures.delete(background);
    const source = asRecord(cropped.__xcSourceTexture);
    callMethod(source, '_removeReference');
    callMethod(cropped, 'destroy', false);
  }

  /** 预览图按 95×40 居中裁切。 */
  function cropPreview(item: UnknownRecord): boolean {
    const background = asRecord(item.bg);
    if (!background) return false;
    const texture = asRecord(background.texture);
    if (!texture || (background.skin && texture.url !== background.skin)) {
      callMethod(background, 'size', PREVIEW_WIDTH, PREVIEW_HEIGHT);
      return false;
    }
    if (!textureAlive(texture)) return reloadPreview(item);
    if (texture === previewTextures.get(background)) return true;
    const width = Number(texture.width);
    const height = Number(texture.height);
    if (!(width > 0 && height > 0)) return false;
    const ratio = PREVIEW_WIDTH / PREVIEW_HEIGHT;
    let cropWidth = width;
    let cropHeight = height;
    let offsetX = 0;
    let offsetY = 0;
    if (width / height > ratio) {
      cropWidth = height * ratio;
      offsetX = (width - cropWidth) / 2;
    } else if (width / height < ratio) {
      cropHeight = width / ratio;
      offsetY = (height - cropHeight) / 2;
    }
    const TextureClass = asRecord(laya()?.Texture);
    const cropped = asRecord(callMethod(TextureClass, 'createFromTexture', texture, offsetX, offsetY, cropWidth, cropHeight));
    if (!cropped) return false;
    Object.defineProperty(cropped, 'url', { value: String(background.skin || texture.url) });
    callMethod(texture, '_addReference');
    cropped.__xcSourceTexture = texture;
    releasePreview(item);
    previewTextures.set(background, cropped);
    background.texture = cropped;
    callMethod(background, 'size', PREVIEW_WIDTH, PREVIEW_HEIGHT);
    return true;
  }

  function armPreview(item: UnknownRecord): void {
    const background = asRecord(item.bg);
    const complete = layaEvent()?.COMPLETE;
    if (!background || !complete) return;
    callMethod(background, 'off', complete, item, onPreviewLoaded);
    callMethod(background, 'once', complete, item, onPreviewLoaded);
  }

  function onPreviewLoaded(this: UnknownRecord): void {
    cropPreview(this);
  }

  /** 纹理被回收后重新加载。 */
  function reloadPreview(item: UnknownRecord): boolean {
    const background = asRecord(item.bg);
    const skin = String(background?.skin || '');
    if (!background || !skin) return false;
    try {
      callMethod(asRecord(laya()?.loader), 'clearRes', skin, true);
    } catch {
      // 清缓存失败时仍尝试重新赋值。
    }
    background.skin = '';
    background.skin = skin;
    armPreview(item);
    return true;
  }

  function createItem(menu: UnknownRecord, favorite: BackgroundFavorite, index: number, panel: UnknownRecord): UnknownRecord | null {
    const ItemClass = itemConstructor;
    if (!ItemClass) return null;
    let item: UnknownRecord;
    try {
      item = new ItemClass();
    } catch {
      return null;
    }
    const clickEvent = layaEvent()?.CLICK;
    const selectButton = asRecord(item.selectedBtn);
    if (selectButton && typeof item.onSelectedClicked === 'function') {
      callMethod(selectButton, 'off', clickEvent, item, item.onSelectedClicked);
    }
    const choose = async (event?: unknown) => {
      callMethod(event, 'stopPropagation');
      if (!options.enabled()) return false;
      const applied = await options.applyFavorite(favorite.resource);
      if (applied) refreshSelection();
      return applied;
    };
    item.onSelectedClicked = choose;
    item.useWall = choose;
    item.UpdateSelectedUI = function (this: UnknownRecord) {
      const selected = asRecord(this.selectedImg);
      if (selected) selected.visible = options.isCurrent(favorite);
      const background = asRecord(this.bg);
      if (background) background.visible = true;
      const texture = background?.texture;
      if (background && texture && texture === previewTextures.get(background) && !textureAlive(texture)) reloadPreview(this);
    };
    const nativeUpdate = item.updateUI;
    if (typeof nativeUpdate === 'function') {
      item.updateUI = function (this: UnknownRecord, ...args: unknown[]) {
        const background = asRecord(this.bg);
        if (background) {
          armPreview(this);
          callMethod(background, 'size', PREVIEW_WIDTH, PREVIEW_HEIGHT);
          background.scrollRect = null;
        }
        const result = (nativeUpdate as PatchableFunction).apply(this, args);
        if (background) background.visible = true;
        return result;
      };
    }
    const nativeDestroy = item.destroy;
    if (typeof nativeDestroy === 'function') {
      item.destroy = function (this: UnknownRecord, ...args: unknown[]) {
        const result = (nativeDestroy as PatchableFunction).apply(this, args);
        releasePreview(this);
        return result;
      };
    }
    callMethod(selectButton, 'on', clickEvent, item, choose);
    callMethod(panel, 'addChild', item);
    callMethod(item, 'UpdateData', {
      ID: -(index + 1),
      SkinID: Number(favorite.skinId) || 0,
      Name: favorite.name,
      IconURL: previewUrl(favorite),
      IsUsual: options.isCurrent(favorite),
      canUsed: true
    });
    callMethod(item, 'UpdateSelectedUI');
    const mark = asRecord(item.selectedImg);
    if (mark) {
      mark.visible = options.isCurrent(favorite);
      mark.zOrder = 999;
      raiseWallpaperSelectedMark(item, mark);
    }
    const { offsetX, offsetY } = skinFavoritesGridPosition(index);
    callMethod(item, 'pos', offsetX, offsetY);
    item.visible = true;
    item.mouseEnabled = true;
    return item;
  }

  function createEmptyHint(panel: UnknownRecord, hasFavorites: boolean): UnknownRecord | null {
    const SpriteClass = laya()?.Sprite as (new () => UnknownRecord) | undefined;
    const TextClass = laya()?.Text as (new () => UnknownRecord) | undefined;
    if (!SpriteClass || !TextClass) return null;
    const hint = new SpriteClass();
    const text = new TextClass();
    const width = Number(panel.width) || 311;
    const height = Math.max(100, Number(panel.height) || 400);
    Object.assign(text, {
      text: hasFavorites ? '皮肤背景列表尚未就绪' : '还没有收藏背景\n请在皮肤详情中点击“收藏背景”',
      font: 'SimSun',
      fontSize: 12,
      color: '#DDCF98',
      align: 'center',
      valign: 'middle',
      leading: 8,
      mouseEnabled: false
    });
    callMethod(text, 'size', width, height);
    callMethod(hint, 'size', width, height);
    hint.mouseEnabled = false;
    hint.Drawed = false;
    hint.Draw = function (this: UnknownRecord) {
      this.Drawed = true;
      this.visible = true;
    };
    hint.ClearDraw = function (this: UnknownRecord) {
      this.Drawed = false;
      this.visible = false;
    };
    callMethod(hint, 'addChild', text);
    callMethod(panel, 'addChild', hint);
    return hint;
  }

  /** 重建收藏列表。 */
  function renderList(menu: UnknownRecord): boolean {
    rememberConstructors(menu);
    const panel = ensurePanel(menu);
    if (!panel) return false;
    clearItems(menu);
    const state = stateOf(menu);
    const favorites = store.favorites();
    if (!favorites.length || !itemConstructor) {
      state.empty = createEmptyHint(panel, favorites.length > 0) ?? undefined;
    } else {
      favorites.forEach((favorite, index) => {
        const item = createItem(menu, favorite, index, panel);
        if (item) state.items.push(item);
      });
    }
    callMethod(panel, 'UpdateDrawContent');
    const scrollBar = asRecord(panel.vScrollBar);
    callMethod(scrollBar, 'stopScroll');
    if (scrollBar) scrollBar.value = 0;
    callMethod(panel, 'refresh');
    return true;
  }

  function toggleLoadMore(menu: UnknownRecord, hide: boolean): void {
    const state = stateOf(menu);
    const text = asRecord(menu.loadMoreTxt);
    const background = asRecord(menu.loadMoreBg);
    if (hide) {
      state.loadMoreVisibility ??= { text: text?.visible, background: background?.visible };
      if (text) text.visible = false;
      if (background) background.visible = false;
      return;
    }
    const saved = state.loadMoreVisibility;
    if (!saved) return;
    if (text) text.visible = saved.text;
    if (background) background.visible = saved.background;
    state.loadMoreVisibility = undefined;
  }

  /** 动态皮肤页的列表面板没人收时会盖在小抄列表上，显示小抄列表前先藏起来。 */
  function hideLiveList(menu: UnknownRecord): void {
    const live = asRecord(menu[WALLPAPER_LIVE_PANEL_KEY]);
    if (!live || live.destroyed === true || live.visible !== true) return;
    stateOf(menu).hiddenLivePanel = live;
    live.visible = false;
  }

  /** 回到动态皮肤页时，把被藏起来的列表还给游戏。 */
  function restoreLiveList(menu: UnknownRecord): void {
    const state = stateOf(menu);
    const live = state.hiddenLivePanel;
    state.hiddenLivePanel = undefined;
    if (live && live.destroyed !== true) live.visible = true;
  }

  /** 从页签点击参数里取出被点页签的值，参数可能是值、数组或带 target 的事件。 */
  function clickedTabValue(argument: unknown): unknown {
    const first = Array.isArray(argument) ? argument[0] : argument;
    const event = asRecord(first);
    const button = asRecord(event?.target) ?? asRecord(event?.currentTarget);
    return button && 'value' in button ? button.value : first;
  }

  /** 显示或隐藏收藏面板。 */
  function showPanel(menu: UnknownRecord, show: boolean, restoreLoadMore = true): boolean {
    const state = stateOf(menu);
    if (!show) {
      if (restoreLoadMore) toggleLoadMore(menu, false);
      if (state.panel && state.panel !== menu.panel) state.panel.visible = false;
      return true;
    }
    const favorites = store.favorites();
    (Array.isArray(menu.wallPaperItems) ? menu.wallPaperItems as unknown[] : []).forEach((item) => {
      const record = asRecord(item);
      if (record) record.visible = false;
    });
    const noSkin = asRecord(menu.noSkinWallSpr);
    if (noSkin) noSkin.visible = false;
    rememberConstructors(menu);
    if (!menu.panel || (favorites.length && !itemConstructor)) {
      // 原生面板与列表项在首次“加载更多”时才创建，借它拿到构造器。
      const visible = menu.visible !== false;
      if (visible) menu.visible = false;
      try {
        callMethod(menu, 'loadMore');
      } finally {
        if (visible) menu.visible = true;
      }
      rememberConstructors(menu);
    }
    const nativePanel = asRecord(menu.panel);
    if (nativePanel) nativePanel.visible = false;
    hideLiveList(menu);
    toggleLoadMore(menu, true);
    const panel = ensurePanel(menu);
    if (!panel) return false;
    renderList(menu);
    panel.visible = true;
    return true;
  }

  // ---------- 页签 ----------

  /** 复制第一个原生页签按钮的样式，建立「小抄背景」页签。 */
  function ensureTab(menu: UnknownRecord): UnknownRecord | null {
    const group = resolveWallPaperTabGroup(menu);
    if (!group) return null;
    const buttons = mutableTabButtons(group);
    if (!buttons?.length) return null;
    const existing = buttons.find((button) => button.value === TAB_VALUE || button[TAB_MARKER]);
    if (existing && existing.destroyed !== true && existing._destroyed !== true) {
      placeFavoritesTabLast(menu, group, buttons, existing);
      return existing;
    }
    if (existing) {
      const staleIndex = buttons.indexOf(existing);
      if (staleIndex >= 0) buttons.splice(staleIndex, 1);
    }
    const template = buttons[0];
    let tab: UnknownRecord | null = null;
    try {
      tab = typeof template?.constructor === 'function' ? new (template.constructor as new () => UnknownRecord)() : null;
    } catch {
      tab = null;
    }
    if (!tab) tab = asRecord(callMethod(template, 'clone'));
    if (!tab) return null;
    const skins = Array.isArray(template?.skins) ? Array.from(template!.skins as unknown[]) : [];
    if (skins.some(Boolean) && typeof tab.InitSkin === 'function') callMethod(tab, 'InitSkin', ...skins);
    else callMethod(tab, 'init');
    if (template) {
      callMethod(tab, 'size', Number(template.width) || Number(tab.width) || 0, Number(template.height) || Number(tab.height) || 0);
      const field = asRecord(template.textField);
      if (field?.font) tab.labelFont = field.font;
      if (Number(field?.fontSize) > 0) tab.labelSize = Number(field!.fontSize);
      if (typeof field?.bold === 'boolean') tab.labelBold = field.bold;
      if (Number(field?.stroke) > 0) tab.labelStroke = Number(field!.stroke);
      if (Array.isArray(template._labelColors)) tab.labelColors = (template._labelColors as unknown[]).join(',');
      if (Array.isArray(template._strokeColors)) tab.strokeColors = (template._strokeColors as unknown[]).join(',');
      if (Array.isArray(template._labelPadding)) tab.labelPadding = (template._labelPadding as unknown[]).join(',');
      if (template._soundRes) tab.soundRes = template._soundRes;
    }
    Object.assign(tab, {
      label: '小抄背景',
      value: TAB_VALUE,
      name: 'ChangeBgSkinBtn',
      [TAB_MARKER]: true,
      visible: true,
      enabled: true,
      mouseEnabled: true
    });
    group[TAB_KEEP_KEY] = tab;
    if (typeof tab.AfterInitUiByGroup === 'function') {
      callMethod(tab, 'AfterInitUiByGroup', { label: tab.label, value: tab.value });
    }
    placeFavoritesTabLast(menu, group, buttons, tab);
    tab.visible = true;
    return tab;
  }

  function restoreNativeTabWidths(menu: UnknownRecord, group: UnknownRecord, buttons: UnknownRecord[]): void {
    const rowWidth = nativeTabRowWidth(menu, group, buttons);
    const nativeButtons = buttons.filter((button) => !isFavoritesTabButton(button));
    shareTabRow(group, nativeButtons, rowWidth);
    bindEqualTabLayout(menu, group, buttons, rowWidth);
    ensureTabFlexLoop(menu, group, buttons, rowWidth);
  }

  function isFavoritesTabButton(button: UnknownRecord): boolean {
    return button.value === TAB_VALUE || button[TAB_MARKER] === true;
  }

  /** 页签这一行占满整个面板宽度。读不到面板宽时退回页签组和按钮占的宽。 */
  function nativeTabRowWidth(menu: UnknownRecord, group: UnknownRecord, buttons: UnknownRecord[]): number {
    const saved = asRecord(group[WALLPAPER_BACKGROUND_TAB_LAYOUT_KEY]);
    const savedWidth = Number(saved?.rowWidth) || 0;
    if (savedWidth > 0) return savedWidth;
    const menuWidth = Number(menu.width) || 0;
    if (menuWidth > 0) {
      group[WALLPAPER_BACKGROUND_TAB_LAYOUT_KEY] = { rowWidth: menuWidth, fromMenu: true };
      return menuWidth;
    }
    const groupWidth = Number(group.width) || Number(group.displayWidth) || 0;
    let right = 0;
    for (const button of buttons) {
      if (isFavoritesTabButton(button)) continue;
      const left = Number(button.x) || 0;
      const width = Number(button.width) || Number(button.displayWidth) || Number(button._width) || 0;
      right = Math.max(right, left + width);
    }
    const rowWidth = Math.max(groupWidth, right);
    if (rowWidth > 0) group[WALLPAPER_BACKGROUND_TAB_LAYOUT_KEY] = { rowWidth };
    return rowWidth;
  }

  function keptFavoritesTab(group: UnknownRecord): UnknownRecord | null {
    const kept = asRecord(group[TAB_KEEP_KEY]);
    if (!kept || kept.destroyed === true || kept._destroyed === true) return null;
    return kept;
  }

  /** 游戏排版会把多出来的页签拿掉，这里再放回列表末尾。 */
  /** 卸载后即使开关还开着也不再补回小抄页签，等下次挂载。 */
  function wantsFavoritesTab(group: UnknownRecord): boolean {
    return options.enabled() && group[TAB_DETACHED_KEY] !== true;
  }

  function holdFavoritesTab(group: UnknownRecord, buttons: UnknownRecord[]): void {
    if (!wantsFavoritesTab(group)) {
      for (let index = buttons.length - 1; index >= 0; index -= 1) {
        if (isFavoritesTabButton(buttons[index]!)) buttons.splice(index, 1);
      }
      return;
    }
    const tab = keptFavoritesTab(group);
    if (!tab) return;
    const currentIndex = buttons.indexOf(tab);
    if (currentIndex >= 0 && currentIndex !== buttons.length - 1) buttons.splice(currentIndex, 1);
    if (!buttons.includes(tab)) buttons.push(tab);
    const parent = asRecord(tab.parent) ?? asRecord(tab._parent);
    if (parent !== group) callMethod(group, 'addChild', tab);
    if (tab.visible !== true) tab.visible = true;
    if (tab.label !== '小抄背景') tab.label = '小抄背景';
  }

  function ensureTabFlexLoop(menu: UnknownRecord, group: UnknownRecord, buttons: UnknownRecord[], rowWidth: number): void {
    if (group[TAB_FLEX_LOOP_KEY] === true || rowWidth <= 0) return;
    group[TAB_FLEX_LOOP_KEY] = true;
    const timer = asRecord(laya()?.timer);
    const tick = () => {
      if (group.destroyed === true) {
        callMethod(timer, 'clear', group, tick);
        group[TAB_FLEX_LOOP_KEY] = false;
        return;
      }
      if (wantsFavoritesTab(group) && !keptFavoritesTab(group)) ensureTab(menu);
      else holdFavoritesTab(group, buttons);
      shareTabRow(group, buttons, rowWidth);
    };
    if (typeof timer?.frameLoop === 'function') callMethod(timer, 'frameLoop', 1, group, tick);
    else tick();
  }

  /** 按钮底图按原尺寸画死，改宽度不会拉伸，第一次排版前记下原宽。 */
  function nativeButtonWidth(button: UnknownRecord): number {
    const stored = Number(button[TAB_NATIVE_WIDTH_KEY]) || 0;
    if (stored > 0) return stored;
    const width = Number(button.width) || Number(button.displayWidth) || 0;
    if (width > 0) button[TAB_NATIVE_WIDTH_KEY] = width;
    return width;
  }

  function setIfChanged(record: UnknownRecord, key: string, value: number): void {
    if (Number(record[key]) !== value) record[key] = value;
  }

  /**
   * 按钮保持原宽，横向缩放让底图的实心部分正好盖满格子，两侧阴影压到相邻页签下面。
   * 文字反向缩放，字形不变形。
   */
  function stretchTabButton(button: UnknownRecord, slotX: number, width: number, height: number): void {
    if ('anchorX' in button) setIfChanged(button, 'anchorX', 0);
    if ('pivotX' in button) setIfChanged(button, 'pivotX', 0);
    const offsetY = Number(button.y) || 0;
    const nativeWidth = nativeButtonWidth(button);
    const solidWidth = nativeWidth - WALLPAPER_TAB_TEXTURE_SHADOW_WIDTH * 2;
    if (solidWidth > 0) {
      if (Number(button.width) !== nativeWidth) callMethod(button, 'size', nativeWidth, height);
      const scale = width / solidWidth;
      setIfChanged(button, 'scaleX', scale);
      setIfChanged(button, 'x', slotX - WALLPAPER_TAB_TEXTURE_SHADOW_WIDTH * scale);
      setIfChanged(button, 'y', offsetY);
      const label = asRecord(button.textField);
      if (label) {
        setIfChanged(label, 'x', 0);
        setIfChanged(label, 'scaleX', 1 / scale);
        setIfChanged(label, 'width', nativeWidth * scale);
      }
      return;
    }
    button.x = slotX;
    button.width = width;
    button.height = height;
    callMethod(button, 'size', width, height);
    for (const key of ['bg', 'back', 'background', 'skinSp', 'image'] as const) {
      const record = asRecord(button[key]);
      if (!record) continue;
      record.x = 0;
      record.width = width;
      record.height = height;
      callMethod(record, 'size', width, height);
    }
    const children = Array.isArray(button._children) ? button._children : [];
    for (const child of children) {
      const record = asRecord(child);
      if (!record || record.text != null || record.textField != null) continue;
      record.x = 0;
      record.width = width;
      record.height = height;
      callMethod(record, 'size', width, height);
    }
  }

  function clearTabGap(group: UnknownRecord): void {
    for (const key of ['space', 'spaceX', '_space', 'itemSpace', 'gap'] as const) {
      if (key in group) setIfChanged(group, key, 0);
    }
  }

  /** 当前还在的页签均分整行，首尾相接，加起来正好是这一行。 */
  function shareTabRow(group: UnknownRecord, buttons: UnknownRecord[], rowWidth: number): void {
    const live = buttons.filter((button) => button.destroyed !== true && button._destroyed !== true);
    if (rowWidth <= 0 || live.length === 0) return;
    clearTabGap(group);
    const eachWidth = Math.floor(rowWidth / live.length);
    if (eachWidth <= 0) return;
    let offsetX = 0;
    live.forEach((button, index) => {
      const width = index === live.length - 1 ? rowWidth - offsetX : eachWidth;
      const height = Number(button.height) || WALLPAPER_FAVORITES_TAB_DEFAULT_HEIGHT;
      stretchTabButton(button, offsetX, width, height);
      if (button.visible !== true) button.visible = true;
      offsetX += width;
    });
    if ('btnWidth' in group) setIfChanged(group, 'btnWidth', eachWidth);
    setIfChanged(group, 'width', rowWidth);
    if (asRecord(group[WALLPAPER_BACKGROUND_TAB_LAYOUT_KEY])?.fromMenu === true) setIfChanged(group, 'x', 0);
  }

  /** 游戏自己排完页签后，再把四个页签拉回同一行均分。 */
  function bindEqualTabLayout(menu: UnknownRecord, group: UnknownRecord, buttons: UnknownRecord[], rowWidth: number): void {
    for (const methodName of ['layout', 'LayoutBtn'] as const) {
      if (typeof group[methodName] !== 'function' || patcher.isWrapped(group, methodName)) continue;
      patcher.wrap(group, methodName, (original) => function (this: UnknownRecord, ...args: unknown[]) {
        const live = buttons.filter((button) => button.destroyed !== true && button._destroyed !== true);
        clearTabGap(this);
        if (rowWidth > 0 && live.length > 0 && 'btnWidth' in this) {
          this.btnWidth = Math.floor(rowWidth / live.length);
        }
        const result = original.apply(this, args);
        if (this === group) {
          if (wantsFavoritesTab(group) && !keptFavoritesTab(group)) ensureTab(menu);
          else holdFavoritesTab(group, buttons);
          shareTabRow(group, buttons, rowWidth);
        }
        return result;
      });
    }
  }

  /** 小抄页签放在最后，四个页签均分游戏页签原来的那一行。 */
  function placeFavoritesTabLast(menu: UnknownRecord, group: UnknownRecord, buttons: UnknownRecord[], tab: UnknownRecord): void {
    const rowWidth = nativeTabRowWidth(menu, group, buttons);
    const currentIndex = buttons.indexOf(tab);
    if (currentIndex >= 0 && currentIndex !== buttons.length - 1) buttons.splice(currentIndex, 1);
    if (!buttons.includes(tab)) buttons.push(tab);
    const parent = asRecord(tab.parent) ?? asRecord(tab._parent);
    if (parent !== group) callMethod(group, 'addChild', tab);
    if (tab.visible !== true) tab.visible = true;
    bindEqualTabLayout(menu, group, buttons, rowWidth);
    ensureTabFlexLoop(menu, group, buttons, rowWidth);
    shareTabRow(group, buttons, rowWidth);
  }

  function bindTabGroupSelectTab(menu: UnknownRecord, group: UnknownRecord): boolean {
    const inherited = typeof group.SelectTab === 'function'
      || typeof (Object.getPrototypeOf(group) as UnknownRecord | null)?.SelectTab === 'function';
    if (!inherited) return false;
    if (patcher.isWrapped(group, 'SelectTab')) return true;
    return patcher.wrap(group, 'SelectTab', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      const result = original.apply(this, args);
      if (this !== group) return result;
      const index = Number(args[0]);
      const buttons = mutableTabButtons(group);
      const button = buttons?.[index];
      if (button && (button.value === TAB_VALUE || button[TAB_MARKER]) && options.enabled()) {
        showPanel(menu, true);
      } else if (options.enabled()) {
        showPanel(menu, false, false);
        if (isWallpaperMenuLiveTabValue(button?.value)) restoreLiveList(menu);
      }
      return result;
    });
  }

  function patchMenuRefresh(menu: UnknownRecord): void {
    const hasRefresh = typeof menu.RefreList === 'function'
      || typeof (Object.getPrototypeOf(menu) as UnknownRecord | null)?.RefreList === 'function';
    if (!hasRefresh || patcher.isWrapped(menu, 'RefreList')) return;
    patcher.wrap(menu, 'RefreList', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      const result = original.apply(this, args);
      if (this !== menu) return result;
      const group = resolveWallPaperTabGroup(menu);
      if (group && wantsFavoritesTab(group)) ensureTab(menu);
      if (isSelected(menu) && options.enabled()) return showPanel(menu, true);
      return result;
    });
  }

  function tabClickHandler(menu: UnknownRecord): PatchableFunction | null {
    if (typeof menu.onTabClick === 'function') return menu.onTabClick as PatchableFunction;
    const prototype = Object.getPrototypeOf(menu) as UnknownRecord | null;
    if (prototype && typeof prototype.onTabClick === 'function') return prototype.onTabClick as PatchableFunction;
    return null;
  }

  function tabClickWrapTarget(menu: UnknownRecord): UnknownRecord | null {
    if (typeof menu.onTabClick === 'function') return menu;
    const prototype = Object.getPrototypeOf(menu) as UnknownRecord | null;
    if (prototype && typeof prototype.onTabClick === 'function') return menu;
    return null;
  }

  /** 接管页签切换与列表刷新。 */
  function bindTabSwitch(menu: UnknownRecord): boolean {
    const group = resolveWallPaperTabGroup(menu);
    if (!group) return false;
    const wrapTarget = tabClickWrapTarget(menu);
    let clickBound = false;
    if (wrapTarget) {
      if (!patcher.isWrapped(wrapTarget, 'onTabClick')) {
        patcher.wrap(wrapTarget, 'onTabClick', (original) => {
          nativeTabClick.set(wrapTarget, original);
          return function (this: UnknownRecord, ...args: unknown[]) {
            const value = Array.isArray(args[0]) ? args[0][0] : args[0];
            if (value === TAB_VALUE && options.enabled()) return showPanel(this, true);
            showPanel(this, false, false);
            // 先还回动态皮肤列表，再让游戏自己切页，游戏对显隐有最终决定权。
            if (isWallpaperMenuLiveTabValue(clickedTabValue(args[0]))) restoreLiveList(this);
            try {
              return original.apply(this, args);
            } finally {
              stateOf(this).loadMoreVisibility = undefined;
            }
          };
        });
      }
      clickBound = true;
    }
    if (!clickBound) clickBound = bindTabGroupSelectTab(menu, group);
    if (!clickBound) return false;
    patchMenuRefresh(menu);
    const state = stateOf(menu);
    if (!state.tabBound && wrapTarget) {
      const eventName = String(asRecord(group.constructor)?.TAP_CLICKED || 'TAP_CLICKED');
      const handler = tabClickHandler(menu);
      const native = nativeTabClick.get(wrapTarget);
      if (native && handler) callMethod(group, 'off', eventName, menu, native);
      if (handler) {
        callMethod(group, 'off', eventName, menu, handler);
        callMethod(group, 'on', eventName, menu, handler);
      }
      state.tabEvent = eventName;
      state.tabBound = true;
    }
    return true;
  }

  function attach(menu: UnknownRecord): void {
    if (!options.enabled()) {
      detach(menu);
      return;
    }
    const attachedGroup = resolveWallPaperTabGroup(menu);
    if (attachedGroup) delete attachedGroup[TAB_DETACHED_KEY];
    if (!bindTabSwitch(menu)) {
      skinTrace('wallpaper-tab-bind-failed', {
        hasTabGroup: Boolean(menu.tabGroup ?? menu.TabGroup),
        hasOnTabClick: typeof menu.onTabClick === 'function'
      });
    }
    if (!ensureTab(menu)) {
      skinTrace('wallpaper-tab-create-failed', {
        tabCount: wallPaperTabButtons(asRecord(menu.tabGroup) ?? asRecord(menu.TabGroup)).length
      });
      return;
    }
    if (menus.has(menu)) return;
    menus.add(menu);
    const group = resolveWallPaperTabGroup(menu);
    callMethod(group, 'layout');
    callMethod(group, 'LayoutBtn');
  }

  function detach(menu: UnknownRecord): void {
    const group = resolveWallPaperTabGroup(menu);
    if (isSelected(menu)) callMethod(group, 'SelectTab', 0);
    showPanel(menu, false);
    const state = stateOf(menu);
    if (state.tabBound) {
      const prototype = Object.getPrototypeOf(menu) as UnknownRecord | null;
      const eventName = state.tabEvent || String(asRecord(group?.constructor)?.TAP_CLICKED || 'TAP_CLICKED');
      const native = prototype ? nativeTabClick.get(prototype) : undefined;
      callMethod(group, 'off', eventName, menu, prototype?.onTabClick);
      if (native) {
        callMethod(group, 'off', eventName, menu, native);
        callMethod(group, 'on', eventName, menu, native);
      }
    }
    clearItems(menu);
    const buttons = Array.isArray(group?.BtnList) ? group.BtnList as UnknownRecord[] : null;
    if (group && buttons) {
      group[TAB_DETACHED_KEY] = true;
      delete group[TAB_KEEP_KEY];
      restoreNativeTabWidths(menu, group, buttons);
      for (let index = buttons.length - 1; index >= 0; index -= 1) {
        if (!asRecord(buttons[index])?.[TAB_MARKER]) continue;
        callMethod(buttons.splice(index, 1)[0], 'destroy', true);
      }
      callMethod(group, 'layout');
      callMethod(group, 'LayoutBtn');
    }
    if (state.panel && state.panel !== menu.panel) callMethod(state.panel, 'destroy', true);
    states.delete(menu);
    menus.delete(menu);
  }

  function liveMenus(): UnknownRecord[] {
    for (const menu of menus) {
      if (menu.destroyed) menus.delete(menu);
    }
    return [...menus];
  }

  function refreshSelection(): void {
    liveMenus().forEach((menu) => {
      stateOf(menu).items.forEach((item) => callMethod(item, 'UpdateSelectedUI'));
      if (options.enabled() && isCurrentFromFavorites() && !isSelected(menu)) activateFavoritesTab(menu);
    });
  }

  const unsubscribe = store.onFavoritesChange(() => {
    liveMenus().forEach((menu) => {
      if (isSelected(menu)) renderList(menu);
    });
  });

  return {
    attach,
    detach,
    refreshSelection,
    dispose() {
      unsubscribe();
      liveMenus().forEach(detach);
    }
  };
}

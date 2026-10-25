/**
 * 本地皮肤切换控制器：按设置改写他人/本家皮肤相关协议或资源。
 */

import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { isGeneralSkillTipManualCloseVisible } from '../../runtime/game-tip-layer.ts';
import { createMethodPatcher, type PatchableFunction } from '../../runtime/method-patch.ts';
import { showToast } from '../../ui/toast/show-toast.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import {
  asRecord,
  callMethod,
  createTaskScope,
  prototypeOf,
  accountScopedStorageKey,
  readJson,
  removeStored,
  seatGeneral,
  seatHoldsGeneral,
  skinTrace,
  supportsDynamicSkin,
  watchSceneSwitch,
  watchWindowShow,
  writeJson,
  type SeatGeneralInfo,
  type UnknownRecord
} from './skin-runtime.ts';

const SAVED_SKINS_KEY = 'XC::localSkins';
const SKIN_WINDOWS = ['ChangeSkinWindow', 'SelectSkinWindow'] as const;
/** 未拥有皮肤项上表示限时、合成等状态的节点，本地解锁后隐藏。 */
const LOCKED_ITEM_NODES = ['timeBg', 'composeBg', 'composeIcon', 'composeTxt1', 'composeTxt2', 'composeTxt', 'timeLimiteTxt'];
const SELF_GENERAL_KEYS = ['generalIds', 'GeneralIds', 'WuJiangs', 'generals'];
const OTHER_BIND_DELAYS = [0, 50, 200, 600, 1500];
const SELF_SKIN_APPLY_DELAYS = [0, 80, 250, 600, 1200];
const HP_REPAINT_DELAYS = [0, 80, 250, 600, 1200, 2000, 3500];
const HP_SYNC_DELAYS = [0, 50, 150, 400];
const OTHER_OPEN_TIMEOUT = 3000;
const SEAT_SKIN_OVERRIDE_HOOK = '__xcSeatSetGeneralSkinOverrideHook';

interface SavedSkin {
  skinID: number;
  isDynamic: boolean;
}

interface ItemOriginalState {
  skinID: number | null;
  supportsDynamic: boolean;
  dynamicState: unknown;
  hasSkin: unknown;
  isUsing: unknown;
  bgMouseEnabled: unknown;
  blackbgVisible: unknown;
  visibility: Record<string, unknown>;
}

interface OtherSkinSession {
  token: number;
  epoch: number;
  scene: unknown;
  seat: UnknownRecord;
  seatIndex: unknown;
  isZhu: boolean;
  generalID: number;
  view: UnknownRecord | null;
  cancelled: boolean;
  completed: boolean;
}

interface OtherSkinOverride {
  epoch: number;
  seat: UnknownRecord;
  generalID: number;
  skinID: number;
  isDynamic: boolean;
  skinType: number;
}

export interface SkinChangeController {
  /** 协议分发前调用：开局下发自己武将皮肤时替换为本地选择。 */
  filterMessage(payload: UnknownRecord, className: string): void;
  dispose(): void;
}

export interface SkinChangeOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  gameEvents?: GameEventBus;
}

/**
 * 皮肤解锁与他人换肤。
 * 两者共用换肤窗口：未拥有的皮肤显示为可选，确认时只在本地调用座位的
 * SetGeneralSkin；自己的选择按武将保存，开局时改写服务器下发的皮肤。
 */
export function installSkinChangeController(
  configStore: XiaochaoConfigStore,
  options: SkinChangeOptions = {}
): SkinChangeController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const gameEvents = options.gameEvents;
  const hpBySeat = new Map<number, { hp: number; maxHp: number }>();
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const storage = options.storage ?? globalObject.localStorage;
  const patcher = createMethodPatcher();
  const tasks = createTaskScope();
  const unsubscribes: Array<() => void> = [];

  const itemStates = new WeakMap<object, ItemOriginalState>();
  const previewItems = new Map<string, Set<UnknownRecord>>();
  const guardedViews = new WeakMap<object, { items: Set<UnknownRecord>; handled?: { skinID: number; result: unknown } }>();

  const sessions = new Set<OtherSkinSession>();
  const sessionByView = new WeakMap<object, OtherSkinSession>();
  const overrides = new Map<string, OtherSkinOverride>();
  const seatKeys = new WeakMap<object, number>();
  const ownSkinButtons = new Set<UnknownRecord>();
  let openingSession: OtherSkinSession | null = null;
  let suppressPickerPreview = false;
  let epoch = 0;
  let sessionToken = 0;
  let seatToken = 0;
  let currentScene: unknown = null;

  const localOn = () => configStore.get('skin.localSkin') === true;
  const otherOn = () => configStore.get('skin.otherLocalSkin') === true;
  const layaEvent = () => asRecord(globalObject.Laya?.Event);

  // ---------- 自己的皮肤选择 ----------

  function skinsKey(): string {
    return accountScopedStorageKey(SAVED_SKINS_KEY, storage);
  }

  function savedSkins(): Record<string, SavedSkin> {
    const key = skinsKey();
    const current = readJson<unknown>(storage, key, null);
    if (current && typeof current === 'object') return current as Record<string, SavedSkin>;
    const legacy = readJson<unknown>(storage, SAVED_SKINS_KEY, null);
    if (legacy && typeof legacy === 'object') {
      writeJson(storage, key, legacy);
      removeStored(storage, SAVED_SKINS_KEY);
      return legacy as Record<string, SavedSkin>;
    }
    return {};
  }

  function savedSkin(generalID: unknown): SavedSkin | null {
    const saved = savedSkins()[String(Number(generalID))];
    return saved && Number(saved.skinID) >= 0 ? { skinID: Number(saved.skinID), isDynamic: saved.isDynamic !== false } : null;
  }

  function saveSkin(generalID: number, skinID: number, isDynamic: boolean): void {
    if (!(generalID > 0)) return;
    writeJson(storage, skinsKey(), { ...savedSkins(), [generalID]: { skinID, isDynamic } });
  }

  function selfSeat(): UnknownRecord | null {
    const seat = asRecord(asRecord(locator.gameScene()?.SelfSeatUi)?.seat);
    return typeof seat?.SetGeneralSkin === 'function' ? seat : null;
  }

  function isOwnGeneral(generalID: number): boolean {
    if (!Number.isFinite(generalID)) return false;
    const seat = asRecord(asRecord(locator.gameScene()?.SelfSeatUi)?.seat);
    for (const key of SELF_GENERAL_KEYS) {
      const ids = seat?.[key];
      if (Array.isArray(ids)) return ids.some((id) => Number(id) === generalID);
    }
    return false;
  }

  function seatIndexOf(seat: UnknownRecord): number | null {
    const id = Number(seat.Index ?? seat.index ?? seat.SeatID ?? seat.seatID);
    return Number.isFinite(id) ? id : null;
  }

  function shownHp(seat: UnknownRecord): { hp: number; maxHp: number } | null {
    const hp = Number(seat.Hp ?? seat.HP ?? seat.currentHp ?? seat.CurrentHp);
    const maxHp = Number(seat.MaxHp ?? seat.maxHp ?? seat.MaxHP ?? seat.maxHP);
    if (!Number.isFinite(hp)) return null;
    return { hp, maxHp: Number.isFinite(maxHp) && maxHp > 0 ? maxHp : Math.max(hp, 1) };
  }

  function resolveHpForSeat(seat: UnknownRecord): { hp: number; maxHp: number } | null {
    const seatId = seatIndexOf(seat);
    const cached = seatId !== null ? hpBySeat.get(seatId) : undefined;
    if (cached) return cached;
    return shownHp(seat);
  }

  function noteSeatHp(seatId: number, hp: number, maxHp: number): void {
    hpBySeat.set(seatId, { hp, maxHp: Math.max(1, maxHp) });
  }

  function clearSeatHpCache(): void {
    hpBySeat.clear();
  }

  function shouldYieldToGeneralSkillTip(): boolean {
    return isGeneralSkillTipManualCloseVisible(globalObject);
  }

  function restoreSeatSetGeneralSkinOverride(seat: UnknownRecord): void {
    const hook = asRecord(seat[SEAT_SKIN_OVERRIDE_HOOK]);
    const native = hook?.native;
    if (typeof native === 'function') {
      seat.SetGeneralSkin = native as PatchableFunction;
    }
    delete seat[SEAT_SKIN_OVERRIDE_HOOK];
  }

  function ensureSeatSetGeneralSkinOverrideHook(seat: UnknownRecord): void {
    if (asRecord(seat[SEAT_SKIN_OVERRIDE_HOOK])?.native) return;
    const native = seat.SetGeneralSkin;
    if (typeof native !== 'function') return;
    seat[SEAT_SKIN_OVERRIDE_HOOK] = { native };
    seat.SetGeneralSkin = function (this: UnknownRecord, ...args: unknown[]) {
      const override = findOverride(this, Number(args[0]));
      if (override) {
        args[1] = override.skinID;
        args[2] = override.isDynamic;
        args[3] = override.skinType;
        args[4] = true;
      }
      return (native as PatchableFunction).apply(this, args);
    };
  }

  function isSelfSeat(seat: UnknownRecord): boolean {
    if (seat.IsSelf === true || seat.isSelf === true) return true;
    const self = selfSeat();
    return Boolean(self && self === seat);
  }

  function seedSelfHpCache(): void {
    const seat = selfSeat();
    if (!seat) return;
    const seatId = seatIndexOf(seat);
    const live = shownHp(seat);
    if (seatId !== null && live) noteSeatHp(seatId, live.hp, live.maxHp);
  }

  /** 换肤会按皮肤默认体力重画血点，这里把座位上的真实体力画回去。 */
  function repaintHp(seat: UnknownRecord, hp: number, maxHp: number): void {
    const general = asRecord(seat.General) ?? asRecord(seat.general);
    for (const target of [seat, general]) {
      if (!target) continue;
      callMethod(target, 'UpdateHp', hp, maxHp);
      callMethod(target, 'SetHp', hp, maxHp);
    }
    try {
      if ('Hp' in seat) seat.Hp = hp;
    } catch {
      // 体力属性只读时，上面的刷新方法已经画过。
    }
  }

  function applySkin(seat: UnknownRecord, generalID: number, skinID: number, isDynamic: boolean, skinType: number): void {
    if (shouldYieldToGeneralSkillTip()) return;
    const shown = resolveHpForSeat(seat);
    callMethod(seat, 'SetGeneralSkin', generalID, skinID, isDynamic, skinType, true);
    if (shown) scheduleRepaintHp(seat, shown.hp, shown.maxHp);
  }

  function repaintHpForSeat(seat: UnknownRecord, fallbackHp: number, fallbackMaxHp: number): void {
    const seatId = seatIndexOf(seat);
    const cached = seatId !== null ? hpBySeat.get(seatId) : undefined;
    const live = shownHp(seat);
    if (cached) {
      repaintHp(seat, cached.hp, cached.maxHp);
      return;
    }
    if (live) {
      if (seatId !== null) noteSeatHp(seatId, live.hp, live.maxHp);
      repaintHp(seat, live.hp, live.maxHp);
      return;
    }
    repaintHp(seat, fallbackHp, fallbackMaxHp);
  }

  function scheduleRepaintHp(seat: UnknownRecord, hp: number, maxHp: number): void {
    for (const delay of HP_REPAINT_DELAYS) {
      tasks.later(() => {
        if (shouldYieldToGeneralSkillTip()) return;
        repaintHpForSeat(seat, hp, maxHp);
      }, delay);
    }
  }

  function formForHp(skinID: number, hp: number): number | null {
    const manager = locator.manager('GeneralSkinManager');
    const raw = callMethod(manager, 'GetSkinListBySkinID', skinID);
    const items = Array.isArray(raw) ? raw : [raw];
    for (const item of items) {
      const skin = asRecord(item);
      if (!skin || skin.IsManyStateDyskin !== true) continue;
      let text = '';
      try {
        text = Object.keys(skin).filter((key) => /dec|desc|tip|info|condition|text|judge/i.test(key)).map((key) => {
          const value = skin[key];
          return typeof value === 'string' ? value : '';
        }).join('\n');
      } catch {
        text = '';
      }
      const matched = text.match(/小于\s*(\d+)\s*血/);
      const threshold = matched ? Number(matched[1]) : 0;
      if (!(threshold > 0)) continue;
      return hp < threshold ? 2 : 1;
    }
    return null;
  }

  function seatByIndex(seatId: number): UnknownRecord | null {
    const scene = locator.gameScene();
    const list = asRecord(scene?.seatContainer)?.seatUIs;
    const uis = [scene?.SelfSeatUi, ...(Array.isArray(list) ? list : [])];
    for (const ui of uis) {
      const seat = asRecord(asRecord(ui)?.seat);
      if (!seat || typeof seat.SetGeneralSkin !== 'function') continue;
      const id = Number(seat.Index ?? seat.index ?? seat.SeatID ?? seat.seatID);
      if (id === seatId) return seat;
    }
    return null;
  }

  function syncDynamicFormForHp(seat: UnknownRecord, hp: number): void {
    for (const isZhu of [true, false]) {
      const info = seatGeneral(seat, isZhu);
      if (!info?.isDynamic) continue;
      const form = formForHp(info.skinID, hp);
      if (form === null || form === info.skinType) continue;
      callMethod(seat, 'SetGeneralSkin', info.generalID, info.skinID, true, form, true);
    }
  }

  function syncShownHp(seat: UnknownRecord, hp: number, maxHp: number): void {
    syncDynamicFormForHp(seat, hp);
    scheduleRepaintHp(seat, hp, maxHp);
  }

  function handleHpUpdated(seatId: number, hp: number | null, maxHp: number | null, maxHpOnly: boolean): void {
    let formSynced = false;
    const run = () => {
      if (shouldYieldToGeneralSkillTip()) return;
      const seat = seatByIndex(seatId);
      if (!seat) return;
      let resolvedHp = hp;
      let resolvedMax = maxHp;
      if (maxHpOnly) {
        const live = shownHp(seat);
        if (!live) return;
        resolvedHp = live.hp;
        resolvedMax = maxHp ?? live.maxHp;
      }
      if (resolvedHp === null || !Number.isFinite(resolvedHp)) return;
      const max = resolvedMax ?? shownHp(seat)?.maxHp ?? Math.max(resolvedHp, 1);
      noteSeatHp(seatId, resolvedHp, max);
      if (!formSynced) {
        syncDynamicFormForHp(seat, resolvedHp);
        formSynced = true;
      }
      scheduleRepaintHp(seat, resolvedHp, max);
    };
    HP_SYNC_DELAYS.forEach((delay) => tasks.later(run, delay));
  }

  function filterMessage(payload: UnknownRecord, className: string): void {
    if (className !== 'ClientGeneralSkinRep' || !localOn()) return;
    const list = payload.GeneralSkinList;
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      const skin = asRecord(entry);
      if (!skin || !isOwnGeneral(Number(skin.GeneralID))) continue;
      skin.state = 1;
      const saved = savedSkin(skin.GeneralID);
      if (!saved) continue;
      skin.SkinID = saved.skinID;
      skin.state = saved.isDynamic ? 1 : 0;
    }
  }

  /** 在自己座位上本地应用皮肤。 */
  function applyToSelfSeat(generalID: number, skinID: number, isDynamic: boolean): boolean {
    const seat = selfSeat();
    if (!seat || !(generalID > 0)) return false;
    for (const isZhu of [true, false]) {
      const info = seatGeneral(seat, isZhu);
      if (!info || !seatHoldsGeneral(seat, info, generalID)) continue;
      applySkin(seat, generalID, skinID, isDynamic, info.skinType);
      return true;
    }
    return false;
  }

  /** 进局后把本地保存的皮肤套到自己座位，避免开换肤窗时先闪官方默认皮。 */
  function applySavedSkinsForSelf(): void {
    if (!localOn() || shouldYieldToGeneralSkillTip()) return;
    seedSelfHpCache();
    const seat = selfSeat();
    if (!seat) return;
    for (const isZhu of [true, false]) {
      const info = seatGeneral(seat, isZhu);
      if (!info) continue;
      const saved = savedSkin(info.generalID);
      if (!saved) continue;
      const skinMatches = info.skinID === saved.skinID;
      const dynamicMatches = info.isDynamic === saved.isDynamic;
      // 动态皮每局再套一次，避免皮号对了但特效仍是静态。
      if (skinMatches && dynamicMatches && !saved.isDynamic) continue;
      try {
        applyToSelfSeat(info.generalID, saved.skinID, saved.isDynamic);
      } catch (error) {
        console.warn('[皮肤解锁] 进局套用本地皮肤失败:', error);
      }
    }
  }

  function scheduleApplySavedSkinsForSelf(): void {
    if (!localOn()) return;
    SELF_SKIN_APPLY_DELAYS.forEach((delay) => tasks.later(() => applySavedSkinsForSelf(), delay));
  }

  function pickerGeneralId(view: UnknownRecord): number {
    return Number(view.defaultGeneralID ?? view.realGeneralID ?? view.generalID);
  }

  function activeSavedSkinForPicker(view: UnknownRecord): SavedSkin | null {
    const generalID = pickerGeneralId(view);
    return localOn() && isOwnGeneral(generalID) ? savedSkin(generalID) : null;
  }

  /** 列表解锁后会把 isUsing 清掉，这里把当前应选中的皮肤项标回去。 */
  function syncPickerUsingState(view: UnknownRecord): void {
    const saved = activeSavedSkinForPicker(view);
    const skinID = saved?.skinID ?? Number(view.usingSkinID);
    if (!(skinID >= 0)) return;
    if (saved) {
      view.usingSkinID = saved.skinID;
      view.closeSelectSkinId = saved.skinID;
      if ('usingDynamicState' in view) view.usingDynamicState = saved.isDynamic ? 1 : 0;
    }
    const guard = guardedViews.get(view);
    if (!guard) return;
    for (const item of guard.items) {
      const original = itemStates.get(item);
      const id = original?.skinID ?? itemSkinId(item);
      item.isUsing = id === skinID;
    }
  }

  // ---------- 换肤窗口：未拥有皮肤显示为可选 ----------

  function itemSkinId(item: UnknownRecord): number | null {
    const skinData = asRecord(item.skinData);
    const id = Number(item.SkinID ?? item.skinId ?? item.skinID ?? skinData?.skinID);
    return Number.isFinite(id) && id >= 0 ? id : null;
  }

  function rememberItem(item: UnknownRecord): ItemOriginalState {
    const existing = itemStates.get(item);
    if (existing) return existing;
    const state: ItemOriginalState = {
      skinID: itemSkinId(item),
      supportsDynamic: supportsDynamicSkin(item),
      dynamicState: item.dynamicState,
      hasSkin: item.hasSkin,
      isUsing: item.isUsing,
      bgMouseEnabled: asRecord(item.bg)?.mouseEnabled,
      blackbgVisible: asRecord(item.blackbg)?.visible,
      visibility: Object.fromEntries(LOCKED_ITEM_NODES.map((name) => [name, asRecord(item[name])?.visible]))
    };
    itemStates.set(item, state);
    return state;
  }

  function unlockItem(item: UnknownRecord): void {
    if (!localOn()) return;
    const original = rememberItem(item);
    item.dynamicState = original.hasSkin ? (original.dynamicState ? -1 : -2) : -3;
    item.hasSkin = true;
    const background = asRecord(item.bg);
    if (background) background.mouseEnabled = true;
    const blackBackground = asRecord(item.blackbg);
    if (blackBackground) blackBackground.visible = false;
    item.isUsing = false;
    LOCKED_ITEM_NODES.forEach((name) => {
      const node = asRecord(item[name]);
      if (node) node.visible = false;
    });
  }

  function restoreItem(item: UnknownRecord): void {
    const original = itemStates.get(item);
    if (!original) return;
    item.dynamicState = original.dynamicState;
    item.hasSkin = original.hasSkin;
    item.isUsing = original.isUsing;
    const background = asRecord(item.bg);
    if (background && original.bgMouseEnabled !== undefined) background.mouseEnabled = original.bgMouseEnabled;
    const blackBackground = asRecord(item.blackbg);
    if (blackBackground && original.blackbgVisible !== undefined) blackBackground.visible = original.blackbgVisible;
    LOCKED_ITEM_NODES.forEach((name) => {
      const node = asRecord(item[name]);
      if (node && original.visibility[name] !== undefined) node.visible = original.visibility[name];
    });
    itemStates.delete(item);
  }

  /** 列表项复用时会重新 render，需在每次渲染后重新套用。 */
  function guardItemRender(item: UnknownRecord): void {
    patcher.wrap(item, 'render', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      const before = itemStates.get(this);
      const result = original.apply(this, args);
      if (localOn()) {
        if (before && itemSkinId(this) !== before.skinID) itemStates.delete(this);
        unlockItem(this);
      } else {
        restoreItem(this);
      }
      return result;
    });
  }

  function restorePreview(windowName?: string): void {
    const entries = windowName ? [[windowName, previewItems.get(windowName)] as const] : [...previewItems.entries()];
    for (const [name, items] of entries) {
      items?.forEach(restoreItem);
      previewItems.delete(name);
    }
  }

  function collectSkinListRecords(win: UnknownRecord | null): UnknownRecord[] {
    if (!win) return [];
    const view = asRecord(win.selectView);
    const candidates: unknown[] = [
      view?.itemList,
      view?.ShowItemList,
      asRecord(view?.list)?.cells,
      win.itemList,
      win.ShowItemList,
      asRecord(win.list)?.cells
    ];
    for (const candidate of candidates) {
      if (!Array.isArray(candidate) || candidate.length < 2) continue;
      const records = candidate.map(asRecord).filter((item): item is UnknownRecord => item !== null);
      if (records.length >= 2) return records;
    }
    return [];
  }

  function findPreviewItem(view: UnknownRecord, skinID: number): { item: UnknownRecord; original: ItemOriginalState } | null {
    const guard = guardedViews.get(view);
    if (!guard || !Number.isFinite(skinID) || skinID < 0) return null;
    for (const item of guard.items) {
      const original = itemStates.get(item);
      if (original && Number(original.skinID) === skinID) return { item, original };
    }
    const windowName = owningWindowName(view);
    if (!windowName) return null;
    for (const item of collectSkinListRecords(skinWindow(windowName))) {
      if (itemSkinId(item) !== skinID) continue;
      if (!itemStates.has(item)) unlockItem(item);
      const original = itemStates.get(item);
      if (original) return { item, original };
    }
    return null;
  }

  function applyPickerSkinFromView(view: UnknownRecord, skinID: number, isDynamic: boolean): boolean {
    const seat = selfSeat();
    if (!seat) return false;
    const requestedGeneralID = Number(view.realGeneralID ?? view.defaultGeneralID ?? view.generalID);
    if (!(requestedGeneralID > 0)) return false;
    for (const isZhu of [true, false]) {
      const info = seatGeneral(seat, isZhu);
      if (!info) continue;
      if (info.generalID !== requestedGeneralID && !seatHoldsGeneral(seat, info, requestedGeneralID)) continue;
      applySkin(seat, requestedGeneralID, skinID, isDynamic, info.skinType);
      return true;
    }
    return false;
  }

  let reunlockingPicker = false;
  let reunlockQueued = false;

  /** 列表重绘后只把当前格子重新解锁，不再整表刷新，避免死循环。 */
  function reunlockVisibleSkins(windowName: string): void {
    if (!localOn() || reunlockingPicker) return;
    const records = collectSkinListRecords(skinWindow(windowName));
    const view = asRecord(skinWindow(windowName)?.selectView);
    if (!view || records.length < 2) return;
    reunlockingPicker = true;
    try {
      if (!guardSelectView(view, records)) return;
      previewItems.set(windowName, new Set(records));
      records.forEach((item) => {
        guardItemRender(item);
        unlockItem(item);
      });
      syncPickerUsingState(view);
    } finally {
      reunlockingPicker = false;
    }
  }

  function bindPickerListRefresh(view: UnknownRecord, windowName: string): void {
    const panel = asRecord(view.pannel);
    if (!panel || panel.__xcSkinListRefreshBound) return;
    if (typeof panel.refresh !== 'function') return;
    patcher.wrap(panel, 'refresh', (original) => function (this: unknown, ...args: unknown[]) {
      const result = original.apply(this, args);
      if (!reunlockingPicker && !reunlockQueued) {
        reunlockQueued = true;
        queueMicrotask(() => {
          reunlockQueued = false;
          reunlockVisibleSkins(windowName);
        });
      }
      return result;
    });
    panel.__xcSkinListRefreshBound = true;
  }

  /** 确认选择时，未拥有的皮肤只在本地应用。 */
  function handleLocalSelection(view: UnknownRecord, native: PatchableFunction, args: unknown[]): { handled: boolean; result?: unknown } {
    const guard = guardedViews.get(view);
    if (!guard) return { handled: false };
    const skinID = Number(view.closeSelectSkinId);
    if (guard.handled && guard.handled.skinID === skinID) return { handled: true, result: guard.handled.result };
    const preview = findPreviewItem(view, skinID);
    if (!preview || !localOn()) {
      if (Number(view.closeSelectDynamicState) < 0) view.closeSelectDynamicState = 0;
      return { handled: false };
    }
    if (view.clickCheck != true) return { handled: false };
    const generalID = Number(view.defaultGeneralID ?? view.realGeneralID ?? view.generalID);
    const isDynamic = isDynamicChoice(view, skinID, view.closeSelectDynamicState);
    const owned = Boolean(preview.original.hasSkin);
    if (generalID > 0) saveSkin(generalID, skinID, isDynamic);
    let nativeResult: unknown = false;
    if (owned) {
      view.closeSelectDynamicState = preview.original.dynamicState ? 1 : 0;
      nativeResult = native.apply(view, args);
    } else {
      view.closeSelectDynamicState = 0;
    }
    let applied = false;
    try {
      applied = applyPickerSkinFromView(view, skinID, isDynamic);
    } catch (error) {
      console.warn('[皮肤解锁] 本地应用失败:', error);
      showToast('本地换肤失败，请重试', 'error');
    }
    const result = applied || nativeResult || (!owned && generalID > 0 && skinID >= 0);
    skinTrace('local-select', {
      generalID,
      skinID,
      owned: Boolean(preview.original.hasSkin),
      isDynamic,
      applied,
      selfSeat: Boolean(selfSeat()),
      seatGenerals: [true, false].map((isZhu) => seatGeneral(selfSeat(), isZhu)?.generalID ?? null)
    });
    guard.handled = { skinID, result };
    return { handled: true, result };
  }

  function guardSelectView(view: UnknownRecord, items: UnknownRecord[]): boolean {
    const existing = guardedViews.get(view);
    if (existing) {
      existing.items = new Set(items);
      existing.handled = undefined;
      return true;
    }
    guardedViews.set(view, { items: new Set(items) });
    return patcher.wrap(view, 'closeSelectSure', (native) => function (this: UnknownRecord, ...args: unknown[]) {
      if (sessionFor(this)) {
        const other = finishOtherSelection(this);
        if (other.handled) return other.applied;
      }
      const local = handleLocalSelection(this, native, args);
      skinTrace('close-select', {
        skinID: this.closeSelectSkinId,
        dynamicState: this.closeSelectDynamicState,
        clickCheck: this.clickCheck,
        handled: local.handled
      });
      return local.handled ? local.result : native.apply(this, args);
    }) || patcher.isWrapped(view, 'closeSelectSure');
  }

  function skinWindow(name: string): UnknownRecord | null {
    const win = locator.window(name);
    return win && !win.destroyed ? win : null;
  }

  /** 对局内打开换肤框不一定经过 ShowWindow，改由列表视图反查所属窗口。 */
  function owningWindowName(view: UnknownRecord): (typeof SKIN_WINDOWS)[number] | null {
    let node: UnknownRecord | null = view;
    for (let depth = 0; node && depth < 8; depth += 1) {
      const name = SKIN_WINDOWS.find((candidate) => candidate === node?.name);
      if (name) return name;
      node = asRecord(node._parent);
    }
    return SKIN_WINDOWS.find((name) => asRecord(skinWindow(name)?.selectView) === view) ?? null;
  }

  async function applyPreview(windowName: string): Promise<void> {
    if (!localOn()) {
      restorePreview(windowName);
      return;
    }
    const items = await tasks.poll(() => {
      const records = collectSkinListRecords(skinWindow(windowName));
      return records.length >= 2 ? records : null;
    }, 300, 20);
    const traceView = asRecord(skinWindow(windowName)?.selectView);
    skinTrace('local-preview', {
      windowName,
      windowFound: Boolean(skinWindow(windowName)),
      inGame: Boolean(locator.gameScene()),
      generalID: traceView?.realGeneralID ?? traceView?.generalID,
      itemCount: Array.isArray(traceView?.itemList) ? traceView.itemList.length : null,
      showCount: Array.isArray(traceView?.ShowItemList) ? traceView.ShowItemList.length : null,
      listArray: Array.isArray(asRecord(traceView?.list)?.array) ? (asRecord(traceView?.list)?.array as unknown[]).length : null,
      viewKeys: traceView ? Object.keys(traceView).slice(0, 80) : [],
      items: (Array.isArray(traceView?.itemList) ? traceView.itemList : []).slice(0, 40).map((entry) => {
        const item = asRecord(entry);
        return { skinID: item ? itemSkinId(item) : null, hasSkin: item?.hasSkin, dynamicState: item?.dynamicState, visible: item?.visible };
      })
    });
    if (!items || !localOn()) return;
    restorePreview(windowName);
    const view = asRecord(skinWindow(windowName)?.selectView);
    const records = items.map(asRecord).filter((item): item is UnknownRecord => item !== null);
    if (!view || !guardSelectView(view, records)) return;
    bindPickerListRefresh(view, windowName);
    previewItems.set(windowName, new Set(records));
    records.forEach((item) => {
      guardItemRender(item);
      unlockItem(item);
    });
    syncPickerUsingState(view);
    // 整表重绘会再次走进列表刷新。这里只重绘一次，避免皮肤很多的武将把界面刷死。
    suppressPickerPreview = true;
    try {
      callMethod(view, 'updateContent');
    } catch {
      // 列表尚未就绪时忽略。
    } finally {
      queueMicrotask(() => {
        suppressPickerPreview = false;
      });
    }
  }

  function syncOpenWindows(): void {
    for (const name of SKIN_WINDOWS) {
      if (!skinWindow(name)) continue;
      if (localOn()) void applyPreview(name);
      else restorePreview(name);
    }
  }

  // ---------- 他人换肤 ----------

  function seatKey(seat: object): number {
    let key = seatKeys.get(seat);
    if (!key) {
      key = ++seatToken;
      seatKeys.set(seat, key);
    }
    return key;
  }

  function overrideKey(seat: UnknownRecord, isZhu: boolean, generalID: number): string {
    return `${seatKey(seat)}:${isZhu ? 'main' : 'deputy'}:${generalID}`;
  }

  function seatIndex(seat: UnknownRecord | null): unknown {
    return seat?.Index ?? seat?.index ?? seat?.seatID;
  }

  function isSpectating(manager: UnknownRecord): boolean {
    const lookOn = asRecord(manager.lookOnBtn);
    if (!lookOn || lookOn.destroyed) return false;
    return '_visible' in lookOn ? lookOn._visible === true : lookOn.visible === true;
  }

  /** 悬停的是主将还是副将。 */
  function hoveredIsZhu(manager: UnknownRecord): boolean {
    const seat = asRecord(manager.seat);
    if (!seat) return manager.isZhu !== false;
    if (seat.General2 && typeof manager.getTipGeneral === 'function') {
      try {
        const general = (manager.getTipGeneral as () => unknown).call(manager);
        if (general === seat.General2) return false;
        if (general === seat.General) return true;
      } catch {
        // 回退到 isZhu。
      }
    }
    return manager.isZhu !== false;
  }

  function findOverride(seat: UnknownRecord, generalID: number): OtherSkinOverride | null {
    if (seat.IsSelf || !(generalID > 0)) return null;
    for (const isZhu of [true, false]) {
      const info = seatGeneral(seat, isZhu);
      if (!info || !seatHoldsGeneral(seat, info, generalID)) continue;
      const exact = overrides.get(overrideKey(seat, isZhu, info.generalID));
      if (exact?.epoch === epoch) return exact;
      const prefix = `${seatKey(seat)}:${isZhu ? 'main' : 'deputy'}:`;
      for (const [key, value] of overrides) {
        if (key.startsWith(prefix) && value.epoch === epoch && seatHoldsGeneral(seat, info, value.generalID)) return value;
      }
    }
    return null;
  }

  function sessionValid(session: OtherSkinSession | null): session is OtherSkinSession {
    if (!session || session.cancelled || session.completed || session.epoch !== epoch || !otherOn()) return false;
    if (session.scene !== locator.gameScene() || session.seat.destroyed || session.seat.IsSelf) return false;
    if (seatIndex(session.seat) !== session.seatIndex) return false;
    const info = seatGeneral(session.seat, session.isZhu);
    return Boolean(info && seatHoldsGeneral(session.seat, info, session.generalID));
  }

  function sessionFor(view: UnknownRecord, generalHint = 0): OtherSkinSession | null {
    const bound = sessionByView.get(view);
    if (bound && !bound.completed) return bound;
    const active = [...sessions].filter((session) => !session.completed && session.epoch === epoch)
      .sort((a, b) => b.token - a.token);
    if (!active.length) return null;
    const generalID = Number(view.realGeneralID ?? view.generalID) || Number(generalHint) || 0;
    if (generalID) {
      const matched = active.find((session) => session.generalID === generalID);
      if (matched) return matched;
    }
    if (openingSession && active.includes(openingSession) && (!generalID || openingSession.generalID === generalID)) {
      return openingSession;
    }
    const free = active.filter((session) => !session.view || session.view === view);
    return !generalID && free.length === 1 ? free[0] : null;
  }

  function bindSession(view: UnknownRecord, session: OtherSkinSession): void {
    sessionByView.set(view, session);
    session.view = view;
    const info = seatGeneral(session.seat, session.isZhu);
    if (!info) return;
    view.usingSkinID = info.skinID;
    view.closeSelectSkinId = info.skinID;
    view.closeSelectDynamicState = info.isDynamic ? 1 : 0;
  }

  function endSession(session: OtherSkinSession | null): void {
    if (!session) return;
    session.cancelled = true;
    session.completed = true;
    sessions.delete(session);
    if (openingSession === session) openingSession = null;
  }

  function cancelAllSessions(): void {
    [...sessions].forEach(endSession);
    openingSession = null;
  }

  function tryBindOpenWindow(session: OtherSkinSession): boolean {
    if (!sessionValid(session)) return false;
    const win = skinWindow('ChangeSkinWindow') ?? skinWindow('SelectSkinWindow');
    const view = asRecord(win?.selectView);
    if (!win || !view) return false;
    const generalID = Number(win.generalID ?? view.realGeneralID ?? session.generalID);
    if (generalID !== session.generalID) return false;
    bindSession(view, session);
    if (openingSession === session) openingSession = null;
    callMethod(view, 'sortList');
    callMethod(view, 'updateContent');
    skinTrace('other-bind', {
      generalID,
      windowName: win.name,
      itemCount: Array.isArray(view.itemList) ? view.itemList.length : null,
      showCount: Array.isArray(view.ShowItemList) ? view.ShowItemList.length : null
    });
    return true;
  }

  function scheduleBind(session: OtherSkinSession): void {
    OTHER_BIND_DELAYS.forEach((delay) => tasks.later(() => {
      if (openingSession === session) tryBindOpenWindow(session);
    }, delay));
    tasks.later(() => {
      if (openingSession !== session) return;
      const view = asRecord((skinWindow('ChangeSkinWindow') ?? skinWindow('SelectSkinWindow'))?.selectView);
      if (view) sessionByView.delete(view);
      endSession(session);
    }, OTHER_OPEN_TIMEOUT);
  }

  function isDynamicChoice(view: UnknownRecord, skinID: number, dynamicState: unknown): boolean {
    const preview = findPreviewItem(view, skinID);
    if (preview) return preview.original.supportsDynamic;
    if (typeof dynamicState === 'boolean') return dynamicState;
    const state = Number(dynamicState) || 0;
    return state > 0 || state === -1;
  }

  /** 确认后只在本地替换该座位皮肤并记住，服务器刷新时继续覆盖。 */
  function finishOtherSelection(view: UnknownRecord): { handled: boolean; applied: boolean } {
    const session = sessionFor(view);
    if (!session) return { handled: false, applied: false };
    sessionByView.delete(view);
    let applied = false;
    const shouldHandle = view.clickCheck === true && sessionValid(session);
    if (shouldHandle) {
      const info = seatGeneral(session.seat, session.isZhu);
      const skinID = Number(view.closeSelectSkinId);
      if (info && Number.isFinite(skinID) && skinID >= 0) {
        const isDynamic = isDynamicChoice(view, skinID, view.closeSelectDynamicState);
        const key = overrideKey(session.seat, session.isZhu, info.generalID);
        const previous = overrides.get(key);
        overrides.set(key, { epoch, seat: session.seat, generalID: info.generalID, skinID, isDynamic, skinType: info.skinType });
        ensureSeatSetGeneralSkinOverrideHook(session.seat);
        try {
          applySkin(session.seat, info.generalID, skinID, isDynamic, info.skinType);
          applied = true;
        } catch (error) {
          if (previous) overrides.set(key, previous);
          else overrides.delete(key);
          console.warn('[他人换肤] 本地应用失败:', error);
          showToast('给其他角色换肤失败，请重试', 'error');
        }
      }
    }
    endSession(session);
    return { handled: shouldHandle, applied };
  }

  /** 以“自己”的身份再调用一次悬停处理，让游戏为他人武将也生成换肤按钮。 */
  function hoverAsSelf(manager: UnknownRecord, args: unknown[], isZhu: boolean, original: PatchableFunction): unknown {
    const seat = asRecord(manager.seat);
    if (!seat) return undefined;
    if (isSpectating(manager)) return original.apply(manager, args);
    const selfDescriptor = Object.getOwnPropertyDescriptor(seat, 'IsSelf');
    const canChangeSkin = manager.canChangeSkin;
    const activated = manager.activated;
    const wasZhu = manager.isZhu;
    let overridden = false;
    try {
      Object.defineProperty(seat, 'IsSelf', { value: true, configurable: true });
      overridden = true;
      manager.canChangeSkin = true;
      manager.activated = false;
      manager.isZhu = isZhu;
      return original.apply(manager, args);
    } finally {
      manager.canChangeSkin = canChangeSkin;
      manager.activated = activated;
      manager.isZhu = wasZhu;
      if (overridden) {
        if (selfDescriptor) Object.defineProperty(seat, 'IsSelf', selfDescriptor);
        else delete seat.IsSelf;
      }
    }
  }

  const originalSkinClick = new WeakMap<object, PatchableFunction>();

  function bindOtherSkinButton(manager: UnknownRecord, isZhu: boolean): void {
    const seat = asRecord(manager.seat);
    if (!seat || seat.IsSelf || isSpectating(manager)) return;
    const prototype = prototypeOf(manager);
    const button = asRecord(manager.skinBtn);
    if (button && prototype && !ownSkinButtons.has(button)) {
      const eventName = layaEvent()?.CLICK;
      const nativeClick = originalSkinClick.get(prototype);
      if (eventName) {
        if (nativeClick) callMethod(button, 'off', eventName, manager, nativeClick);
        callMethod(button, 'off', eventName, manager, manager.onSKinClick);
        callMethod(button, 'on', eventName, manager, manager.onSKinClick);
      }
      ownSkinButtons.add(button);
    }
    if (button) {
      button.mouseEnabled = true;
      button.mouseThrough = true;
      button.__xcOtherSkinIsZhu = isZhu;
      if (seat.General2 && typeof manager.getTipGeneral === 'function') {
        const half = Math.round(Number(manager.width || 146) / 2);
        button.x = isZhu ? Math.max(0, 104 - half) : 104;
      }
    }
  }

  function patchSeatManager(manager: UnknownRecord): void {
    if (!otherOn()) return;
    const prototype = prototypeOf(manager);
    if (!prototype) return;
    patcher.wrap(prototype, 'onSKinClick', (original) => {
      originalSkinClick.set(prototype, original);
      return function (this: UnknownRecord, ...args: unknown[]) {
        const seat = asRecord(this.seat);
        if (!otherOn() || !seat || seat.IsSelf || isSpectating(this)) return original.apply(this, args);
        return openOtherPicker(this, args, original) || original.apply(this, args);
      };
    });
    patcher.wrap(prototype, 'OnSomeTextureOver', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      const seat = asRecord(this.seat);
      if (!seat || seat.IsSelf) return original.apply(this, args);
      const result = original.apply(this, args);
      if (!otherOn()) {
        const button = asRecord(this.skinBtn);
        if (button) Object.assign(button, { visible: false, mouseEnabled: false });
        return result;
      }
      const manager = this;
      const isZhu = hoveredIsZhu(manager);
      tasks.later(() => {
        if (shouldYieldToGeneralSkillTip()) return;
        if (!otherOn()) return;
        const liveSeat = asRecord(manager.seat);
        if (!liveSeat || liveSeat.IsSelf || isSpectating(manager)) return;
        hoverAsSelf(manager, args, isZhu, original);
        bindOtherSkinButton(manager, isZhu);
      }, 0);
      return result;
    });
  }

  /** 打开原生换肤框，并把窗口绑定到这次他人换肤会话。 */
  function openOtherPicker(manager: UnknownRecord, args: unknown[], original: PatchableFunction): boolean {
    const button = asRecord(manager.skinBtn);
    const isZhu = typeof button?.__xcOtherSkinIsZhu === 'boolean' ? button.__xcOtherSkinIsZhu : hoveredIsZhu(manager);
    const info: SeatGeneralInfo | null = seatGeneral(manager.seat, isZhu);
    const scene = locator.gameScene();
    if (!info || info.seat.IsSelf || !scene) return false;
    if (openingSession) endSession(openingSession);
    const session: OtherSkinSession = {
      token: ++sessionToken,
      epoch,
      scene,
      seat: info.seat,
      seatIndex: seatIndex(info.seat),
      isZhu: info.isZhu,
      generalID: info.generalID,
      view: null,
      cancelled: false,
      completed: false
    };
    sessions.add(session);
    openingSession = session;
    const wasZhu = manager.isZhu;
    try {
      manager.isZhu = info.isZhu;
      original.apply(manager, args);
    } catch (error) {
      endSession(session);
      console.warn('[他人换肤] 打开换肤框失败:', error);
      return false;
    } finally {
      manager.isZhu = wasZhu;
    }
    if (openingSession === session) scheduleBind(session);
    return true;
  }

  function seatManagers(scene: UnknownRecord | null): UnknownRecord[] {
    const managers = new Set<UnknownRecord>();
    const visit = (seatUi: unknown) => {
      const record = asRecord(seatUi);
      if (!record) return;
      for (const manager of [record.otherTopManager, record.topManager]) {
        const candidate = asRecord(manager);
        if (typeof candidate?.OnSomeTextureOver === 'function' && typeof candidate.onSKinClick === 'function') {
          managers.add(candidate);
        }
      }
      if (record.fuSeatUI && record.fuSeatUI !== record) visit(record.fuSeatUI);
    };
    const seatUis = asRecord(scene?.seatContainer)?.seatUIs;
    if (Array.isArray(seatUis)) seatUis.forEach(visit);
    visit(scene?.SelfSeatUi);
    return [...managers];
  }

  function hideOwnSkinButtons(): void {
    ownSkinButtons.forEach((button) => {
      button.visible = false;
      button.mouseEnabled = false;
    });
  }

  /** 进入新牌局时清空覆盖记录。 */
  function resetForScene(): void {
    hideOwnSkinButtons();
    ownSkinButtons.clear();
    cancelAllSessions();
    for (const override of overrides.values()) {
      restoreSeatSetGeneralSkinOverride(override.seat);
    }
    overrides.clear();
    epoch += 1;
  }

  function syncGameScene(): number {
    const scene = locator.gameScene();
    if (scene && currentScene && scene !== currentScene) resetForScene();
    if (scene) currentScene = scene;
    const managers = seatManagers(scene);
    managers.forEach((manager) => {
      if (otherOn()) patchSeatManager(manager);
    });
    if (!otherOn()) {
      hideOwnSkinButtons();
      cancelAllSessions();
      overrides.clear();
    }
    return managers.length;
  }

  function waitForSeats(): void {
    void tasks.poll(() => {
      if (!locator.gameScene()) return false;
      const ready = syncGameScene() > 0;
      if (ready) scheduleApplySavedSkinsForSelf();
      return ready;
    }, 60, 500);
  }

  // ---------- 换肤框原型：他人换肤接管初始化与确认 ----------

  function patchPickerPrototype(view: unknown): void {
    const prototype = prototypeOf(view);
    if (!prototype) return;
    patcher.wrap(prototype, 'initUsingSKinID', (original) => function (this: UnknownRecord, generalID: unknown, ...rest: unknown[]) {
      const session = sessionFor(this, Number(generalID));
      if (session && Number(generalID) === session.generalID) {
        if (sessionValid(session)) {
          bindSession(this, session);
          if (openingSession === session) openingSession = null;
          return undefined;
        }
        sessionByView.set(this, session);
      }
      const saved = localOn() && isOwnGeneral(Number(generalID)) ? savedSkin(generalID) : null;
      if (saved) {
        this.usingSkinID = saved.skinID;
        if ('usingDynamicState' in this) this.usingDynamicState = saved.isDynamic ? 1 : 0;
      }
      const result = original.call(this, generalID, ...rest);
      if (!(Number(this.usingSkinID) > 0)) {
        const manager = locator.manager('GeneralSkinManager');
        const using = callMethod(manager, 'GetSelfUsingSkinID', generalID);
        if (using !== undefined) this.usingSkinID = using;
      }
      if (saved) {
        this.usingSkinID = saved.skinID;
        this.closeSelectSkinId = saved.skinID;
        if ('usingDynamicState' in this) this.usingDynamicState = saved.isDynamic ? 1 : 0;
        try {
          applyToSelfSeat(Number(generalID), saved.skinID, saved.isDynamic);
        } catch (error) {
          console.warn('[皮肤解锁] 换肤窗初始化套用本地皮肤失败:', error);
        }
        syncPickerUsingState(this);
        try {
          callMethod(this, 'updateContent');
        } catch {
          // 列表尚未就绪时忽略。
        }
      }
      return result;
    });
    patcher.wrap(prototype, 'UpdateInfo', (original) => function (this: UnknownRecord, generalID: unknown, ...rest: unknown[]) {
      const result = original.call(this, generalID, ...rest);
      const session = sessionFor(this, Number(generalID));
      if (session && Number(generalID) === session.generalID) {
        if (sessionValid(session)) {
          bindSession(this, session);
          callMethod(this, 'sortList');
          callMethod(this, 'updateContent');
        } else {
          sessionByView.set(this, session);
        }
      }
      if (suppressPickerPreview) return result;
      const view = this;
      void tasks.poll(() => owningWindowName(view), 30, 100).then((windowName) => {
        if (suppressPickerPreview) return;
        skinTrace('update-info', { generalID, windowName, session: Boolean(session) });
        if (windowName) void applyPreview(windowName);
      });
      return result;
    });
    patcher.wrap(prototype, 'closeSelectSure', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      const other = finishOtherSelection(this);
      return other.handled ? other.applied : original.apply(this, args);
    });
  }

  /** 换肤框首次打开前就要接管 initUsingSKinID，因此启动时临时建一个实例取原型。 */
  function preparePickerPrototype(): void {
    for (const name of SKIN_WINDOWS) {
      const instance = locator.createInstance(name);
      if (!instance) continue;
      patchPickerPrototype(instance.selectView);
      skinTrace('picker-prototype', { name, viewFound: Boolean(instance.selectView) });
      try {
        callMethod(instance, 'destroy', true);
      } catch {
        // 临时实例销毁失败不影响补丁。
      }
    }
  }

  function onSkinWindowShown(windowName: string): void {
    const view = asRecord(skinWindow(windowName)?.selectView);
    skinTrace('window-show', { windowName, windowFound: Boolean(skinWindow(windowName)), viewFound: Boolean(view), openingSession: Boolean(openingSession) });
    if (view) patchPickerPrototype(view);
    void applyPreview(windowName);
  }

  if (gameEvents) {
    unsubscribes.push(gameEvents.subscribe((event) => {
      if (event.type === 'game-started' || event.type === 'game-ended') {
        clearSeatHpCache();
        return;
      }
      if (event.type !== 'hp-updated') return;
      handleHpUpdated(event.seatId, event.hp, event.maxHp, event.maxHpOnly);
    }));
  }

  unsubscribes.push(
    configStore.subscribe('skin.localSkin', () => {
      syncOpenWindows();
      scheduleApplySavedSkinsForSelf();
    }),
    configStore.subscribe('skin.otherLocalSkin', () => {
      syncGameScene();
      if (otherOn()) waitForSeats();
    })
  );

  watchWindowShow(locator, patcher, tasks, SKIN_WINDOWS, onSkinWindowShown);
  watchSceneSwitch(locator, patcher, tasks, () => {
    syncGameScene();
    waitForSeats();
    scheduleApplySavedSkinsForSelf();
    syncOpenWindows();
  });
  void tasks.poll(() => locator.dispatcher() && locator.manager('WindowManager'), Infinity, 1000).then((ready) => {
    if (!ready) return;
    preparePickerPrototype();
    syncGameScene();
    if (locator.gameScene()) {
      waitForSeats();
      scheduleApplySavedSkinsForSelf();
    }
  });

  return {
    filterMessage,
    dispose() {
      unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
      tasks.dispose();
      restorePreview();
      hideOwnSkinButtons();
      cancelAllSessions();
      overrides.clear();
      clearSeatHpCache();
      patcher.restoreAll();
    }
  };
}

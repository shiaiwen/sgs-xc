/** 斗地主与单骑无双商店：只为指定限购商品提供按账号自动兑换。 */

import type { CardConfigSource } from '../../adapters/card-config-source.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { resolveGameAccountId } from '../../runtime/game-account-session.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { everyInterval } from '../../runtime/shared-ticker.ts';
import { storageKeyForAccount } from '../skin-background/skin-runtime.ts';

type RecordLike = Record<string, unknown>;
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

interface PendingExchange {
  id: number;
  bought: number;
  count: number;
  balance: number;
  success: boolean;
  balanceUpdated: boolean;
}

/** 新键避免旧版“任意限购商品”的勾选在收窄范围后继续自动兑换。 */
const STORAGE_KEY = 'XC_DDZ_AUTO_EXCHANGE_TARGETED';
const POLL_MS = 1_000;
const REQUEST_COOLDOWN_MS = 15_000;
const SHOP_WINDOW = 'DdzShopWindow';
const DAILY_RECRUIT_TOKEN_ID = 8100201;
const RECRUIT_TOKEN_BUNDLE_ID = 9020701;
const CHECKBOX_NAME = 'xcDdzAutoExchangeCheck';
const LIMIT_TYPES = new Set([1, 2, 3]);
const LIMIT_LABELS: Record<number, string> = { 1: '每日', 2: '每周', 3: '每月' };

function record(value: unknown): RecordLike | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as RecordLike : null;
}

function number(value: unknown): number {
  return Number(value);
}

function call(target: RecordLike | null, name: string, ...args: unknown[]): unknown {
  const method = target?.[name];
  return typeof method === 'function' ? method.apply(target, args) : undefined;
}

function isLimited(item: RecordLike | null): boolean {
  return !!item && LIMIT_TYPES.has(number(item.MaxBuyType))
    && Number.isSafeInteger(number(item.MaxBuyCount)) && number(item.MaxBuyCount) > 0;
}

function isTargetGood(name: unknown, limitType: unknown, itemId: unknown): boolean {
  const normalized = String(name ?? '').replace(/\s/g, '').replace(/[xX*]/g, '×');
  const period = number(limitType);
  return period === 2 && (normalized === '祈福灯' || normalized === '招募令×3'
    || (normalized === '招募令' && number(itemId) === RECRUIT_TOKEN_BUNDLE_ID))
    || period === 1 && (/^武将包(?:×\d+)?$/.test(normalized)
      || (normalized === '招募令' && number(itemId) === DAILY_RECRUIT_TOKEN_ID));
}

function beijingClock(now = Date.now()): { day: string; weekday: number; hour: number; minute: number } {
  const date = new Date(now + 8 * 60 * 60 * 1_000);
  return {
    day: date.toISOString().slice(0, 10),
    weekday: date.getUTCDay(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes()
  };
}

export interface DdzShopAutoExchangeOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  storage?: StorageLike;
  cardConfigSource: Pick<CardConfigSource, 'getDdzShopCurrencyGoodsId'>;
}

export function installDdzShopAutoExchange(options: DdzShopAutoExchangeOptions): () => void {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const storage = options.storage ?? globalObject.localStorage;
  const patcher = createMethodPatcher();
  const checkboxes = new Map<RecordLike, { view: RecordLike; sprite: RecordLike }>();
  let owner = '';
  let manager: RecordLike | null = null;
  let proxy: RecordLike | null = null;
  let selected = new Set<number>();
  let readyDay = '';
  let requestedDay = '';
  let lastRequestAt = 0;
  let mondayRefreshDay = '';
  let pending: PendingExchange | null = null;
  let failed = new Set<number>();
  let listeners: Array<() => void> = [];
  let disposed = false;

  function readSelected(account: string): Set<number> {
    try {
      const saved = JSON.parse(storage?.getItem(storageKeyForAccount(STORAGE_KEY, account)) || '[]');
      return new Set(Array.isArray(saved) ? saved.map(number).filter((id) => Number.isSafeInteger(id) && id > 0) : []);
    } catch {
      return new Set();
    }
  }

  function saveSelected(): void {
    if (!owner) return;
    try {
      storage?.setItem(storageKeyForAccount(STORAGE_KEY, owner), JSON.stringify([...selected]));
    } catch (error) {
      console.warn('[商店自动兑换] 保存勾选失败:', error);
    }
  }

  function bind(target: RecordLike | null, event: string, handler: (payload: unknown) => void): void {
    if (typeof target?.on !== 'function' || typeof target.off !== 'function') return;
    target.on(event, target, handler);
    listeners.push(() => target.off(event, target, handler));
  }

  function requestList(): void {
    if (!owner || !selected.size || !manager || typeof manager.ReqDdzShopListGeneralPoolList !== 'function') return;
    if (Date.now() - lastRequestAt < REQUEST_COOLDOWN_MS) return;
    lastRequestAt = Date.now();
    requestedDay = beijingClock().day;
    try {
      call(manager, 'ReqDdzShopListGeneralPoolList');
    } catch (error) {
      requestedDay = '';
      console.warn('[商店自动兑换] 同步限购列表失败:', error);
    }
  }

  function isTargetItem(item: RecordLike | null, name: unknown): boolean {
    return isLimited(item) && isTargetGood(name, item?.MaxBuyType, item?.ItemID);
  }

  function bindRuntime(account: string, nextManager: RecordLike | null, nextProxy: RecordLike | null): void {
    if (owner === account && manager === nextManager && proxy === nextProxy) return;
    listeners.forEach((stop) => stop());
    listeners = [];
    owner = account;
    manager = nextManager;
    proxy = nextProxy;
    selected = account ? readSelected(account) : new Set();
    readyDay = requestedDay = '';
    lastRequestAt = 0;
    mondayRefreshDay = '';
    pending = null;
    failed = new Set();
    if (!account || !manager || !proxy) return;
    bind(proxy, 'ClientFightLordGoodsLimitInfoRep', (payload) => {
      if (number(record(record(payload)?.Protocol)?.Type) === 0) readyDay = beijingClock().day;
      runExchange();
    });
    bind(manager, 'UPDATE_DDZ_SHOP_LIMIT_UPDATE_EVENT', () => {
      if (requestedDay === beijingClock().day && manager?.IsDdzShopListGeneralPoolListReady) {
        readyDay = requestedDay;
      }
      runExchange();
    });
    bind(proxy, 'ClientExchangeFightLordGoodsRep', (payload) => {
      const reply = record(record(payload)?.Protocol);
      if (!pending || pending.id !== number(reply?.ItemID)) return;
      if (number(reply?.Result) === 0) pending.success = true;
      else {
        failed.add(pending.id);
        pending = null;
      }
      runExchange();
    });
    requestList();
  }

  function balance(): number {
    const currencyId = options.cardConfigSource.getDdzShopCurrencyGoodsId();
    const goods = locator.manager('GameGoodsManager');
    if (!currencyId || typeof goods?.GetGoodsNumByFourID !== 'function') return NaN;
    return number(call(goods, 'GetGoodsNumByFourID', currencyId));
  }

  function runExchange(): void {
    if (disposed || !owner || owner !== resolveGameAccountId(globalObject, locator) || !manager || !selected.size) return;
    const clock = beijingClock();
    if (readyDay !== clock.day || !manager.IsDdzShopListGeneralPoolListReady) return;
    // 周一零点服务器重置商店，等待重置窗口结束再兑换。
    if (clock.weekday === 1 && clock.hour === 0 && clock.minute < 10) return;
    const money = balance();
    if (!Number.isSafeInteger(money) || money < 0) return;
    if (pending) {
      if (money !== pending.balance) pending.balanceUpdated = true;
      const bought = number(call(manager, 'GetDdzHasBuyCountByItemID', pending.id));
      if (!pending.success || !pending.balanceUpdated || !Number.isSafeInteger(bought)
        || bought < pending.bought + pending.count) return;
      pending = null;
    }
    const items = Array.isArray(manager.DdzShopSortList) ? manager.DdzShopSortList : [];
    for (const rawItem of items) {
      const item = record(rawItem);
      const id = number(item?.ItemID);
      const price = number(item?.Price);
      // 专用存储键只保存通过目标商品勾选框选择的 ID，登录后无需先打开商店取名称。
      if (!isLimited(item) || !selected.has(id) || failed.has(id)) continue;
      if (!Number.isSafeInteger(price) || price <= 0 || number(manager.DdzZgsWinCtn) < number(item?.winCount)) continue;
      if (call(manager, 'isGoodsOwned', item) === true) continue;
      const bought = number(call(manager, 'GetDdzHasBuyCountByItemID', id));
      if (!Number.isSafeInteger(bought) || bought < 0) continue;
      const count = Math.min(number(item?.MaxBuyCount) - bought, Math.floor(money / price));
      if (count <= 0) continue;
      if (typeof manager.DdzExchange !== 'function') return;
      pending = { id, bought, count, balance: money, success: false, balanceUpdated: false };
      try {
        call(manager, 'DdzExchange', id, price, count);
      } catch (error) {
        // 保持 pending，不在本次登录中盲目重发购买请求。
        console.warn('[商店自动兑换] 发送失败，等待重新登录后同步:', error);
      }
      return;
    }
  }

  function createCheckbox(view: RecordLike, item: RecordLike): RecordLike | null {
    if (typeof view.addChild !== 'function') return null;
    const classUtils = record(globalObject.Laya?.ClassUtils);
    const Laya = record(globalObject.Laya);
    let sprite: RecordLike | null = null;
    try {
      sprite = record(call(classUtils, 'getInstance', 'SgsSprite'));
    } catch (error) {
      console.warn('[商店自动兑换] 创建游戏勾选框失败:', error);
    }
    if (!sprite && typeof Laya?.Sprite === 'function') sprite = record(new (Laya.Sprite as new () => unknown)());
    if (!sprite) return null;
    sprite.name = CHECKBOX_NAME;
    call(sprite, 'size', 20, 20);
    sprite.mouseEnabled = true;
    sprite.needStopPropagation = true;
    const eventName = record(globalObject.Laya?.Event)?.CLICK ?? 'click';
    const stopEvent = (event: unknown) => call(record(event), 'stopPropagation');
    for (const name of [
      record(globalObject.Laya?.Event)?.MOUSE_OVER,
      record(globalObject.Laya?.Event)?.MOUSE_DOWN,
      record(globalObject.Laya?.Event)?.MOUSE_MOVE
    ]) {
      if (typeof name === 'string') call(sprite, 'on', name, sprite, stopEvent);
    }
    call(sprite, 'on', eventName as string, sprite, (event: unknown) => {
      stopEvent(event);
      if (disposed || !Array.isArray(view.itemList) || !view.itemList.includes(item)) return;
      const info = record(item.limitInfo);
      if (!item.goodsinfo || !isTargetItem(info, record(item.goodsinfo)?.name) || !owner) return;
      const id = number(info?.ItemID);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      saveSelected();
      failed.delete(id);
      if (selected.has(id)) {
        if (readyDay !== beijingClock().day) requestList();
        else runExchange();
      }
      renderShop(view);
    });
    // 商品是 DrawSprite，没有 addChild。和商品共用 shopView 的坐标系。
    view.addChild(sprite);
    checkboxes.set(item, { view, sprite });
    return sprite;
  }

  function renderShop(view: RecordLike | null): void {
    if (!view || view.destroyed) return;
    const items = Array.isArray(view.itemList) ? view.itemList : [];
    // 商店同步时可能重建商品卡片，移除依附于旧卡片的控件。
    for (const [item, entry] of checkboxes) {
      if (entry.view !== view || items.includes(item)) continue;
      if (!entry.sprite.destroyed) call(entry.sprite, 'destroy', true);
      checkboxes.delete(item);
    }
    for (const rawItem of items) {
      const item = record(rawItem);
      if (!item) continue;
      const info = record(item.limitInfo);
      const eligible = !!item.goodsinfo && isTargetItem(info, record(item.goodsinfo)?.name);
      const cached = checkboxes.get(item)?.sprite;
      const sprite = cached && !cached.destroyed ? cached : eligible ? createCheckbox(view, item) : null;
      if (!sprite || sprite.destroyed) continue;
      sprite.visible = eligible && item.visible !== false;
      if (!sprite.visible) continue;
      const checked = selected.has(number(info?.ItemID));
      const period = LIMIT_LABELS[number(info?.MaxBuyType)] || '';
      sprite.ToolTip = `自动兑换：${period}兑换至限购上限\n仅对当前账号生效；余额不足时先兑换可负担次数，补足后继续`;
      // 商品卡片为 214×95；目标位置是价格左侧、限购文字上方。
      call(sprite, 'pos', number(item.x) + 88, number(item.y) + 42);
      const graphics = record(sprite.graphics);
      call(graphics, 'clear');
      call(graphics, 'drawRect', 1, 1, 18, 18, checked ? '#6b501b' : '#201e1a', '#e4d5a0', 1);
      if (checked) call(graphics, 'drawLines', 0, 0, [5, 10, 9, 14, 15, 6], '#ffe3a0', 2);
    }
  }

  function bindShopView(view: RecordLike | null): void {
    if (!view || view.destroyed) return;
    patcher.wrap(view, 'updateList', (original) => function (this: RecordLike, ...args) {
      const result = original.apply(this, args);
      renderShop(this);
      return result;
    });
    renderShop(view);
  }

  function tick(): void {
    if (disposed) return;
    patcher.wrap(locator.classPrototype(SHOP_WINDOW), 'initUI', (original) => function (this: RecordLike, ...args) {
      const result = original.apply(this, args);
      bindShopView(record(this.shopView));
      return result;
    });
    const account = resolveGameAccountId(globalObject, locator);
    bindRuntime(account, locator.manager('ActivityGameDataManager'), locator.manager('ServerProxy'));
    const clock = beijingClock();
    if (clock.weekday === 1 && clock.hour === 0 && clock.minute >= 10 && mondayRefreshDay !== clock.day) {
      mondayRefreshDay = clock.day;
      readyDay = requestedDay = '';
      lastRequestAt = 0;
    }
    if (requestedDay !== clock.day) {
      readyDay = '';
      failed.clear();
      pending = null;
      requestList();
    } else if (selected.size && readyDay !== clock.day) {
      requestList();
    }
    const shopWindow = locator.window(SHOP_WINDOW);
    bindShopView(record(shopWindow?.shopView));
    runExchange();
  }

  const stopPolling = everyInterval('斗地主商店自动兑换', POLL_MS, tick, {}, globalObject);
  tick();
  return () => {
    disposed = true;
    stopPolling();
    listeners.forEach((stop) => stop());
    patcher.restoreAll();
    for (const { sprite } of checkboxes.values()) if (!sprite.destroyed) call(sprite, 'destroy', true);
    checkboxes.clear();
  };
}

/**
 * 秒杀连点：列出当前秒杀商品，勾选某一项后，到点（提前 1 秒）按 300ms 节奏连点下单，抢到或满额即停。
 *
 * 游戏侧下单入口是 NewSecKillManager（单例）上的混淆方法（本次包体里叫 tt），
 * 源码含特征串 newSecKill_baseID，由 locator 还原成 ReqBuySeckillGoods 后调用。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator';
import { createLayaObjectLocator } from '../../adapters/laya-object-locator';
import { everyInterval } from '../../runtime/shared-ticker';

const SEC_KILL_REFRESH_MS = 1000;
const SEC_KILL_TICK_MS = 300;
/** 开售前提前启动连点的毫秒数。 */
const SEC_KILL_LEAD_MS = 1000;
/** 列表为空时，最多每 30 秒主动拉一次秒杀活动信息，避免空轮询反复请求。 */
const SEC_KILL_INFO_REFRESH_MS = 30_000;

type UnknownRecord = Record<string, unknown>;
type BuyMethod = (goods: UnknownRecord, actId: number) => unknown;
type GoodsConfigLookup = (id: number) => unknown;

export interface SecKillItem {
  actId: number;
  goodsId: number;
  baseId: number;
  label: string;
  startMs: number;
  endMs: number;
  stockNow: number;
  disabled: boolean;
}

interface SecKillSelection {
  actId: number;
  goodsId: number;
  baseId: number;
  startMs: number;
}

export interface SecKillSnapshot {
  items: SecKillItem[];
  selectedActId: number | null;
  selectedGoodsId: number | null;
}

export interface SecKillController {
  getSnapshot(): SecKillSnapshot;
  subscribe(listener: (snapshot: SecKillSnapshot) => void): () => void;
  select(item: SecKillItem): void;
  cancel(): void;
  isSelected(actId: number, goodsId: number): boolean;
  /** 面板展开时开列表刷新，收起时停，避免没人看还每秒拉列表。 */
  setActive(active: boolean): void;
  dispose(): void;
}

export interface SecKillControllerOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
}

export function installSecKillController(options: SecKillControllerOptions = {}): SecKillController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const listeners = new Set<(snapshot: SecKillSnapshot) => void>();
  let selected: SecKillSelection | null = null;
  let items: SecKillItem[] = [];
  let stopRefresh: (() => void) | null = null;
  let stopTick: (() => void) | null = null;
  let startTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let lastInfoReqAt = 0;
  let goodsConfigLookup: GoodsConfigLookup | null | undefined;
  let timeManager: UnknownRecord | null | undefined;

  function manager(): UnknownRecord | null {
    return locator.manager('NewSecKillManager');
  }

  function buyMethod(target: UnknownRecord): BuyMethod | null {
    const name = locator.obfuscatedMethodName(target, 'NewSecKillManager', 'ReqBuySeckillGoods');
    if (!name) return null;
    const resolved = target[name];
    return typeof resolved === 'function' ? resolved as BuyMethod : null;
  }

  function goodsName(itemId: number): string {
    if (goodsConfigLookup === undefined) {
      goodsConfigLookup = null;
      try {
        const proto = locator.classPrototype('SgxFPreviewWindow') as UnknownRecord | null;
        const lookup = proto?.getGoodConfig;
        if (typeof lookup === 'function') goodsConfigLookup = lookup as GoodsConfigLookup;
      } catch {
        // 取不到商品配置时退回空名。
      }
    }
    if (!goodsConfigLookup) return '';
    try {
      const goods = asRecord(goodsConfigLookup(itemId));
      const base = asRecord(goods?.baseInfo) ?? goods;
      return String(base?.name ?? base?.Name ?? goods?.name ?? goods?.Name ?? '');
    } catch {
      return '';
    }
  }

  function serverNowMs(): number {
    if (timeManager === undefined) {
      timeManager = locator.findManagerByPredicate((item) => (
        typeof (item as UnknownRecord)?.LocalStaticServerTime === 'number'
        || typeof (item as UnknownRecord)?.LocalServerTime === 'number'
      ));
    }
    const seconds = Number(
      timeManager?.LocalStaticServerTime
        ?? timeManager?.LocalServerTime
        ?? Math.floor(Date.now() / 1000)
    );
    return seconds * 1000;
  }

  function emit(): void {
    const snapshot: SecKillSnapshot = {
      items,
      selectedActId: selected?.actId ?? null,
      selectedGoodsId: selected?.goodsId ?? null
    };
    listeners.forEach((listener) => listener(snapshot));
  }

  function refresh(): void {
    if (disposed) return;
    const mgr = manager();
    // 用原始字典而不是 CurrentSecKills：CurrentSecKills 只返回开售展示期的活动，
    // 原始字典里才有还没开售（如早上 8 点开、7 点 50 能提前看到）的活动。
    const activities = mgr ? rawActivities(mgr) : [];
    if (!activities.length && typeof mgr?.SendNewSecKillInfoReq === 'function') {
      const nowMs = Date.now();
      if (nowMs - lastInfoReqAt >= SEC_KILL_INFO_REFRESH_MS) {
        lastInfoReqAt = nowMs;
        try {
          mgr.SendNewSecKillInfoReq();
        } catch {
          // 拉取失败下一轮再试。
        }
      }
    }
    const now = serverNowMs();
    const next: SecKillItem[] = [];
    for (const activity of activities) {
      const actId = Number(activity?.ActID ?? 0);
      const startMs = Number(activity?.BuyTime ?? 0) * 1000;
      const endMs = Number(activity?.BuyEndTime ?? 0) * 1000;
      if (endMs > 0 && endMs <= now) continue;
      for (const goods of goodsEntries(activity?.GoodsDataDic)) {
        if (isOwnedGenSkin(goods)) continue;  // 已有该武将/皮肤，不显示
        const goodsId = Number(goods?.itemId ?? goods?.ItemId ?? 0);
        const baseId = Number(goods?.baseId ?? goods?.BaseId ?? 0);
        const count = Number(goods?.count ?? goods?.Count ?? 1);
        const stockNow = Number(goods?.StockNow ?? 0);
        const limitSelf = Number(goods?.LimitSelfCount ?? 0);
        const limitSum = Number(goods?.limitSumCount ?? 0);
        const name = goodsName(baseId) || '秒杀商品';
        const price = Number(goods?.price ?? 0);
        const currency = currencyOf(Number(goods?.price_type ?? 0));
        const label = [
          name,
          count > 1 ? `×${count}` : '',
          price > 0 ? `${price}${currency}` : ''
        ].filter(Boolean).join(' ');
        next.push({
          actId,
          goodsId,
          baseId,
          label,
          startMs,
          endMs,
          stockNow,
          disabled: stockNow <= 0 || (limitSum > 0 && limitSelf >= limitSum)
        });
      }
    }
    items = next.filter((item) => !item.disabled);
    emit();
  }

  function tick(): void {
    if (disposed || !selected) return;
    const mgr = manager();
    if (!mgr) return;
    const activity = resolveActivity(mgr, selected.actId);
    if (!activity) {
      cancel();
      return;
    }
    const goods = resolveGoods(activity, selected.goodsId, selected.baseId);
    if (!goods) {
      cancel();
      return;
    }
    const limitSum = Number(goods?.limitSumCount ?? 0);
    const selfCount = Number(goods?.LimitSelfCount ?? 0);
    if (limitSum > 0 && selfCount >= limitSum) {
      cancel();
      return;
    }
    if (Number(goods?.StockNow ?? 0) <= 0) {
      if (typeof mgr.SendNewSecKillStockReq === 'function') {
        try {
          mgr.SendNewSecKillStockReq(selected.actId);
        } catch {
          // 刷新失败下一轮继续。
        }
      }
      return;
    }
    const buy = buyMethod(mgr);
    if (!buy) {
      cancel();
      return;
    }
    try {
      buy.call(mgr, goods, selected.actId);
    } catch {
      // 下单失败不中断，下一轮继续。
    }
  }

  function scheduleStart(): void {
    if (startTimer) clearTimeout(startTimer);
    startTimer = null;
    if (!selected) return;
    const delay = Math.max(0, selected.startMs - SEC_KILL_LEAD_MS - serverNowMs());
    startTimer = setTimeout(() => {
      startTimer = null;
      const mgr = manager();
      if (mgr && typeof mgr.SendNewSecKillStockReq === 'function') {
        try {
          mgr.SendNewSecKillStockReq(selected!.actId);
        } catch {
          // 忽略，tick 里还会补。
        }
      }
      tick();
      if (!stopTick) stopTick = everyInterval('秒杀连点', SEC_KILL_TICK_MS, tick, {}, globalObject);
    }, delay);
  }

  function select(item: SecKillItem): void {
    selected = { actId: item.actId, goodsId: item.goodsId, baseId: item.baseId, startMs: item.startMs };
    scheduleStart();
    emit();
  }

  function cancel(): void {
    selected = null;
    if (stopTick) {
      stopTick();
      stopTick = null;
    }
    if (startTimer) {
      clearTimeout(startTimer);
      startTimer = null;
    }
    emit();
  }

  function startRefreshLoop(): void {
    if (disposed || stopRefresh) return;
    stopRefresh = everyInterval('秒杀列表', SEC_KILL_REFRESH_MS, refresh, {}, globalObject);
    refresh();
  }

  function stopRefreshLoop(): void {
    if (!stopRefresh) return;
    stopRefresh();
    stopRefresh = null;
  }

  return {
    getSnapshot: () => ({
      items,
      selectedActId: selected?.actId ?? null,
      selectedGoodsId: selected?.goodsId ?? null
    }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    select,
    cancel,
    isSelected: (actId, goodsId) => selected?.actId === actId && selected?.goodsId === goodsId,
    setActive(active: boolean) {
      if (disposed) return;
      if (active) startRefreshLoop();
      else stopRefreshLoop();
    },
    dispose() {
      disposed = true;
      cancel();
      stopRefresh?.();
      stopRefresh = null;
      listeners.clear();
    }
  };
}

function resolveActivity(mgr: UnknownRecord, actId: number): UnknownRecord | null {
  const get = mgr.GetDataVoByActId;
  if (typeof get === 'function') {
    try {
      const vo = get.call(mgr, actId);
      if (vo) return vo as UnknownRecord;
    } catch {
      // 退回列表查找。
    }
  }
  const list = mgr.CurrentSecKills;
  if (Array.isArray(list)) {
    return (list as UnknownRecord[]).find((item) => Number(item?.ActID ?? 0) === actId) ?? null;
  }
  return null;
}

function resolveGoods(activity: UnknownRecord, goodsId: number, baseId: number): UnknownRecord | null {
  const dic = asRecord(activity?.GoodsDataDic);
  for (const id of [goodsId, baseId].filter((value) => value > 0)) {
    const get = dic?.getNumberKey ?? dic?.get;
    if (typeof get === 'function') {
      try {
        const goods = (get as (key: unknown) => unknown).call(dic, id);
        if (goods) return asRecord(goods);
      } catch {
        // 继续尝试下一个键。
      }
    }
  }
  return asRecord(activity?.FirstGoods);
}

/** GoodsDataDic 可能是数组，也可能包在 datum/_objDatum/_maps 里。 */
function goodsEntries(value: unknown): UnknownRecord[] {
  const record = asRecord(value);
  if (!record) return [];
  const pick = (list: unknown) => (Array.isArray(list) ? list.map(asRecord).filter((item): item is UnknownRecord => item !== null) : []);
  if (Array.isArray(record)) return pick(record);
  if (Array.isArray(record.datum)) return pick(record.datum);
  if (Array.isArray(record._objDatum)) return pick(record._objDatum);
  const maps = asRecord(record._maps) ?? asRecord(record._map);
  if (maps) return Object.values(maps).flatMap((item) => pick(item));
  return [];
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

/** 秒杀商品货币：1/2=元宝、3=银两（对应 TK.Price_Type_*）。 */
function currencyOf(priceType: number): string {
  switch (priceType) {
    case 3: return '银两';
    default: return '元宝';
  }
}

/** 从 secKillDataDic 原始字典取全部活动（含未开售的）。 */
function rawActivities(mgr: UnknownRecord): UnknownRecord[] {
  const dic = asRecord(mgr?.secKillDataDic);
  if (!dic) return [];
  const datum = dic.datum;
  return Array.isArray(datum)
    ? (datum as unknown[]).map(asRecord).filter((item): item is UnknownRecord => item !== null)
    : [];
}

/** 该商品是不是玩家已拥有的武将/皮肤（道具类返回 false）。 */
function isOwnedGenSkin(goods: UnknownRecord): boolean {
  try {
    return goods?.IsGenSkinHad === true;
  } catch {
    return false;
  }
}

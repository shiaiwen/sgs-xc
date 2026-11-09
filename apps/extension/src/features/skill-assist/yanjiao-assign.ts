/**
 * 严教自动分牌：按算好的方案，把游戏严教窗口里的牌摆进三栏，再让窗口重新排版。
 * 只改窗口里的三栏牌，不替换游戏方法；最后提交仍由玩家点游戏的确定。
 */

import { createLayaObjectLocator, type LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import {
  YANJIAO_OTHER_QUEUE_INDEX,
  YANJIAO_REST_QUEUE_INDEX,
  YANJIAO_SELF_QUEUE_INDEX,
  YANJIAO_WINDOW_LAYER,
  YANJIAO_WINDOW_NAME
} from '../../const/yanjiao.ts';
import type { YanjiaoSplit } from './point-calculators.ts';

type UnknownRecord = Record<string, unknown>;

export type YanjiaoSide = 'left' | 'right';

export type YanjiaoAssignResult = 'assigned' | 'no-window' | 'not-mine' | 'cards-mismatch';

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

/** 先按牌号查牌表，和算方案用的点数一致；查不到再读牌面上的点数。 */
function cardRank(cardUi: unknown, rankOfCardId: (cardId: number) => number): number {
  const card = asRecord(asRecord(cardUi)?.Card) ?? asRecord(asRecord(cardUi)?.card);
  const cardId = Number(card?.CardId ?? card?.CardID ?? card?.cardId ?? card?.cardID);
  const fromCatalog = cardId > 0 ? rankOfCardId(cardId) : 0;
  return fromCatalog || Number(card?.CardNumber ?? card?.cardNumber);
}

/** 从窗口里的牌按点数取出指定张数；牌不够时返回空，窗口保持原样。 */
function takeByRanks(buckets: Map<number, unknown[]>, ranks: readonly number[]): unknown[] | null {
  const taken: unknown[] = [];
  for (const rank of ranks) {
    const card = buckets.get(rank)?.shift();
    if (card === undefined) return null;
    taken.push(card);
  }
  return taken;
}

/**
 * 点哪一组，哪一组就分给自己，另一组分给发动严教的人，剩下的进弃牌栏。
 * 窗口不是自己在分时不动。
 */
export function assignYanjiaoCards(
  globalObject: LayaRuntimeWindow,
  split: YanjiaoSplit,
  selfSide: YanjiaoSide,
  rankOfCardId: (cardId: number) => number,
  isOwnSeat: (seatIndex: number) => boolean
): YanjiaoAssignResult {
  const win = createLayaObjectLocator(globalObject)
    .findInLayer(YANJIAO_WINDOW_LAYER, YANJIAO_WINDOW_NAME)
    .find((node) => node.destroyed !== true && node.visible !== false);
  const queues = win?.cardQueues;
  if (!win || !Array.isArray(queues) || queues.length <= YANJIAO_SELF_QUEUE_INDEX) return 'no-window';
  const seatIndex = Number(asRecord(win.seat)?.index);
  if (!Number.isInteger(seatIndex) || !isOwnSeat(seatIndex)) return 'not-mine';
  if (!queues.every(Array.isArray)) return 'no-window';

  const buckets = new Map<number, unknown[]>();
  for (const cardUi of (queues as unknown[][]).flat()) {
    const rank = cardRank(cardUi, rankOfCardId);
    const bucket = buckets.get(rank) ?? [];
    bucket.push(cardUi);
    buckets.set(rank, bucket);
  }
  const selfRanks = selfSide === 'left' ? split.left : split.right;
  const otherRanks = selfSide === 'left' ? split.right : split.left;
  const rest = takeByRanks(buckets, split.rest);
  const other = takeByRanks(buckets, otherRanks);
  const self = takeByRanks(buckets, selfRanks);
  if (!rest || !other || !self) return 'cards-mismatch';

  // 游戏拿着这几个数组本身，只能原地替换内容。
  const typedQueues = queues as unknown[][];
  typedQueues[YANJIAO_REST_QUEUE_INDEX].splice(0, Infinity, ...rest);
  typedQueues[YANJIAO_OTHER_QUEUE_INDEX].splice(0, Infinity, ...other);
  typedQueues[YANJIAO_SELF_QUEUE_INDEX].splice(0, Infinity, ...self);
  const layout = win.layoutCardUIs;
  if (typeof layout === 'function') {
    try {
      layout.call(win);
    } catch {
      // 排版失败时牌已经分好，下次窗口刷新会画出来。
    }
  }
  return 'assigned';
}

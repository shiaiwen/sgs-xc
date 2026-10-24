/**
 * 明牌引擎的对外契约：分区查询、已知牌登记、明牌标签与移牌入口。
 *
 * 实现是牌位图（`graph/graph-engine.ts`）：分区的「第几格是哪张牌」由槽位链维护，
 * 查询直接读区域数组与槽位。
 */

import { createGraphMingpaiEngine } from './graph/graph-engine.ts';
import { formatZoneId, parseZoneId } from './graph/card-graph.ts';

/** 一张已知牌当时所在的位置。 */
export interface KnownCardLocation {
  seatId: number;
  zone: number;
  position: number;
  zoneParam: number;
}

/** 一次移牌的协议字段。 */
export interface KnownCardMovement {
  cardCount: number;
  cardIds: readonly number[];
  fromId: number;
  fromZone: number;
  fromPosition: number;
  fromZoneParam: number;
  toId: number;
  toZone: number;
  toPosition: number;
  toZoneParam: number;
}

export interface MingpaiZoneRef {
  ownerId: number;
  zone: number;
}

export interface MingpaiFindResult {
  /** 已知牌以 cardId 为键；归属不明时可能使用 0。 */
  keys: readonly number[];
  /** 分区键列表，如 `5-3`、`1-255`、`unknown`、`?`。 */
  zones: readonly string[];
}

export interface MingpaiEngineSnapshot {
  /** 分区 → 已知正数卡号（技能条 / 调试用）。 */
  zones: Readonly<Record<string, readonly number[]>>;
  /** 全部已登记已知牌。 */
  records: readonly Readonly<{
    cardId: number;
    tags: readonly string[];
    persistentTags: readonly string[];
    originalOwnerSeatId: number | null;
    location: KnownCardLocation | null;
    zoneId: string | null;
  }>[];
  /** 牌堆有序已知牌：top[0] 下一张被摸到，bottom 最后一张最底部；0 表示该位置不可见。 */
  drawPile: Readonly<{ top: readonly number[]; bottom: readonly number[] }>;
}

export interface MingpaiEngine {
  getSnapshot(): Readonly<MingpaiEngineSnapshot>;
  getZoneCardIds(zoneId: string): readonly number[];
  setZoneCardIds(zoneId: string, cardIds: readonly number[]): void;
  addZoneCardIds(zoneId: string, cardIds: readonly number[]): void;
  removeZoneCardIds(zoneId: string, cardIds: readonly number[]): void;
  clearZone(zoneId: string): void;
  /** 按槽位推断某张牌可能所在的分区。 */
  findKZ(cardIdOrNode: number): MingpaiFindResult;
  /** 手牌区已知牌 ID。 */
  getHandCardIds(seatId: number): readonly number[];
  /** 手牌已确定为空时，清除引擎里仍留在该座位手牌区的过期牌号。 */
  clearKnownHandCards(seatId: number): void;
  /** 牌堆区（zone=1）已知牌 ID。 */
  getDrawPileCardIds(): readonly number[];
  clearKnownDrawPileOrder(): void;
  /**
   * 重连后按场上仍公开的手牌重登记。
   * 不在快照里的手牌改成位置未知；牌堆顺序不在这里恢复。
   */
  reconcileVisibleHands(hands: readonly { seatId: number; cardIds: readonly number[] }[]): void;
  /** 场景装备栏与牌位图装备区对齐：卸下的装备从图上摘掉，仍穿戴的登记到装备区。 */
  reconcileVisibleEquipment(equipment: readonly { seatId: number; cardIds: readonly number[] }[]): void;
  observeKnownHandCard(cardId: number, seatId: number, tags?: readonly string[]): void;
  /** 登记装备区等非手牌分区上的已知牌，便于顺手牵羊等移牌补号。 */
  observeKnownZoneCard(cardId: number, seatId: number, zone: number): void;
  rememberPersistentCardTag(cardId: number, tag: string, originalOwnerSeatId?: number | null): void;
  forgetPersistentCardTag(cardId: number, tag: string): void;
  /** 持久标签里还带着这个字的牌，包括没出现在当前牌位里的。 */
  listCardIdsWithPersistentTag(tag: string): number[];
  /**
   * 座位的「官方公开手牌」集合变化时调用。
   * 离开这个集合的牌会丢掉普通标签，只留下会跟着牌走的粘性标签。
   */
  syncOfficialHand(seatId: number, cardIds: readonly number[]): void;
  getOfficialHandCardIds(seatId: number): readonly number[];
  /** 鉴定牌堆内已知牌，并标记相对位置（顶 / 底 / 未指定）。 */
  observeKnownDrawPileCards(cardIds: readonly number[], position: number): void;
  getPersistentTags(cardId: number): string[];
  getOriginalOwnerSeatId(cardId: number): number | null;
  resolveHiddenMovement(
    movement: KnownCardMovement,
    preferredOriginalOwnerSeatId?: number | null
  ): number[];
  /**
   * 执行一次移牌，返回这一批实际落位的牌号（未知槽位是 0）。
   * 调用方拿它去驱动座位展示与标签。
   */
  applyMovement(
    movement: KnownCardMovement & { spellId?: number; moveType?: number; pilePackCount?: number },
    effectiveCardIds: readonly number[]
  ): readonly number[];
  /** 技能把候选牌写入专用展示分区（宴戏等）。 */
  projectSkillCards(zoneId: string, cardIds: readonly number[]): void;
  /**
   * 一局结束时调用。
   * 之后的对局中洗牌不再把整副牌打包成「已经洗回牌堆、身份不可知」的组。
   */
  noteGameSettled(): void;
  /**
   * 开局按整副牌重建：每张牌各占一个未知槽位，先都不归入具体区域。
   * 之后靠移牌把牌归位。
   */
  resetAllCardsUnknown(cardIds: readonly number[]): void;
  /**
   * 重连按整副牌重建：每张牌各占一个未知槽位，且都算牌堆里的牌。
   * 牌堆顺序不可信时用这个回到「只知道牌由哪些组成」的状态。
   */
  resetAllCardsToDrawPile(cardIds: readonly number[]): void;
  hasRestoredRecords(): boolean;
  clear(): void;
  subscribe(listener: (snapshot: Readonly<MingpaiEngineSnapshot>) => void): () => void;
}

export const HAND_ZONE = 5;
export const EQUIP_ZONE = 6;
export const DRAW_PILE_ZONE = 1;
export const DISCARD_ZONE = 2;
/** 3=处理区、8=判定展示区、10=技能临时区。 */
export const TEMPORARY_CARD_ZONES = new Set([3, 8, 10]);
export const GLOBAL_OWNER = 0xff;

/** 建立一局使用的明牌引擎；新建即视为开一局，牌位图会先清空。 */
export function createMingpaiEngine(storage: Storage | null = getSessionStorage()): MingpaiEngine {
  return createGraphMingpaiEngine(storage);
}

function getSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export { formatZoneId, parseZoneId };

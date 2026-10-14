/**
 * 裴秀对局资源快照：手牌花色统计、已装备诸葛、剩余出杀与酒/桃/闪电限制等，供路线规划。
 */

import type { LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import {
  classifyCardName,
  type PeixiuHandCard,
  type PeixiuRewardInfo
} from './peixiu-map-model.ts';

type UnknownRecord = Record<string, unknown>;

export interface PeixiuResourceSnapshot {
  suitCounts: number[];
  handCards: PeixiuHandCard[];
  selectedCardKey: string;
  hasZhugeEquipped: boolean;
  remainingSha: number;
  jiuLimit: number;
  peachLimit: number;
  shandianLimit: number;
  hp: number | null;
  maxHp: number | null;
  isDying: boolean;
}

export interface PeixiuCardLookup {
  getCard?(cardId: number): UnknownRecord | null;
}

export interface PeixiuRewardLookup {
  getReward?(rewardId: number): PeixiuRewardInfo | null;
  findByName?(name: string): number;
}

const emptySnapshot = (): PeixiuResourceSnapshot => ({
  suitCounts: [0, 0, 0, 0, 0],
  handCards: [],
  selectedCardKey: '',
  hasZhugeEquipped: false,
  remainingSha: 1,
  jiuLimit: 0,
  peachLimit: 0,
  shandianLimit: 1,
  hp: null,
  maxHp: null,
  isDying: false
});

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

function cardIdOf(card: UnknownRecord | null): number {
  return Number(card?.CardId ?? card?.cardId ?? card?.ID ?? card?.id ?? 0) || 0;
}

function cardSuitOf(card: UnknownRecord | null): number {
  return Number(
    card?.FlowerOnSeat ?? card?.flower ?? card?.Flower ?? card?.CardSuit
      ?? card?.cardSuit ?? card?.suit ?? card?.Color ?? card?.color ?? 0
  ) || 0;
}

function cardNameOf(card: UnknownRecord | null, lookup?: PeixiuCardLookup): string {
  const id = cardIdOf(card);
  const catalog = id ? lookup?.getCard?.(id) : null;
  return String(
    card?.CardName || card?.cardName || card?.Name || card?.name || catalog?.name || ''
  );
}

function cardDisplayName(card: UnknownRecord | null, fallback: string, lookup?: PeixiuCardLookup): string {
  const id = cardIdOf(card);
  const catalog = id ? lookup?.getCard?.(id) : null;
  const name = String(catalog?.name || fallback || '牌');
  return name + String(catalog?.cn ?? '');
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

/** 从 DOM/场景读取本回合剩余出杀次数。 */
export function remainingShaFromDom(documentObject?: Document | null): number {
  const text = documentObject?.getElementById?.('sha')?.textContent || '';
  if (/∞/.test(text)) return Infinity;
  const matched = text.match(/(?:剩余\s*[：:]?\s*)?(\d+)/);
  return matched ? Math.max(0, Number(matched[1]) || 0) : 1;
}

/** 汇总裴秀规划用资源：手牌、花色计数、血量与限制等。 */
export function collectPeixiuResources(options: {
  globalObject?: LayaRuntimeWindow;
  cardLookup?: PeixiuCardLookup;
  remainingSha?: number;
  shandianLimit?: number;
} = {}): PeixiuResourceSnapshot {
  try {
    const globalObject = options.globalObject ?? (typeof window !== 'undefined' ? window as LayaRuntimeWindow : {});
    const scene = locateGameScene(globalObject);
    const selfSeatUi = asRecord(scene?.SelfSeatUi) ?? asRecord(asRecord(scene)?.selfSeatUi);
    const seat = asRecord(selfSeatUi?.seat) ?? {};
    const container = asRecord(selfSeatUi?.cardContainer) ?? {};
    const cardUis = Array.isArray(container.handCardUis) && container.handCardUis.length
      ? container.handCardUis
      : (container.cardUis as unknown[]) || [];
    const equipUis = (container.equipCardUis as unknown[]) || [];
    const selectedUis = new Set([
      ...((container.selectCardUis as unknown[]) || []),
      ...((container.selectedCardUis as unknown[]) || [])
    ]);
    const selectedIds = new Set(
      Array.from(
        (asRecord(container.selectCardContext)?.SelectedCardIds
          ?? asRecord(container.SelectContext)?.SelectedCardIds
          ?? []) as unknown[],
        Number
      )
    );
    const activatedList = container.activatedCardtems ?? container.activatedCardItems;
    const activatedSet = new Set(Array.isArray(activatedList) ? activatedList : []);
    const suitCounts = [0, 0, 0, 0, 0];
    const handCards = cardUis.map((item, index) => {
      const ui = asRecord(item);
      const card = asRecord(ui?.Card) ?? asRecord(ui?.theCard) ?? ui;
      const id = cardIdOf(card);
      const suit = cardSuitOf(card);
      const name = cardNameOf(card, options.cardLookup);
      const kind = classifyCardName(name);
      const activated = ui?.Activated ?? ui?.activated ?? card?.Activated ?? card?.activated
        ?? (Array.isArray(activatedList) ? activatedSet.has(item) : undefined);
      if (suit >= 1 && suit <= 4) suitCounts[suit] += 1;
      return {
        key: id ? String(id) : `hand-${index}`,
        id,
        suit,
        name,
        displayName: cardDisplayName(card, name, options.cardLookup),
        kind,
        playable: activated === undefined ? true : !!activated,
        selected: !!(ui?.selected || card?.selected || selectedUis.has(item) || selectedIds.has(id))
      } satisfies PeixiuHandCard;
    });
    const hasZhuge = (equipUis as unknown[]).some((item) => {
      const ui = asRecord(item);
      return classifyCardName(cardNameOf(asRecord(ui?.Card) ?? asRecord(ui?.theCard) ?? ui, options.cardLookup)) === 'zhuge';
    });
    const hp = firstNumber(seat.currentHp, seat.CurrentHp, seat.Hp, seat.HP);
    const maxHp = firstNumber(seat.maxHp, seat.MaxHp, seat.maxHP, seat.MaxHP);
    const isDying = !!(seat.isDying || seat.IsDying || seat.dying || (hp != null && hp <= 0));
    const lost = hp != null && maxHp != null ? Math.max(0, maxHp - hp) : 0;
    const jiuCards = handCards.filter((card) => card.kind === 'jiu' && card.playable);
    const peachCards = handCards.filter((card) => card.kind === 'tao' && card.playable);
    const jiuLimit = isDying ? jiuCards.length : Math.min(1, jiuCards.length);
    const peachLimit = hp != null && maxHp != null
      ? Math.min(peachCards.length, isDying ? Math.max(1, 1 - hp) : lost)
      : 0;
    const selected = handCards.find((card) => card.selected) || null;
    return {
      suitCounts,
      handCards,
      selectedCardKey: selected?.key || '',
      hasZhugeEquipped: hasZhuge,
      remainingSha: hasZhuge ? Infinity : (options.remainingSha ?? remainingShaFromDom(globalObject.document)),
      jiuLimit,
      peachLimit,
      shandianLimit: options.shandianLimit ?? 1,
      hp,
      maxHp,
      isDying
    };
  } catch {
    return emptySnapshot();
  }
}

/** 读取本家座位 ID。 */
export function readSelfSeatId(globalObject?: LayaRuntimeWindow, gameContext?: unknown): string {
  const runtime = globalObject ?? (typeof window !== 'undefined' ? window as LayaRuntimeWindow : {});
  const scene = asRecord(locateGameScene(runtime));
  const self = asRecord(scene?.SelfSeatUi) ?? asRecord(scene?.selfSeatUi);
  const seat = asRecord(self?.seat) ?? asRecord(self?.Seat);
  const context = asRecord(gameContext)
    ?? asRecord(runtime.GameContext)
    ?? asRecord(asRecord(runtime.Laya?.Browser?.window)?.GameContext);
  const id = seat?.SeatID ?? seat?.seatID ?? seat?.SeatId ?? seat?.seatId
    ?? seat?.index ?? seat?.Index
    ?? self?.SeatID ?? self?.seatID ?? self?.SeatId ?? self?.seatId
    ?? self?.index ?? self?.Index
    ?? context?.mySeatID ?? context?.MySeatID ?? context?.selfSeatID ?? context?.SelfSeatID
    ?? context?.myID ?? context?.MyID;
  return id == null ? '' : String(id);
}

/** 读取当前行动座位 ID。 */
export function readCurrentSeatId(globalObject?: LayaRuntimeWindow, gameContext?: unknown): string {
  const runtime = globalObject ?? (typeof window !== 'undefined' ? window as LayaRuntimeWindow : {} as LayaRuntimeWindow);
  const context = asRecord(gameContext)
    ?? asRecord(runtime.GameContext)
    ?? asRecord(asRecord(runtime.Laya?.Browser?.window)?.GameContext);
  const id = context?.currentID ?? context?.CurrentID ?? context?.currentId ?? context?.CurrentId;
  return id == null ? '' : String(id);
}

/**
 * 本回合新走到的格子上的奖励。
 * 地图刚展开时格子上已经画着的城市技能不算已获得；
 * 换回合后以上一回合结束时的格子为基准，那些奖励不再显示。
 */
export function rewardIdsCollectedSince(
  collectedCells: number[],
  baseline: ReadonlySet<number>,
  rewardAt: (cell: number) => number,
  alwaysCells: number[] = []
): number[] {
  const ids = new Set<number>();
  for (const cell of alwaysCells) {
    const rewardId = rewardAt(cell);
    if (rewardId) ids.add(rewardId);
  }
  for (const cell of collectedCells) {
    if (baseline.has(cell)) continue;
    const rewardId = rewardAt(cell);
    if (rewardId) ids.add(rewardId);
  }
  return [...ids];
}

/** 新地图拿到的城接在已有列表后面，不覆盖之前的城。 */
export function appendRewardIds(owned: readonly number[], incoming: readonly number[]): number[] {
  const next = [...owned];
  for (const id of incoming) {
    if (id && !next.includes(id)) next.push(id);
  }
  return next;
}

function isSelfCityReward(reward: { cell?: number; rawCell?: number; type?: unknown }): boolean {
  const type = Number(reward.type);
  const cell = Number(reward.cell);
  const rawCell = Number(reward.rawCell);
  return type === 26 || rawCell === 26 || (cell === 26) || (cell !== 0 && (cell < 1 || cell > 25));
}

/**
 * 当前地图所在的城。走到琅琊、徐州时，回合结束仍会带上彭城。
 * 彭城不在棋盘奖励格上，要按地图城名或唯一的本城技能来认。
 */
export function defaultMapCityRewardId(
  map: {
    id?: number;
    name?: string;
    cityRewardIds?: number[];
    rewards?: Array<{ cell?: number; rawCell?: number; rewardId?: number; type?: unknown }>;
  } | null | undefined,
  lookup: PeixiuRewardLookup
): number {
  const mapName = String(map?.name || '').trim();
  const rewards = map?.rewards || [];
  if (mapName) {
    const namedOnMap = rewards.find((item) => lookup.getReward?.(Number(item.rewardId))?.name === mapName);
    if (Number(namedOnMap?.rewardId)) return Number(namedOnMap?.rewardId);
    const named = lookup.findByName?.(mapName) || 0;
    if (named) return named;
  }
  const selfCity = rewards.filter((item) => Number(item.rewardId) && isSelfCityReward(item));
  if (selfCity.length === 1) return Number(selfCity[0].rewardId);
  const candidates = [...(map?.cityRewardIds || [])];
  const mapId = Number(map?.id) || 0;
  if (mapId && !candidates.includes(mapId)) candidates.push(mapId);
  for (const id of candidates) {
    const info = lookup.getReward?.(id);
    if (info?.name && (!mapName || info.name === mapName)) return id;
  }
  return 0;
}

/** 收集指定格子上已获得的技能。配置里整座城的技能列表不计入。 */
export function collectOwnedSkills(
  map: { rewards?: Array<{ cell?: number; rawCell?: number; rewardId?: number; type?: unknown }> } | null | undefined,
  collectedCells: number[],
  lookup: PeixiuRewardLookup,
  rewardAt: (cell: number) => number
): PeixiuRewardInfo[] {
  void map;
  return rewardIdsCollectedSince(collectedCells, new Set(), rewardAt)
    .map((rewardId) => lookup.getReward?.(rewardId) ?? { rewardId, name: `地图技#${rewardId}`, description: '' })
    .filter((item) => item.name);
}

/** 解析地图格子上的奖励 ID。 */
export function resolveRewardIdAt(
  map: { rewards?: Array<{ cell?: number; rewardId?: number }> } | null | undefined,
  cell: number
): number {
  const found = (map?.rewards || []).find((item) => Number(item.cell) === Number(cell));
  return Number(found?.rewardId) || 0;
}

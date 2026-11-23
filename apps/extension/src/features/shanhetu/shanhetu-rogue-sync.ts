/**
 * 山河同步包解析：与集市透视共用同一套 ProtoObj / data 嵌套路径。
 */

import type { LayaObjectLocator } from '../../adapters/laya-object-locator.ts';
import {
  EMPTY_ROGUE_MAP_RUNTIME,
  type RogueCitySpot,
  type RogueMapRuntime
} from './shanhetu-map-types.ts';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizePlotInventoryId(value: unknown): string | number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  const record = asRecord(value);
  if (!record) return null;
  const id = record.id ?? record.Id ?? record.plot ?? record.Plot
    ?? record.itemId ?? record.ItemId ?? record.plotId ?? record.PlotId
    ?? record.plotID ?? record.PlotID ?? record.goodId ?? record.GoodId;
  if (typeof id === 'string' || typeof id === 'number') return id;
  return null;
}

function resolveGameData(payload: UnknownRecord): UnknownRecord | null {
  const allData = readRogueLikeAllData(payload) ?? payload;
  return asRecord(allData.gameData)
    ?? asRecord(allData.GameData)
    ?? asRecord(payload.gameData)
    ?? asRecord(payload.GameData);
}

/**
 * 山河同步业务字段在 ProtoObj 上
 *（`allData` / `dataMark` / `shopData`），外层可能再套一层 data。
 */
export function resolveRogueLikeSyncBody(payload: UnknownRecord): UnknownRecord {
  const protocol = asRecord(payload.Protocol) ?? asRecord(payload.protocol);
  const data = asRecord(protocol?.Data) ?? asRecord(protocol?.data);
  const outerData = asRecord(payload.data) ?? asRecord(payload.Data);
  const candidates = [
    payload, asRecord(payload.ProtoObj), asRecord(payload.protoObj),
    protocol, data, asRecord(data?.ProtoObj), asRecord(data?.protoObj),
    outerData, asRecord(outerData?.ProtoObj), asRecord(outerData?.protoObj),
    asRecord(protocol?.ProtoObj), asRecord(protocol?.protoObj)
  ];
  return candidates.find((item) => item && (
    item.allData !== undefined || item.AllData !== undefined
    || item.dataMark !== undefined || item.DataMark !== undefined
    || item.shopData !== undefined || item.ShopData !== undefined
  )) ?? payload;
}

/** 从同步包或 manager 缓存对象上取出 allData。 */
export function readRogueLikeAllData(payload: UnknownRecord): UnknownRecord | null {
  const body = resolveRogueLikeSyncBody(payload);
  return asRecord(body.allData)
    ?? asRecord(body.AllData)
    ?? asRecord(body.data)
    ?? asRecord(body.Data)
    ?? body;
}

function pushInventoryIds(
  target: Array<string | number>,
  seen: Set<string>,
  entries: readonly unknown[]
): void {
  for (const entry of entries) {
    const id = normalizePlotInventoryId(entry);
    if (id == null) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(id);
  }
}

function readGroupedInventoryIds(data: UnknownRecord): Array<string | number> {
  const ids: Array<string | number> = [];
  const seen = new Set<string>();
  const pushEntries = (entries: unknown) => {
    pushInventoryIds(ids, seen, asArray(entries));
  };
  for (const key of [
    'itemId', 'ItemId', 'itemID', 'itemList', 'ItemList', 'plotList', 'PlotList',
    'ShowItemList', 'showItemList', 'plotItems', 'PlotItems', 'zhanFaItems', 'ZhanFaItems',
    'skillItems', 'SkillItems', 'rogueItems', 'RogueItems'
  ]) {
    pushEntries(data[key]);
  }
  for (const key of ['goodList', 'GoodList']) {
    for (const group of asArray(data[key])) {
      if (typeof group === 'number' || typeof group === 'string') {
        pushEntries([group]);
        continue;
      }
      const groupRecord = asRecord(group);
      if (!groupRecord) continue;
      pushEntries(groupRecord.items ?? groupRecord.list ?? groupRecord.goodList ?? groupRecord.GoodList);
      for (const item of asArray(group)) {
        const record = asRecord(item);
        if (!record) continue;
        pushEntries([
          record.goodId ?? record.GoodId ?? record.plotId ?? record.PlotId
            ?? record.plot ?? record.Plot ?? record.id ?? record.Id ?? record.itemId
        ]);
      }
    }
  }
  return ids;
}

/** 从 gameData 读出当前持有的战法/技能等 plot id 列表。 */
export function readRogueGameItemIds(gameData: UnknownRecord | null | undefined): Array<string | number> | null {
  if (!gameData) return null;
  const ids = readGroupedInventoryIds(gameData);
  return ids.length > 0 ? ids : null;
}

/** 从同步包或 PveManager 缓存汇总玩家持有的 plot id，供失去战法名提示使用。 */
export function mergeRogueInventoryPlotIds(payloads: readonly UnknownRecord[]): Array<string | number> | null {
  const merged: Array<string | number> = [];
  const seen = new Set<string>();
  for (const payload of payloads) {
    const part = collectRogueInventoryPlotIds(payload);
    if (!part) continue;
    for (const id of part) {
      const key = String(id);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(id);
    }
  }
  return merged.length > 0 ? merged : null;
}

export function collectRogueInventoryPlotIds(payload: UnknownRecord): Array<string | number> | null {
  const merged: Array<string | number> = [];
  const seen = new Set<string>();
  const allData = readRogueLikeAllData(payload) ?? asRecord(payload);
  const shopData = allData
    ? asRecord(allData.shopData) ?? asRecord(allData.ShopData)
    : asRecord(resolveRogueLikeSyncBody(payload).shopData)
      ?? asRecord(resolveRogueLikeSyncBody(payload).ShopData);
  const candidates = [
    resolveGameData(payload),
    asRecord(allData),
    shopData,
    payload
  ];
  for (const record of candidates) {
    if (!record) continue;
    for (const id of readGroupedInventoryIds(record)) {
      const key = String(id);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(id);
    }
  }
  return merged.length > 0 ? merged : null;
}

function readChapterLocationSignature(allData: UnknownRecord | null | undefined): string {
  if (!allData) return '';
  const chapter = asRecord(allData.chapterData) ?? asRecord(allData.ChapterData);
  if (!chapter) return '';
  const locations = asArray(chapter.locations ?? chapter.Locations);
  return locations.map((entry) => {
    const record = asRecord(entry) ?? {};
    const cityId = record.location ?? record.Location ?? record.cityId ?? record.CityId;
    const event = record.event ?? record.Event;
    return `${cityId}:${event}`;
  }).join(';');
}

/** 新开一局：赛季、章 id、对局种子。 */
export function readRogueRunFingerprint(payload: UnknownRecord): string {
  const body = resolveRogueLikeSyncBody(payload);
  const runtime = extractRogueMapRuntime(body, EMPTY_ROGUE_MAP_RUNTIME);
  const gameData = resolveGameData(body) ?? {};
  const runToken = gameData.gameUID ?? gameData.GameUID ?? gameData.gameId ?? gameData.GameId;
  const seedBlob = gameData.seedData ?? gameData.SeedData ?? gameData.seedItem ?? gameData.SeedItem;
  const tail = runToken != null && runToken !== ''
    ? String(runToken)
    : JSON.stringify(seedBlob ?? '');
  return [runtime.seasonId, runtime.chapterId, tail].join('|');
}

/** 地图城池事件组合；新开局布局不同，购买战法不改这一项。 */
export function readRogueMapLayoutFingerprint(payload: UnknownRecord): string {
  const allData = readRogueLikeAllData(resolveRogueLikeSyncBody(payload));
  return readChapterLocationSignature(allData);
}

type RogueManagerLocator = Pick<LayaObjectLocator, 'manager' | 'findManagerByPredicate'>;

function isRogueLikePveManager(manager: UnknownRecord): boolean {
  return typeof manager.RogueLikeDataReq === 'function'
    || typeof manager.decodeRogueLikeDataSync === 'function';
}

/** RogueLikePveManager 不是 window 全局量，需从协议监听者或 managerList 找回。 */
export function findRogueLikePveManager(locator: RogueManagerLocator): UnknownRecord | null {
  const direct = asRecord(locator.manager('RogueLikePveManager'));
  if (direct) return direct;
  return locator.findManagerByPredicate(isRogueLikePveManager);
}

/**
 * 带缓存的山河管理器查找。找到后一直复用；找不到时隔一段时间才重扫，
 * 大厅和普通对局里它一直不存在，每轮都扫全部事件监听会拖慢游戏。
 */
export function createRogueManagerLookup(
  locator: RogueManagerLocator,
  retryMs: number,
  now: () => number = Date.now
): { get(): UnknownRecord | null; peek(): UnknownRecord | null; reset(): void } {
  let cached: UnknownRecord | null = null;
  let lastMissAt = Number.NEGATIVE_INFINITY;
  return {
    get() {
      if (cached && cached.destroyed !== true) return cached;
      cached = null;
      const direct = asRecord(locator.manager('RogueLikePveManager'));
      if (direct) {
        cached = direct;
        return direct;
      }
      const time = now();
      if (time - lastMissAt < retryMs) return null;
      const found = locator.findManagerByPredicate(isRogueLikePveManager);
      if (found) cached = found;
      else lastMissAt = time;
      return found;
    },
    peek() {
      return cached;
    },
    reset() {
      cached = null;
      lastMissAt = Number.NEGATIVE_INFINITY;
    }
  };
}

export function collectRogueInventoryFromMapScene(
  scene: UnknownRecord | null | undefined
): Array<string | number> | null {
  if (!scene) return null;
  const nested = [
    scene,
    asRecord(scene.mapView),
    asRecord(scene.MapView),
    asRecord(scene.uiView),
    asRecord(scene.UIView),
    asRecord(scene.bottomView),
    asRecord(scene.BottomView)
  ].filter((entry): entry is UnknownRecord => Boolean(entry));
  return mergeRogueInventoryPlotIds(nested);
}

export function extractRogueCitySpots(payload: UnknownRecord): RogueCitySpot[] | null {
  const allData = readRogueLikeAllData(payload);
  if (!allData) return null;
  const chapterData = asRecord(allData.chapterData) ?? asRecord(allData.ChapterData);
  const locations = chapterData?.locations ?? chapterData?.Locations;
  if (!Array.isArray(locations)) return null;
  return locations.map((entry) => {
    const record = asRecord(entry) ?? {};
    return {
      id: record.location
        ?? record.Location
        ?? record.locationId
        ?? record.LocationId
        ?? record.cityId
        ?? record.CityId
        ?? record.id
        ?? record.ID,
      event: record.event ?? record.Event
    };
  }).filter((spot) => spot.id != null && spot.event != null) as RogueCitySpot[];
}

export function extractRogueMapRuntime(payload: UnknownRecord, previous: RogueMapRuntime): RogueMapRuntime {
  const allData = readRogueLikeAllData(payload) ?? payload;
  const seasonData = asRecord(allData.seasonData) ?? asRecord(allData.SeasonData) ?? {};
  const chapterData = asRecord(allData.chapterData) ?? asRecord(allData.ChapterData) ?? {};
  const gameData = resolveGameData(payload) ?? {};
  const seedData = asRecord(gameData.seedData) ?? asRecord(gameData.SeedData) ?? {};
  const difficulty = Number(seasonData.difficulty ?? seasonData.Difficulty);
  const seasonId = Number(seasonData.seasonId ?? seasonData.SeasonId ?? seasonData.seasonID);
  const accday = Number(chapterData.accday ?? chapterData.Accday);
  const chapterId = Number(chapterData.chapterId ?? chapterData.ChapterId);
  const passChapter = Array.isArray(gameData.passChapter)
    ? gameData.passChapter.length
    : Number(gameData.passChapter ?? previous.passChapter);
  const seedItem = Array.isArray(seedData.seedItem)
    ? seedData.seedItem
    : Array.isArray(gameData.seedItem)
      ? gameData.seedItem
      : previous.seedItem;
  const itemIds = collectRogueInventoryPlotIds(payload) ?? previous.itemIds;
  const eventData = asRecord(chapterData.curEventData) ?? asRecord(chapterData.CurEventData);
  const loseData = eventData?.loseData ?? eventData?.LoseData;
  const hasChapterData = allData.chapterData !== undefined || allData.ChapterData !== undefined;
  const choiceLostResult = Array.isArray(loseData) && loseData.length > 0
    ? {
        cityId: Number(chapterData.curLocation ?? chapterData.CurLocation),
        effectId: Number(eventData?.eventId ?? eventData?.EventId),
        itemIds: loseData.map((entry) => normalizePlotInventoryId(entry))
          .filter((id): id is string | number => id !== null)
      }
    : previous.choiceLostResult;
  return {
    difficulty: Number.isFinite(difficulty) ? difficulty : previous.difficulty,
    seasonId: Number.isFinite(seasonId) && seasonId > 0 ? seasonId : previous.seasonId,
    accday: Number.isFinite(accday) ? accday : previous.accday,
    passChapter: Number.isFinite(passChapter) ? passChapter : previous.passChapter,
    chapterId: Number.isFinite(chapterId) ? chapterId : previous.chapterId,
    seedItem,
    itemIds,
    choiceLostResult
  };
}

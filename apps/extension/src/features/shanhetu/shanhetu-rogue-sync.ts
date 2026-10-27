/**
 * 山河同步包解析：与集市透视共用同一套 ProtoObj / data 嵌套路径。
 */

import type { RogueCitySpot, RogueMapRuntime } from './shanhetu-map-types.ts';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

/**
 * 山河同步业务字段在 ProtoObj 上
 *（`allData` / `dataMark` / `shopData`），外层可能再套一层 data。
 */
export function resolveRogueLikeSyncBody(payload: UnknownRecord): UnknownRecord {
  const nestedData = asRecord(payload.data) ?? asRecord(payload.Data);
  return asRecord(payload.ProtoObj)
    ?? asRecord(payload.protoObj)
    ?? asRecord(nestedData?.ProtoObj)
    ?? asRecord(nestedData?.protoObj)
    ?? payload;
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
  const allData = readRogueLikeAllData(payload) ?? {};
  const seasonData = asRecord(allData.seasonData) ?? asRecord(allData.SeasonData) ?? {};
  const chapterData = asRecord(allData.chapterData) ?? asRecord(allData.ChapterData) ?? {};
  const gameData = asRecord(allData.gameData) ?? asRecord(allData.GameData) ?? {};
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
  return {
    difficulty: Number.isFinite(difficulty) ? difficulty : previous.difficulty,
    seasonId: Number.isFinite(seasonId) && seasonId > 0 ? seasonId : previous.seasonId,
    accday: Number.isFinite(accday) ? accday : previous.accday,
    passChapter: Number.isFinite(passChapter) ? passChapter : previous.passChapter,
    chapterId: Number.isFinite(chapterId) ? chapterId : previous.chapterId,
    seedItem
  };
}

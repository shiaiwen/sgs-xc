/**
 * 山河事件文案：拼装城市事件标题/正文，决定是否跳过展示。
 */

import {
  EMPTY_ROGUE_MAP_RUNTIME,
  ROGUE_LINE_BREAK,
  splitRogueLines,
  type RogueCitySpot,
  type ShanhetuMapConfigData,
  type RogueMapPanelLayout,
  type RogueMapRuntime,
  type RoguePanelLine,
  type RoguePlotMeta
} from './shanhetu-map-types.ts';
import {
  formatGeneralName,
  formatGeneralWarningSkills,
  formatGeneralStatsLine,
  resolveRogueFightScaleMeta
} from './shanhetu-map-general-stats.ts';

type UnknownRecord = Record<string, unknown>;

function findPlotMeta(
  config: ShanhetuMapConfigData,
  id: string | number
): RoguePlotMeta | undefined {
  const direct = config.Rplot[String(id)];
  if (direct) return direct;
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return undefined;
  for (const meta of Object.values(config.Rplot)) {
    if (Number(meta.spellid) === numericId) return meta;
  }
  return undefined;
}

function plotNamesByIds(
  config: ShanhetuMapConfigData,
  ids: readonly (string | number)[]
): string[] {
  return ids
    .map((id) => findPlotMeta(config, id)?.name?.trim() ?? '')
    .filter(Boolean);
}

function parseLostTierLine(lost: string): { rarity: string; kind: string; head: string } | null {
  const head = (lost.split(/[,，]/)[0] ?? lost).trim();
  const match = /^失去\s*(普通|稀有|史诗|传说)\s*(战法|技能|手牌|装备)/.exec(head);
  if (!match) return null;
  return { rarity: match[1], kind: match[2], head };
}

function plotMatchesLostTier(
  item: RoguePlotMeta | undefined,
  wantedTypes: number[],
  wantedLevel: number
): boolean {
  if (!item) return false;
  const itemType = Number(item.type);
  const itemLevel = Number(item.level);
  return wantedTypes.includes(itemType) && itemLevel === wantedLevel;
}

/** 表意是「失去普通战法」时，服务器未下发 loseData 时只取背包 itemId 顺序里第一件同品第一件。 */
function firstInventoryLostName(
  config: ShanhetuMapConfigData,
  itemIds: readonly (string | number)[] | undefined,
  wantedTypes: number[],
  wantedLevel: number
): string {
  for (const id of itemIds ?? []) {
    const item = findPlotMeta(config, id);
    if (!plotMatchesLostTier(item, wantedTypes, wantedLevel)) continue;
    const name = item?.name?.trim() ?? '';
    if (name) return name;
  }
  return '';
}

function lostItemNames(
  config: ShanhetuMapConfigData,
  lost: string,
  runtime: RogueMapRuntime,
  cityId: string | number | undefined,
  choiceId: string | number
): string {
  const parsed = parseLostTierLine(lost);
  if (!parsed) return '';
  const types: Record<string, number[]> = { 战法: [2], 技能: [3], 手牌: [4], 装备: [5, 6, 7] };
  const level: Record<string, number> = { 普通: 1, 稀有: 2, 史诗: 3, 传说: 4 };
  const wantedTypes = types[parsed.kind];
  const wantedLevel = level[parsed.rarity];
  const actual = runtime.choiceLostResult;
  if (
    actual
    && actual.cityId === Number(cityId)
    && actual.effectId === Number(choiceId)
  ) {
    return plotNamesByIds(config, actual.itemIds).join('、');
  }
  return firstInventoryLostName(config, runtime.itemIds, wantedTypes, wantedLevel);
}

function generalLine(general: UnknownRecord, config: ShanhetuMapConfigData, runtime: RogueMapRuntime): RoguePanelLine | null {
  const name = formatGeneralName(general);
  if (!name) return null;
  const warningSkills = formatGeneralWarningSkills(general, config, runtime);
  return { kind: 'general', text: warningSkills.length ? `${name} ${warningSkills.join(' ')}` : name, warning: warningSkills.length > 0 };
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

/** 把地图事件收成面板标题。 */
export function resolveEventTitle(config: ShanhetuMapConfigData, event: string | number): string {
  const adventure = config.Radventure[String(event)];
  if (adventure) return String(adventure);
  const fight = config.Rfight[String(event)];
  return String(fight?.name || fight?.text || '未知事件');
}

/**
 * 奇遇选项 id：
 * 1) 优先 Adventure.effect1/2/3 → RadventureChoices
 * 2) 表空时用 event+"1" / event+"01" 查 Rchoose（问号奇遇常用此编号）
 *    真战斗（Rfight 带武将名）禁止误拼，避免 10→101 撞号。
 */
export function adventureChoiceIds(
  config: ShanhetuMapConfigData,
  event: string | number
): Array<string | number> {
  const key = String(event);
  const fromTable = config.RadventureChoices[key];
  if (Array.isArray(fromTable) && fromTable.length) return fromTable;

  const ids: Array<string | number> = [];
  for (let index = 1; index <= 3; index += 1) {
    const plain = `${key}${index}`;
    const padded = `${key}${String(index).padStart(2, '0')}`;
    const choiceId = config.Rchoose[padded] ? padded : plain;
    if (config.Rchoose[String(choiceId)]) ids.push(choiceId);
  }
  if (!ids.length) return [];

  // 有奇遇章名 → 一定可拼；无章名时仅当不是「带武将的真战斗」才拼。
  if (config.Radventure[key] || !isRealFightEvent(config, key)) return ids;
  return [];
}

/** Rfight 有可显示武将名才算真战斗；空壳/仅 generalgroup 撞号不算。 */
export function isRealFightEvent(config: ShanhetuMapConfigData, event: string | number): boolean {
  const fight = config.Rfight[String(event)];
  if (!fight) return false;
  const generals = Array.isArray(fight.generals) ? fight.generals : [];
  return generals.some((entry) => {
    const general = asRecord(entry);
    return Boolean(general && formatGeneralName(general));
  });
}

/** 营地类奇遇不画面板：选项 camp=true（含 event+1 / +01 编号）。 */
export function shouldSkipCityEvent(config: ShanhetuMapConfigData, event: string | number): boolean {
  for (const choiceId of adventureChoiceIds(config, event)) {
    if (config.Rchoose[String(choiceId)]?.camp) return true;
  }
  // adventureChoiceIds 在真战斗时会故意返回 []，营地检测仍要走拼接。
  const key = String(event);
  for (let index = 1; index <= 3; index += 1) {
    const plain = `${key}${index}`;
    const padded = `${key}${String(index).padStart(2, '0')}`;
    if (config.Rchoose[padded]?.camp || config.Rchoose[plain]?.camp) return true;
  }
  return false;
}

/** @deprecated 保留给旧测试；新面板用 `buildEventLines`。 */
export function buildEventBodyLines(
  config: ShanhetuMapConfigData,
  event: string | number,
  runtime: RogueMapRuntime = EMPTY_ROGUE_MAP_RUNTIME,
  cityId?: string | number
): string[] {
  return buildEventLines(config, event, runtime, cityId).map((line) => line.text);
}

/**
 * 无真战斗时走奇遇选项正文；有 Radventure / 可拼选项也优先奇遇，
 * 避免 generalgroup 空壳抢走问号关正文。
 */
export function isAdventureEvent(config: ShanhetuMapConfigData, event: string | number): boolean {
  const key = String(event);
  if (config.Radventure[key]) return true;
  if (adventureChoiceIds(config, event).length > 0) return true;
  return false;
}

/**
 * 武将名加属性行，再接奖励和奇遇得失。
 * 奇遇（含地图问号关）优先于 Rfight，避免 generalgroup 空壳抢走正文。
 */
export function buildEventLines(
  config: ShanhetuMapConfigData,
  event: string | number,
  runtime: RogueMapRuntime = EMPTY_ROGUE_MAP_RUNTIME,
  cityId?: string | number
): RoguePanelLine[] {
  if (isAdventureEvent(config, event)) {
    const lines: RoguePanelLine[] = [];
    for (const choiceId of adventureChoiceIds(config, event)) {
      const choice = config.Rchoose[String(choiceId)];
      if (!choice || choice.camp) continue;
      if (Array.isArray(choice.generals) && choice.generals.length) {
        for (const entry of choice.generals) {
          const general = asRecord(entry);
          if (!general) continue;
          const heading = generalLine(general, config, runtime);
          if (heading) lines.push(heading);
          const stats = formatGeneralStatsLine(
            general,
            config,
            runtime,
            resolveRogueFightScaleMeta(config, event, choice as UnknownRecord),
            cityId
          );
          if (stats) lines.push({ kind: 'stats', text: stats });
        }
      }
      const chunk: string[] = [];
      if (!choice.generals?.length && choice.lost) {
        const lost = String(choice.lost);
        const parsedLost = parseLostTierLine(lost);
        const lostHead = parsedLost?.head ?? lost.split(/[,，]/)[0]?.trim() ?? lost;
        const name = lostItemNames(config, lost, runtime, cityId, choiceId);
        chunk.push([lostHead, name].filter(Boolean).join(' '));
      }
      if (choice.get) chunk.push(String(choice.get));
      if (chunk.length) lines.push({ kind: 'reward', text: chunk.join(ROGUE_LINE_BREAK) });
    }
    return lines;
  }

  const fight = config.Rfight[String(event)];
  if (!fight) return [];
  const lines: RoguePanelLine[] = [];
  const generals = Array.isArray(fight.generals) ? fight.generals : [];
  for (const entry of generals) {
    const general = asRecord(entry);
    if (!general) continue;
    const heading = generalLine(general, config, runtime);
    if (heading) lines.push(heading);
    const stats = formatGeneralStatsLine(
      general,
      config,
      runtime,
      resolveRogueFightScaleMeta(config, event, fight as UnknownRecord),
      cityId
    );
    if (stats) lines.push({ kind: 'stats', text: stats });
  }
  if (fight.get) {
    for (const text of splitRogueLines(String(fight.get))) {
      lines.push({ kind: 'reward', text });
    }
  }
  return lines;
}

/** 按当前城池生成地图面板草稿。 */
export function buildPanelDrafts(
  config: ShanhetuMapConfigData,
  cities: readonly RogueCitySpot[],
  runtime: RogueMapRuntime = EMPTY_ROGUE_MAP_RUNTIME
): Array<Pick<RogueMapPanelLayout, 'id' | 'title' | 'lines'>> {
  const drafts: Array<Pick<RogueMapPanelLayout, 'id' | 'title' | 'lines'>> = [];
  for (const city of cities) {
    if (!config.Rcity[String(city.id)]) continue;
    if (shouldSkipCityEvent(config, city.event)) continue;
    drafts.push({
      id: city.id,
      title: resolveEventTitle(config, city.event),
      lines: buildEventLines(config, city.event, runtime, city.id)
    });
  }
  return drafts;
}

/**
 * 山河图武将战力/属性统计辅助：从配置与场景数据汇总展示用数值。
 */

import type { ShanhetuMapConfigData, RogueMapRuntime } from './shanhetu-map-types.ts';

type UnknownRecord = Record<string, unknown>;

const ATTR_META = Object.freeze({
  1: { key: 'draw', seed: 5 },
  2: { key: 'exshatimes', diffKey: 'skill', seed: 7 },
  3: { key: 'getarmor', seed: 3 },
  4: { key: 'hp', seed: 1 },
  5: { key: 'cardnum', seed: 4 },
  6: { key: 'armor', seed: 2 }
} as const);

const EXTRA_ATTR_FIELDS = ['att_ZD', 'att_KN', 'att_EM', 'att_LY'] as const;
const EXTRA_ATTR_CACHE_KEY = '__xcRogueAttExtra';

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isHiddenGeneral(general: UnknownRecord): boolean {
  return num(general.hide ?? general.Hide) === 1;
}

function generalStartChapter(general: UnknownRecord): number {
  return num(general.startChapter ?? general.StartChapter);
}

function fightIsSingle(fight: UnknownRecord): boolean {
  return num(fight.isSingle ?? fight.IsSingle) === 1;
}

/** RnumGrow 人数缩放依赖开战配置的 baseGenerals / isSingle，奇遇选项会缺字段，回填 Rfight。 */
export function resolveRogueFightScaleMeta(
  config: ShanhetuMapConfigData,
  event: string | number | undefined,
  fightLike: UnknownRecord
): UnknownRecord {
  const parent = event == null ? null : config.Rfight[String(event)];
  const baseFromFight = asArray(fightLike.baseGenerals);
  const baseFromParent = parent ? asArray(parent.baseGenerals) : [];
  const baseGenerals = baseFromFight.length ? baseFromFight : baseFromParent;
  if (!parent && !baseGenerals.length) return fightLike;
  return {
    ...(parent as UnknownRecord ?? {}),
    ...fightLike,
    baseGenerals: baseGenerals.length ? baseGenerals : asArray(fightLike.generals ?? parent?.generals),
    isSingle: fightLike.isSingle ?? fightLike.IsSingle ?? parent?.isSingle ?? parent?.IsSingle
  };
}

function scaleAdd(raw: number): number {
  if (raw >= 1) return Math.floor(raw);
  if (raw >= 0) return Math.ceil(raw);
  return Math.floor(raw);
}

/** 高难分段额外属性字段前缀。 */
function hardExtraField(difficulty: number, prefix: string): string | null {
  if (difficulty >= 0x65 && difficulty <= 0x6d) return `${prefix}1`;
  if (difficulty >= 0x6f && difficulty <= 0x77) return `${prefix}2`;
  if (difficulty >= 0x79 && difficulty <= 0x81) return `${prefix}3`;
  return null;
}

function readExtraAttrs(
  general: UnknownRecord,
  bigDif: number,
  difficulty: number
): Record<string, number> {
  const cacheRoot = asRecord(general[EXTRA_ATTR_CACHE_KEY]) ?? {};
  const cacheKey = `${bigDif}_${difficulty}`;
  const cached = cacheRoot[cacheKey];
  if (cached && typeof cached === 'object') {
    return cached as Record<string, number>;
  }
  const result: Record<string, number> = {};
  for (let index = 0; index < bigDif && index < EXTRA_ATTR_FIELDS.length; index += 1) {
    for (const part of String(general[EXTRA_ATTR_FIELDS[index]] ?? '').split(';')) {
      const [key, value] = part.split(',');
      if (!key || value == null) continue;
      result[key] = (result[key] || 0) + num(value);
    }
  }
  if (difficulty > 100) {
    for (const prefix of ['att_JJ']) {
      const field = hardExtraField(difficulty, prefix);
      if (!field) continue;
      for (const part of String(general[field] ?? '').split(';')) {
        const [needDiff, key, value] = part.split(',');
        if (!key || value == null || num(needDiff) > difficulty) continue;
        result[key] = (result[key] || 0) + num(value);
      }
    }
  }
  cacheRoot[cacheKey] = result;
  general[EXTRA_ATTR_CACHE_KEY] = cacheRoot;
  return result;
}

function applySeedItems(value: number, attrType: number, seedItem: readonly unknown[]): number {
  const seed = ATTR_META[attrType as keyof typeof ATTR_META]?.seed;
  if (seed == null) return value;
  let next = value;
  for (const entry of seedItem) {
    const item = asRecord(entry);
    if (!item || Number(item.itemType) !== 1) continue;
    if (Number(item.attrType) !== seed) continue;
    if (Number(item.goal) !== 1 && Number(item.goal) !== 3) continue;
    const amount = num(item.value ?? item.num ?? item.val);
    next += item.sub ? -amount : amount;
  }
  return next;
}

function readAttr(
  general: UnknownRecord,
  attrType: keyof typeof ATTR_META,
  grow: GrowContext,
  numGrowRow: UnknownRecord | null
): { value: number; add: number; extra: Record<string, number> } {
  const meta = ATTR_META[attrType];
  const key = meta.key;
  const diffKey = 'diffKey' in meta ? meta.diffKey : key;
  let add = num(grow.growRow?.[key])
    + num(grow.diffRow?.[diffKey] ?? grow.diffRow?.[key])
    + num(grow.diffGrowRow?.[key]);
  const scale = numGrowRow?.[key] != null ? num(numGrowRow[key]) / 100 : 1;
  add = scaleAdd(add * scale);
  const extra = readExtraAttrs(general, grow.bigDif, grow.difficulty);
  let value = num(general[key]) + add + num(extra[key]);
  value = attrType === 4 ? Math.max(1, value) : Math.max(0, value);
  value = applySeedItems(value, attrType, grow.seedItem);
  return { value, add, extra };
}

interface GrowContext {
  difficulty: number;
  chapter: number;
  bigDif: number;
  growRow: UnknownRecord | null;
  diffRow: UnknownRecord | null;
  diffGrowRow: UnknownRecord | null;
  bossLocation: number;
  seedItem: readonly unknown[];
}

function buildGrowContext(
  config: ShanhetuMapConfigData,
  runtime: RogueMapRuntime
): GrowContext {
  const difficulty = num(runtime.difficulty);
  const seasonId = String(runtime.seasonId || config.RcurSeason || 1);
  const diffs = config.Rdiff[seasonId] ?? {};
  const diffRow = asRecord(diffs[difficulty as unknown as string])
    ?? asRecord(diffs[String(difficulty)])
    ?? null;
  const bigDif = Math.max(1, num(diffRow?.bdif, 1));
  const chapter = num(runtime.passChapter) + 1;
  const accday = num(runtime.accday);
  const growRow = asRecord(config.Rgrow[`${accday}_${difficulty}`]) ?? null;
  const diffGrowRow = asRecord(config.RdiffGrow[`${bigDif}_${chapter}`]) ?? null;
  const bosses = config.RchapBoss[seasonId] ?? config.RchapBoss[String(seasonId)] ?? {};
  const bossLocation = num(
    bosses[String(runtime.chapterId)]
    ?? bosses[runtime.chapterId as unknown as string]
  );
  return {
    difficulty,
    chapter,
    bigDif,
    growRow,
    diffRow,
    diffGrowRow,
    bossLocation,
    seedItem: asArray(runtime.seedItem)
  };
}

function readNumGrowRow(
  config: ShanhetuMapConfigData,
  fight: UnknownRecord,
  cityId: string | number | undefined,
  grow: GrowContext
): UnknownRecord | null {
  const generals = asArray(fight.baseGenerals ?? fight.generals);
  const visible = generals.filter((entry) => {
    const general = asRecord(entry);
    if (!general || isHiddenGeneral(general)) return false;
    return generalStartChapter(general) <= grow.chapter;
  });
  const mode = cityId != null && grow.bossLocation === Number(cityId)
    ? 1
    : fightIsSingle(fight)
      ? 2
      : 3;
  return asRecord(config.RnumGrow[`${mode}_${visible.length}`]) ?? null;
}

/** 武将属性行：血、牌、摸、杀、甲。 */
export function formatGeneralStatsLine(
  general: UnknownRecord,
  config: ShanhetuMapConfigData,
  runtime: RogueMapRuntime,
  fight: UnknownRecord,
  cityId?: string | number
): string {
  const grow = buildGrowContext(config, runtime);
  const numGrow = readNumGrowRow(config, fight, cityId, grow);
  const hp = readAttr(general, 4, grow, numGrow);
  const maxHp = Math.max(1, num(general.maxhp ?? general.maxHp) + hp.add + num(hp.extra.maxhp));
  const cards = readAttr(general, 5, grow, numGrow).value;
  const draw = readAttr(general, 1, grow, numGrow).value;
  const sha = 1 + readAttr(general, 2, grow, numGrow).value;
  const armor = readAttr(general, 6, grow, numGrow).value;
  const getArmor = readAttr(general, 3, grow, numGrow).value;
  const parts = [
    `${hp.value}${maxHp !== hp.value ? `/${maxHp}` : ''}血`,
    `${cards}牌`,
    `摸${draw}`,
    `杀${sha}`
  ];
  if (armor) parts.push(`甲${armor}${getArmor ? `+${getArmor}` : ''}`);
  return parts.join(' ');
}

/** 格式化山河图武将名。 */
export function formatGeneralName(general: UnknownRecord): string {
  const name = String(general.generalname ?? '');
  return general.start ? `[先手]${name}` : name;
}

/** 地图透视里需要标红的敌方技能名，与官网脚本警戒表一致。 */
const WARNING_SPELLS = new Set([
  '巳蛇', '灵动', '八门', '智迟', '持盈', '卫主', '不死', '刚烈', '觉醒', '悲鸣',
  '断肠', '节命', '先机', '忘魂', '雅士', '挥泪', '不屈', '封冻', '灵躯', '武魂',
  '已蛇', '邪徒', '魅步', '雷击', '恢拓', '夺炁', '恩怨', '鸡肋', '反击'
]);

/** 难度档对应的 getspell 字段，下标即档位序号。 */
const GENERAL_SPELL_FIELDS_BY_DIFFICULTY = [
  'getspell',
  'getspell_ZD',
  'getspell_KN',
  'getspell_EM',
  'getspell_LY'
] as const;

export function formatGeneralWarningSkills(
  general: UnknownRecord,
  config: ShanhetuMapConfigData,
  runtime: RogueMapRuntime
): string[] {
  const seasonId = String(runtime.seasonId || config.RcurSeason || 1);
  const diff = config.Rdiff[seasonId]?.[String(runtime.difficulty)];
  const bigDif = Math.max(1, num(diff?.bdif, 1));
  let spellIds: string[] = [];
  const apply = (value: string): void => {
    for (const id of value.split(';').filter(Boolean)) {
      if (id.startsWith('_')) spellIds = spellIds.filter((existing) => existing !== id.slice(1));
      else spellIds.push(id);
    }
  };
  for (const field of GENERAL_SPELL_FIELDS_BY_DIFFICULTY.slice(0, bigDif)) {
    apply(String(general[field] ?? ''));
  }
  if (runtime.difficulty > 100) {
    const field = hardExtraField(runtime.difficulty, 'getspell_JJ');
    for (const part of String(field ? general[field] ?? '' : '').split(';')) {
      const [minimum, ...changes] = part.split(',');
      if (num(minimum) > runtime.difficulty) continue;
      for (const change of changes) apply(change);
    }
  }
  const warnings: string[] = [];
  for (const id of spellIds) {
    const name = config.RspellNames?.[id] ?? '';
    if (name && WARNING_SPELLS.has(name)) warnings.push(name);
  }
  return warnings;
}

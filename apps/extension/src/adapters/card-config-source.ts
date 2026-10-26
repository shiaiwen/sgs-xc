/**
 * 官方 Config_w.sgs 配置源：下载解密后提供卡牌字典、技能名、自动任务/山河/进阶辅助表。
 *
 * 流程：等页面出现 JSZip/CtrUtil/Zlib → 复用游戏已请求的 Config_w URL（或按
 * resourceVersion 拼）→ 下载 → Gunzip/解密各表 → 建字典并挂到 window 供监控。
 * 自动任务/山河/进阶表失败不影响卡牌字典本身。
 */

import {
  AUTO_TASK_CONFIG_FILES,
  buildAutoTaskConfigData,
  configDayStamp,
  type AutoTaskConfigData,
  type AutoTaskConfigFileName
} from '../features/auto-task/auto-task-config-data.ts';
import {
  buildShanhetuMapConfigData,
  type ShanhetuMapConfigData
} from '../features/shanhetu/shanhetu-map-config-data.ts';
import type { ExtraAssistConfigData } from '../features/extra-assist/extra-assist-config-data.ts';
import { buildExtraAssistConfigData } from '../features/extra-assist/extra-assist-config-data.ts';
import { buildGeneralNameDict } from '../features/shanhetu/shanhetu-change-general.ts';

type UnknownRecord = Record<string, unknown>;
export type CardConfigDictionary = Record<number, UnknownRecord>;

declare global {
  interface Window {
    /** 开发监控读取的卡牌字典；只读，业务代码应通过 CardConfigSource 访问。 */
    __XIAOCHAO_OFFICIAL_CARD_DICTIONARY__?: CardConfigDictionary;
    /** cha_spell 技能号到显示名，供明牌等模块查技能名。 */
    __XIAOCHAO_SPELL_NAMES_BY_ID__?: ReadonlyMap<number, string>;
  }
}

export interface CardConfigSource {
  getCard(cardId: number): UnknownRecord | null;
  /** 按技能名查技能 ID（来自 cha_spell.sgs），配置未就绪时返回空数组。 */
  findSpellIdsByName(name: string): number[];
  /** 自动任务用的任务 id、武将灯系列与物品名；配置未就绪时返回 null。 */
  getAutoTaskData(): AutoTaskConfigData | null;
  /** 山河地图透视表（hd_roguelike.sgs）；配置未就绪时返回 null。 */
  getShanhetuMapData(): ShanhetuMapConfigData | null;
  /** 进阶辅助用的南华/许劭表（cha_spellextend.sgs）；配置未就绪时返回 null。 */
  getExtraAssistData(): ExtraAssistConfigData | null;
  /** 进阶辅助原始表，供控制器按需解析；配置未就绪时返回 null。 */
  getSpellExtendRaw(): unknown;
  /** 武将编号对应的显示名；配置未就绪或没有该武将时返回 null。 */
  getGeneralName(generalId: number): string | null;
  /** 武将名表是否已经解析完。失败时也会变为 true，避免换将提示一直等。 */
  generalNamesReady(): boolean;
  size(): number;
  dispose(): void;
}

interface ZipFile { async(type: 'arraybuffer'): Promise<ArrayBuffer> }
interface ZipArchive { file(name: string): ZipFile | null }
interface GameConfigCodecs {
  loadZip(data: ArrayBuffer): Promise<ZipArchive>;
  decrypt(data: ArrayBuffer): unknown;
  gunzip(data: unknown): Uint8Array;
}

const CONFIG_PATH = '/220/h5_2/res/config/Config_w.sgs';
const CONFIG_ORIGIN = 'https://web.sanguosha.com';
const TEST_CONFIG_URL = 'https://test.sanguosha.com/h5/res/config//Config_w.sgs';
const ROGUE_MAP_CONFIG_FILE = 'hd_roguelike.sgs';
const POLL_INTERVAL_MS = 1000;
const DOWNLOAD_TIMEOUT_MS = 20000;
const DOWNLOAD_ATTEMPTS = 3;

/**
 * 自行下载游戏的 Config_w.sgs，并用游戏页面自带的 JSZip / CtrUtil / Zlib 解出
 * sys_playcard、cha_spell、自动任务表与山河地图表。
 */
export function installCardConfigSource(globalObject: Window = window): CardConfigSource {
  let dictionary: CardConfigDictionary | null = null;
  let spellIdsByName = new Map<string, number[]>();
  let autoTaskData: AutoTaskConfigData | null = null;
  let shanhetuMapData: ShanhetuMapConfigData | null = null;
  let extraAssistData: ExtraAssistConfigData | null = null;
  let spellExtendRaw: unknown = null;
  let generalNames: Map<number, string> | null = null;
  let disposed = false;
  let loading = false;
  let failures = 0;
  let polls = 0;
  const timer = globalObject.setInterval(tryLoad, POLL_INTERVAL_MS);
  tryLoad();

  /** 轮询等待解码库；登录页停留不计入超时。就绪后异步拉包，只触发一次。 */
  function tryLoad(): void {
    if (disposed || loading || dictionary) return;
    const codecs = readGameConfigCodecs(globalObject);
    if (!codecs) {
      // 解码库随游戏脚本加载；登录页停留期间不计入超时。
      if (!(globalObject as unknown as UnknownRecord).Laya) return;
      polls += 1;
      if (polls === 30) console.error('[xiaochao] 卡牌配置等待游戏解码库超时', describeMissingCodecs(globalObject));
      return;
    }
    loading = true;
    loadCardDictionary(globalObject, codecs)
      .then((result) => {
        if (disposed) return;
        dictionary = result.cards;
        spellIdsByName = result.spellIdsByName;
        autoTaskData = result.autoTaskData;
        if (result.autoTaskData) {
          try {
            globalObject.dispatchEvent(new CustomEvent('xiaochao-autotask-config'));
          } catch {
            // 非浏览器环境忽略。
          }
        }
        shanhetuMapData = result.shanhetuMapData;
        extraAssistData = result.extraAssistData;
        spellExtendRaw = result.spellExtendRaw;
        generalNames = result.generalNames;
        globalObject.__XIAOCHAO_OFFICIAL_CARD_DICTIONARY__ = result.cards;
        globalObject.__XIAOCHAO_SPELL_NAMES_BY_ID__ = result.spellNamesById;
        globalObject.clearInterval(timer);
      })
      .catch((error) => {
        failures += 1;
        console.error(`[xiaochao] 卡牌配置加载失败: ${String((error as Error)?.message ?? error)}`);
        if (failures >= DOWNLOAD_ATTEMPTS) globalObject.clearInterval(timer);
      })
      .finally(() => {
        loading = false;
      });
  }

  return {
    getCard(cardId) {
      return dictionary?.[cardId] ?? null;
    },
    findSpellIdsByName(name) {
      return [...(spellIdsByName.get(name) ?? [])];
    },
    getAutoTaskData() {
      return autoTaskData;
    },
    getShanhetuMapData() {
      return shanhetuMapData;
    },
    getExtraAssistData() {
      return extraAssistData;
    },
    getSpellExtendRaw() {
      return spellExtendRaw;
    },
    getGeneralName(generalId) {
      return generalNames?.get(generalId) ?? null;
    },
    generalNamesReady() {
      return generalNames !== null;
    },
    size() {
      return dictionary ? Object.keys(dictionary).length : 0;
    },
    dispose() {
      disposed = true;
      globalObject.clearInterval(timer);
    }
  };
}

/**
 * 解包 Config_w：卡牌与技能必做；自动任务/山河/进阶辅助表失败只打日志。
 * 成功后写入 window.__XIAOCHAO_OFFICIAL_CARD_DICTIONARY__ 等只读挂载点。
 */
async function loadCardDictionary(
  globalObject: Window,
  codecs: GameConfigCodecs
): Promise<{
  cards: CardConfigDictionary;
  spellIdsByName: Map<string, number[]>;
  spellNamesById: Map<number, string>;
  autoTaskData: AutoTaskConfigData | null;
  shanhetuMapData: ShanhetuMapConfigData | null;
  extraAssistData: ExtraAssistConfigData | null;
  spellExtendRaw: unknown;
  generalNames: Map<number, string>;
}> {
  const archive = await codecs.loadZip(await downloadArchive(resolveConfigUrl(globalObject)));
  const [playCards, spells, autoTaskData, shanhetuRaw, spellExtendRaw, characterRaw] = await Promise.all([
    readConfigFile(archive, codecs, 'sys_playcard.sgs'),
    readConfigFile(archive, codecs, 'cha_spell.sgs'),
    loadAutoTaskData(archive, codecs),
    readConfigFile(archive, codecs, ROGUE_MAP_CONFIG_FILE).catch((error) => {
      console.warn(`[xiaochao] 山河配置读取失败: ${ROGUE_MAP_CONFIG_FILE}`, error);
      return null;
    }),
    readConfigFile(archive, codecs, 'cha_spellextend.sgs').catch((error) => {
      console.warn('[xiaochao] 进阶辅助配置读取失败: cha_spellextend.sgs', error);
      return null;
    }),
    readConfigFile(archive, codecs, 'character.sgs').catch((error) => {
      console.warn('[xiaochao] 武将名配置读取失败: character.sgs', error);
      return null;
    })
  ]);
  const cards = buildCardDictionary(playCards, spells);
  let shanhetuMapData: ShanhetuMapConfigData | null = null;
  if (shanhetuRaw) {
    try {
      shanhetuMapData = buildShanhetuMapConfigData(shanhetuRaw, buildShanhetuNameTables(playCards, spells));
      if (!Object.keys(shanhetuMapData.Rcity).length) {
        console.warn('[xiaochao] 山河配置解析后 Rcity 为空');
        shanhetuMapData = null;
      }
    } catch (error) {
      console.warn('[xiaochao] 山河配置解析失败', error);
    }
  }
  let extraAssistData: ExtraAssistConfigData | null = null;
  if (spellExtendRaw) {
    try {
      extraAssistData = buildExtraAssistConfigData(spellExtendRaw);
    } catch (error) {
      console.warn('[xiaochao] 进阶辅助配置解析失败', error);
    }
  }
  return {
    cards,
    spellIdsByName: buildSpellIdsByName(spells),
    spellNamesById: buildSpellNamesById(spells),
    autoTaskData,
    shanhetuMapData,
    extraAssistData,
    spellExtendRaw,
    generalNames: buildGeneralNameDict(characterRaw)
  };
}

/** 自动任务配置缺失或损坏不影响卡牌字典。 */
async function loadAutoTaskData(archive: ZipArchive, codecs: GameConfigCodecs): Promise<AutoTaskConfigData | null> {
  const files: Partial<Record<AutoTaskConfigFileName, unknown>> = {};
  await Promise.all(AUTO_TASK_CONFIG_FILES.map(async (fileName) => {
    try {
      files[fileName] = await readConfigFile(archive, codecs, fileName);
    } catch (error) {
      console.warn(`[xiaochao] 自动任务配置读取失败: ${fileName}`, error);
    }
  }));
  try {
    return buildAutoTaskConfigData(files, configDayStamp(new Date()));
  } catch (error) {
    console.warn('[xiaochao] 自动任务配置解析失败', error);
    return null;
  }
}

/** 山河 Rplot 需要技能名 / 牌名；与卡牌字典同源解析。 */
function buildShanhetuNameTables(playCards: unknown, spells: unknown): {
  spells: Map<number, { name: string; desc: string }>;
  cards: Map<number, {
    name: string;
    desc?: string;
    subType?: number;
    type?: number;
    color?: unknown;
    number?: unknown;
  }>;
} {
  const spellMap = new Map<number, { name: string; desc: string }>();
  for (const entry of asArray(asRecord(asRecord(spells)?.GameSpells)?.spell)) {
    const record = asRecord(entry);
    const spellId = Number(record?.a);
    if (!Number.isFinite(spellId)) continue;
    spellMap.set(spellId, {
      name: typeof record?.c === 'string' ? record.c : '',
      desc: typeof record?.o === 'string' ? stripSpellMarkup(record.o) : ''
    });
  }

  const playCardRoot = asRecord(playCards);
  const abbreviation = new Map<string, string>();
  for (const entry of asArray(playCardRoot?.abbreviation)) {
    const record = asRecord(entry);
    if (typeof record?.Short === 'string' && typeof record.Long === 'string') {
      abbreviation.set(record.Short, record.Long);
    }
  }
  const cardMap = new Map<number, {
    name: string;
    desc?: string;
    subType?: number;
    type?: number;
    color?: unknown;
    number?: unknown;
  }>();
  for (const entry of asArray(asRecord(playCardRoot?.GamePlayCards)?.card)) {
    const record = asRecord(entry);
    if (!record) continue;
    const card: UnknownRecord = {};
    for (const [key, value] of Object.entries(record)) card[abbreviation.get(key) ?? key] = value;
    const cardId = Number(card.id);
    if (!Number.isInteger(cardId) || cardId <= 0) continue;
    const spell = spellMap.get(Number(card.spellId));
    cardMap.set(cardId, {
      name: typeof card.name === 'string' ? card.name : (spell?.name ?? ''),
      desc: spell?.desc,
      subType: Number(card.subType),
      type: Number(card.type),
      color: card.color,
      number: card.number ?? card.num
    });
  }
  return { spells: spellMap, cards: cardMap };
}

/** 技能号到显示名，来自 cha_spell.sgs。 */
export function buildSpellNamesById(spells: unknown): Map<number, string> {
  const result = new Map<number, string>();
  for (const entry of asArray(asRecord(asRecord(spells)?.GameSpells)?.spell)) {
    const record = asRecord(entry);
    const spellId = Number(record?.a);
    if (!Number.isInteger(spellId) || spellId <= 0 || typeof record?.c !== 'string') continue;
    const name = record.c.trim();
    if (name) result.set(spellId, name);
  }
  return result;
}

/** 按技能名建立编号索引，供运行时用名字反查技能。 */
export function buildSpellIdsByName(spells: unknown): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const entry of asArray(asRecord(asRecord(spells)?.GameSpells)?.spell)) {
    const record = asRecord(entry);
    const spellId = Number(record?.a);
    if (!Number.isInteger(spellId) || spellId <= 0 || typeof record?.c !== 'string') continue;
    const ids = result.get(record.c) ?? [];
    ids.push(spellId);
    result.set(record.c, ids);
  }
  return result;
}

/** 字段缩写表 abbreviation 把压缩键（a/b/c…）还原成 id/name/spellId 等完整字段。 */
export function buildCardDictionary(playCards: unknown, spells: unknown): CardConfigDictionary {
  const playCardRoot = asRecord(playCards);
  const abbreviation = new Map<string, string>();
  for (const entry of asArray(playCardRoot?.abbreviation)) {
    const record = asRecord(entry);
    if (typeof record?.Short === 'string' && typeof record.Long === 'string') {
      abbreviation.set(record.Short, record.Long);
    }
  }
  const spellNames = new Map<number, { name: string; desc: string }>();
  for (const entry of asArray(asRecord(asRecord(spells)?.GameSpells)?.spell)) {
    const record = asRecord(entry);
    const spellId = Number(record?.a);
    if (!Number.isFinite(spellId)) continue;
    spellNames.set(spellId, {
      name: typeof record?.c === 'string' ? record.c : '',
      desc: typeof record?.o === 'string' ? stripSpellMarkup(record.o) : ''
    });
  }
  const dictionary: CardConfigDictionary = {};
  for (const entry of asArray(asRecord(playCardRoot?.GamePlayCards)?.card)) {
    const record = asRecord(entry);
    if (!record) continue;
    const card: UnknownRecord = {};
    for (const [key, value] of Object.entries(record)) card[abbreviation.get(key) ?? key] = value;
    const cardId = Number(card.id);
    if (!Number.isInteger(cardId) || cardId <= 0) continue;
    const spell = spellNames.get(Number(card.spellId));
    dictionary[cardId] = { ...card, name: card.name ?? spell?.name, desc: spell?.desc };
  }
  return dictionary;
}

/** 去掉技能描述里的富文本标记，得到纯显示名。 */
function stripSpellMarkup(text: string): string {
  return text.replace(/<[^<>]*>/g, '').replace(/#.*/g, '').replace(/[;\n]+$/g, '');
}

/** 从 zip 里按名取文件，经 CtrUtil 解密再 JSON 解析。 */
async function readConfigFile(
  archive: ZipArchive,
  codecs: GameConfigCodecs,
  fileName: string
): Promise<unknown> {
  const file = archive.file(fileName);
  if (!file) throw new Error(`Config_w.sgs 缺少 ${fileName}`);
  const encrypted = await file.async('arraybuffer');
  return JSON.parse(new TextDecoder().decode(codecs.gunzip(codecs.decrypt(encrypted))));
}

/** 优先复用游戏自己已经请求过的地址，命中浏览器缓存且版本号一致。 */
function resolveConfigUrl(globalObject: Window): string {
  if (globalObject.location.host === 'test.sanguosha.com') return TEST_CONFIG_URL;
  try {
    const entries = globalObject.performance.getEntriesByType('resource');
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index] as PerformanceResourceTiming;
      if (entry.responseEnd > 0 && isConfigArchiveUrl(entry.name, globalObject)) return entry.name;
    }
  } catch {
    // Performance API 不可用时回退到按 resourceVersion 拼接的地址。
  }
  const version = (globalObject as unknown as UnknownRecord).resourceVersion;
  return `${CONFIG_ORIGIN}${CONFIG_PATH}?v=${version ?? ''}`;
}

/** 判断 performance 里看到的请求是否就是 Config_w 资源包。 */
function isConfigArchiveUrl(url: string, globalObject: Window): boolean {
  try {
    const parsed = new URL(url, globalObject.location.href);
    return parsed.origin === CONFIG_ORIGIN && parsed.pathname.replace(/\/+/g, '/') === CONFIG_PATH;
  } catch {
    return false;
  }
}

/** 带超时的 fetch；中止后抛错，由上层决定是否重试。 */
async function downloadArchive(url: string): Promise<ArrayBuffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.arrayBuffer();
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

declare const JSZip: unknown;
declare const CtrUtil: unknown;
declare const Zlib: unknown;

/** 游戏用顶层 let/const 声明这些库，只存在于全局词法作用域，不挂在 window 上。 */
function readGameGlobals(globalObject: Window): Record<'JSZip' | 'CtrUtil' | 'Zlib', unknown> {
  const globals = globalObject as unknown as UnknownRecord;
  return {
    JSZip: globals.JSZip ?? (typeof JSZip === 'undefined' ? undefined : JSZip),
    CtrUtil: globals.CtrUtil ?? (typeof CtrUtil === 'undefined' ? undefined : CtrUtil),
    Zlib: globals.Zlib ?? (typeof Zlib === 'undefined' ? undefined : Zlib)
  };
}

/** 缺哪些解码库的可读描述，便于超时日志。 */
function describeMissingCodecs(globalObject: Window): string {
  const globals = readGameGlobals(globalObject) as Record<string, any>;
  return JSON.stringify({
    JSZip: typeof globals.JSZip?.loadAsync,
    CtrUtil: typeof globals.CtrUtil?.Ctr?.Ofb_Dec,
    Zlib: typeof globals.Zlib?.Gunzip
  });
}

/** 三件套齐全才返回；缺一不可（解压 + 解密 + zip）。 */
function readGameConfigCodecs(globalObject: Window): GameConfigCodecs | null {
  const globals = readGameGlobals(globalObject);
  const jsZip = asObjectLike(globals.JSZip);
  const ctr = asObjectLike(asObjectLike(globals.CtrUtil)?.Ctr);
  const zlib = asObjectLike(globals.Zlib);
  const loadAsync = jsZip?.loadAsync;
  const decrypt = ctr?.Ofb_Dec;
  const Gunzip = zlib?.Gunzip as (new (data: unknown) => { decompress(): Uint8Array }) | undefined;
  if (typeof loadAsync !== 'function' || typeof decrypt !== 'function' || typeof Gunzip !== 'function') return null;
  return {
    loadZip: (data) => (loadAsync as (data: ArrayBuffer) => Promise<ZipArchive>).call(jsZip, data),
    decrypt: (data) => (decrypt as (data: ArrayBuffer) => unknown).call(ctr, data),
    gunzip: (data) => new Gunzip(data).decompress()
  };
}

/** 游戏库常以函数（类 / 命名空间）形式暴露静态成员。 */
function asObjectLike(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

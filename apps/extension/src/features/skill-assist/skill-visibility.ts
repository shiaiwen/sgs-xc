/**
 * 技能辅助可见性：桌上是否存在某技能、面板条目是否展示。
 */

import type { GameSceneSeatSource } from '../seat-display/seat-game-adapter.ts';
import type { SkillAssistDefinition } from './skill-definitions.ts';

type UnknownRecord = Record<string, unknown>;

/**
 * 任意座位 HasSkill(id) 为真时，即视为本局桌上存在该技能。
 * 不依赖 legacy，只读 Laya 座位对象上的 HasSkill。
 */
export function anySeatHasSkill(
  scene: GameSceneSeatSource | null,
  skillIds: readonly number[]
): boolean {
  if (!scene || !skillIds.length) return false;
  const seatUIs = scene.seatContainer?.seatUIs;
  if (!Array.isArray(seatUIs) || !seatUIs.length) return false;
  return seatUIs.some((rawSeatUI) => {
    const seatUI = asRecord(rawSeatUI);
    const seat = asRecord(seatUI?.seat) ?? seatUI;
    if (!seat) return false;
    const hasSkill = seat.HasSkill;
    if (typeof hasSkill !== 'function') return false;
    return skillIds.some((skillId) => {
      try {
        return Boolean(hasSkill.call(seat, skillId));
      } catch {
        return false;
      }
    });
  });
}

/** 是否有座位持有指定技能（用于出牌时判断当前行动者）。 */
export function seatHasSkill(
  scene: GameSceneSeatSource | null,
  seatId: number,
  skillIds: readonly number[]
): boolean {
  if (!scene || !skillIds.length) return false;
  const seatUIs = scene.seatContainer?.seatUIs;
  if (!Array.isArray(seatUIs)) return false;
  for (const rawSeatUI of seatUIs) {
    const seatUI = asRecord(rawSeatUI);
    const seat = asRecord(seatUI?.seat) ?? seatUI;
    if (!seat) continue;
    const id = readSeatId(seat) ?? readSeatId(seatUI);
    if (id !== seatId) continue;
    const hasSkill = seat.HasSkill;
    if (typeof hasSkill !== 'function') return false;
    return skillIds.some((skillId) => {
      try {
        return Boolean(hasSkill.call(seat, skillId));
      } catch {
        return false;
      }
    });
  }
  return false;
}

/**
 * 解析模块最终 skillIds：静态 ID + spellDict 按名字查找（有则合并）。
 * spellDict 不可用时退回静态列表，保证权变等已知 ID 仍可用。
 */
export function resolveSkillIds(
  definition: SkillAssistDefinition,
  scene: GameSceneSeatSource | null
): number[] {
  const fromNames = resolveSpellIdsByName(definition.spellNames ?? [], scene);
  return [...new Set([...definition.skillIds, ...fromNames].filter((id) => Number.isInteger(id) && id > 0))];
}

/** 当前局面是否应该显示该技能辅助。 */
export function isSkillAssistVisible(
  definition: SkillAssistDefinition,
  scene: GameSceneSeatSource | null,
  inGame: boolean,
  isSelfSeat: (seatId: number) => boolean = () => false
): boolean {
  if (!inGame || !scene || definition.triggerOnly) return false;
  const seatUIs = scene.seatContainer?.seatUIs;
  if (!Array.isArray(seatUIs) || !seatUIs.length) return false;
  const skillIds = resolveSkillIds(definition, scene);
  const generalNames = new Set(definition.generalNames ?? []);
  if (definition.selfOnly) {
    return seatUIs.some((rawSeatUI) => {
      const seatUI = asRecord(rawSeatUI);
      const seat = asRecord(seatUI?.seat) ?? seatUI;
      if (!isOwnSeat(scene, rawSeatUI, seatUI, seat, isSelfSeat)) return false;
      if (definition.selfGeneralOnly) return seatHasGeneralName(scene, seatUI, seat, generalNames);
      const seatId = readSeatId(seatUI) ?? readSeatId(seat);
      return (seatId !== null && seatHasSkill(scene, seatId, skillIds))
        || seatHasNamedSkill(seat, definition.spellNames ?? [])
        || seatHasGeneralName(scene, seatUI, seat, generalNames);
    });
  }
  if (anySeatHasSkill(scene, skillIds)) return true;
  return seatUIs.some((rawSeatUI) => {
    const seatUI = asRecord(rawSeatUI);
    return seatHasGeneralName(scene, seatUI, asRecord(seatUI?.seat) ?? seatUI, generalNames);
  });
}

let fallbackSpellLookup: ((name: string) => number[]) | null = null;

/** 游戏场景没有技能字典时，用自行解析的 cha_spell.sgs 按名字查 ID。 */
export function registerSpellNameLookup(lookup: ((name: string) => number[]) | null): void {
  fallbackSpellLookup = lookup;
}

function resolveSpellIdsByName(
  spellNames: readonly string[],
  scene: GameSceneSeatSource | null
): number[] {
  if (!spellNames.length || !scene) return [];
  const nameSet = new Set(spellNames);
  const wantedNames = spellNames.filter((name) => name.length >= 2);
  const matchesName = (name: string): boolean => nameSet.has(name)
    || wantedNames.some((want) => name.includes(want));
  const dict = findSpellDict(scene);
  if (!dict) return fallbackSpellLookup ? spellNames.flatMap((name) => fallbackSpellLookup!(name)) : [];
  const ids: number[] = [];
  for (const [rawKey, rawValue] of Object.entries(dict)) {
    const record = asRecord(rawValue);
    const name = typeof record?.name === 'string'
      ? record.name
      : typeof record?.Name === 'string'
        ? record.Name
        : typeof rawValue === 'string'
          ? rawValue
          : '';
    if (!matchesName(name)) continue;
    const id = Number(record?.id ?? record?.ID ?? record?.spellId ?? rawKey);
    if (Number.isInteger(id) && id > 0) ids.push(id);
  }
  return ids;
}

function findSpellDict(scene: GameSceneSeatSource | null): UnknownRecord | null {
  const sceneRecord = asRecord(scene);
  for (const key of ['spellDict', 'SpellDict', 'initMap']) {
    const candidate = asRecord(sceneRecord?.[key]);
    const nested = asRecord(candidate?.spellDict) ?? candidate;
    if (nested && Object.keys(nested).length) return nested;
  }
  const globalDict = asRecord((globalThis as { jI?: unknown }).jI);
  const fromGlobal = asRecord(globalDict?.spellDict);
  return fromGlobal && Object.keys(fromGlobal).length ? fromGlobal : null;
}

/** 本家座位：场景标记、座位标记，或座位号对得上自己。 */
function isOwnSeat(
  scene: GameSceneSeatSource,
  rawSeatUI: unknown,
  seatUI: UnknownRecord | null,
  seat: UnknownRecord | null,
  isSelfSeat: (seatId: number) => boolean
): boolean {
  if (rawSeatUI && rawSeatUI === scene.SelfSeatUi) return true;
  if (seat?.isSelf === true || seat?.IsSelf === true) return true;
  const seatId = readSeatId(seatUI) ?? readSeatId(seat);
  if (seatId !== null && isSelfSeat(seatId)) return true;
  const myId = Number(asRecord(scene)?.myID);
  return Number.isInteger(myId) && myId >= 0 && seatId === myId;
}

/** 座位主将 / 副将名。先读武将对象上的名字，再按武将编号查字典和场景武将表。 */
function seatHasGeneralName(
  scene: GameSceneSeatSource | null,
  seatUI: UnknownRecord | null,
  seat: UnknownRecord | null,
  nameSet: ReadonlySet<string>
): boolean {
  if (!nameSet.size) return false;
  const names: string[] = [];
  for (const key of ['General', 'general', 'General2', 'general2']) {
    names.push(...readNameStrings(asRecord(seat?.[key])));
  }
  if (names.some((name) => matchesGeneralName(name, nameSet))) return true;
  const seatId = readSeatId(seatUI) ?? readSeatId(seat);
  const listedIds = seatId === null ? [] : readSceneGeneralIds(scene, seatId);
  const generalIds = [
    ...readNumberArray(seat, ['generalIds', 'GeneralIds', 'WuJiangs', 'generals']),
    Number(seat?.GeneralId),
    Number(seat?.generalID),
    Number(seat?.General2Id),
    Number(seat?.general2ID),
    ...listedIds
  ];
  return generalIds.some((generalId) => matchesGeneralName(lookupGeneralName(scene, generalId), nameSet));
}

function readSceneGeneralIds(scene: GameSceneSeatSource | null, seatId: number): number[] {
  const generals = asRecord(scene)?.generals;
  const listed = Array.isArray(generals) ? generals[seatId] : asRecord(generals)?.[seatId];
  return Array.isArray(listed) ? listed.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
}

function lookupGeneralName(scene: GameSceneSeatSource | null, generalId: number): string {
  if (!(generalId > 0)) return '';
  for (const dict of generalDicts(scene)) {
    const entry = dict[String(generalId)] ?? dict[generalId];
    if (typeof entry === 'string') return entry;
    const record = asRecord(entry);
    const name = readNameStrings(record)[0];
    if (name) return name;
  }
  return '';
}

function generalDicts(scene: GameSceneSeatSource | null): UnknownRecord[] {
  const globals = globalThis as { jI?: unknown; jj?: unknown };
  return [
    asRecord(asRecord(scene)?.generalDict),
    asRecord(asRecord(globals.jj)?.generalDict),
    asRecord(asRecord(globals.jI)?.generalDict)
  ].filter((dict): dict is UnknownRecord => Boolean(dict));
}

function readNameStrings(record: UnknownRecord | null): string[] {
  if (!record) return [];
  const names: string[] = [];
  for (const key of ['cardName', 'CardName', 'specifyName', 'trueSpecifyName', 'itemName', 'ItemName', 'generalname', 'generalName', 'GeneralName', 'showName', 'cnName', 'Name', 'name']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) names.push(value.trim());
  }
  return names;
}

/** 座位技能列表里带这个名字时也算有技能。HasSkill 的技能号对不上时还能认出来。 */
function seatHasNamedSkill(seat: UnknownRecord | null, spellNames: readonly string[]): boolean {
  if (!seat || !spellNames.length) return false;
  const wanted = spellNames.filter((name) => name.length >= 2);
  const lists = ['skills', 'Skills', 'skillList', 'SkillList', 'spellList', 'SpellList'];
  for (const key of lists) {
    const value = seat[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const record = asRecord(item);
      const name = typeof item === 'string'
        ? item
        : readNameStrings(record)[0] ?? '';
      if (wanted.some((want) => name === want || name.includes(want))) return true;
      const id = Number(record?.id ?? record?.ID ?? record?.skillId ?? record?.SkillId);
      if (spellNames.includes(String(id))) return true;
    }
  }
  return false;
}

function matchesGeneralName(name: string, nameSet: ReadonlySet<string>): boolean {
  return [...nameSet].some((wanted) => name === wanted || name.includes(wanted));
}

function readSeatId(source: UnknownRecord | null | undefined): number | null {
  if (!source) return null;
  for (const key of ['seatID', 'seatId', 'SeatID', 'SeatId', 'index', 'Index', 'id', 'ID']) {
    const value = Number(source[key]);
    if (Number.isInteger(value) && value >= 0 && value < 0xff) return value;
  }
  return null;
}

function readNumberArray(source: UnknownRecord | null | undefined, keys: readonly string[]): number[] {
  if (!source) return [];
  for (const key of keys) {
    const value = source[key];
    if (!Array.isArray(value)) continue;
    return value.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  }
  return [];
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

/**
 * 技能标记区在小牌条上的展示：与游戏自带标记重复的整行省略，应算进手牌区的并入第一行。
 */

import type { PossibleGroupView, Zone4Row } from './graph/mingpai-candidates.ts';
import { HAND_LABEL_ALIASES } from './rules/hand-label-aliases.ts';
import { readSpellName } from './spell-name.ts';

/** 关时不画技能区紫色标记行，牌并进上面手牌行。 */
export const ZONE4_STRIP_ROWS_ENABLED = false;

/** 开时才用合并、省略规则；关时由 ROWS_ENABLED 统一并进手牌行。 */
export const ZONE4_STRIP_GROUPING_ENABLED = false;

/** 游戏武将牌上已有计数标记，小牌条不再重复画一行。 */
const ZONE4_STRIP_OMIT_SPELL_IDS = new Set<number>([3, 616, 0x268]);

/** 扣在武将牌上的标记，游戏自己会显示，不并进手牌行。 */
const ZONE4_STRIP_OMIT_NAMES = new Set<string>(['醇', '醇醪', '化木', '灵杉', '玉树']);

/** 牌面应跟手牌同一行展示的技能区。 */
const ZONE4_MERGE_INTO_HAND_SPELL_IDS = new Set<number>([2, 121, 232, 0x79, 0xe8]);

export interface Zone4StripPartition {
  stripRows: Zone4Row[];
  mergeKnownBySpell: ReadonlyArray<{ spellId: number; cardIds: readonly number[] }>;
  stripExcludeCardIds: ReadonlySet<number>;
}

export function shouldOmitZone4StripRow(spellId: number): boolean {
  if (ZONE4_STRIP_OMIT_SPELL_IDS.has(spellId)) return true;
  const name = readSpellName(spellId);
  return ZONE4_STRIP_OMIT_NAMES.has(name);
}

export function shouldMergeZone4IntoHand(spellId: number): boolean {
  if (ZONE4_MERGE_INTO_HAND_SPELL_IDS.has(spellId)) return true;
  const name = readSpellName(spellId);
  return name === '缔盟';
}

export function zone4HandSourceTag(spellId: number): string | null {
  const name = readSpellName(spellId);
  if (!name) return null;
  const short = HAND_LABEL_ALIASES[name] ?? name.slice(0, 2);
  return `[${short}]`;
}

export function partitionZone4RowsForStrip(rows: readonly Zone4Row[]): Zone4StripPartition {
  if (!ZONE4_STRIP_ROWS_ENABLED) {
    const mergeKnownBySpell: Array<{ spellId: number; cardIds: number[] }> = [];
    for (const row of rows) {
      if (shouldOmitZone4StripRow(row.spellId)) continue;
      const cardIds = row.knownCardIds.filter((cardId) => cardId > 0);
      if (cardIds.length) mergeKnownBySpell.push({ spellId: row.spellId, cardIds });
    }
    return { stripRows: [], mergeKnownBySpell, stripExcludeCardIds: new Set() };
  }

  if (!ZONE4_STRIP_GROUPING_ENABLED) {
    const stripExcludeCardIds = new Set<number>();
    for (const row of rows) {
      for (const cardId of row.knownCardIds) {
        if (cardId > 0) stripExcludeCardIds.add(cardId);
      }
      for (const cardId of row.possibleCardIds) {
        if (cardId > 0) stripExcludeCardIds.add(cardId);
      }
    }
    return { stripRows: [...rows], mergeKnownBySpell: [], stripExcludeCardIds };
  }

  const stripRows: Zone4Row[] = [];
  const mergeKnownBySpell: Array<{ spellId: number; cardIds: number[] }> = [];
  const stripExcludeCardIds = new Set<number>();

  for (const row of rows) {
    if (shouldOmitZone4StripRow(row.spellId)) continue;
    if (shouldMergeZone4IntoHand(row.spellId)) {
      const cardIds = row.knownCardIds.filter((cardId) => cardId > 0);
      if (cardIds.length) mergeKnownBySpell.push({ spellId: row.spellId, cardIds });
      continue;
    }
    stripRows.push(row);
    for (const cardId of row.knownCardIds) {
      if (cardId > 0) stripExcludeCardIds.add(cardId);
    }
    for (const cardId of row.possibleCardIds) {
      if (cardId > 0) stripExcludeCardIds.add(cardId);
    }
  }

  return { stripRows, mergeKnownBySpell, stripExcludeCardIds };
}

export interface MingpaiStripTile {
  cardId: number;
  possible: boolean;
}

/** 技能区里出现过的牌号。 */
export function zone4CardIds(rows: readonly Zone4Row[]): Set<number> {
  const ids = new Set<number>();
  for (const row of rows) {
    for (const cardId of [...row.knownCardIds, ...row.possibleCardIds]) {
      if (cardId > 0) ids.add(cardId);
    }
  }
  return ids;
}

/**
 * 已经在手牌、装备或判定里的牌继续画。
 * 只在技能区里的牌号不画。
 */
export function stripBlockedSkillCardIds(
  skillCardIds: ReadonlySet<number>,
  keptCardIds: readonly number[]
): Set<number> {
  const kept = new Set(keptCardIds.filter((cardId) => cardId > 0));
  const blocked = new Set<number>();
  for (const cardId of skillCardIds) {
    if (cardId > 0 && !kept.has(cardId)) blocked.add(cardId);
  }
  return blocked;
}

function cardNameIsKnown(cardId: number, cardName: (cardId: number) => string): boolean {
  if (!(cardId > 0)) return false;
  const name = cardName(cardId).trim();
  return name.length > 0 && name !== '?' && name !== '？';
}

function firstNamedCardId(
  group: PossibleGroupView,
  cardName: (cardId: number) => string,
  skillCardIds: ReadonlySet<number>,
  seen: ReadonlySet<number>
): number {
  const namedId = group.candidateCardIds.find((cardId) => (
    cardNameIsKnown(cardId, cardName) && !skillCardIds.has(cardId) && !seen.has(cardId)
  ));
  if (namedId) return namedId;
  if (
    cardNameIsKnown(group.representativeCardId, cardName)
    && !skillCardIds.has(group.representativeCardId)
    && !seen.has(group.representativeCardId)
  ) return group.representativeCardId;
  return 0;
}

/** 这一组里至少有一张叫得出牌名、且不属于技能区的牌。 */
export function isNamedPossibleGroup(
  group: PossibleGroupView,
  cardName: (cardId: number) => string,
  skillCardIds: ReadonlySet<number> = new Set()
): boolean {
  return firstNamedCardId(group, cardName, skillCardIds, new Set()) > 0;
}

/**
 * 小牌条要画的牌。
 * 确定牌在前。能叫出牌名的可能牌带问号，一组只占一格。
 * 技能区的牌、以及只有问号叫不出牌名的一组，都不画。
 */
export function mingpaiStripTiles(input: {
  knownCardIds: readonly number[];
  possibleGroups: readonly PossibleGroupView[];
  skillCardIds: ReadonlySet<number>;
  cardName: (cardId: number) => string;
}): MingpaiStripTile[] {
  const tiles: MingpaiStripTile[] = [];
  const seen = new Set<number>();
  for (const cardId of input.knownCardIds) {
    if (!(cardId > 0) || input.skillCardIds.has(cardId) || seen.has(cardId)) continue;
    seen.add(cardId);
    tiles.push({ cardId, possible: false });
  }
  for (const group of input.possibleGroups) {
    const cardId = firstNamedCardId(group, input.cardName, input.skillCardIds, seen);
    if (!(cardId > 0)) continue;
    seen.add(cardId);
    tiles.push({ cardId, possible: true });
  }
  return tiles;
}

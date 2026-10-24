/**
 * 技能名查询：游戏 spellDict、配置 cha_spell、按 id 扫描表项。
 */

interface SpellEntry {
  name?: string;
  Name?: string;
  id?: number;
  ID?: number;
  spellId?: number;
}

declare global {
  interface Window {
    __XIAOCHAO_SPELL_NAMES_BY_ID__?: ReadonlyMap<number, string>;
  }
}

export function readSpellName(spellId: number): string {
  const id = Number(spellId);
  if (!Number.isFinite(id) || id <= 0) return '';
  const fromConfig = globalThis.__XIAOCHAO_SPELL_NAMES_BY_ID__?.get(id);
  if (fromConfig) return fromConfig;
  const dict = readSpellDict();
  if (!dict) return '';
  const direct = readEntryName(dict[id] ?? dict[String(id)]);
  if (direct) return direct;
  for (const [rawKey, entry] of Object.entries(dict)) {
    const record = entry as SpellEntry;
    const entryId = Number(record?.id ?? record?.ID ?? record?.spellId ?? rawKey);
    if (entryId === id) {
      const name = readEntryName(record);
      if (name) return name;
    }
  }
  return '';
}

function readEntryName(entry: unknown): string {
  if (!entry || typeof entry !== 'object') return '';
  const record = entry as SpellEntry;
  const name = record.name ?? record.Name;
  return typeof name === 'string' && name.trim() ? name.trim() : '';
}

function readSpellDict(): Record<string | number, SpellEntry> | null {
  const globals = globalThis as {
    jI?: { spellDict?: Record<string | number, SpellEntry> };
    jL?: { spellDict?: Record<string | number, SpellEntry> };
    jj?: { spellDict?: Record<string | number, SpellEntry> };
  };
  for (const source of [globals.jI?.spellDict, globals.jL?.spellDict, globals.jj?.spellDict]) {
    if (source && Object.keys(source).length) return source;
  }
  return null;
}

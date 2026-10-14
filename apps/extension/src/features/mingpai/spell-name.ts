/**
 * 技能名查询：从游戏注入的技能表里按技能号取名字。
 * 取不到时返回空串，调用方自己决定回落文案。
 */

interface SpellEntry { name?: string }

export function readSpellName(spellId: number): string {
  const id = Number(spellId);
  if (!Number.isFinite(id) || id <= 0) return '';
  const dict = readSpellDict();
  const name = dict?.[id]?.name ?? dict?.[String(id)]?.name;
  return typeof name === 'string' ? name : '';
}

function readSpellDict(): Record<string | number, SpellEntry> | null {
  const globals = globalThis as {
    jI?: { spellDict?: Record<string | number, SpellEntry> };
    jL?: { spellDict?: Record<string | number, SpellEntry> };
  };
  return globals.jI?.spellDict ?? globals.jL?.spellDict ?? null;
}

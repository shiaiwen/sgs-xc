/**
 * 山河图换将透视：可换武将名单的文案。
 */

export const ROGUE_SELECT_GENERAL_WINDOW = 'RogueSelectGeneralWindow';
export const CHANGE_GENERAL_TOAST_PREFIX = '小抄提示：可换将为';
export const CHANGE_GENERAL_TOAST_MS = 10000;

type UnknownRecord = Record<string, unknown>;

export interface ChangeGeneralNameSource {
  getGeneralName(generalId: number): string | null;
  generalNamesReady(): boolean;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 从 character.sgs 的 GameCharacters.character 取出编号到武将名。 */
export function buildGeneralNameDict(characterConfig: unknown): Map<number, string> {
  const characters = asArray(asRecord(asRecord(characterConfig)?.GameCharacters)?.character);
  const dict = new Map<number, string>();
  for (const entry of characters) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = Number(record.a);
    if (!Number.isInteger(id)) continue;
    const prefix = typeof record.ai === 'string' ? record.ai : '';
    const base = typeof record.b === 'string' ? record.b.replaceAll('&', '') : '';
    const name = prefix + base;
    if (name) dict.set(id, name);
  }
  return dict;
}

/** 可换列表为空时不提示。名单按打开窗口时的顺序倒过来，逗号分隔。 */
export function formatChangeGeneralToast(
  generalChange: unknown,
  nameOf: (generalId: number) => string | null
): string | null {
  if (!Array.isArray(generalChange) || generalChange.length === 0) return null;
  const names = generalChange.map((id) => {
    const numeric = Number(id);
    const name = Number.isFinite(numeric) ? nameOf(numeric) : null;
    return name || `Unknown (${String(id)})`;
  });
  return CHANGE_GENERAL_TOAST_PREFIX + names.reverse().join(', ');
}

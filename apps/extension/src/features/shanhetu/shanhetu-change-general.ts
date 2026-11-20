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

function isGeneralIdList(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((entry) => Number.isFinite(Number(entry)));
}

/** 只读取换将协议的 general_change，避免把当前选将列表误当成可换名单。 */
export function readGeneralChangeList(payload: unknown): unknown[] | null {
  if (payload == null) return null;
  const queue: unknown[] = [payload];
  const seen = new Set<unknown>();
  while (queue.length) {
    const current = queue.shift();
    if (current == null || seen.has(current)) continue;
    seen.add(current);
    const record = asRecord(current);
    if (!record) continue;
    if (isGeneralIdList(record.general_change)) return record.general_change;
    for (const key of [
      'data', 'Data', 'protoObj', 'ProtoObj', 'param', 'Param',
      'WindowData', 'windowData', 'vo', 'VO', 'mData', 'viewData'
    ]) {
      if (key in record) queue.push(record[key]);
    }
  }
  return null;
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
  const list = Array.isArray(generalChange) ? generalChange : readGeneralChangeList(generalChange);
  if (!list?.length) return null;
  const names = list.map((id) => {
    const numeric = Number(id);
    const name = Number.isFinite(numeric) ? nameOf(numeric) : null;
    return name || `Unknown (${String(id)})`;
  });
  return CHANGE_GENERAL_TOAST_PREFIX + names.reverse().join(', ');
}

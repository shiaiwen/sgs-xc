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

const GENERAL_CHANGE_KEYS = [
  'general_change',
  'generalChange',
  'GeneralChange',
  'general_list',
  'generalList',
  'generalIds',
  'generalPool'
] as const;

function isGeneralIdList(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((entry) => Number.isFinite(Number(entry)));
}

/** 从 ShowWindow 参数、开窗事件或窗口实例里取出可换武将 id 列表。 */
export function readGeneralChangeList(payload: unknown, depth = 0): unknown[] | null {
  if (payload == null) return null;
  if (isGeneralIdList(payload)) return payload;
  if (depth > 6) return null;
  const queue: unknown[] = [payload];
  const seen = new Set<unknown>();
  while (queue.length) {
    const current = queue.shift();
    if (current == null || seen.has(current)) continue;
    seen.add(current);
    if (isGeneralIdList(current)) return current;
    const record = asRecord(current);
    if (!record) continue;
    for (const key of GENERAL_CHANGE_KEYS) {
      const list = record[key];
      if (isGeneralIdList(list)) return list;
    }
    for (const key of [
      'data', 'Data', 'protoObj', 'ProtoObj', 'param', 'Param',
      'WindowData', 'windowData', 'vo', 'VO', 'mData', 'viewData'
    ]) {
      if (key in record) queue.push(record[key]);
    }
  }
  return null;
}

/** 在对象树里深搜可换将列表，给已打开的换将窗用。 */
export function scanObjectForGeneralChange(root: unknown, maxDepth = 5): unknown[] | null {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  const seen = new Set<unknown>();
  while (queue.length) {
    const item = queue.shift();
    if (!item || seen.has(item.value)) continue;
    seen.add(item.value);
    const found = readGeneralChangeList(item.value, item.depth);
    if (found?.length) return found;
    if (item.depth >= maxDepth) continue;
    const record = asRecord(item.value);
    if (!record) continue;
    for (const value of Object.values(record)) {
      if (value !== null && typeof value === 'object') queue.push({ value, depth: item.depth + 1 });
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

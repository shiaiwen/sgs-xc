/**
 * 人机判断。
 * 账号编号小于 AI_CLIENT_ID_MIN 是真人；达到阈值后，普通机器人和其他高编号分开记。
 */

/** 大于等于该编号的账号是人机。 */
export const AI_CLIENT_ID_MIN = 0xee6b2800;

/** 0 真人，1 其他人机，2 普通机器人。 */
export function aiKind(clientId: unknown, isNormalRobot: unknown): 0 | 1 | 2 {
  const id = Number(clientId);
  if (!Number.isFinite(id) || id < AI_CLIENT_ID_MIN) return 0;
  return isNormalRobot ? 2 : 1;
}

/** 编号达到阈值就是人机。 */
export function isAiClientId(clientId: unknown): boolean {
  return aiKind(clientId, false) !== 0;
}

/** 排位、斗地主里真人座位上要写出的账号编号。人机和其他模式不写。 */
export function playerIdLabel(clientId: unknown, rankOrDoudizhu: boolean): string {
  if (!rankOrDoudizhu) return '';
  if (clientId == null || clientId === '') return '';
  const id = Number(clientId);
  if (!Number.isFinite(id) || isAiClientId(id)) return '';
  return String(id);
}

/**
 * 真人显示名字，人机隐藏。
 * 编号还没读到时返回 null，调用方不要据此把名字关掉。
 */
export function playNameVisible(clientId: unknown): boolean | null {
  if (clientId == null || clientId === '') return null;
  const id = Number(clientId);
  if (!Number.isFinite(id)) return null;
  return !isAiClientId(id);
}

const CLIENT_ID_KEYS = [
  'ClientId', 'clientId', 'ClientID', 'clientID', 'client_id', 'clientid'
] as const;

/** 只读 ClientId。旁边的小编号不能拿来判断人机。 */
export function readNestedClientId(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return null;
  const bags: Record<string, unknown>[] = [];
  const queue: { value: Record<string, unknown>; depth: number }[] = [{ value: record, depth: 0 }];
  const seen = new Set<Record<string, unknown>>();
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current.value)) continue;
    seen.add(current.value);
    bags.push(current.value);
    if (current.depth >= 2) continue;
    for (const key of ['userData', 'UserData', 'userInfo', 'UserInfo', 'playerInfo', 'PlayerInfo', 'player', 'Player']) {
      const nested = asRecord(current.value[key]);
      if (nested) queue.push({ value: nested, depth: current.depth + 1 });
    }
  }
  for (const key of CLIENT_ID_KEYS) {
    for (const bag of bags) {
      const id = bag[key];
      if (id != null && id !== '') return id;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

/**
 * 自动任务配置数据：任务 ID、武将灯系列与物品名等表结构构建。
 */

type UnknownRecord = Record<string, unknown>;

/** 自动任务需要的静态配置（来自 Config_w.sgs）。 */
export interface AutoTaskConfigData {
  /** 当前有效的任务 id：sys_h5_quest / ff_task_daily / gn_new_fuli / gn_newoldBack。 */
  taskIds: ReadonlySet<number>;
  /** 当期武将福利任务 id，来自 gn_new_fuli.sgs 的 taskteam。 */
  newFuliTaskIds: ReadonlySet<number>;
  /** 新武将回归等入口可能藏起来的任务 id，来自 gn_newoldBack.sgs。 */
  returnUnlockTaskIds: ReadonlySet<number>;
  /** 武将灯系列 id：cha_dbs_general_series。 */
  seriesList: readonly number[];
  /** 物品 id → 名称：sys_gs_dbs_fs_goodsbaseinfo。 */
  goodsNames: ReadonlyMap<number, string>;
}

export const AUTO_TASK_CONFIG_FILES = [
  'sys_h5_quest.sgs',
  'ff_task_daily.sgs',
  'gn_new_fuli.sgs',
  'gn_newoldBack.sgs',
  'cha_dbs_general_series.sgs',
  'sys_gs_dbs_fs_goodsbaseinfo.sgs'
] as const;

export type AutoTaskConfigFileName = typeof AUTO_TASK_CONFIG_FILES[number];

/** 配置里的时间形如 20260927T000000，与本地当天 T000002 按字符串比较。 */
export function configDayStamp(now: Date): string {
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}T000002`;
}

function withinRange(start: unknown, end: unknown, today: string): boolean {
  return (!start || String(start) <= today) && (!end || String(end) >= today);
}

function withinDuration(duration: unknown, today: string): boolean {
  if (!duration) return true;
  const text = String(duration);
  const parts = text.match(/[0-9]{8}T[0-9]{6}/g) ?? text.split(',');
  return withinRange(parts[0], parts[1], today);
}

/** 配置项当天是否有效。 */
export function isConfigEntryActive(entry: unknown, today: string): boolean {
  const record = asRecord(entry);
  if (!record) return false;
  const start = record.ClientTimeStart ?? record.clientTimeStart ?? record.TimeStart ?? record.timeStart
    ?? record.begintime ?? record.BeginTime;
  const end = record.ClientTimeEnd ?? record.clientTimeEnd ?? record.TimeEnd ?? record.timeEnd
    ?? record.endtime ?? record.EndTime;
  const duration = record.duration ?? record.Duration ?? record.duration2 ?? record.Duration2;
  return withinRange(start, end, today) && withinDuration(duration, today);
}

/** 把任务配置文件收成当日可领取的任务数据。 */
export function buildAutoTaskConfigData(
  files: Partial<Record<AutoTaskConfigFileName, unknown>>,
  today: string
): AutoTaskConfigData {
  const taskIds = new Set<number>();
  const addTaskId = (value: unknown) => {
    const id = Number(value);
    if (Number.isFinite(id) && id > 0) taskIds.add(id);
  };
  for (const task of asArray(rootOf(files['sys_h5_quest.sgs'])?.Task)) {
    if (isConfigEntryActive(task, today)) addTaskId(asRecord(task)?.Id);
  }
  for (const team of asArray(rootOf(files['ff_task_daily.sgs'])?.taskteam)) {
    const record = asRecord(team);
    if (record && Number(record.id) === 0 && Number(record.taskid) > 0 && isConfigEntryActive(record, today)) {
      addTaskId(record.taskid);
    }
  }
  const newFuliTaskIds = new Set<number>();
  const addNewFuliTaskId = (value: unknown) => {
    const id = Number(value);
    if (!Number.isFinite(id) || id <= 0) return;
    newFuliTaskIds.add(id);
    taskIds.add(id);
  };
  const newFuliRoot = rootOf(files['gn_new_fuli.sgs']);
  for (const key of ['taskteam', 'TaskTeam', 'taskTeam']) {
    for (const team of asArray(newFuliRoot?.[key])) {
      const record = asRecord(team);
      if (!record) continue;
      if (!isConfigEntryActive(record, today)) continue;
      addNewFuliTaskId(record.taskid ?? record.taskId ?? record.TaskId);
    }
  }
  if (newFuliRoot) collectNestedTaskIds(newFuliRoot, newFuliTaskIds);

  const returnUnlockTaskIds = new Set<number>();
  const addReturnUnlockId = (value: unknown) => {
    const id = Number(value);
    if (!Number.isFinite(id) || id <= 0) return;
    returnUnlockTaskIds.add(id);
    taskIds.add(id);
  };
  const newOldBackRoot = rootOf(files['gn_newoldBack.sgs']);
  if (newOldBackRoot) {
    for (const key of [
      'returnunlock', 'ReturnUnlock', 'returnUnlock', 'ReturnUnlockTask',
      'task', 'Task', 'tasks', 'Tasks', 'taskteam', 'TaskTeam'
    ]) {
      for (const entry of asArray(newOldBackRoot[key])) {
        const record = asRecord(entry);
        if (!record || !isConfigEntryActive(record, today)) continue;
        addReturnUnlockId(record.id ?? record.Id ?? record.taskid ?? record.taskId ?? record.TaskId);
      }
    }
    collectReturnUnlockTaskIdsFromRoot(newOldBackRoot, today).forEach((id) => addReturnUnlockId(id));
  }

  const seriesList: number[] = [];
  for (const collection of asArray(rootOf(files['cha_dbs_general_series.sgs'])?.Collection)) {
    const text = asRecord(collection)?.seriesList;
    if (typeof text !== 'string' && typeof text !== 'number') continue;
    for (const part of String(text).split(',')) {
      const id = Number(part);
      if (Number.isFinite(id) && id > 0) seriesList.push(id);
    }
  }

  const goodsNames = new Map<number, string>();
  for (const goods of asArray(asRecord(rootOf(files['sys_gs_dbs_fs_goodsbaseinfo.sgs'])?.goodslist)?.goods)) {
    const record = asRecord(goods);
    const id = Number(record?.a);
    if (Number.isFinite(id) && typeof record?.b === 'string') goodsNames.set(id, record.b);
  }

  for (const id of newFuliTaskIds) taskIds.add(id);

  return { taskIds, newFuliTaskIds, returnUnlockTaskIds, seriesList, goodsNames };
}

/** 配置根节点可能是 root 或 Root。 */
function rootOf(file: unknown): UnknownRecord | null {
  const record = asRecord(file);
  if (!record) return null;
  return asRecord(record.Root) ?? asRecord(record.root);
}

/** gn_newoldBack 里带 gamemodel 的规则表，任务 id 在同一张表。 */
/** gn_new_fuli 里 taskteam 可能嵌套，扫一遍带 taskid 的节点。 */
function collectNestedTaskIds(value: unknown, out: Set<number>, depth = 0, seen?: WeakSet<object>): void {
  if (depth > 6) return;
  const record = asRecord(value);
  if (!record) return;
  const tracker = seen ?? new WeakSet<object>();
  if (tracker.has(record)) return;
  tracker.add(record);
  const id = Number(record.taskid ?? record.taskId ?? record.TaskId);
  if (Number.isFinite(id) && id > 0) out.add(id);
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) child.forEach((item) => collectNestedTaskIds(item, out, depth + 1, tracker));
    else collectNestedTaskIds(child, out, depth + 1, tracker);
  }
}

function collectReturnUnlockTaskIdsFromRoot(root: UnknownRecord, today: string): number[] {
  const ids: number[] = [];
  const tryEntry = (entry: unknown) => {
    const record = asRecord(entry);
    if (!record) return;
    const id = Number(record.id ?? record.Id ?? record.taskid ?? record.taskId ?? record.TaskId);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!isConfigEntryActive(record, today)) return;
    ids.push(id);
  };
  for (const value of Object.values(root)) {
    const arr = asArray(value);
    if (arr.length === 0 || arr.length > 500) continue;
    const looksLikeUnlockRules = arr.every((entry) => {
      const record = asRecord(entry);
      if (!record) return false;
      const hasId = record.id != null || record.Id != null || record.taskid != null || record.taskId != null;
      if (!hasId) return false;
      return record.gamemodel != null || record.gameModel != null || record.GameModel != null
        || record.Gamemodel != null;
    });
    if (!looksLikeUnlockRules) continue;
    arr.forEach(tryEntry);
  }
  return ids;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value && typeof value === 'object' ? [value] : [];
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

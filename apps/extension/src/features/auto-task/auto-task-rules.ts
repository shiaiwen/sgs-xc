/**
 * 自动任务规则：判断任务是否可领、是否应跳过等纯逻辑。
 */

type UnknownRecord = Record<string, unknown>;

/** 酒馆碎片任务。 */
export const TAVERN_TASK_IDS: readonly number[] = [161114, 161115, 161116];
/** 不自动领取的任务。 */
const EXCLUDED_TASK_IDS = new Set([97, 98, 126, 127]);
const HUAN_LE_DOU_ITEM_IDS = new Set(['9020101', '9030101']);
const COST_TASK_PATTERN = /兑换|兑取|换取|消费|消耗|扣除|合成|盲盒/;
/** 已消费达标后的进度描述，领取时不再扣费。先从文案里摘掉，避免被上面的规则误伤。 */
const SPEND_PROGRESS_PATTERN = /累计实际扣除|扣除绑定元宝|扣除元宝|消耗绑定元宝|消耗元宝|累计消费|消费/g;
const COST_REQ_TYPE = 30;
const FREE_EXCHANGE_CLIENT_TASK_TYPES = new Set([34, 35]);

export interface RewardFilterContext {
  skipDiJiaQuan: boolean;
  skipHuanLeDou: boolean;
  goodsName(itemId: unknown): string;
}

export interface TaskRuleContext extends RewardFilterContext {
  skipTavern: boolean;
  /** 配置中的有效任务 id；配置未加载时为 null。 */
  taskIds: ReadonlySet<number> | null;
  /** 当期武将福利任务 id；配置未加载时为 null。 */
  newFuliTaskIds: ReadonlySet<number> | null;
  /** 新武将回归等隐藏入口任务；配置未加载时为 null。 */
  returnUnlockTaskIds: ReadonlySet<number> | null;
  /** 物品是否为需要自选的道具（游戏物品对象的 CheckHasPropItem）。 */
  goodsHasPropItem(itemId: unknown): boolean;
}

/** 游戏 TaskManager 的访问入口；方法名可能被压缩，由调用方解析。 */
export interface TaskManagerAccess {
  readonly manager: UnknownRecord;
  has(method: string): boolean;
  call(method: string, ...args: unknown[]): unknown;
}

/** 从任务对象上读取任务编号。 */
export function taskIdOf(task: unknown): unknown {
  const record = asRecord(task);
  const base = asRecord(record?.baseVo);
  return record?._id ?? record?.id ?? record?.taskId ?? base?._id ?? base?.id;
}

/** 读取任务奖励列表。 */
export function taskRewards(task: unknown): unknown[] {
  const record = asRecord(task);
  const base = asRecord(record?.baseVo);
  const rewards = base?.TaskRewardItem || base?.taskRewardItem || record?.TaskRewardItem || record?.taskRewardItem;
  return Array.isArray(rewards) ? rewards : [];
}

/** 读取一条奖励的道具编号。 */
export function rewardItemId(item: unknown): unknown {
  const record = asRecord(item);
  return record?.ItemID ?? record?.itemID ?? record?.itemId ?? record?.id ?? record?.ID
    ?? record?.goodsId ?? record?.GoodsID ?? record?.baseId ?? record?.BaseID;
}

function rewardItemName(item: unknown, context: RewardFilterContext): string {
  const record = asRecord(item);
  return String(
    context.goodsName(rewardItemId(item))
    || record?.itemName || record?.ItemName || record?.name || record?.Name
    || record?.goodsName || record?.GoodsName || ''
  );
}

function someReward(
  rewards: unknown,
  context: RewardFilterContext,
  predicate: (itemId: unknown, name: string) => boolean
): boolean {
  const list = Array.isArray(rewards) ? rewards : rewards ? [rewards] : [];
  return list.some((item) => predicate(rewardItemId(item), rewardItemName(item, context)));
}

/** 奖励里是否包含抵价券。 */
export function rewardsContainDiJiaQuan(rewards: unknown, context: RewardFilterContext): boolean {
  return someReward(rewards, context, (_, name) => name.includes('抵价券'));
}

/** 道具编号是不是欢乐豆。 */
export function isHuanLeDouItem(itemId: unknown): boolean {
  return HUAN_LE_DOU_ITEM_IDS.has(String(itemId));
}

/** 奖励里是否包含欢乐豆。 */
export function rewardsContainHuanLeDou(rewards: unknown, context: RewardFilterContext): boolean {
  return someReward(rewards, context, (itemId, name) => name.includes('欢乐豆') || isHuanLeDouItem(itemId));
}

/** 奖励含用户选择跳过的抵价券 / 欢乐豆。 */
export function rewardsBlocked(rewards: unknown, context: RewardFilterContext): boolean {
  return (context.skipDiJiaQuan && rewardsContainDiJiaQuan(rewards, context))
    || (context.skipHuanLeDou && rewardsContainHuanLeDou(rewards, context));
}

/** 按数组 / datum / _objDatum / _maps 展开游戏容器。 */
export function flattenGameCollection(value: unknown): unknown[] {
  try {
    const record = asRecord(value);
    if (Array.isArray(value)) return value.filter(isPresent);
    if (Array.isArray(record?.datum)) return record.datum.filter(isPresent);
    if (Array.isArray(record?._objDatum) && record._objDatum.length) return record._objDatum.filter(isPresent);
    const maps = asRecord(record?._maps);
    if (maps) return Object.values(maps).flat().filter(isPresent);
  } catch {
    // 容器访问器抛错时视为空。
  }
  return [];
}

function lookupTask(access: TaskManagerAccess, id: unknown): unknown {
  return access.call('GetServerTaskDataByTaskID', id) || access.call('GetAllTaskDataByTaskID', id);
}

/** 收集候选任务：配置任务 id、TaskManager 中的任务表、未跳过时的酒馆任务，按 id 去重。 */
export function collectTasks(access: TaskManagerAccess, context: TaskRuleContext): unknown[] {
  const tasks = new Map<string, unknown>();
  const add = (task: unknown) => {
    const id = taskIdOf(task);
    if (id === undefined || id === null || tasks.has(String(id)) || EXCLUDED_TASK_IDS.has(Number(id))) return;
    tasks.set(String(id), task);
  };
  for (const id of context.taskIds ?? []) add(lookupTask(access, id));
  for (const id of context.newFuliTaskIds ?? []) add(lookupTask(access, id));
  for (const id of context.returnUnlockTaskIds ?? []) add(lookupTask(access, id));
  for (const key of ['allTasks', 'taskLocalConditionDict', 'typeTaskDict']) {
    flattenGameCollection(access.manager[key]).forEach(add);
  }
  if (!context.skipTavern) TAVERN_TASK_IDS.forEach((id) => add(lookupTask(access, id)));
  for (const key of ['allTasks', 'taskLocalConditionDict', 'typeTaskDict']) {
    for (const task of flattenGameCollection(access.manager[key])) {
      const record = asRecord(task);
      if (!record || !taskCanAward(record)) continue;
      if (!isForcedGeneralWelfareTask(task, context)) continue;
      add(task);
    }
  }
  return [...tasks.values()];
}

/** 可领取：兼容 CanAward 为 0/1 或 taskState=2。 */
export function taskCanAward(task: unknown): boolean {
  const record = asRecord(task);
  if (!record) return false;
  try {
    const flag = record.CanAward ?? record.canAward;
    if (flag === true || flag === 1 || flag === '1') return true;
  } catch {
    // 访问器抛错时继续看状态字段。
  }
  const state = Number(record.taskState ?? record.TaskState ?? record.state ?? record.State);
  return state === 2;
}

function isExpired(task: UnknownRecord): boolean {
  try {
    if (task.HasExpired === true || task.hasExpired === true) return true;
  } catch {
    // 访问器抛错时继续判断。
  }
  const base = asRecord(task.baseVo) ?? task;
  try {
    if (base.EffectClientTime === false || base.effectClientTime === false) return true;
  } catch {
    // 访问器抛错时视为未过期。
  }
  return false;
}

function hasSelectReward(task: UnknownRecord): boolean {
  const base = asRecord(task.baseVo);
  return Boolean(base?.HaveSelectReward || base?.haveSelectReward || task.HaveSelectReward || task.haveSelectReward);
}

function isFreeExchangeTask(task: UnknownRecord): boolean {
  const base = asRecord(task.baseVo) ?? task;
  const type = Number(base.clientTaskType ?? base.ClientTaskType ?? task.clientTaskType ?? task.ClientTaskType ?? 0);
  return FREE_EXCHANGE_CLIENT_TASK_TYPES.has(type);
}

function rewardsNeedPropSelection(task: UnknownRecord, context: TaskRuleContext): boolean {
  if (isFreeExchangeTask(task)) return false;
  return taskRewards(task).some((item) => {
    const record = asRecord(item);
    return context.goodsHasPropItem(record?.ItemID ?? record?.itemID ?? record?.itemId ?? record?.id);
  });
}

function conditionsOf(task: UnknownRecord): UnknownRecord[] {
  return Array.isArray(task.taskConditions)
    ? task.taskConditions.map(asRecord).filter((item): item is UnknownRecord => item !== null)
    : [];
}

export function taskText(task: UnknownRecord): string {
  const base = asRecord(task.baseVo) ?? task;
  return [
    base._name, base.name, base.Name, base._desc, base.desc, base.Desc,
    task._name, task.name, task.Name, task._desc, task.desc, task.Desc,
    ...conditionsOf(task).map((condition) => condition._desc || condition.desc || condition.Desc)
  ].filter(Boolean).join(' ');
}

function rewardTextOf(task: UnknownRecord, context: TaskRuleContext): string {
  return taskRewards(task).map((item) => {
    const row = asRecord(item);
    const name = rewardItemName(item, context);
    if (name) return name;
    return String(row?.itemName ?? row?.ItemName ?? row?.name ?? row?.Name ?? row?.desc ?? row?.Desc ?? '');
  }).join(' ');
}

/** 拥有新武将送经典版三国秀；入口隐藏时仍可能 CanAward。 */
export function isClassicGeneralShowWelfareTask(task: unknown, context: TaskRuleContext): boolean {
  const record = asRecord(task);
  if (!record) return false;
  const text = taskText(record);
  if (!/拥有/.test(text)) return false;
  const rewardText = rewardTextOf(record, context);
  return /经典版|经典形象|三国秀/.test(rewardText) || /经典版|原画装扮/.test(text);
}

/** 当期活动将任务：文案里直接出现将名或重阳祈福相关。 */
export function isActivityGeneralWelfareByText(task: unknown): boolean {
  const record = asRecord(task);
  if (!record) return false;
  const text = taskText(record);
  if (/谋田丰|田丰/.test(text)) return true;
  return /重阳|祈福/.test(text) && /使用|拥有|功勋|谋/.test(text);
}

/** 当期新将福利：如使用谋田丰完成局数领功勋，配置在 gn_new_fuli。 */
export function isGnNewFuliStyleTask(task: unknown, context: TaskRuleContext): boolean {
  const record = asRecord(task);
  if (!record) return false;
  const text = taskText(record);
  if (!/使用.{1,20}(完成|获胜|胜|局|升阶)|拥有.{1,20}/.test(text)) return false;
  const rewardText = rewardTextOf(record, context);
  return /功勋|经典|三国秀|原画/.test(rewardText) || /原画装扮/.test(text);
}

function isNewFuliConfigTask(id: unknown, context: TaskRuleContext): boolean {
  const numericId = Number(id);
  return Number.isFinite(numericId) && context.newFuliTaskIds?.has(numericId) === true;
}

/** 武将福利 / 隐藏入口任务：强制纳入自动领取。 */
export function isForcedGeneralWelfareTask(task: unknown, context: TaskRuleContext, id: unknown = taskIdOf(task)): boolean {
  return isNewFuliConfigTask(id, context)
    || isReturnUnlockTask(id, context)
    || isClassicGeneralShowWelfareTask(task, context)
    || isGnNewFuliStyleTask(task, context)
    || isActivityGeneralWelfareByText(task);
}

function bypassHiddenTaskRules(task: UnknownRecord, context: TaskRuleContext, id: unknown): boolean {
  return isForcedGeneralWelfareTask(task, context, id);
}

function skipCostOrRepeatForForced(task: UnknownRecord, context: TaskRuleContext, id: unknown): boolean {
  return isNewFuliConfigTask(id, context)
    || isReturnUnlockTask(id, context)
    || isGnNewFuliStyleTask(task, context)
    || isClassicGeneralShowWelfareTask(task, context)
    || isActivityGeneralWelfareByText(task);
}

/** 无奖励且不在当前配置里的任务视为隐藏或旧任务。 */
function isHiddenOrLegacyTask(id: unknown, task: UnknownRecord, context: TaskRuleContext): boolean {
  if (bypassHiddenTaskRules(task, context, id)) return false;
  if (taskRewards(task).length > 0) return false;
  if (context.taskIds) return ![...context.taskIds].some((taskId) => String(taskId) === String(id));
  return task.currentConfig === false || task.hiddenOrLegacyTask === true;
}

/** 文案是消费达标进度，而不是领取时再扣一次道具。 */
function isSpendProgressTask(text: string): boolean {
  return /累计实际扣除|扣除元宝|扣除绑定元宝|消耗元宝|消耗绑定元宝|累计消费|消费/.test(text);
}

/**
 * 兑换、消耗道具、可反复完成的任务不自动领取。
 * 消费回馈（累计实际扣除 / 消费达标）领取时不再扣费，多档可以一次领完。
 */
function isCostOrRepeatTask(task: UnknownRecord): boolean {
  if (isFreeExchangeTask(task)) return false;
  const text = taskText(task);
  const spendProgress = isSpendProgressTask(text);
  const costText = text.replace(new RegExp(SPEND_PROGRESS_PATTERN.source, 'g'), '');
  if (COST_TASK_PATTERN.test(costText)) return true;
  const paysOnClaim = conditionsOf(task).some((condition) => (
    Number(condition._reqType ?? condition.reqType ?? condition.ReqType) === COST_REQ_TYPE
  ));
  if (paysOnClaim && !spendProgress) return true;
  if (spendProgress) return false;
  const base = asRecord(task.baseVo) ?? task;
  const maxComplete = Number(base.maxComplete ?? base._maxComplete ?? task.maxComplete ?? task._maxComplete ?? 0);
  const canRewardCount = Number(task.CanRewardCount ?? task.canRewardCount ?? 0);
  return (Number.isFinite(maxComplete) && maxComplete > 1) || (Number.isFinite(canRewardCount) && canRewardCount > 1);
}

/** 任务是否不应自动领取。 */
function isReturnUnlockTask(id: unknown, context: TaskRuleContext): boolean {
  const numericId = Number(id);
  return Number.isFinite(numericId) && context.returnUnlockTaskIds?.has(numericId) === true;
}

export function isTaskExcluded(task: unknown, context: TaskRuleContext, id: unknown = taskIdOf(task)): boolean {
  const record = asRecord(task);
  if (!record) return true;
  const numericId = Number(id);
  if (Number.isFinite(numericId) && TAVERN_TASK_IDS.includes(numericId) && context.skipTavern) return true;
  if (bypassHiddenTaskRules(record, context, id)) {
    const blockCost = !skipCostOrRepeatForForced(record, context, id) && isCostOrRepeatTask(record);
    return !taskCanAward(record)
      || isExpired(record)
      || hasSelectReward(record)
      || rewardsNeedPropSelection(record, context)
      || blockCost;
  }
  return !taskCanAward(record)
    || isExpired(record)
    || hasSelectReward(record)
    || rewardsNeedPropSelection(record, context)
    || isHiddenOrLegacyTask(id, record, context)
    || isCostOrRepeatTask(record);
}

/** 任务还没接取：本地有未接取数据，服务器侧没有。 */
export function isUnacceptedTask(access: TaskManagerAccess, id: unknown, task?: unknown): boolean {
  try {
    if (!access.call('GetNoGetTaskDataByTaskID', id)) return false;
    if (access.call('GetServerTaskDataByTaskID', id)) return false;
    const data = asRecord(task || access.call('GetAllTaskDataByTaskID', id));
    return !(data?.isFromServer || data?.IsFromServer);
  } catch {
    return false;
  }
}

function canRewardCount(task: unknown): number {
  const record = asRecord(task);
  const count = Number(record?.CanRewardCount ?? record?.canRewardCount ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/** 节流键：未接取的任务先接取，否则领取奖励。 */
export function taskClaimKey(access: TaskManagerAccess, id: unknown, task: unknown): string {
  const accepting = isUnacceptedTask(access, id, task) && access.has('et');
  return `${accepting ? 'taskAccept:' : 'task:'}${String(id)}`;
}

/** 接取或领取单个任务；返回 false 表示没有发出请求。 */
export function claimTask(access: TaskManagerAccess, id: unknown, task: unknown, context: TaskRuleContext): unknown {
  const current = access.call('GetServerTaskDataByTaskID', id) || access.call('GetAllTaskDataByTaskID', id) || task;
  if (isTaskExcluded(current, context, id)) return false;
  if (isUnacceptedTask(access, id, current) && access.has('RequestAcceptTask')) {
    return access.call('RequestAcceptTask', id, id, 0);
  }
  if (!access.has('RequestTaskAward')) return false;
  const count = canRewardCount(current);
  const result = access.call('RequestTaskAward', id, 0, count);
  return result === false && count !== 0 ? access.call('RequestTaskAward', id, 0, 0) : result;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

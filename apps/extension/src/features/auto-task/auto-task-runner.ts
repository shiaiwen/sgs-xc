/**
 * 自动领取。
 *
 * 按固定顺序处理任务、活动、邮件、福利和签到。
 * 每项都先看设置里的跳过开关，再看奖励是不是抵价券或欢乐豆。
 * 同一领取用 claims 限流，避免窗口没关时重复请求。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { readUserDataSelf } from '../../runtime/game-account-session.ts';
import type { MethodPatcher } from '../../runtime/method-patch.ts';
import type { TaskScope } from '../skin-background/skin-runtime.ts';
import { beijingDate, type AutoTaskClaims } from './auto-task-claims.ts';
import type { AutoTaskConfigData } from './auto-task-config-data.ts';
import {
  TAVERN_TASK_IDS,
  claimTask,
  collectTasks,
  flattenGameCollection,
  isHuanLeDouItem,
  isTaskExcluded,
  isUnacceptedTask,
  rewardLooksLikeGeneral,
  rewardsBlocked,
  rewardsContainDiJiaQuan,
  rewardsContainHuanLeDou,
  shouldClaimAllJdRechargeRewards,
  shouldClaimOfficerSalaryReward,
  shouldSkipFreeShopGoodForHuanLeDou,
  shouldClaimDdztllReward,
  taskClaimKey,
  taskClaimState,
  taskIdOf,
  taskPrerequisiteMet,
  taskLikelyGrantsHuanLeDou,
  taskRewards,
  type TaskManagerAccess,
  type TaskRuleContext
} from './auto-task-rules.ts';
import {
  WYQJ_TRIAL_CARD_AFTER_SYNC_MS,
  WYQJ_TRIAL_CARD_RETRY_DELAY_MS,
  WYQJ_TRIAL_CARD_RETRY_MAX,
  WYQJ_TRIAL_CARD_OPEN_WINDOW_MS,
  WYQJ_TRIAL_CARD_DEFAULT_SEND_LIMIT,
  WYQJ_TRIAL_VIEW_CLASS_NAMES,
  WYQJ_VIEW_CELL_SCAN_MAX,
  WYQJ_VIEW_DISPLAY_SCAN_MAX,
  TASK_MAIN_CONFIG_FILE_NAME
} from '../../const/wyqj-trial-card.ts';
import type { AutoTaskSkipKey } from './auto-task-settings.ts';
import type { AutoTaskWindows } from './auto-task-windows.ts';

type UnknownRecord = Record<string, unknown>;

interface PendingNewJunDianClaim {
  activity: UnknownRecord;
  proxy: UnknownRecord;
  account: string | undefined;
  id: number;
  isBp: boolean;
  finish(success: boolean): void;
}

export interface AutoTaskOptions {
  skipTavern: boolean;
  skipMail: boolean;
  skipDailyGeneralBag: boolean;
  skipSignTrialCard: boolean;
  skipWyqjExperienceCard: boolean;
  skipDiJiaQuan: boolean;
  skipHuanLeDou: boolean;
  skipFreeBless: boolean;
  skipFreeTreasureFlip: boolean;
}

export interface AutoTaskRunnerDeps {
  locator: LayaObjectLocator;
  windows: AutoTaskWindows;
  claims: AutoTaskClaims;
  tasks: TaskScope;
  /** 用于挂可撤销的领奖回包和错误提示钩子。 */
  patcher?: MethodPatcher;
  enabled(): boolean;
  options(): AutoTaskOptions;
  configData(): AutoTaskConfigData | null;
  account?(): string;
}

export interface AutoTaskRunner {
  /** 执行一轮全部子步骤（不等待签到等延后动作）。 */
  runPass(): void;
  /** 每日免费武将包。 */
  claimDailyGeneralBag(): void;
  /** 大厅场景切换后补领低欢乐豆。 */
  scheduleLowBeanFree(reason: string): void;
  /** 新周卡、新月卡：不等待福利与砍树，并短时重试。 */
  claimNewPrivilegeCards(): void;
  /** 用户刚勾选某领取项时，只跑对应步骤。 */
  runClaimForSkipKey(key: AutoTaskSkipKey): void;
}

const LOW_BEAN_THRESHOLD = 600;
const LOW_BEAN_RETRY_DELAYS = [1200, 5000, 11000, 18000, 35000];
/** 新特权卡拉数据与领取用更短节流，避免 15 秒才重试。 */
const NEW_PRIVILEGE_SYNC_THROTTLE_MS = 3_000;
const NEW_PRIVILEGE_CLAIM_THROTTLE_MS = 2_000;
const NEW_PRIVILEGE_RETRY_DELAYS = [2_000, 5_000, 12_000];
const MONTH_CARD_TYPES = [2, 3];
const MONTH_CARD_SYNC_METHODS = [
  'SendClientPrivilegeCardInfoReq',
  'SendClientPrivilegeInfoReq',
  'ReqPrivilegeCardInfo',
  'ReqClientPrivilegeCardInfo',
  'SendPrivilegeCardInfoReq'
];
const TREE_USING_KEY = 'kanshu:treeUsing';
const TREE_USING_REQUEST_KEY = 'kanshu:treeUsing:request';
const TREE_ITEM_BASE = 12130001;
/** 见 auto-task-rules EXCLUDED_AUTO_SHOP_GOODS_IDS；仅遍历可能存在的其它免费商品。 */
const FREE_SHOP_GOODS = [13360001, 11578201];
const DAILY_GENERAL_BAG = { id: 8100101, type: 3 };
const MAIL_SKIP_TITLES = new Set(['道具过期提醒', '不良游戏行为警告']);
const MAIL_UNKNOWN_SENDER = '系统未知好友';
const NEW_FESTIVAL_SIGN_IDS = [71, 72];
const FESTIVAL_SYNC_METHODS: ReadonlyArray<readonly [string, string]> = [
  ['festivalSign:sync:config', 'SendFestivalSignConfigReq'],
  ['festivalSign:sync:data', 'SendClientFestivalSignDataReq'],
  ['festivalSign:sync:newConfig', 'SendNewFestivalSignConfigReq'],
  ['accumulatedSign:sync:config', 'SendAccumlateSignConfigReq'],
  ['accumulatedSign:sync:login', 'SendAccumlateLoginReq']
];
const ACCUMULATED_STATE_METHODS = [
  'GetAccumlateAwdState',
  'GetAccumlateSignAwdState',
  'GetAccumlateLoginAwdState',
  'GetAccumulateAwdState',
  'GetAccumSignAwdState'
];
const ACCUMULATED_REWARD_METHODS = [
  'SendNewClientAccumlateSignGetRewardReq',
  'SendClientAccumlateSignGetRewardReq',
  'SendNewClientAccumlateLoginGetRewardReq',
  'SendClientAccumlateLoginGetRewardReq',
  'SendAccumulateSignGetRewardReq',
  'SendAccumSignGetRewardReq'
];

/** 任务操作回复协议号（CLIENT_QUEST_OP_REP）。服务器拒绝领取时游戏会弹「未知错误107014_…」。 */
const CLIENT_QUEST_OP_REP = 107014;
/** 自动领取发出的任务操作，回复前保留多久用于抑制对应任务的错误弹窗。 */
const QUEST_OP_CLAIM_TTL_MS = 20_000;
const CLIENT_NEW_JD_GET_AWARD_REP = 170297;
const NEW_JD_AWARD_REPLY_EVENT = 'decodeClientNewJDGetAwardRep';
const NEW_JD_REPLY_TIMEOUT_MS = 5_000;

/** 创建自动领取执行器，串起窗口、任务和领取记录。 */
export function createAutoTaskRunner(deps: AutoTaskRunnerDeps): AutoTaskRunner {
  const { locator, windows, claims, tasks, patcher } = deps;
  const newJunDianRuns = new WeakMap<object, Promise<boolean>>();
  const manualNewJunDianUntil = new WeakMap<object, number>();
  let pendingNewJunDianClaim: PendingNewJunDianClaim | null = null;
  let startingNewJunDianClaim: PendingNewJunDianClaim | null = null;
  let silentNewJunDianError: number | null = null;
  const newPrivilegePending = new WeakMap<object, Map<number, string>>();
  const newPrivilegeBound = new WeakSet<object>();
  let newPrivilegeRetryScheduled = false;
  const freeBlessBound = new WeakSet<object>();
  const rejectedTasks = new WeakMap<object, Map<string, string>>();
  const pendingTaskClaims = new Set<string>();
  /** 已发出任务操作的任务 id → 过期时间；用于吞掉这些任务触发的 107014 错误弹窗。 */
  const autoClaimedQuestIds = new Map<number, number>();
  let mailRunning = false;
  let generalBagTimerArmed = false;
  let goodsConfigLookup: ((id: unknown) => unknown) | null | undefined;
  /** 取消上一轮体验卡重试，避免多轮自动领取叠很多延时任务。 */
  let wyqjTrialClaimRunId = 0;

  const delay = (ms: number) => new Promise<void>((resolve) => tasks.later(resolve, ms));
  const active = () => !tasks.disposed && deps.enabled();

  async function poll<T>(probe: () => T | null | undefined | false, attempts: number, interval: number): Promise<T | null> {
    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      if (tasks.disposed) return null;
      try {
        const value = probe();
        if (value) return value;
      } catch {
        // 继续等待。
      }
      if (attempt < attempts) await delay(interval);
    }
    return null;
  }

  function manager(name: string): UnknownRecord | null {
    return locator.manager(name);
  }

  function newFuLiManager(): UnknownRecord | null {
    return manager('NewFuLiManager')
      ?? locator.findManagerByPredicate((item) => typeof item.SendSetOutRewardAllReq === 'function');
  }

  function resolveMethod(target: UnknownRecord | null, owner: string, method: string): ((...args: unknown[]) => unknown) | null {
    if (!target) return null;
    const direct = target[method];
    if (typeof direct === 'function') return direct as (...args: unknown[]) => unknown;
    const name = locator.obfuscatedMethodName(target, owner, method);
    const resolved = name ? target[name] : null;
    return typeof resolved === 'function' ? resolved as (...args: unknown[]) => unknown : null;
  }

  function invoke(target: UnknownRecord | null, owner: string, method: string, ...args: unknown[]): unknown {
    const fn = resolveMethod(target, owner, method);
    return fn ? fn.apply(target, args) : undefined;
  }

  function has(target: UnknownRecord | null, method: string): boolean {
    return typeof target?.[method] === 'function';
  }

  function call(target: UnknownRecord | null, method: string, ...args: unknown[]): unknown {
    const fn = target?.[method];
    return typeof fn === 'function' ? fn.apply(target, args) : undefined;
  }

  /** 物品对象（SgxFPreviewWindow.getGoodConfig），用于读名称与 CheckHasPropItem。 */
  function goodsConfig(itemId: unknown): UnknownRecord | null {
    if (goodsConfigLookup === undefined) {
      const preview = windows.get('SgxFPreviewWindow', null);
      const lookup = preview?.getGoodConfig;
      goodsConfigLookup = typeof lookup === 'function' ? lookup as (id: unknown) => unknown : null;
      windows.release('SgxFPreviewWindow');
    }
    if (!goodsConfigLookup) return null;
    try {
      const found = goodsConfigLookup(itemId);
      return found !== null && typeof found === 'object' ? found as UnknownRecord : null;
    } catch {
      return null;
    }
  }

  function collectGoodsRewardEntries(goodsId: unknown): unknown[] {
    const entries: unknown[] = [{ ItemID: goodsId }];
    const goods = goodsConfig(goodsId);
    if (!goods) return entries;
    const base = asRecord(goods.baseInfo) ?? goods;
    const selfName = String(base?.name || base?.Name || goods.name || goods.Name || '');
    if (selfName) entries.push({ itemName: selfName });
    for (const key of [
      'containGoods', 'ContainGoods', 'goodsList', 'GoodsList',
      'previewList', 'rewardItems', 'giftGoods', 'GiftGoods'
    ]) {
      const nested = goods[key];
      if (nested) entries.push(nested);
    }
    return entries;
  }

  function shouldBuyFreeShopGood(goodsId: number): boolean {
    const options = deps.options();
    const context = ruleContext();
    const entries = collectGoodsRewardEntries(goodsId);
    const name = goodsName(goodsId);
    if (shouldSkipFreeShopGoodForHuanLeDou(options.skipHuanLeDou, goodsId, name, entries, context)) return false;
    return !rewardsBlocked(entries, context);
  }

  function goodsName(itemId: unknown): string {
    const fromConfig = deps.configData()?.goodsNames.get(Number(itemId));
    if (fromConfig) return fromConfig;
    const goods = goodsConfig(itemId);
    const baseInfo = asRecord(goods?.baseInfo);
    return String(baseInfo?.name || baseInfo?.Name || goods?.name || goods?.Name || '');
  }

  function ruleContext(): TaskRuleContext {
    const options = deps.options();
    return {
      skipTavern: options.skipTavern,
      skipDiJiaQuan: options.skipDiJiaQuan,
      skipHuanLeDou: options.skipHuanLeDou,
      taskIds: deps.configData()?.taskIds ?? null,
      newFuliTaskIds: deps.configData()?.newFuliTaskIds ?? null,
      returnUnlockTaskIds: deps.configData()?.returnUnlockTaskIds ?? null,
      goodsName,
      goodsHasPropItem: (itemId) => Boolean(goodsConfig(itemId)?.CheckHasPropItem)
    };
  }

  function blocked(rewards: unknown): boolean {
    return rewardsBlocked(rewards, ruleContext());
  }

  function waitForEvent(
    target: UnknownRecord, eventName: unknown, action: () => unknown,
    timeout = 5000, ready: () => boolean = () => true
  ): Promise<boolean> {
    if (!eventName || !has(target, 'on') || !has(target, 'off')) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      const caller = {};
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        call(target, 'off', eventName, caller, onEvent);
        resolve(value);
      };
      const onEvent = () => {
        try {
          if (active() && ready()) finish(true);
        } catch {
          finish(false);
        }
      };
      const timer = setTimeout(() => finish(false), timeout);
      call(target, 'on', eventName, caller, onEvent);
      try {
        if (action() === false) finish(false);
      } catch (error) {
        clearTimeout(timer);
        call(target, 'off', eventName, caller, onEvent);
        reject(error);
      }
    });
  }

  function eventConstant(target: UnknownRecord, name: string): unknown {
    const constructor = target.constructor;
    const value = typeof constructor === 'function'
      ? Reflect.get(constructor, name)
      : asRecord(constructor)?.[name];
    return value ?? target[name];
  }

  // ---------- 任务 ----------

  /** 记一条已发出的任务操作，供错误弹窗抑制钩子查询。 */
  function markQuestOpSent(id: unknown): void {
    const questId = Number(id);
    if (!Number.isFinite(questId)) return;
    const expiry = Date.now() + QUEST_OP_CLAIM_TTL_MS;
    for (const [key, time] of autoClaimedQuestIds) {
      if (time <= Date.now()) autoClaimedQuestIds.delete(key);
    }
    autoClaimedQuestIds.set(questId, expiry);
  }

  /**
   * 挂 GameEventDispatcher.ShowProtocolError 的抑制钩子：协议号 107014（任务操作回复）
   * 且任务是我们刚自动领取触发的，就吞掉「未知错误107014_…」弹窗。手动领任务报错不受影响。
   */
  function ensureClaimErrorHook(dispatcher?: UnknownRecord | null): void {
    if (!patcher) return;
    const ged = dispatcher ?? (typeof locator.dispatcher === 'function' ? locator.dispatcher() : null);
    if (!ged || patcher.isWrapped(ged, 'ShowProtocolError')) return;
    patcher.wrap(ged, 'ShowProtocolError', (original) => function (this: unknown, ...args: unknown[]) {
      const [protocolId, errorCode, suffix] = args;
      if (protocolId === CLIENT_NEW_JD_GET_AWARD_REP && errorCode === silentNewJunDianError && silentNewJunDianError !== null) {
        return undefined;
      }
      if (protocolId === CLIENT_QUEST_OP_REP) {
        const questId = Number(suffix);
        if (Number.isFinite(questId) && (autoClaimedQuestIds.get(questId) ?? 0) > Date.now()) {
          console.warn('[自动领取] 已吞掉任务领取失败弹窗:', questId, errorCode);
          return undefined;
        }
      }
      return original.apply(this, args);
    });
  }

  async function requestTaskClaim(access: TaskManagerAccess, id: unknown, task: unknown, context: TaskRuleContext): Promise<boolean> {
    const proxy = manager('ServerProxy');
    const replyManager = manager('TaskManager');
    if (!proxy || !has(proxy, 'on') || !has(proxy, 'off')) return false;
    const key = `${deps.account?.() ?? ''}:${String(id)}`;
    if (pendingTaskClaims.has(key) || !taskPrerequisiteMet(access, task)) return false;
    let rejected = rejectedTasks.get(access.manager);
    if (!rejected) rejectedTasks.set(access.manager, rejected = new Map());
    const state = taskClaimState(task);
    const accepting = isUnacceptedTask(access, id, task);
    if (rejected.get(key) === state) return false;
    if (!claims.acquire(taskClaimKey(access, id, task))) return false;
    pendingTaskClaims.add(key);
    return new Promise<boolean>((resolve) => {
      const caller = {};
      const bindings: Array<[UnknownRecord, string, (...args: unknown[]) => void]> = [];
      let settled = false;
      const finish = (success: boolean, remember = true) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        bindings.forEach(([target, event, fn]) => call(target, 'off', event, caller, fn));
        pendingTaskClaims.delete(key);
        if (remember) {
          if (success) rejected!.delete(key);
          else rejected!.set(key, state);
        }
        resolve(success);
      };
      const bind = (target: UnknownRecord, event: string, fn: (...args: unknown[]) => void) => {
        bindings.push([target, event, fn]);
        call(target, 'on', event, caller, fn);
      };
      const matches = (value: unknown) => String(value) === String(id);
      const timer = setTimeout(() => finish(false), 15000);
      try {
        bind(proxy, 'SmsgTaskFailed', (payload) => {
          const protocol = asRecord(asRecord(payload)?.Protocol);
          if (matches(protocol?.TaskID)) finish(false);
        });
        bind(proxy, 'decodeUserQuestOpRep', (payload) => {
          const protocol = asRecord(asRecord(payload)?.Protocol);
          const data = asRecord(asRecord(protocol?.Data)?.ProtoObj);
          if (data && matches(data.quest_id) && Number(data.result ?? 0) > 0) finish(false);
        });
        const replyTarget = has(access.manager, 'on') && has(access.manager, 'off')
          ? access.manager
          : replyManager;
        if (replyTarget && has(replyTarget, 'on') && has(replyTarget, 'off')) {
          for (const event of accepting ? ['TASK_ACCEPTED'] : ['REWARD_REP', 'TASK_HAS_AWARD']) {
            bind(replyTarget, event, (taskId) => { if (matches(taskId)) finish(true); });
          }
        }
        ensureClaimErrorHook();
        if (claimTask(access, id, task, context) === false) finish(false, false);
        else markQuestOpSent(id);
      } catch (error) {
        console.warn('[自动领取] 任务领取失败:', id, error);
        finish(false);
      }
    });
  }

  async function refreshTaskListFromServer(taskManager: UnknownRecord, owner: string): Promise<void> {
    try {
      const refresh = resolveMethod(taskManager, owner, 'getTaskListFromServer')
        ?? taskManager.GetTaskListFromServer;
      if (typeof refresh === 'function') await Promise.resolve(refresh.call(taskManager));
    } catch {
      // 同步失败时用本地已有任务。
    }
  }

  function findQuestTaskManager(): UnknownRecord | null {
    const classic = manager('TaskManager');
    return locator.findManagerByPredicate((item) => {
      if (item === classic) return false;
      const hasList = typeof (item.getTaskListFromServer ?? item.GetTaskListFromServer) === 'function';
      return hasList && item.allTasks != null;
    });
  }

  function taskSources(): Array<{ manager: UnknownRecord; owner: string }> {
    const sources: Array<{ manager: UnknownRecord; owner: string }> = [];
    const classic = manager('TaskManager');
    if (classic) sources.push({ manager: classic, owner: 'TaskManager' });
    const quest = findQuestTaskManager();
    if (quest) sources.push({ manager: quest, owner: 'QuestTaskManager' });
    return sources;
  }

  function reqTaskProgress(taskManager: UnknownRecord, ids: readonly number[]): void {
    if (!ids.length) return;
    const direct = resolveMethod(taskManager, 'TaskManager', 'reqTaskProgressByIds')
      ?? taskManager.ReqTaskProgressByIds;
    if (typeof direct === 'function') direct.call(taskManager, [...ids]);
  }

  async function claimTasks(): Promise<void> {
    const sources = taskSources();
    const taskManager = sources.find((source) => source.owner === 'TaskManager')?.manager ?? null;
    if (!active() || sources.length === 0) return;
    for (const source of sources) {
      await refreshTaskListFromServer(source.manager, source.owner);
    }
    const options = deps.options();
    if (taskManager && !options.skipTavern) {
      claims.throttled('tavern:sync', () => reqTaskProgress(taskManager, TAVERN_TASK_IDS));
    }
    const progressIds = [
      ...(deps.configData()?.newFuliTaskIds ?? []),
      ...(deps.configData()?.returnUnlockTaskIds ?? [])
    ];
    if (taskManager && progressIds.length) {
      claims.throttled('welfare:sync', () => reqTaskProgress(taskManager, progressIds));
    }
    await delay(progressIds.length ? 1200 : 500);
    if (!active()) return;
    const context = ruleContext();
    for (const source of sources) {
      const access: TaskManagerAccess = {
        manager: source.manager,
        has: (method) => resolveMethod(source.manager, source.owner, method) !== null,
        call: (method, ...args) => invoke(source.manager, source.owner, method, ...args)
      };
      for (const task of collectTasks(access, context).filter((item) => !isTaskExcluded(item, context))) {
        if (!active()) return;
        const id = taskIdOf(task);
        if (id === undefined || id === null) continue;
        const rewards = taskRewards(task);
        if (options.skipDiJiaQuan && rewardsContainDiJiaQuan(rewards, context)) continue;
        if (options.skipHuanLeDou && (rewardsContainHuanLeDou(rewards, context) || taskLikelyGrantsHuanLeDou(task, context))) continue;
        if (await requestTaskClaim(access, id, task, context)) await delay(600);
      }
    }
    const activity = manager('ActivityManager');
    if (taskManager && activity && !options.skipWyqjExperienceCard) {
      await prepareWyqjTrialClaim(taskManager);
      if (active()) claimWyqjTrialCard(activity, taskManager);
    }
  }

  // ---------- 活动 ----------

  function prepareNewJunDianClaims(activity: UnknownRecord): UnknownRecord | null {
    const proxy = manager('ServerProxy');
    if (!patcher || !proxy) return null;
    if (!patcher.isWrapped(activity, 'SendGetNewJDRewardReq') &&
      !patcher.wrap(activity, 'SendGetNewJDRewardReq', (original) => function (this: unknown, ...args: unknown[]) {
        const pending = pendingNewJunDianClaim;
        if (this === activity && !(pending && startingNewJunDianClaim === pending && pending.activity === activity
          && args[0] === pending.id && args[1] === pending.isBp && args[2] === false)) {
          // 手动请求可能与自动请求领取同一档，回包无法区分时保留游戏提示。
          manualNewJunDianUntil.set(activity, Date.now() + NEW_JD_REPLY_TIMEOUT_MS);
          if (pending?.activity === activity) pending.finish(false);
        }
        return original.apply(this, args);
      })) return null;

    if (!patcher.isWrapped(proxy, 'event') &&
      !patcher.wrap(proxy, 'event', (original) => function (this: unknown, ...args: unknown[]) {
        const pending = pendingNewJunDianClaim;
        if (this !== proxy || args[0] !== NEW_JD_AWARD_REPLY_EVENT || pending?.proxy !== proxy
          || !active() || pending.account !== deps.account?.()) return original.apply(this, args);
        const protocol = asRecord(asRecord(args[1])?.Protocol);
        const reply = asRecord(asRecord(protocol?.Data)?.ProtoObj);
        if (!reply || protocol?.Id !== CLIENT_NEW_JD_GET_AWARD_REP || reply.is_all) return original.apply(this, args);

        const result = reply.result ?? 0;
        const sameReward = reply.id === pending.id && Boolean(reply.is_bp) === pending.isBp;
        // 无编号的成功通知也可触发一次刷新，领取结果仍以已领列表为准。
        if (!sameReward && !(reply.id === undefined && result === 0)) return original.apply(this, args);

        const previousError = silentNewJunDianError;
        silentNewJunDianError = sameReward && typeof result === 'number' && result > 0 ? result : null;
        try {
          return original.apply(this, args);
        } finally {
          silentNewJunDianError = previousError;
          pending.finish(result === 0);
        }
      })) return null;

    ensureClaimErrorHook(asRecord(activity.Ged));
    return proxy;
  }

  function requestNewJunDianReward(
    activity: UnknownRecord, proxy: UnknownRecord | null, id: number, isBp: boolean, account: string | undefined
  ): Promise<boolean> {
    const send = () => call(activity, 'SendGetNewJDRewardReq', id, isBp, false);
    if (!proxy) {
      return waitForEvent(activity, eventConstant(activity, 'NEW_JD_REWARD_REP'), send, NEW_JD_REPLY_TIMEOUT_MS);
    }
    return new Promise((resolve, reject) => {
      const pending: PendingNewJunDianClaim = { activity, proxy, account, id, isBp, finish };
      const timer = setTimeout(() => finish(false), NEW_JD_REPLY_TIMEOUT_MS);
      pendingNewJunDianClaim = pending;
      startingNewJunDianClaim = pending;
      function cleanup() {
        clearTimeout(timer);
        if (pendingNewJunDianClaim === pending) pendingNewJunDianClaim = null;
      }
      function finish(success: boolean) {
        cleanup();
        resolve(success);
      }
      try {
        if (send() === false) finish(false);
      } catch (error) {
        cleanup();
        reject(error);
      } finally {
        startingNewJunDianClaim = null;
      }
    });
  }

  async function syncNewJunDian(activity: UnknownRecord): Promise<boolean> {
    if (!has(activity, 'SendGetNewJDInfoReq')) return false;
    const free = activity.NewJDHaveRewardList;
    const paid = activity.NewJDHaveRewardList_bp;
    return waitForEvent(activity, eventConstant(activity, 'NEW_JD_INFO_SUC'),
      () => call(activity, 'SendGetNewJDInfoReq'), 5000,
      () => Array.isArray(activity.NewJDHaveRewardList) && activity.NewJDHaveRewardList !== free
        && (Number(activity.NewJDLevel) === 0 || (
          Array.isArray(activity.NewJDHaveRewardList_bp) && activity.NewJDHaveRewardList_bp !== paid
        )));
  }

  async function claimNewJunDianOnce(activity: UnknownRecord): Promise<boolean> {
    if (!has(activity, 'SendGetNewJDRewardReq')) return false;
    const account = deps.account?.();
    const proxy = prepareNewJunDianClaims(activity);
    if (!await syncNewJunDian(activity) || !activity.HasNewJDRewardRed || account !== deps.account?.()) return false;
    const level = Number(activity.NewJDLevel);
    if (!Number.isInteger(level) || level < 0) return false;
    const hasBattlePass = level >= 1;
    const pending: Array<{ id: number; isBp: boolean }> = [];
    const view = windows.get('NewJunDianViewCtrl', null);
    if (!view) return false;
    try {
      const subView = asRecord(call(view, 'createSubView', 1));
      if (!Array.isArray(subView?.curScoreAwards)) return false;
      for (const award of subView.curScoreAwards as UnknownRecord[]) {
        const id = Number(award.Id);
        if (!Number.isSafeInteger(id) || id <= 0 || !(Number(subView.currentScore) >= Number(award.Point))) continue;
        for (const isBp of [false, true]) {
          if (isBp && !hasBattlePass) continue;
          const itemId = isBp ? award.FfItemId : award.ItemId;
          const claimed = isBp ? activity.NewJDHaveRewardList_bp : activity.NewJDHaveRewardList;
          if (!(Number(itemId) > 0) || !Array.isArray(claimed) || claimed.includes(id)) continue;
          if (blocked([{ itemId }])) continue;
          pending.push({ id, isBp });
        }
      }
    } finally {
      windows.release('NewJunDianViewCtrl');
    }
    let claimedAny = false;
    for (const { id, isBp } of pending) {
      if (!active() || account !== deps.account?.() || pendingNewJunDianClaim
        || (proxy && (manualNewJunDianUntil.get(activity) ?? 0) > Date.now())) break;
      const list = isBp ? 'NewJDHaveRewardList_bp' : 'NewJDHaveRewardList';
      const claimed = activity[list];
      if (!Array.isArray(claimed) || claimed.includes(id) || (isBp && Number(activity.NewJDLevel) < 1)) continue;
      if (!claims.acquire(`activity:newJD:${String(id)}:${String(isBp)}`)) continue;
      try {
        if (!await requestNewJunDianReward(activity, proxy, id, isBp, account)) break;
        if (!active() || account !== deps.account?.() || !await syncNewJunDian(activity)) break;
        const refreshed = activity[list];
        if (account !== deps.account?.() || !Array.isArray(refreshed) || !refreshed.includes(id)) break;
        claimedAny = true;
      } catch (error) {
        console.warn('[自动领取] 节钺令领取失败:', id, isBp, error);
        break;
      }
    }
    return claimedAny;
  }

  function claimNewJunDian(activity: UnknownRecord): Promise<boolean> {
    const running = newJunDianRuns.get(activity);
    if (running) return running;
    const run = claimNewJunDianOnce(activity).finally(() => {
      if (newJunDianRuns.get(activity) === run) newJunDianRuns.delete(activity);
    });
    newJunDianRuns.set(activity, run);
    return run;
  }

  async function prepareWyqjTrialClaim(taskManager: UnknownRecord): Promise<void> {
    await refreshTaskListFromServer(taskManager, 'TaskManager');
    if (!active()) return;
    syncWyqjTrialFromActivity(manager('ActivityManager'));
    refreshWyqjTrialCanGetMarker(taskManager);
    await delay(WYQJ_TRIAL_CARD_AFTER_SYNC_MS);
  }

  function refreshWyqjTrialCanGetMarker(taskManager: UnknownRecord): void {
    const lastExperienceTime = Number(
      taskManager.want_strong_general_experience_time
        ?? taskManager.wantStrongGeneralExperienceTime
        ?? 0
    );
    try {
      taskManager.setWyqjTaskAwardShowRed = lastExperienceTime;
    } catch {
      // 主章节信息未到齐时由后续重试再读红点。
    }
  }

  /** 领取成功后立刻消红点：把 want_strong_general_experience_time 置成今天（秒）再触发红点重算。 */
  function forceClearWyqjRedDot(taskManager: UnknownRecord): void {
    try {
      // 游戏红点 = !IsSameDay(LocalServerTime, want_strong_general_experience_time + TimezoneOffset)。
      // 取服务端本地时间并回退时区偏移，使等式成立、红点消失。
      const timeMgr = locator.findManagerByPredicate((item) => typeof (item as UnknownRecord)?.LocalServerTime === 'number');
      const localServerTime = Number((timeMgr as UnknownRecord | null)?.LocalServerTime ?? Math.floor(Date.now() / 1000));
      const offset = Number((timeMgr as UnknownRecord | null)?.TimezoneStaticOffsetSec ?? 0);
      taskManager.want_strong_general_experience_time = localServerTime - offset;
    } catch {
      try {
        taskManager.want_strong_general_experience_time = Math.floor(Date.now() / 1000);
      } catch {
        // 字段不可写时退回只刷新标记。
      }
    }
    refreshWyqjTrialCanGetMarker(taskManager);
  }

  function taskManagerAllowsWyqjTrialCard(taskManager: UnknownRecord): boolean {
    try {
      const fromGetter = taskManager.getWyqjTaskAwardShowRed;
      if (typeof fromGetter === 'boolean') return fromGetter;
    } catch {
      // 未挂载 getter 时走字段兜底。
    }
    const prototype = locator.classPrototype('TaskManager');
    return Boolean(taskManager.canGetWYQJCard ?? prototype?.canGetWYQJCard);
  }

  function pushWyqjGeneralId(generalId: number, ids: number[], seen: Set<number>): void {
    if (generalId > 0 && !seen.has(generalId)) {
      seen.add(generalId);
      ids.push(generalId);
    }
  }

  function gameHasOwnedGeneral(generalId: number): boolean | null {
    const generalManager = manager('GameGeneralManager');
    if (typeof generalManager?.HasGeneral !== 'function') return null;
    try {
      return Boolean((generalManager.HasGeneral as (id: number) => boolean).call(generalManager, generalId));
    } catch {
      return null;
    }
  }

  /** 强将列表子视图：右上角「武将体验」按钮绑定 onClickTiYanBtn。 */
  function looksLikeWyqjSmallListView(view: UnknownRecord): boolean {
    return typeof view.onClickTiYanBtn === 'function'
      && Array.isArray(view.allDatas)
      && view.tiyanBtn !== undefined;
  }

  function wyqjExperienceButtonReady(view: UnknownRecord): boolean {
    const button = asRecord(view.tiyanBtn);
    if (!button) return false;
    if (button.visible === false) return false;
    if (button.enabled === false) return false;
    return true;
  }

  function looksLikeWyqjBigListView(view: UnknownRecord): boolean {
    return typeof view.getTabInfo === 'function' && view.viewStack !== undefined;
  }

  function collectWyqjTrialIdsLikeGameButton(allDatas: unknown[]): number[] {
    const limit = readWyqjTrialSendLimit();
    const ids: number[] = [];
    const seen = new Set<number>();
    for (let index = 0; index < allDatas.length && ids.length < limit; index += 1) {
      const generalId = Number(asRecord(allDatas[index])?.GeneralId ?? asRecord(allDatas[index])?.generalId ?? 0);
      if (!(generalId > 0) || seen.has(generalId)) continue;
      const owned = gameHasOwnedGeneral(generalId);
      if (owned === true) continue;
      seen.add(generalId);
      ids.push(generalId);
    }
    return ids;
  }

  function inTableGameplay(): boolean {
    return Boolean(locator.gameScene());
  }

  function wyqjTrialClaimStillCurrent(runId: number): boolean {
    return runId === wyqjTrialClaimRunId && active() && !deps.options().skipWyqjExperienceCard;
  }

  function scanWyqjSmallListViews(): UnknownRecord[] {
    const found: UnknownRecord[] = [];
    const seenNode = new Set<unknown>();
    const roots: UnknownRecord[] = [];
    const layaStage = asRecord(
      typeof window !== 'undefined'
        ? (window as { Laya?: { stage?: unknown } }).Laya?.stage
        : null
    );
    if (layaStage) roots.push(layaStage);
    const windowLayer = locator.layer('WindowLayer');
    if (windowLayer && windowLayer !== layaStage) roots.push(windowLayer);
    const pushRoot = (view: UnknownRecord | null | undefined) => {
      if (view && !view.destroyed) roots.push(view);
    };
    pushRoot(windows.opened('TaskWindow'));
    pushRoot(locator.window('TaskWindow'));
    pushRoot(windows.opened('WyqjBigView'));
    for (const view of locator.findWindows('TaskWindow')) pushRoot(view);

    const stack: UnknownRecord[] = [...roots];
    let scanned = 0;
    while (stack.length > 0 && scanned < WYQJ_VIEW_DISPLAY_SCAN_MAX) {
      const node = stack.pop();
      if (!node || node.destroyed || seenNode.has(node)) continue;
      seenNode.add(node);
      scanned += 1;
      if (looksLikeWyqjSmallListView(node) && node.allDatas.length > 0) found.push(node);

      const count = Number(node.numChildren ?? 0);
      const getChildAt = node.getChildAt;
      if (Number.isInteger(count) && typeof getChildAt === 'function') {
        for (let index = 0; index < count; index += 1) {
          const child = asRecord(getChildAt.call(node, index));
          if (child) stack.push(child);
        }
      }
      for (const key of Object.keys(node)) {
        if (key === 'constructor' || key === 'parent' || key === 'scene') continue;
        const value = node[key];
        if (Array.isArray(value)) {
          for (const item of value) {
            const record = asRecord(item);
            if (record && !record.destroyed) stack.push(record);
          }
          continue;
        }
        const nested = asRecord(value);
        if (nested && !nested.destroyed) stack.push(nested);
      }
    }
    return found;
  }

  function pushWyqjGeneralIdsFromList(list: unknown, ids: number[], seen: Set<number>): void {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const record = asRecord(asRecord(item)?.vo) ?? asRecord(item);
      pushWyqjGeneralId(Number(record?.generalId ?? record?.GeneralId ?? 0), ids, seen);
    }
  }

  function scanWyqjViewDisplayTree(view: UnknownRecord, ids: number[], seen: Set<number>): void {
    const stack: UnknownRecord[] = [view];
    let scanned = 0;
    while (stack.length > 0 && scanned < WYQJ_VIEW_CELL_SCAN_MAX) {
      const node = stack.pop();
      if (!node || node.destroyed) continue;
      scanned += 1;
      const vo = asRecord(node.vo);
      if (vo) pushWyqjGeneralId(Number(vo.generalId ?? vo.GeneralID ?? 0), ids, seen);
      const count = Number(node.numChildren ?? 0);
      const getChildAt = node.getChildAt;
      if (!Number.isInteger(count) || typeof getChildAt !== 'function') continue;
      for (let index = 0; index < count; index += 1) {
        const child = asRecord(getChildAt.call(node, index));
        if (child) stack.push(child);
      }
    }
  }

  function locateTaskMainConfig(): UnknownRecord | null {
    const matchesTaskMain = (item: UnknownRecord) => {
      if (item.FileName === TASK_MAIN_CONFIG_FILE_NAME) return true;
      const vos = asRecord(item.StrongGeneralVos);
      if (!vos || typeof vos !== 'object') return false;
      return typeof item.InitTaskData === 'function'
        || typeof item.InitLevelReward === 'function'
        || 'StrongGeneralNum' in item;
    };
    return locator.managerFromList(matchesTaskMain)
      ?? locator.findManagerByPredicate(matchesTaskMain);
  }

  function readStrongGeneralTabEntries(vos: UnknownRecord, tabIndex = 0): unknown[] | null {
    const keys = vos.keys;
    if (Array.isArray(keys) && keys.length > tabIndex) {
      const key = keys[tabIndex];
      const get = vos.get;
      const getNumberKey = vos.getNumberKey;
      let entries: unknown = typeof get === 'function' ? get.call(vos, key) : vos[key as string];
      if (!Array.isArray(entries) && typeof getNumberKey === 'function') {
        entries = getNumberKey.call(vos, key);
      }
      if (Array.isArray(entries) && entries.length > 0) return entries;
    }
    let first: unknown[] | null = null;
    forEachStrongGeneralTab(vos, (entries) => {
      if (!first?.length && entries.length > 0) first = entries;
    });
    return first;
  }

  function forEachStrongGeneralTab(
    vos: UnknownRecord,
    visit: (entries: unknown[]) => void
  ): void {
    const forEach = vos.forEach;
    if (typeof forEach === 'function') {
      try {
        forEach.call(vos, (entries: unknown) => {
          if (Array.isArray(entries)) visit(entries);
        });
        return;
      } catch {
        // 换 keys 遍历。
      }
    }
    const keys = vos.keys;
    if (!Array.isArray(keys)) return;
    const get = vos.get;
    const getNumberKey = vos.getNumberKey;
    for (const key of keys) {
      let entries: unknown = typeof get === 'function' ? get.call(vos, key) : vos[key as string];
      if (!Array.isArray(entries) && typeof getNumberKey === 'function') {
        entries = getNumberKey.call(vos, key);
      }
      if (Array.isArray(entries)) visit(entries);
    }
  }

  function readWyqjTrialSendLimit(): number {
    const config = locateTaskMainConfig();
    const limit = Number(config?.StrongGeneralNum ?? 0);
    if (Number.isFinite(limit) && limit > 0) return limit;
    return WYQJ_TRIAL_CARD_DEFAULT_SEND_LIMIT;
  }

  function isWyqjNodeVisible(view: UnknownRecord): boolean {
    let node: UnknownRecord | null = view;
    while (node) {
      if (node.visible === false) return false;
      node = asRecord(node.parent);
    }
    return view.visible !== false;
  }

  function wyqjSmallViewFromViewStack(stack: UnknownRecord | null): UnknownRecord | null {
    if (!stack) return null;
    const selected = asRecord(stack.selectedChild);
    if (selected && looksLikeWyqjSmallListView(selected) && Array.isArray(selected.allDatas) && selected.allDatas.length) {
      return selected;
    }
    const index = Number(stack.selectedIndex ?? stack.selectedChildIndex ?? -1);
    const dataList = stack.childInitDataList;
    const childList = stack.childList;
    if (
      Number.isInteger(index)
      && index >= 0
      && Array.isArray(dataList)
      && Array.isArray(childList)
      && String(childList[index] ?? '').includes('WyqjSmall')
      && Array.isArray(dataList[index])
      && dataList[index].length > 0
    ) {
      const active = selected;
      if (active && looksLikeWyqjSmallListView(active)) return active;
    }
    return null;
  }

  function resolveWyqjSmallFromTaskWindow(): UnknownRecord | null {
    const task = windows.opened('TaskWindow') ?? locator.window('TaskWindow');
    if (!task || task.destroyed) return null;
    const outerStack = asRecord(task.viewStack);
    let big = asRecord(outerStack?.selectedChild);
    if (!big || !looksLikeWyqjBigListView(big)) {
      const index = Number(outerStack?.selectedIndex ?? -1);
      const childList = outerStack?.childList;
      if (Array.isArray(childList) && index >= 0 && String(childList[index] ?? '').includes('WyqjBig')) {
        big = asRecord(outerStack?.selectedChild);
      }
    }
    if (!big || !looksLikeWyqjBigListView(big)) return null;
    return wyqjSmallViewFromViewStack(asRecord(big.viewStack));
  }

  function readActiveWyqjSmallListView(): UnknownRecord | null {
    const fromTask = resolveWyqjSmallFromTaskWindow();
    if (fromTask) return fromTask;

    // 一次同步调用里显示树不会变，扫一遍复用即可，避免反复全树遍历。
    const scanned = scanWyqjSmallListViews();
    const visible = scanned.filter((view) => {
      if (!Array.isArray(view.allDatas) || !view.allDatas.length) return false;
      return isWyqjNodeVisible(view);
    });
    if (visible.length === 1) return visible[0];
    if (visible.length > 1) {
      for (const view of visible) {
        const button = asRecord(view.tiyanBtn);
        if (button && button.visible !== false) return view;
      }
      return visible[0];
    }

    for (const view of scanned) {
      if (Array.isArray(view.allDatas) && view.allDatas.length) return view;
    }
    return null;
  }

  function readPrimaryWyqjTabAllDatas(): unknown[] | null {
    const active = readActiveWyqjSmallListView();
    if (active && Array.isArray(active.allDatas) && active.allDatas.length) return active.allDatas;

    let bigView: UnknownRecord | null = null;
    try {
      bigView = windows.get('WyqjBigView');
      if (!bigView) {
        console.warn('[自动领取][体验卡] 离屏 WyqjBigView 创建失败');
        return null;
      }
      const getTabInfo = bigView.getTabInfo;
      if (typeof getTabInfo !== 'function') {
        console.warn('[自动领取][体验卡] WyqjBigView 没有 getTabInfo');
        return null;
      }
      try {
        getTabInfo.call(bigView);
      } catch (error) {
        console.warn('[自动领取][体验卡] getTabInfo 抛错:', error);
        return null;
      }
      const stack = asRecord(bigView.viewStack);
      const fromStack = wyqjSmallViewFromViewStack(stack);
      if (fromStack && Array.isArray(fromStack.allDatas) && fromStack.allDatas.length) return fromStack.allDatas;
      const dataList = stack?.childInitDataList;
      const childList = stack?.childList;
      if (Array.isArray(dataList) && Array.isArray(childList)) {
        // 每日体验卡是「WyqjSmallView」标签；getTabInfo 会 ResetSelectedIndex，selectedIndex 可能是 -1，不能依赖。
        const wyqjTabIndex = childList.findIndex((name) => String(name ?? '').includes('WyqjSmall'));
        const tab = dataList[wyqjTabIndex >= 0 ? wyqjTabIndex : 0];
        if (Array.isArray(tab) && tab.length) return tab;
        console.warn('[自动领取][体验卡] childInitDataList 没取到');
      }
      const voDic = asRecord(bigView.voDic);
      if (voDic) {
        const entries = readStrongGeneralTabEntries(voDic, 0);
        if (entries?.length) return entries;
        console.warn('[自动领取][体验卡] voDic 读不到条目');
      }
    } finally {
      windows.release('WyqjBigView');
    }
    const vos = asRecord(locateTaskMainConfig()?.StrongGeneralVos);
    if (vos) return readStrongGeneralTabEntries(vos, 0);
    return null;
  }

  /** 不开任务窗口时，把离屏读到的体验列表塞给离屏 WyqjSmallView，直接调游戏自己的「武将体验」点击逻辑发协议。 */
  async function simulateWyqjTrialClick(): Promise<boolean> {
    // 离屏读配置可能第一次不中就绪，短重试几次。
    let tab: unknown[] | null = null;
    for (let readAttempt = 0; readAttempt < 3 && !tab?.length; readAttempt += 1) {
      tab = readPrimaryWyqjTabAllDatas();
      if (!tab?.length && readAttempt < 2) await delay(600);
    }
    if (!tab?.length) {
      console.warn('[自动领取][体验卡] 模拟点击: 体验列表为空');
      return false;
    }
    const view = windows.get('WyqjSmallView', null);
    if (!view) {
      console.warn('[自动领取][体验卡] 模拟点击: 离屏 WyqjSmallView 创建失败');
      return false;
    }
    if (typeof view.onClickTiYanBtn !== 'function') {
      console.warn('[自动领取][体验卡] 模拟点击: onClickTiYanBtn 不是函数');
      windows.release('WyqjSmallView');
      return false;
    }
    try {
      view.allDatas = tab;
      view.onClickTiYanBtn();
      return true;
    } catch (error) {
      console.warn('[自动领取][体验卡] 模拟点击失败:', error);
      return false;
    } finally {
      windows.release('WyqjSmallView');
    }
  }

  /** 等同手动点强将页右上角「武将体验」，内部会组 general_list 并发协议。 */
  function clickWyqjGeneralExperienceButton(): boolean {
    const view = readActiveWyqjSmallListView();
    if (!view || !wyqjExperienceButtonReady(view)) return false;
    const click = view.onClickTiYanBtn;
    if (typeof click !== 'function') return false;
    try {
      click.call(view);
      return true;
    } catch {
      return false;
    }
  }

  function sendWyqjTrialLikeExperienceButton(activity: UnknownRecord, view: UnknownRecord): boolean {
    const allDatas = view.allDatas;
    if (!Array.isArray(allDatas) || !allDatas.length) return false;
    const generalIds = collectWyqjTrialIdsLikeGameButton(allDatas);
    if (!generalIds.length) return false;
    sendWyqjTrialCardRequest(activity, generalIds);
    return true;
  }

  function pushWyqjGeneralIdsFromView(view: UnknownRecord, ids: number[], seen: Set<number>): void {
    for (const key of ['allDatas', 'nowDatas', 'items', 'itemList', 'list', 'dataList', 'data', 'generalList', 'cells']) {
      pushWyqjGeneralIdsFromList(view[key], ids, seen);
    }
    const viewRecord = asRecord(view.vo) ?? view;
    pushWyqjGeneralId(Number(viewRecord.generalId ?? viewRecord.GeneralID ?? 0), ids, seen);
    scanWyqjViewDisplayTree(view, ids, seen);
  }

  function syncWyqjTrialFromActivity(activity: UnknownRecord | null): void {
    if (!activity) return;
    for (const key of Object.keys(activity)) {
      if (!/wyqj|WYQJ|wantstrong|want_strong/i.test(key) || typeof activity[key] !== 'function') continue;
      const name = key.toLowerCase();
      if (!/(send|req|get|sync|info|data)/i.test(name)) continue;
      try {
        (activity[key] as () => void).call(activity);
      } catch {
        // 同步失败时继续尝试从已有界面读武将。
      }
    }
  }

  function ingestWyqjViewRoots(
    view: UnknownRecord | null | undefined,
    ingest: (candidate: UnknownRecord) => void,
    seen: Set<unknown>
  ): void {
    if (!view || view.destroyed || seen.has(view)) return;
    seen.add(view);
    ingest(view);
    const constructorName = String(asRecord(view.constructor)?.name ?? '');
    const nodeName = String(view.name ?? '');
    if (
      looksLikeWyqjSmallListView(view)
      || looksLikeWyqjBigListView(view)
      || constructorName.includes('Wyqj')
      || nodeName.includes('TaskWindow')
      || constructorName === 'TaskWindow'
    ) {
      for (const key of Object.keys(view)) {
        if (!/wyqj|small|big|item|list|cell|general|viewstack|stack|content|child|panel/i.test(key)) continue;
        const nested = asRecord(view[key]);
        if (nested && !nested.destroyed && typeof nested === 'object') ingest(nested);
      }
    }
  }

  function collectWyqjViewsFromDisplayTree(): UnknownRecord[] {
    const layer = locator.layer('WindowLayer');
    if (!layer) return [];
    const classNames = new Set<string>(WYQJ_TRIAL_VIEW_CLASS_NAMES);
    const found: UnknownRecord[] = [];
    const stack: UnknownRecord[] = [layer];
    let scanned = 0;
    while (stack.length > 0 && scanned < WYQJ_VIEW_DISPLAY_SCAN_MAX) {
      const node = stack.pop();
      if (!node || node.destroyed) continue;
      scanned += 1;
      const constructorName = String(asRecord(node.constructor)?.name ?? '');
      const nodeName = String(node.name ?? '');
      if (
        classNames.has(constructorName)
        || classNames.has(nodeName)
        || looksLikeWyqjSmallListView(node)
        || looksLikeWyqjBigListView(node)
      ) {
        found.push(node);
      }
      const count = Number(node.numChildren ?? 0);
      const getChildAt = node.getChildAt;
      if (!Number.isInteger(count) || typeof getChildAt !== 'function') continue;
      for (let index = 0; index < count; index += 1) {
        const child = asRecord(getChildAt.call(node, index));
        if (child) stack.push(child);
      }
    }
    return found;
  }

  function collectWyqjGeneralIdFromTaskManager(taskManager: UnknownRecord): number[] {
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const key of Object.keys(taskManager)) {
      if (!/wyqj|WYQJ|tiyan|Tiyan|experience.*card/i.test(key)) continue;
      const value = taskManager[key];
      if (typeof value === 'number' || typeof value === 'string') {
        pushWyqjGeneralId(Number(value), ids, seen);
        continue;
      }
      const record = asRecord(value);
      if (!record) continue;
      pushWyqjGeneralId(Number(record.generalId ?? record.GeneralID ?? 0), ids, seen);
    }
    return ids;
  }

  function collectWyqjGeneralIdFromActivity(activity: UnknownRecord): number[] {
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const key of Object.keys(activity)) {
      if (!/wyqj|WYQJ|tiyan|Tiyan/i.test(key)) continue;
      const value = activity[key];
      if (typeof value === 'number' || typeof value === 'string') {
        pushWyqjGeneralId(Number(value), ids, seen);
        continue;
      }
      const record = asRecord(value);
      if (!record) continue;
      pushWyqjGeneralId(Number(record.generalId ?? record.GeneralID ?? 0), ids, seen);
      if (Array.isArray(record.list)) pushWyqjGeneralIdsFromList(record.list, ids, seen);
    }
    return ids;
  }

  async function warmWyqjBigViewTabData(): Promise<void> {
    let bigView: UnknownRecord | null = null;
    try {
      bigView = windows.get('WyqjBigView');
      if (!bigView) return;
      const getTabInfo = bigView.getTabInfo;
      if (typeof getTabInfo === 'function') {
        try {
          getTabInfo.call(bigView);
        } catch {
          // 表未就绪时由重试流程再试。
        }
      }
      await delay(WYQJ_TRIAL_CARD_OPEN_WINDOW_MS);
    } finally {
      windows.release('WyqjBigView');
    }
  }

  function sendWyqjTrialCardRequest(activity: UnknownRecord, generalIds: number[]): void {
    if (!generalIds.length) return;
    const resolved = resolveMethod(activity, 'ActivityManager', 'SendGetWyqjTiyanCardReq');
    if (resolved) {
      resolved.call(activity, generalIds);
      return;
    }
    if (typeof activity.SendGetWyqjTiyanCardReq === 'function') {
      call(activity, 'SendGetWyqjTiyanCardReq', generalIds);
    }
  }

  async function runWyqjTrialClaim(
    activity: UnknownRecord,
    taskManager: UnknownRecord,
    attempt = 0,
    runId = wyqjTrialClaimRunId
  ): Promise<void> {
    if (!wyqjTrialClaimStillCurrent(runId)) return;
    if (inTableGameplay()) return;
    const canSend = resolveMethod(activity, 'ActivityManager', 'SendGetWyqjTiyanCardReq')
      ?? (typeof activity.SendGetWyqjTiyanCardReq === 'function' ? activity.SendGetWyqjTiyanCardReq : null);
    if (!canSend) {
      console.warn('[自动领取] 每日体验卡未触发: 没找到游戏的领取方法');
      return;
    }

    const markerAllowsClaim = taskManagerAllowsWyqjTrialCard(taskManager);
    const taskWindowOpen = Boolean(windows.opened('TaskWindow'));

    if (clickWyqjGeneralExperienceButton()) return;

    const activeView = readActiveWyqjSmallListView();
    if (activeView && wyqjExperienceButtonReady(activeView) && sendWyqjTrialLikeExperienceButton(activity, activeView)) {
      return;
    }

    if (attempt < WYQJ_TRIAL_CARD_RETRY_MAX && taskWindowOpen) {
      await warmWyqjBigViewTabData();
      if (!wyqjTrialClaimStillCurrent(runId) || inTableGameplay()) return;
      if (clickWyqjGeneralExperienceButton()) return;
      const viewAfterWarm = readActiveWyqjSmallListView();
      if (viewAfterWarm && wyqjExperienceButtonReady(viewAfterWarm) && sendWyqjTrialLikeExperienceButton(activity, viewAfterWarm)) {
        return;
      }
    }

    if (!markerAllowsClaim) {
      console.info('[自动领取] 每日体验卡: 游戏记录今天不能领，跳过');
      return;
    }

    // 按游戏自己的逻辑：离屏 WyqjSmallView 调 onClickTiYanBtn（模拟点「武将体验」图标），
    // 游戏内部会按 StrongGeneralNum 限数量，避免直发组错数量被服务端拒「不符合领取条件」。
    if (await simulateWyqjTrialClick()) {
      console.info('[自动领取] 每日体验卡: 已通过模拟点击领取');
      // 领取成功后立刻把红点消掉：置今天的时间戳再触发 setWyqjTaskAwardShowRed 重算。
      forceClearWyqjRedDot(taskManager);
      return;
    }

    // 数据/视图可能还没就绪，短重试。
    if (attempt < WYQJ_TRIAL_CARD_RETRY_MAX) {
      tasks.later(() => {
        void (async () => {
          if (!wyqjTrialClaimStillCurrent(runId) || inTableGameplay()) return;
          const freshActivity = manager('ActivityManager');
          const freshTaskManager = manager('TaskManager');
          if (!freshActivity || !freshTaskManager) return;
          await prepareWyqjTrialClaim(freshTaskManager);
          if (!wyqjTrialClaimStillCurrent(runId) || inTableGameplay()) return;
          await runWyqjTrialClaim(freshActivity, freshTaskManager, attempt + 1, runId);
        })();
      }, WYQJ_TRIAL_CARD_RETRY_DELAY_MS);
      return;
    }

    console.warn('[自动领取] 每日体验卡未触发: 模拟点击没成功', {
      userLevel: typeof window !== 'undefined' ? readUserDataSelf(window as LayaRuntimeWindow)?.UserLevel : undefined
    });
  }

  function claimWyqjTrialCard(
    activity: UnknownRecord,
    taskManager: UnknownRecord
  ): void {
    // 体验卡是「试到成功为止」的领取，靠游戏红点标记（markerAllowsClaim）停发，
    // 不套每日 3 次的硬上限，否则几次重试后就静默不再尝试（表现为「没日志」）。
    claims.throttled('activity:wyqj:trial:sync', () => {
      const runId = ++wyqjTrialClaimRunId;
      void runWyqjTrialClaim(activity, taskManager, 0, runId).catch((error) => {
        console.warn('[自动领取] 每日体验卡失败:', error);
      });
    }, 60_000);
  }

  function claimInviteLogin(activity: UnknownRecord): void {
    if (has(activity, 'SendReqInviteLoginCfg')) claims.throttled('activity:inviteLogin:sync:cfg', () => call(activity, 'SendReqInviteLoginCfg'));
    if (has(activity, 'SendReqInviteLoginInfo')) claims.throttled('activity:inviteLogin:sync:info', () => call(activity, 'SendReqInviteLoginInfo'));
    if (has(activity, 'SendReqInviteLoginAssitRecords')) {
      claims.throttled('activity:inviteLogin:sync:assistRecords', () => call(activity, 'SendReqInviteLoginAssitRecords'));
    }
    let hasRedPoint = false;
    try {
      hasRedPoint = has(activity, 'IsHaveInviteLoginRedPoint')
        ? Boolean(call(activity, 'IsHaveInviteLoginRedPoint'))
        : Boolean(activity.inviteNew_GetCoinnum);
    } catch {
      hasRedPoint = false;
    }
    if (hasRedPoint && has(activity, 'SendReqInviteLoginGetCoin')) {
      claims.throttled('activity:inviteLogin:getCoin', () => call(activity, 'SendReqInviteLoginGetCoin'));
    }
  }

  function huanLeDouInBag(): number | undefined {
    const goodsManager = manager('GameGoodsManager');
    const seen = new Set<unknown>();
    const items: UnknownRecord[] = [];
    for (const key of ['goodsList', 'goodsDict', 'goodsDic', 'GoodsDict', 'goodsMap', 'allGoods']) {
      for (const item of bagEntries(goodsManager?.[key])) {
        if (!seen.has(item)) {
          seen.add(item);
          items.push(item);
        }
      }
    }
    const beans = items.filter((item) => isHuanLeDouItem(goodsBaseId(item)));
    if (!beans.length) return undefined;
    return beans.reduce((sum, item) => {
      const count = Number(item.Count ?? item.count ?? item.Num ?? item.num ?? 0);
      return sum + (Number.isFinite(count) ? count : 0);
    }, 0);
  }

  function claimLowBeanFree(gameData: UnknownRecord | null): void {
    if (deps.options().skipHuanLeDou || !has(gameData, 'SendClientGetWeekFreeBeanReq')) return;
    const beans = huanLeDouInBag();
    const ddz = asRecord(gameData?.ddzData) ?? asRecord(gameData?.DdzData);
    const rawFree = ddz?.FreeBeanCount ?? ddz?.freeBeanCount;
    const freeCount = Number(rawFree);
    if (rawFree === undefined || rawFree === null || rawFree === '' || !Number.isFinite(freeCount)) return;
    if (!(beans !== undefined && beans < LOW_BEAN_THRESHOLD && freeCount > 0)) return;
    claims.throttled('activity:lowBeanFree', () => call(gameData, 'SendClientGetWeekFreeBeanReq'));
  }

  function setOutPassRewards(pass: UnknownRecord): unknown[] {
    const rewards: unknown[] = [];
    const vo = asRecord(pass.vo);
    const configured = Number(vo?.reward ?? vo?.Reward ?? pass.rewardLevels ?? pass.reward ?? 0);
    const levels = Number.isFinite(configured) && configured > 0
      ? configured
      : Math.max(arrayLength(pass.awardsLow), arrayLength(pass.awardsHigh));
    const collect = (level: number, high: boolean) => {
      if (has(pass, 'HasGetReward') && call(pass, 'HasGetReward', level, high)) return;
      const claimed = pass[high ? 'awardsHigh' : 'awardsLow'];
      if (Array.isArray(claimed) && claimed[level]) return;
      const reward = asRecord(call(pass, 'GetRewardVO', level, high));
      const list = [reward?.Awards, reward?.awards, reward?.reward, reward?.rewards].find(Array.isArray);
      if (list) rewards.push(...list);
      else if (reward?.ItemID || reward?.itemId || reward?.goodsId) rewards.push(reward);
    };
    for (let level = 1; level <= levels; level += 1) {
      collect(level, false);
      collect(level, true);
    }
    return rewards;
  }

  function setOutPassId(data: unknown): unknown {
    const record = asRecord(data);
    if (!record) return undefined;
    return asRecord(record.vo)?.id ?? record.passId ?? record.PassID ?? record.PassId ?? record.id ?? record.ID;
  }

  function collectSetOutPasses(fuli: UnknownRecord): Array<{ id: unknown; data: unknown }> {
    const passes = new Map<string, { id: unknown; data: unknown }>();
    for (const key of ['passDataDic', 'PassDataDic', 'passDic', 'PassDic']) {
      for (const data of flattenGameCollection(fuli[key])) {
        const rawId = setOutPassId(data);
        if (rawId === undefined || rawId === null || rawId === '') continue;
        const numeric = Number(rawId);
        const id = Number.isFinite(numeric) && String(rawId).trim() !== '' ? numeric : rawId;
        if (!passes.has(String(id))) passes.set(String(id), { id, data });
      }
    }
    return [...passes.values()];
  }

  function syncSetOutPassData(fuli: UnknownRecord): void {
    for (const method of [
      'SendAllSetOutGidtInfoReq',
      'SendAllSetOutGiftInfoReq',
      'SetOutGidtInfoReq',
      'SendAllTaskInfoReq',
      'SendClientSetOutGiftInfoReq',
      'SendSetOutGiftInfoReq'
    ]) {
      if (typeof fuli[method] === 'function') {
        try {
          fuli[method]();
        } catch {
          // 继续尝试其他同步接口。
        }
      }
    }
  }

  function passHasClaimableReward(pass: UnknownRecord): boolean {
    const checker = pass.HasCanGetReward;
    if (typeof checker === 'function') {
      try {
        return Boolean(checker.call(pass));
      } catch {
        return false;
      }
    }
    return Boolean(checker);
  }

  async function claimNewFuLiSetOut(fuli: UnknownRecord): Promise<void> {
    if (typeof fuli.SendSetOutRewardAllReq !== 'function') return;
    syncSetOutPassData(fuli);
    claims.throttled('newFuLi:setOut:sync:info', () => syncSetOutPassData(fuli));
    if (typeof fuli.SendAllTaskInfoReq === 'function') {
      claims.throttled('newFuLi:setOut:sync:task', () => call(fuli, 'SendAllTaskInfoReq'));
    }
    await delay(1200);
    if (!active()) return;
    for (const { id, data } of collectSetOutPasses(fuli)) {
      const pass = asRecord(call(fuli, 'GetPassData', id)) ?? asRecord(data);
      if (!pass || !passHasClaimableReward(pass)) continue;
      const rewards = setOutPassRewards(pass);
      if (rewards.length && blocked(rewards)) continue;
      const sent = claims.throttled(`newFuLi:setOut:${String(id)}`, () => call(fuli, 'SendSetOutRewardAllReq', id));
      if (sent !== false) await delay(600);
    }
  }

  async function claimNewFuLiWelfare(): Promise<void> {
    const fuli = newFuLiManager();
    if (!active() || !fuli) return;
    await claimNewFuLiSetOut(fuli);
    if (!active()) return;
    await delay(800);
    await claimNewFuLiSetOut(fuli);
  }

  async function claimActivities(): Promise<void> {
    const activity = manager('ActivityManager');
    const taskManager = manager('TaskManager');
    if (!active() || !activity) return;
    call(activity, 'SendDDZTLLInfoReq');
    call(activity, 'SendGetJDInfoReq');
    await claimNewJunDian(activity);
    if (!active()) return;
    claimInviteLogin(activity);
    claimLowBeanFree(manager('ActivityGameDataManager'));
    if (shouldClaimDdztllReward({
      skipHuanLeDou: deps.options().skipHuanLeDou,
      hasRewardRed: Boolean(activity.HasDDZTLLRewardRed),
      rewardInfo: activity.tllLastCanRewardInfo
    }, ruleContext())) {
      claims.throttled('activity:DDZTLL:0', () => call(activity, 'SendDDZTLLAwardReq', 0, false, true));
    }
    if (
      activity.HasJDRewardRed
      && has(activity, 'ReqDrawAllJDRwd')
      && shouldClaimAllJdRechargeRewards(deps.options().skipHuanLeDou, activity.JDShowRewardList, ruleContext())
    ) {
      claims.throttled('activity:JD:all', () => call(activity, 'ReqDrawAllJDRwd'));
    }
    if (taskManager) {
      const calcCount = Math.min(Math.floor(Number(taskManager.jdTaskRewardNum ?? taskManager.JdTaskRewardNum ?? 0) / 3), 3);
      for (let index = 1; index <= calcCount; index += 1) {
        if (!call(taskManager, 'HasRewardQuest', index)) {
          claims.throttled(`task:JDCalcQuest:${index}`, () => call(taskManager, 'SendGetJdCalcQuestRewardReq', index));
        }
      }
    }
    const fuli = newFuLiManager();
    if (fuli) await claimNewFuLiSetOut(fuli);
  }

  // ---------- 邮件 ----------

  async function claimMail(): Promise<void> {
    if (mailRunning || !active() || deps.options().skipMail) return;
    mailRunning = true;
    try {
      const mailManager = await poll(() => manager('MailManager'), 20, 500);
      if (!mailManager) return;
      for (const method of ['GetSystemMailList', 'SendClientGetMailListReq']) {
        if (!has(mailManager, method)) continue;
        try {
          call(mailManager, method);
          await delay(1500);
          break;
        } catch (error) {
          console.warn('[自动领取] 同步邮件列表失败:', error);
        }
      }
      await poll(() => Array.isArray(mailManager.systemMailList), 20, 500);
      const mailList = mailManager.systemMailList;
      if (!Array.isArray(mailList)) return;
      const pending = (mailList as UnknownRecord[]).filter((mail) => mail?.mid && mail.hasAttachMent && !mail.Geted);
      if (!pending.length) return;
      const needsWindow = pending.some((mail) => Number(mail.AttachmentType) === 1);
      const mailWindow = needsWindow ? windows.opened('MailWindow') ?? windows.get('MailWindow') : null;
      if (mailWindow && !windows.opened('MailWindow')) windows.release('MailWindow', 30000);
      const content = asRecord(mailWindow?.mailContentWindow);
      const owner = asRecord(mailWindow?.manager) ?? mailManager;
      const activity = manager('ActivityManager');
      if (has(activity, 'AskRechargeInfoAgain')) call(activity, 'AskRechargeInfoAgain');
      await delay(500);
      for (const mail of pending) {
        if (!active()) return;
        const mailId = mail.mid;
        try {
          if (MAIL_SKIP_TITLES.has(String(mail.title)) || !mail.hasAttachMent) continue;
          if (!mail.read && has(owner, 'ReadMail')) {
            call(owner, 'ReadMail', mailId);
            await delay(300);
          }
          const attachmentType = Number(mail.AttachmentType);
          const keys = call(asRecord(mail.attachment), 'getStringKey', 'key');
          const key = Array.isArray(keys) ? keys[0] ?? '' : '';
          const sender = mail.fromUserName && mail.fromUserName !== MAIL_UNKNOWN_SENDER ? mail.fromUserName : '';
          if (attachmentType === 1) {
            if (!content) continue;
            const tab = sender ? 2 : 0;
            call(content, 'ChangeWindow', tab, mail);
            await delay(300);
            const page = asRecord(asRecord(content.winArr)?.[tab]);
            if (!page || !has(page, 'getBtnClick')) continue;
            call(page, 'getBtnClick');
            call(page, 'Close');
            call(content, 'close');
          } else if (attachmentType === 2 && has(owner, 'SendClientDbsGetgmawardReq')) {
            call(owner, 'SendClientDbsGetgmawardReq', key, mailId, sender);
            await delay(800);
          }
          await delay(500);
        } catch (error) {
          console.warn('[自动领取] 单封邮件领取失败:', mailId, mail?.title, error);
        }
      }
    } finally {
      mailRunning = false;
    }
  }

  // ---------- 福利：砍树、月卡 ----------

  const blessingTreeRuns = new WeakMap<UnknownRecord, Promise<boolean>>();

  function syncWelfare(welfare: UnknownRecord): boolean {
    let synced = false;
    for (const method of MONTH_CARD_SYNC_METHODS) {
      if (!has(welfare, method)) continue;
      try {
        call(welfare, method);
        synced = true;
        break;
      } catch {
        // 尝试下一个同步方法。
      }
    }
    if (has(welfare, 'ReqJbpInfo')) {
      try {
        call(welfare, 'ReqJbpInfo');
        synced = true;
      } catch {
        // 忽略。
      }
    }
    return synced;
  }

  function freeBlessItemEnough(): boolean {
    const bless = manager('BlessManager');
    if (!bless) return false;
    const value = bless.FreeBlessItemEnough;
    if (typeof value === 'function') {
      try {
        return Boolean(value.call(bless));
      } catch {
        return false;
      }
    }
    return Boolean(value);
  }

  function treeItemId(userData: unknown): number {
    const record = asRecord(userData);
    if (!record || Number(record.Status) !== 1) return 0;
    const level = Number(record.Level);
    return Number.isFinite(level) ? level * 100 + TREE_ITEM_BASE : 0;
  }

  function refreshTree(welfare: UnknownRecord): void {
    try {
      call(welfare, 'SaveKanShuPhpData');
    } catch {
      // 忽略。
    }
    try {
      // 游戏的发财树红点带「首次提示」标记，只有这个方法会清掉；它只读写单例，不依赖窗口实例。
      const kanShuProto = locator.classPrototype('KanShuWindow');
      if (typeof kanShuProto?.checkKanShuRed === 'function') kanShuProto.checkKanShuRed();
    } catch {
      // 忽略。
    }
    try {
      call(welfare, 'ReqJbpInfo');
    } catch {
      // 忽略。
    }
  }

  function refreshTreeOnAward(welfare: UnknownRecord): { promise: Promise<boolean>; detach: () => void } | null {
    const eventName = asRecord(welfare.constructor)?.KANSHU_GET_AWARD;
    if (!eventName || !has(welfare, 'once')) return null;
    const caller = {};
    let finish!: (awarded: boolean) => void;
    const promise = new Promise<boolean>((resolve) => { finish = resolve; });
    const handler = () => {
      refreshTree(welfare);
      finish(true);
    };
    call(welfare, 'once', eventName, caller, handler);
    return {
      promise,
      detach: () => {
        call(welfare, 'off', eventName, caller, handler);
        finish(false);
      }
    };
  }

  /** 同一时间只跑一轮砍树；多轮重叠会重复砍树、重复买道具，互相打乱等待结果。 */
  function claimBlessingTree(welfare: UnknownRecord): Promise<boolean> {
    const running = blessingTreeRuns.get(welfare);
    if (running) return running;
    const run = claimBlessingTreeOnce(welfare).finally(() => blessingTreeRuns.delete(welfare));
    blessingTreeRuns.set(welfare, run);
    return run;
  }

  async function claimBlessingTreeOnce(welfare: UnknownRecord): Promise<boolean> {
    const itemId = treeItemId(welfare.JbpUserData);
    if (itemId && claims.claimedToday(`kanshu:${itemId}`)) {
      refreshTree(welfare);
      return false;
    }
    if (!itemId) {
      const status = Number(asRecord(welfare.JbpUserData)?.Status);
      if (status !== 0) {
        if (status === 2) refreshTree(welfare);
        return false;
      }
      // 树还没砍时，即使今天记过「已砍」也重新请求；每天的发送次数由 acquire 限制，服务器拒绝时不会反复弹错。
      if (claims.acquire(TREE_USING_REQUEST_KEY)) {
        if (!has(welfare, 'ReqJbpTreeUsing')) return false;
        try {
          if (call(welfare, 'ReqJbpTreeUsing') === false) return false;
        } catch (error) {
          console.warn('[自动领取] 砍树请求失败:', error);
          return false;
        }
      }
      await poll(() => {
        const found = treeItemId(welfare.JbpUserData);
        if (found) return found;
        call(welfare, 'ReqJbpInfo');
        return treeItemId(welfare.JbpUserData) || false;
      }, 12, 500);
      const statusAfterCut = Number(asRecord(welfare.JbpUserData)?.Status);
      if (statusAfterCut === 1 || statusAfterCut === 2) {
        claims.markClaimedToday(TREE_USING_KEY);
        refreshTree(welfare);
      }
    }
    const waterItemId = treeItemId(welfare.JbpUserData);
    if (!waterItemId || claims.claimedToday(`kanshu:${waterItemId}`)) return false;
    let award: ReturnType<typeof refreshTreeOnAward> = null;
    try {
      const goodsManager = manager('GameGoodsManager');
      const hasItem = () => Boolean(call(goodsManager, 'GetGoodsByBaseID', waterItemId));
      const canCheckItem = has(goodsManager, 'GetGoodsByBaseID');
      const ownsItem = canCheckItem && hasItem();
      if (!ownsItem && freeBlessItemEnough()) {
        const shop = manager('GameShopManager');
        if (!resolveMethod(shop, 'GameShopManager', 'BuySingleItem')) return false;
        const bought = invoke(shop, 'GameShopManager', 'BuySingleItem', waterItemId);
        if (bought === false || (typeof bought === 'number' && bought !== 0)) return false;
        if (canCheckItem) {
          const arrived = await poll(hasItem, 20, 500);
          if (!arrived) {
            console.warn('[自动领取] 浇树道具未到账，稍后重试:', waterItemId);
            return false;
          }
        } else {
          // 部分游戏版本不暴露背包查询方法；购买后仍应发送领奖请求。
          await delay(1000);
        }
      } else if (!ownsItem && canCheckItem) {
        return false;
      }
      if (!has(welfare, 'ReqJbpAwd')) return false;
      award = refreshTreeOnAward(welfare);
      if (call(welfare, 'ReqJbpAwd', waterItemId) === false) {
        award?.detach();
        return false;
      }
      const awarded = award
        ? await Promise.race([award.promise, delay(8000).then(() => false)])
        : Boolean(await poll(() => Number(asRecord(welfare.JbpUserData)?.Status) === 2, 16, 500));
      if (!awarded) {
        award?.detach();
        return false;
      }
      claims.markClaimedToday(`kanshu:${waterItemId}`);
      if (!award) refreshTree(welfare);
      return true;
    } catch (error) {
      award?.detach();
      console.warn('[自动领取] 浇树领取失败:', error);
      return false;
    }
  }

  function goodsType(itemId: number): { typeId: number; period: number } | null {
    const goods = goodsConfig(itemId);
    const base = asRecord(goods?.baseInfo) ?? goods;
    if (!base) return null;
    return { typeId: Number(base.TypeID ?? base.typeId), period: Number(base.period ?? base.Period) };
  }

  function bindNewPrivilege(cardManager: UnknownRecord): void {
    if (newPrivilegeBound.has(cardManager) || !has(cardManager, 'on')) return;
    newPrivilegeBound.add(cardManager);
    const pending = new Map<number, string>();
    newPrivilegePending.set(cardManager, pending);
    const onData = () => {
      if (active()) claimNewPrivilegeCards(cardManager, { skipSync: true });
    };
    const onActivate = () => {
      if (!active()) return;
      claims.throttled(
        'newPrivilege:sync',
        () => call(cardManager, 'SendNewPrivilegeCardDataReq'),
        NEW_PRIVILEGE_SYNC_THROTTLE_MS
      );
    };
    const onReward = (id: unknown) => {
      const cardId = Number(id);
      const day = pending.get(cardId);
      if (day && day === beijingDate(Date.now())) claims.markClaimedToday(`newPrivilege:daily:${cardId}`);
      pending.delete(cardId);
      onActivate();
    };
    call(cardManager, 'on', 'UPDATE_NEW_PRIVILEGE_CARD_DATA', cardManager, onData);
    call(cardManager, 'on', 'UPDATE_NEW_PRIVILEGE_CARD_DAILY_REWARD', cardManager, onReward);
    call(cardManager, 'on', 'UPDATE_NEW_PRIVILEGE_CARD_ACTIVATE', cardManager, onActivate);
  }

  function hasPendingNewPrivilegeClaim(): boolean {
    for (const card of deps.configData()?.newPrivilegeCards ?? []) {
      if ((card.type !== 1 && card.type !== 2) || card.open !== 1) continue;
      if (!claims.claimedToday(`newPrivilege:daily:${card.id}`)) return true;
    }
    return false;
  }

  function scheduleNewPrivilegeRetries(): void {
    if (!active() || newPrivilegeRetryScheduled || !hasPendingNewPrivilegeClaim()) return;
    newPrivilegeRetryScheduled = true;
    const lastDelay = NEW_PRIVILEGE_RETRY_DELAYS[NEW_PRIVILEGE_RETRY_DELAYS.length - 1] ?? 0;
    NEW_PRIVILEGE_RETRY_DELAYS.forEach((wait) => {
      tasks.later(() => {
        if (!active()) return;
        claimNewPrivilegeCards(manager('NewPrivilegeCardManager'));
      }, wait);
    });
    tasks.later(() => {
      newPrivilegeRetryScheduled = false;
    }, lastDelay + 500);
  }

  function claimNewPrivilegeCards(
    cardManager: UnknownRecord | null,
    opts?: { skipSync?: boolean }
  ): void {
    if (!cardManager) return;
    bindNewPrivilege(cardManager);
    if (!opts?.skipSync) {
      claims.throttled(
        'newPrivilege:sync',
        () => call(cardManager, 'SendNewPrivilegeCardDataReq'),
        NEW_PRIVILEGE_SYNC_THROTTLE_MS
      );
    }
    const options = deps.options();
    const pending = newPrivilegePending.get(cardManager);
    for (const card of deps.configData()?.newPrivilegeCards ?? []) {
      try {
        if ((card.type !== 1 && card.type !== 2) || card.open !== 1) continue;
        const claimKey = `newPrivilege:daily:${card.id}`;
        if (claims.claimedToday(claimKey)) continue;
        if (!call(cardManager, 'IsCardActive', card.id) || call(cardManager, 'IsClaimedToday', card.id)) continue;
        if (!card.rewards.length) continue;
        const rewardItems = card.rewards.map((reward) => ({ ItemID: reward.itemId, ItemNum: reward.itemNum }));
        if (rewardsBlocked(rewardItems, { ...options, goodsName })) continue;
        if (options.skipSignTrialCard && card.rewards.some((reward) => rewardLooksLikeGeneral(goodsType(reward.itemId)))) continue;
        claims.throttled(`newPrivilege:${card.id}`, () => {
          pending?.set(card.id, beijingDate(Date.now()));
          const sent = call(cardManager, 'SendNewPrivilegeCardDailyRewardReq', card.id);
          if (sent === false) pending?.delete(card.id);
          return sent;
        }, NEW_PRIVILEGE_CLAIM_THROTTLE_MS);
      } catch (error) {
        console.warn('[自动领取] 新周卡月卡领取失败:', card.id, error);
      }
    }
  }

  function runClaimNewPrivilegeCards(): void {
    if (!active()) return;
    claimNewPrivilegeCards(manager('NewPrivilegeCardManager'));
    scheduleNewPrivilegeRetries();
  }

  function blessNewManager(): UnknownRecord | null {
    return manager('BlessNewManager')
      ?? locator.findManagerByPredicate((item) => typeof item.sendQifuDrawReq === 'function'
        && typeof item.CanFreeBless === 'function'
        && item.infoDic != null);
  }

  function blessRoundIds(infoDic: unknown): number[] {
    const record = asRecord(infoDic);
    const maps = asRecord(record?.Maps) ?? asRecord(record?._maps);
    if (!maps) return [];
    return Object.keys(maps).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  }

  function bindFreeBless(bless: UnknownRecord): void {
    if (freeBlessBound.has(bless) || !has(bless, 'on')) return;
    freeBlessBound.add(bless);
    const refresh = () => {
      if (active()) claimFreeBlessDraws(bless);
    };
    call(bless, 'on', 'BLESS_RECEIVE_CONFIG', bless, refresh);
    call(bless, 'on', 'UPDATA_CUR_QIFU_UI', bless, refresh);
  }

  /** 只在游戏判定本次不扣祈福灯时发单抽。付费抽奖和买灯都不走这里。 */
  function claimFreeBlessDraws(bless: UnknownRecord | null): void {
    if (!bless || deps.options().skipFreeBless) return;
    bindFreeBless(bless);
    claims.throttled('qifu:free:sync', () => call(bless, 'SendClientSecretInfoReqs', 0));
    for (const roundId of blessRoundIds(bless.infoDic)) {
      try {
        if (call(bless, 'IsInDrawTime', roundId) !== true) continue;
        if (call(bless, 'CanFreeBless', roundId) !== true) continue;
        claims.throttled(`qifu:free:${roundId}`, () => {
          if (call(bless, 'CanFreeBless', roundId) !== true) return false;
          return call(bless, 'sendQifuDrawReq', roundId, 1);
        });
      } catch (error) {
        console.warn('[自动领取] 免费祈福失败:', roundId, error);
      }
    }
  }

  function claimMonthCards(welfare: UnknownRecord): void {
    for (const type of MONTH_CARD_TYPES) {
      const card = asRecord(call(welfare, 'GetCardDataByType', type));
      if (!card?.bActive) continue;
      if (card.bReward) {
        claims.throttled(`yueka:reward:${type}:${String(card.rewardDays)}`, () => call(welfare, 'SendClientPrivilegeRewardReq', card.rewardDays, type));
      }
      if (type === 3) {
        tasks.later(() => {
          const list = call(card, 'AddAwardsCanAwardList');
          if (!Array.isArray(list)) return;
          list.forEach((canAward, index) => {
            if (!canAward) return;
            const day = Number(card.days) + index + 1;
            claims.throttled(`yueka:addAward:${type}:${day}`, () => call(welfare, 'SendClientPrivilegeRewardReq', day, type));
          });
        }, 5000);
      }
      if (call(welfare, 'CanShowPrivilegeDaliyReward', type)) {
        claims.throttled(`yueka:daily:${type}`, () => call(welfare, 'PrivilegeCardDaliyRewardReq', type));
      }
    }
  }

  async function claimWelfare(): Promise<void> {
    const welfare = manager('WelfareManger');
    if (!active() || !welfare) return;
    syncWelfare(welfare);
    await delay(800);
    if (!active()) return;
    await claimBlessingTree(welfare);
    if (!active()) return;
    claimMonthCards(welfare);
  }

  // ---------- 公会三敲 ----------

  async function beatGuildDrums(): Promise<void> {
    if (!active()) return;
    const drumWindow = windows.get('GuildDrumWindow');
    if (!drumWindow) return;
    call(drumWindow, 'initDrums');
    call(drumWindow, 'updateItems');
    await delay(1000);
    const items = Array.isArray(drumWindow.itemList) ? drumWindow.itemList as UnknownRecord[] : [];
    const drum = items.find((item) => item?.leftTime);
    let remaining = Math.max(1, Number(drum?.leftTime) || 0);
    const tick = () => {
      if (!active()) {
        windows.release('GuildDrumWindow', 500);
        return;
      }
      call(drum ?? null, 'btnClick');
      remaining -= 1;
      if (remaining <= 0) windows.release('GuildDrumWindow', 500);
      else tasks.later(tick, 300);
    };
    tasks.later(tick, 300);
  }

  // ---------- 签到 ----------

  function claimOldFestivalSigns(activity: UnknownRecord): void {
    const configs = flattenGameCollection(activity.FestivalSignConfigDic);
    const records = flattenGameCollection(activity.FestivalSignDataDic);
    configs.forEach((config, index) => {
      const signId = activityIdOf(config);
      if (signId === undefined || signId === null) return;
      const record = asRecord(records.find((item) => String(activityIdOf(item)) === String(signId)) ?? records[index]);
      if (record?.isActive === false) return;
      const signDays = Number(record?.signDays || 0);
      if (!signDays) return;
      let data = record;
      if (has(activity, 'GetFestivalSignData')) {
        try {
          data = asRecord(call(activity, 'GetFestivalSignData', signId)) ?? record;
        } catch {
          data = record;
        }
      }
      const claimedDays = new Set((Array.isArray(data?.awardData) ? data.awardData : []).map(Number).filter((day) => Number.isFinite(day) && day > 0));
      const awards = asRecord(config)?.awards;
      (Array.isArray(awards) ? awards : []).forEach((award) => {
        const day = Number(asRecord(award)?.days ?? asRecord(award)?.day);
        if (!Number.isFinite(day) || day <= 0 || day > signDays || claimedDays.has(day) || blocked(award)) return;
        claims.throttled(`festivalSign:old:${String(signId)}:${day}`, () => (
          has(activity, 'SendClientFestivalSignGetRewardReq') ? call(activity, 'SendClientFestivalSignGetRewardReq', signId, day) : false
        ));
      });
    });
  }

  function claimNewFestivalSigns(activity: UnknownRecord): void {
    const signs = new Map<string, UnknownRecord>();
    flattenGameCollection(activity.NewFestivalSignDataDic).forEach((item) => {
      const id = activityIdOf(item);
      const record = asRecord(item);
      if (id !== undefined && id !== null && record) signs.set(String(id), record);
    });
    NEW_FESTIVAL_SIGN_IDS.forEach((signId) => {
      const data = asRecord(call(activity, 'GetNewFestivalSignData', signId));
      if (data) signs.set(String(activityIdOf(data) ?? signId), data);
    });
    signs.forEach((sign) => {
      const signId = activityIdOf(sign);
      (Array.isArray(sign.awards) ? sign.awards : []).forEach((award) => {
        const date = asRecord(award)?.date;
        if (!date || !has(activity, 'GetFesSignAwdState') || Number(call(activity, 'GetFesSignAwdState', award)) !== 2) return;
        if (blocked(award)) return;
        claims.throttled(`festivalSign:new:${String(signId)}:${String(date)}`, () => (
          has(activity, 'SendNewClientFestivalSignGetRewardReq') ? call(activity, 'SendNewClientFestivalSignGetRewardReq', signId, date) : false
        ));
      });
    });
  }

  function accumulatedAwardState(
    activity: UnknownRecord,
    signId: unknown,
    award: unknown,
    day: number,
    index: number,
    data: unknown
  ): number | undefined {
    let fallback: number | undefined;
    for (const method of ACCUMULATED_STATE_METHODS) {
      if (!has(activity, method)) continue;
      for (const args of [[signId, award], [signId, day], [award]]) {
        try {
          const state = Number(call(activity, method, ...args));
          if (state === 2) return 2;
          if (Number.isFinite(state) && state > 0 && fallback === undefined) fallback = state;
        } catch {
          // 尝试下一组参数。
        }
      }
    }
    const awardRecord = asRecord(award);
    if (awardRecord?.stat === true || awardRecord?.Stat === true || awardRecord?.claimed === true
      || awardRecord?.Claimed === true || awardRecord?.hasReward === true || awardRecord?.HasReward === true) {
      return 1;
    }
    const dataRecord = asRecord(data);
    const states = [dataRecord?.awardStates, dataRecord?.AwardStates, dataRecord?.awardsState, dataRecord?.rewardStates,
      dataRecord?.states, dataRecord?.awardData, dataRecord?.AwardData].find(Array.isArray) as unknown[] | undefined;
    const rawState = states?.[index];
    const state = Number(rawState);
    if (state === 2) return 2;
    if (Number.isFinite(state) && state > 0) return state;
    if (rawState !== undefined && rawState !== null) return state;
    if (fallback !== undefined) return fallback;
    if (accumulatedProgress(data) >= day && !accumulatedClaimedDays(data).has(day)) return 2;
    if (awardRecord?.CanAward || awardRecord?.canAward || awardRecord?.CanGet || awardRecord?.canGet
      || awardRecord?.CanReceive || awardRecord?.canReceive) {
      return 2;
    }
    return undefined;
  }

  function claimAccumulatedSigns(activity: UnknownRecord): void {
    const dataList = [activity.AccumlateLoginDic, activity.AccumlateSignDataDic, activity.AccumlateLoginDataDic,
      activity.AccumulateLoginDic, activity.AccumulateSignDataDic, activity.AccumulateLoginDataDic,
      activity.AccumSignDataDic, activity.AccumLoginDataDic].flatMap(flattenGameCollection);
    const dataById = new Map<string, unknown>();
    dataList.forEach((item) => {
      const id = activityIdOf(item);
      if (id !== undefined && id !== null) dataById.set(String(id), item);
    });
    const configs = uniqueActivities(activity.AccumlateSignConfigDic, activity.AccumlateLoginConfigDic,
      activity.AccumulateSignConfigDic, activity.AccumulateLoginConfigDic, activity.AccumSignConfigDic,
      activity.AccumLoginConfigDic, ...dataList);
    configs.forEach((config, index) => {
      const signId = activityIdOf(config);
      if (signId === undefined || signId === null) return;
      const data = dataById.get(String(signId)) ?? dataList[index] ?? config;
      const awards = awardListOf(config).length ? awardListOf(config) : awardListOf(data);
      awards.forEach((award, awardIndex) => {
        const day = accumulatedAwardDay(award, awardIndex + 1);
        if (!Number.isFinite(day) || day <= 0) return;
        if (accumulatedAwardState(activity, signId, award, day, awardIndex, data) !== 2 || blocked(award)) return;
        claims.throttled(`accumulatedSign:${String(signId)}:${day}`, () => {
          for (const method of ACCUMULATED_REWARD_METHODS) {
            if (has(activity, method)) return call(activity, method, signId, day, award);
          }
          return false;
        });
      });
    });
  }

  async function claimActivitySigns(activity: UnknownRecord): Promise<void> {
    FESTIVAL_SYNC_METHODS.forEach(([key, method]) => {
      if (has(activity, method)) claims.throttled(key, () => call(activity, method));
    });
    await delay(800);
    if (!active()) return;
    claimOldFestivalSigns(activity);
    claimNewFestivalSigns(activity);
    claimAccumulatedSigns(activity);
  }

  function isDailySignItemAllowed(itemId: unknown, skipTrialCard: boolean): boolean {
    const text = String(itemId ?? '');
    return !skipTrialCard || text === '9020101' || !text.startsWith('90');
  }

  function dailySignItemId(item: UnknownRecord, fallback: number): unknown {
    return asRecord(item.baseData)?.ID ?? asRecord(item.data)?.ID ?? asRecord(item.vo)?.ID ?? item.id ?? fallback;
  }

  function dailySignTotalDay(item: UnknownRecord, fallback: number): unknown {
    const days = Number(item.days ?? asRecord(item.baseData)?.days ?? asRecord(item.data)?.days ?? asRecord(item.vo)?.days);
    return Number.isFinite(days) && days > 0 ? days : dailySignItemId(item, fallback);
  }

  function clickSign(item: UnknownRecord, prefix: string, id: unknown): boolean {
    if (!has(item, 'OnSignClick')) return false;
    return claims.throttled(`${prefix}:${String(id)}`, () => call(item, 'OnSignClick'));
  }

  async function clickDailySign(view: UnknownRecord, skipTrialCard: boolean, checkIn: boolean): Promise<boolean> {
    let checkedIn = false;
    const items = Array.isArray(view.itemList) ? view.itemList as UnknownRecord[] : [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const itemId = dailySignItemId(item, index);
      if (!isDailySignItemAllowed(itemId, skipTrialCard)) continue;
      const type = Number(item.type);
      if (checkIn && type === 1 && Number(view.signState) === 2) {
        if (!clickSign(item, 'sign:checkIn', itemId)) continue;
        checkedIn = true;
        await delay(500);
      } else if ((type === 1 && Number(view.signState) !== 2) || type === 2 || type === 3) {
        if (!clickSign(item, 'sign:itemReward', itemId)) continue;
        await delay(500);
      }
    }
    const totals = Array.isArray(view.totalItemList) ? view.totalItemList as UnknownRecord[] : [];
    for (let index = 0; index < totals.length; index += 1) {
      const item = totals[index];
      const type = Number(item.type);
      if (type !== 2 && type !== 3) continue;
      const success = asRecord(item.success);
      if (success?.visible || success?._visible) continue;
      if (!clickSign(item, 'sign:totalReward', dailySignTotalDay(item, index))) continue;
      await delay(500);
    }
    return checkedIn;
  }

  function buyFreeShopGoods(goodsId: number): unknown {
    const buyWindow = windows.get('NormalShopBuyWindow');
    if (!buyWindow || !has(buyWindow, 'enterWindow') || !has(buyWindow, 'confirmBuy')) {
      windows.release('NormalShopBuyWindow');
      return false;
    }
    call(buyWindow, 'enterWindow', goodsId, 1);
    call(buyWindow, 'confirmBuy');
    windows.release('NormalShopBuyWindow');
    return true;
  }

  async function claimDailySignAndOfficer(skipTrialCard: boolean): Promise<void> {
    await delay(10000);
    if (!active()) return;
    try {
      const view = windows.get('DailySignNewView');
      if (view) {
        windows.release('DailySignNewView', 10000);
        if (await clickDailySign(view, skipTrialCard, true)) {
          await delay(1500);
          await clickDailySign(view, skipTrialCard, false);
        }
      }
      const shop = manager('GameShopManager');
      for (const goodsId of FREE_SHOP_GOODS) {
        const goods = goodsConfig(goodsId);
        if (!shouldBuyFreeShopGood(goodsId)) continue;
        if (goods && has(shop, 'CheckGoodsLimit') && call(shop, 'CheckGoodsLimit', goods) === false) {
          claims.throttled(`shop:free:${goodsId}`, () => buyFreeShopGoods(goodsId));
        }
      }
      const officer = manager('OfficerManager');
      const claimOfficerSalary = shouldClaimOfficerSalaryReward(deps.options().skipHuanLeDou);
      if (claimOfficerSalary && invoke(officer, 'OfficerManager', 'CanGetOfficerWeekReward')) {
        claims.throttled('officer:week', () => invoke(officer, 'OfficerManager', 'sendGetWeekReward'));
      }
      if (claimOfficerSalary && invoke(officer, 'OfficerManager', 'CanGetOfficerDayReward')) {
        claims.throttled('officer:day', () => invoke(officer, 'OfficerManager', 'sendGetDayReward'));
      }
    } catch (error) {
      console.error('[自动领取] 签到失败:', error);
    }
  }

  async function claimSigns(): Promise<void> {
    const activity = manager('ActivityManager');
    if (!active() || !activity) return;
    await claimActivitySigns(activity);
    if (!active()) return;
    void claimDailySignAndOfficer(deps.options().skipSignTrialCard);
    const generalManager = manager('GameGeneralManager');
    if (!generalManager) return;
    for (const method of [
      'ClientGeneralFromRep',
      'SendClientGeneralAtlasReq',
      'ReqGeneralAtlasData',
      'SendGeneralAtlasDataReq'
    ]) {
      if (!has(generalManager, method)) continue;
      try {
        call(generalManager, method);
      } catch {
        // 同步失败时仍尝试用已有图鉴缓存领奖。
      }
      break;
    }
    for (const series of deps.configData()?.seriesList ?? []) {
      if (call(generalManager, 'LampRewardCanAward', series) && !call(generalManager, 'LampHasReward', series)) {
        claims.throttled(`generalLamp:${series}`, () => call(generalManager, 'LampRewardReq', series));
      }
    }
    const atlas = asRecord(asRecord(generalManager.atlasGeneralDict)?._maps) ?? {};
    Object.entries(atlas)
      .filter(([, canAward]) => canAward)
      .map(([id]) => Number(id))
      .forEach((id) => claims.throttled(`generalAtlas:${id}`, () => call(generalManager, 'GeneralAtlasRewardReq', id)));
  }

  /** 皮肤册集齐后书上出红点。总开关开着就领，没有单独开关。 */
  function claimSkinBooks(): Promise<void> {
    const skin = manager('GeneralSkinManager');
    if (!active() || !skin) return Promise.resolve();
    if (has(skin, 'SendClientSkinCollectionReq')) {
      try {
        call(skin, 'SendClientSkinCollectionReq');
      } catch (error) {
        console.warn('[自动领取] 皮肤册同步失败:', error);
      }
    }
    for (const id of listClaimableSkinBookIds(skin)) {
      claims.throttled(`skinBook:${id}`, () => call(skin, 'SendClientSkinCollectionRewardReq', id));
    }
    return Promise.resolve();
  }

  /** 奇珍翻翻乐当天能免费翻时，翻一张没翻开的。花费固定为 0，不重置、不兑换。 */
  function claimFreeTreasureFlip(): Promise<void> {
    if (!active() || deps.options().skipFreeTreasureFlip) return Promise.resolve();
    const activity = manager('ActivityManager');
    if (!activity) return Promise.resolve();
    if (has(activity, 'SendClientTreasureReq')) {
      try {
        call(activity, 'SendClientTreasureReq');
      } catch (error) {
        console.warn('[自动领取] 翻翻乐同步失败:', error);
      }
    }
    if (activity.TreasureNewCardFreeCard !== true) return Promise.resolve();
    const info = asRecord(activity.TreasureInfoVo ?? activity.treasureInfoVo);
    const sessionId = Number(info?.SessionId ?? info?.SeaonId);
    const index = freeTreasureFlipIndex(activity.TreasureCardVos ?? activity.treasureCardVos);
    if (!sessionId || index < 0 || !has(activity, 'SendOpenTreasureCard')) return Promise.resolve();
    claims.throttled(`treasure:free:${sessionId}`, () => {
      if (activity.TreasureNewCardFreeCard !== true) return false;
      return call(activity, 'SendOpenTreasureCard', sessionId, 0, 1, index);
    });
    return Promise.resolve();
  }

  // ---------- 武将包 ----------

  function openDailyGeneralBag(): void {
    if (!active() || deps.options().skipDailyGeneralBag) return;
    const bagWindow = windows.get('GeneralOpenWindow');
    if (!bagWindow) return;
    const text = asRecord(asRecord(asRecord(bagWindow.newView)?.freeTimeTxt))?._text;
    const parts = typeof text === 'string' ? text.split(':').map(Number) : [];
    const waitMs = (parts.reduce((sum, value, index) => sum + value * Math.pow(60, 2 - index), 0) || 0) * 1000;
    if (waitMs) {
      if (!generalBagTimerArmed) {
        generalBagTimerArmed = true;
        tasks.later(() => {
          generalBagTimerArmed = false;
          openDailyGeneralBag();
        }, waitMs);
      }
    } else {
      const opened = claims.throttled(`wujiang:bag:${DAILY_GENERAL_BAG.id}:${DAILY_GENERAL_BAG.type}`, () => (
        call(bagWindow, 'onNewOpenBag', DAILY_GENERAL_BAG.id, DAILY_GENERAL_BAG.type)
      ));
      if (opened) windows.closeOpened('GeneralOpenResultWindow', 8, 500);
    }
    windows.release('GeneralOpenWindow', 5000);
  }

  function runStep(name: string, step: () => Promise<void>): void {
    step().catch((error) => console.warn(`[自动领取] ${name}失败:`, error));
  }

  function runRewardFilterClaims(includeLowBean: boolean): void {
    runStep('任务', claimTasks);
    runStep('活动', claimActivities);
    runStep('邮件', claimMail);
    runStep('福利', claimWelfare);
    if (includeLowBean) {
      LOW_BEAN_RETRY_DELAYS.slice(0, 1).forEach((wait) => {
        tasks.later(() => {
          if (active()) claimLowBeanFree(manager('ActivityGameDataManager'));
        }, wait);
      });
    }
  }

  function runClaimForSkipKey(key: AutoTaskSkipKey): void {
    if (!active()) return;
    switch (key) {
      case 'autoTask.skipTavern':
        runStep('任务', claimTasks);
        return;
      case 'autoTask.skipMail':
        runStep('邮件', claimMail);
        return;
      case 'autoTask.skipDailyGeneralBag':
        try {
          openDailyGeneralBag();
        } catch (error) {
          console.warn('[自动领取] 武将包失败:', error);
        }
        return;
      case 'autoTask.skipFreeBless':
        claimFreeBlessDraws(blessNewManager());
        return;
      case 'autoTask.skipSignTrialCard':
        runStep('签到', claimSigns);
        return;
      case 'autoTask.skipWyqjExperienceCard': {
        void (async () => {
          const activity = manager('ActivityManager');
          const taskManager = manager('TaskManager');
          if (!activity || !taskManager) return;
          await prepareWyqjTrialClaim(taskManager);
          if (active()) claimWyqjTrialCard(activity, taskManager);
        })();
        return;
      }
      case 'autoTask.skipDiJiaQuan':
        runRewardFilterClaims(false);
        return;
      case 'autoTask.skipHuanLeDou':
        runRewardFilterClaims(true);
        return;
      case 'autoTask.skipFreeTreasureFlip':
        runStep('翻翻乐', claimFreeTreasureFlip);
        return;
      default:
        return;
    }
  }

  return {
    runPass() {
      if (!active()) return;
      runClaimNewPrivilegeCards();
      claimFreeBlessDraws(blessNewManager());
      runStep('武将福利', claimNewFuLiWelfare);
      runStep('任务', claimTasks);
      runStep('活动', claimActivities);
      runStep('邮件', claimMail);
      runStep('福利', claimWelfare);
      runStep('公会三敲', beatGuildDrums);
      runStep('签到', claimSigns);
      runStep('皮肤册', claimSkinBooks);
      runStep('翻翻乐', claimFreeTreasureFlip);
    },
    claimDailyGeneralBag() {
      try {
        openDailyGeneralBag();
      } catch (error) {
        console.warn('[自动领取] 武将包失败:', error);
      }
    },
    scheduleLowBeanFree(_reason) {
      if (!active()) return;
      LOW_BEAN_RETRY_DELAYS.forEach((wait) => {
        tasks.later(() => {
          if (active()) claimLowBeanFree(manager('ActivityGameDataManager'));
        }, wait);
      });
    },
    claimNewPrivilegeCards() {
      try {
        runClaimNewPrivilegeCards();
      } catch (error) {
        console.warn('[自动领取] 新周卡月卡失败:', error);
      }
    },
    runClaimForSkipKey(key) {
      runClaimForSkipKey(key);
    }
  };
}

function activityIdOf(item: unknown): unknown {
  const record = asRecord(item);
  return record?.id ?? record?.ID ?? record?.activityId ?? record?.ActivityID ?? record?.activity_id ?? record?.signId ?? record?.SignID;
}

function uniqueActivities(...sources: unknown[]): unknown[] {
  const result = new Map<string, unknown>();
  const add = (item: unknown) => {
    const id = activityIdOf(item);
    if (id !== undefined && id !== null && !result.has(String(id))) result.set(String(id), item);
  };
  sources.forEach((source) => {
    add(source);
    flattenGameCollection(source).forEach(add);
  });
  return [...result.values()];
}

function awardListOf(item: unknown): unknown[] {
  const record = asRecord(item);
  return ([record?.awards, record?.Awards, record?.awardList, record?.AwardList, record?.rewardList,
    record?.RewardList, record?.rewards, record?.Rewards].find(Array.isArray) as unknown[] | undefined) ?? [];
}

/** 从累计奖励对象上取天数，缺字段时用调用方给的序号。 */
function accumulatedAwardDay(award: unknown, fallback: number): number {
  const record = asRecord(award);
  const day = Number(record?.day ?? record?.Day ?? record?.days ?? record?.Days ?? record?.loginDay ?? record?.LoginDay
    ?? record?.loginDays ?? record?.LoginDays ?? record?.logindays ?? record?.needDay ?? record?.needDays
    ?? record?.needLoginDays ?? record?.requiredLoginDays ?? fallback);
  return Number.isFinite(day) ? day : fallback;
}

/** 累计签到已经走到第几天。 */
function accumulatedProgress(data: unknown): number {
  if (typeof data === 'number') return Number.isFinite(data) ? data : 0;
  const record = asRecord(data);
  const value = Number(record?.signDays ?? record?.SignDays ?? record?.loginDays ?? record?.LoginDays ?? record?.logindays
    ?? record?.days ?? record?.Days ?? record?.currentDay ?? record?.CurrentDay ?? record?.progress ?? record?.Progress ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/** 已经领过的累计天数，用来跳过重复领取。 */
function accumulatedClaimedDays(data: unknown): Set<number> {
  const record = asRecord(data);
  const list = ([record?.claimedDays, record?.ClaimedDays, record?.claimedRewardDays, record?.ClaimedRewardDays,
    record?.getRewardDays, record?.GetRewardDays].find(Array.isArray) as unknown[] | undefined) ?? [];
  return new Set(list.map(Number).filter((day) => Number.isFinite(day) && day > 0));
}

/** 背包条目可能是数组，也可能包在 list / objs 里。 */
function bagEntries(value: unknown): UnknownRecord[] {
  const record = asRecord(value);
  if (!value) return [];
  const pick = (list: unknown[]) => list.map(asRecord).filter((item): item is UnknownRecord => item !== null);
  if (Array.isArray(value)) return pick(value);
  if (Array.isArray(record?.datum)) return pick(record.datum);
  if (Array.isArray(record?._objDatum)) return pick(record._objDatum);
  if (asRecord(record?._maps)) return pick(Object.values(record!._maps as UnknownRecord));
  if (asRecord(record?._map)) return pick(Object.values(record!._map as UnknownRecord));
  return [];
}

function goodsBaseId(item: UnknownRecord): unknown {
  const baseInfo = asRecord(item.baseInfo);
  return item.BaseID ?? item.baseID ?? item.baseId ?? item.GoodsBaseID ?? item.goodsBaseID ?? item.goodsBaseId
    ?? baseInfo?.ID ?? baseInfo?.id;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

/** 皮肤册里书上带红点、可以领的收藏编号。 */
export function listClaimableSkinBookIds(skinManager: UnknownRecord | null): number[] {
  const dic = asRecord(skinManager?.qycSkinCollectDic);
  const maps = asRecord(dic?.Maps ?? dic?._maps);
  if (!maps) return [];
  const ids: number[] = [];
  for (const page of Object.values(maps)) {
    if (!Array.isArray(page)) continue;
    for (const item of page) {
      const record = asRecord(item);
      if (!record?.CanReward) continue;
      const id = Number(record.nId);
      if (Number.isFinite(id) && id > 0) ids.push(id);
    }
  }
  return ids;
}

/** 五张牌里第一张还没翻开的位置。没有空位时返回 -1。 */
export function freeTreasureFlipIndex(cards: unknown): number {
  if (!Array.isArray(cards)) return -1;
  for (let index = 0; index < cards.length; index += 1) {
    const card = asRecord(cards[index]);
    if (!Number(card?.Card)) return index;
  }
  return -1;
}

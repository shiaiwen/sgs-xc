/**
 * 自动领取运行时探测：用小抄同一套 locator 看管理器与可领状态。
 */

import type { LayaObjectLocator } from '../../adapters/laya-object-locator.ts';
import type { AutoTaskConfigData } from './auto-task-config-data.ts';
import {
  collectTasks,
  flattenGameCollection,
  isTaskExcluded,
  taskCanAward,
  taskIdOf,
  taskText,
  type TaskManagerAccess,
  type TaskRuleContext
} from './auto-task-rules.ts';

type UnknownRecord = Record<string, unknown>;

export interface AutoTaskProbeSnapshot {
  taskManager: boolean;
  activityManager: boolean;
  newFuLiManager: boolean;
  sendSetOutRewardAll: boolean;
  setOutPassCount: number;
  setOutClaimable: Array<{ id: unknown; claimable: boolean }>;
  configLoaded: boolean;
  configNewFuliTaskCount: number;
  welfareTaskCandidates: Array<{ id: unknown; canAward: boolean; text: string }>;
}

function setOutPassId(data: unknown): unknown {
  const record = data !== null && typeof data === 'object' ? data as UnknownRecord : null;
  if (!record) return undefined;
  const vo = record.vo !== null && typeof record.vo === 'object' ? record.vo as UnknownRecord : null;
  return vo?.id ?? record.passId ?? record.PassID ?? record.id ?? record.ID;
}

function collectSetOutPasses(fuli: UnknownRecord): unknown[] {
  const out: unknown[] = [];
  for (const key of ['passDataDic', 'PassDataDic', 'passDic']) {
    out.push(...flattenGameCollection(fuli[key]));
  }
  return out;
}

function passClaimable(fuli: UnknownRecord, data: unknown): boolean {
  const id = setOutPassId(data);
  const pass = (typeof fuli.GetPassData === 'function' && id != null ? fuli.GetPassData(id) : data) as UnknownRecord | undefined;
  if (!pass) return false;
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

export function mountAutoTaskProbe(
  globalObject: Window,
  run: () => AutoTaskProbeSnapshot
): () => AutoTaskProbeSnapshot {
  const host = globalObject as Window & {
    __XC_PROBE_AUTO_TASK__?: () => AutoTaskProbeSnapshot;
    __xcProbeAutoTask?: () => AutoTaskProbeSnapshot;
  };
  host.__XC_PROBE_AUTO_TASK__ = run;
  host.__xcProbeAutoTask = run;
  try {
    const bridge = (globalObject as unknown as Record<string, unknown>).__XIAOCHAO_ENGINEERING__;
    if (bridge && typeof bridge === 'object') {
      (bridge as Record<string, unknown>).probeAutoTask = run;
    }
  } catch {
    // 桥接对象不可写时仍保留 window 上的探测入口。
  }
  if (globalObject !== globalThis) {
    const g = globalThis as typeof host;
    g.__XC_PROBE_AUTO_TASK__ = run;
    g.__xcProbeAutoTask = run;
  }
  return run;
}

export function probeAutoTaskRuntime(
  locator: LayaObjectLocator,
  configData: AutoTaskConfigData | null,
  ruleContext: TaskRuleContext
): AutoTaskProbeSnapshot {
  const taskManager = locator.manager('TaskManager');
  const activityManager = locator.manager('ActivityManager');
  const newFuLi = locator.manager('NewFuLiManager')
    ?? locator.managerFromList((item) => typeof item.SendSetOutRewardAllReq === 'function');
  const passes = newFuLi ? collectSetOutPasses(newFuLi) : [];
  const welfareTaskCandidates: AutoTaskProbeSnapshot['welfareTaskCandidates'] = [];

  if (taskManager) {
    const access: TaskManagerAccess = {
      manager: taskManager,
      has: (method) => typeof taskManager[method] === 'function',
      call: (method, ...args) => {
        const fn = taskManager[method];
        return typeof fn === 'function' ? fn.apply(taskManager, args) : undefined;
      }
    };
    const context = ruleContext;
    for (const task of collectTasks(access, context)) {
      const record = task as UnknownRecord;
      const text = taskText(record);
      if (!/田丰|谋田丰|重阳|祈福|功勋|武将福利/.test(text)) continue;
      const id = taskIdOf(task);
      welfareTaskCandidates.push({
        id,
        canAward: taskCanAward(record) && !isTaskExcluded(task, context, id),
        text: text.slice(0, 120)
      });
    }
  }

  return {
    taskManager: Boolean(taskManager),
    activityManager: Boolean(activityManager),
    newFuLiManager: Boolean(newFuLi),
    sendSetOutRewardAll: Boolean(newFuLi && typeof newFuLi.SendSetOutRewardAllReq === 'function'),
    setOutPassCount: passes.length,
    setOutClaimable: passes.map((data) => ({
      id: setOutPassId(data),
      claimable: newFuLi ? passClaimable(newFuLi, data) : false
    })),
    configLoaded: Boolean(configData),
    configNewFuliTaskCount: configData?.newFuliTaskIds.size ?? 0,
    welfareTaskCandidates
  };
}

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import {
  ANNIVERSARY_ASSIST_ACT_ID,
  ANNIVERSARY_ASSIST_DAILY_BIND_LIMIT,
  ANNIVERSARY_ASSIST_DAILY_RECEIVE_LIMIT,
  ANNIVERSARY_ASSIST_INVITE_CODE_PATTERN,
  ANNIVERSARY_ASSIST_WINDOW_END_MS,
  ANNIVERSARY_ASSIST_WINDOW_START_MS,
  ANNIVERSARY_BIND_POLL_MS,
  ANNIVERSARY_BIND_WAIT_MS,
} from '../../const/anniversary-assist.ts';
import type { AnniversaryAssistReadyReport } from './anniversary-assist-types.ts';

type UnknownRecord = Record<string, unknown>;

function callManager<T>(manager: UnknownRecord | null, method: string, ...args: unknown[]): T | undefined {
  if (!manager) return undefined;
  const fn = manager[method];
  if (typeof fn !== 'function') return undefined;
  try {
    return fn.call(manager, ...args) as T;
  } catch {
    return undefined;
  }
}

function managerCtor(manager: UnknownRecord): UnknownRecord {
  return (manager.constructor ?? Object) as UnknownRecord;
}

function managerEventName(manager: UnknownRecord, name: string): string {
  const ctor = managerCtor(manager);
  const resolved = ctor[name];
  return typeof resolved === 'string' ? resolved : name;
}

function sleep(ms: number, globalObject: LayaRuntimeWindow): Promise<void> {
  return new Promise((resolve) => globalObject.setTimeout(resolve, ms));
}

async function waitForManagerEvent(
  manager: UnknownRecord,
  eventName: string,
  match: (...args: unknown[]) => unknown | undefined,
  trigger: () => void,
  timeoutMs: number,
  globalObject: LayaRuntimeWindow
): Promise<unknown | undefined> {
  const event = managerEventName(manager, eventName);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await new Promise<unknown | undefined>((resolve) => {
      const onEvent = (...args: unknown[]) => {
        const hit = match(...args);
        if (hit === undefined) return;
        cleanup();
        resolve(hit);
      };
      const cleanup = () => {
        if (typeof manager.off === 'function') manager.off(event, manager, onEvent);
      };
      if (typeof manager.on !== 'function') {
        resolve(undefined);
        return;
      }
      manager.on(event, manager, onEvent);
      try {
        trigger();
      } catch {
        cleanup();
        resolve(undefined);
        return;
      }
      globalObject.setTimeout(() => {
        cleanup();
        resolve(undefined);
      }, Math.max(200, deadline - Date.now()));
    });
    if (result !== undefined) return result;
    await sleep(ANNIVERSARY_BIND_POLL_MS, globalObject);
  }
  return undefined;
}

export function findDailyBindManager(locator: LayaObjectLocator): UnknownRecord | null {
  return locator.findManagerByPredicate((manager) => {
    return typeof manager.GetDailyBindUsed === 'function'
      && typeof manager.GetDailyBoundUsed === 'function'
      && typeof manager.RequestBind === 'function';
  });
}

export function isAnniversaryAssistActivityOpen(
  manager: UnknownRecord | null,
  now = Date.now()
): boolean {
  if (!manager) return false;
  if (now < ANNIVERSARY_ASSIST_WINDOW_START_MS || now > ANNIVERSARY_ASSIST_WINDOW_END_MS) {
    return false;
  }
  const actId = ANNIVERSARY_ASSIST_ACT_ID;
  const config = callManager<UnknownRecord>(manager, 'GetConfig', actId);
  const dailyBindLimit = Number(config?.dailyBindLimit ?? ANNIVERSARY_ASSIST_DAILY_BIND_LIMIT);
  if (dailyBindLimit !== ANNIVERSARY_ASSIST_DAILY_BIND_LIMIT) return false;
  const isOpen = Boolean(callManager<boolean>(manager, 'IsOpen', actId) ?? callManager<boolean>(manager, 'isOpen', actId));
  const inTime = Boolean(callManager<boolean>(manager, 'IsInTime', actId) ?? callManager<boolean>(manager, 'isInTime', actId));
  return isOpen && inTime;
}

export function isModeSceneHall(locator: LayaObjectLocator): boolean {
  const sceneName = String(locator.scene()?.SceneName ?? '');
  return sceneName === 'ModeScene';
}

export async function ensureDailyBindConfigReady(
  manager: UnknownRecord | null,
  globalObject: LayaRuntimeWindow
): Promise<boolean> {
  if (!manager) return false;
  const actId = ANNIVERSARY_ASSIST_ACT_ID;
  if (typeof manager.RequestConfig === 'function') {
    try {
      manager.RequestConfig.call(manager, actId);
    } catch {
      // 部分版本已缓存配置。
    }
  }
  if (typeof manager.IsBatchConfigLoaded === 'function') {
    const loaded = await waitForManagerEvent(
      manager,
      'CONFIG_CHANGE',
      (value) => (value === 0 || value === actId ? true : undefined),
      () => callManager(manager, 'RequestConfig', actId),
      8_000,
      globalObject
    );
    if (!loaded) return Boolean(readDailyBindProgress(manager));
  }
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (readDailyBindProgress(manager)) return true;
    await sleep(ANNIVERSARY_BIND_POLL_MS, globalObject);
  }
  return Boolean(readDailyBindProgress(manager));
}

async function resolveInviteCode(
  manager: UnknownRecord,
  actId: number,
  globalObject: LayaRuntimeWindow
): Promise<string> {
  const direct = String(
    callManager<string>(manager, 'GetCode', actId)
      ?? callManager<string>(manager, 'GetInviteCode', actId)
      ?? ''
  ).trim();
  if (ANNIVERSARY_ASSIST_INVITE_CODE_PATTERN.test(direct)) return direct;
  const fromProgress = String(callManager<UnknownRecord>(manager, 'GetProgress', actId)?.inviteCode ?? '').trim();
  if (ANNIVERSARY_ASSIST_INVITE_CODE_PATTERN.test(fromProgress)) return fromProgress;

  await waitForManagerEvent(
    manager,
    'PROGRESS_CHANGE',
    (value) => {
      if (value !== actId) return undefined;
      const code = String(callManager<string>(manager, 'GetCode', actId) ?? '').trim();
      return ANNIVERSARY_ASSIST_INVITE_CODE_PATTERN.test(code) ? code : undefined;
    },
    () => callManager(manager, 'RequestProgress', actId),
    12_000,
    globalObject
  );
  const late = String(callManager<string>(manager, 'GetCode', actId) ?? '').trim();
  return ANNIVERSARY_ASSIST_INVITE_CODE_PATTERN.test(late) ? late : '';
}

export function readDailyBindProgress(manager: UnknownRecord | null): AnniversaryAssistReadyReport | null {
  if (!manager) return null;
  const actId = ANNIVERSARY_ASSIST_ACT_ID;
  const config = callManager<UnknownRecord>(manager, 'GetConfig', actId);
  const usedBind = callManager<number | null>(manager, 'GetDailyBindUsed', actId);
  const usedBound = callManager<number | null>(manager, 'GetDailyBoundUsed', actId);
  const resetSeconds = Number(callManager<number>(manager, 'GetDailyResetTime', actId) ?? 0);
  const resetAt = resetSeconds > 0 ? resetSeconds * 1000 : 0;
  if (usedBind === null || usedBound === null || resetAt <= Date.now()) return null;
  if (!config) return null;
  const bindLimit = Number(config.dailyBindLimit ?? ANNIVERSARY_ASSIST_DAILY_BIND_LIMIT);
  const receiveLimit = Number(config.dailyReceiveLimit ?? ANNIVERSARY_ASSIST_DAILY_RECEIVE_LIMIT);
  const code = String(callManager<string>(manager, 'GetCode', actId) ?? '').trim();
  if (!ANNIVERSARY_ASSIST_INVITE_CODE_PATTERN.test(code)) return null;
  const busy = Boolean(callManager<boolean>(manager, 'IsBusy', actId));
  return {
    code,
    resetAt,
    used: usedBind,
    canBind: usedBind < bindLimit && !busy,
    canReceive: usedBound < receiveLimit,
  };
}

export async function ensureDailyBindReadyReport(
  manager: UnknownRecord | null,
  globalObject: LayaRuntimeWindow
): Promise<AnniversaryAssistReadyReport | null> {
  if (!manager) return null;
  await ensureDailyBindConfigReady(manager, globalObject);
  const direct = readDailyBindProgress(manager);
  if (direct) return direct;
  const actId = ANNIVERSARY_ASSIST_ACT_ID;
  const code = await resolveInviteCode(manager, actId, globalObject);
  if (!ANNIVERSARY_ASSIST_INVITE_CODE_PATTERN.test(code)) return null;
  return readDailyBindProgress(manager);
}

export async function requestDailyBind(
  manager: UnknownRecord | null,
  globalObject: LayaRuntimeWindow,
  inviteCode: string
): Promise<number | null> {
  if (!manager || !ANNIVERSARY_ASSIST_INVITE_CODE_PATTERN.test(inviteCode)) return null;
  const actId = ANNIVERSARY_ASSIST_ACT_ID;
  if (Boolean(callManager<boolean>(manager, 'IsBusy', actId))) return null;
  const result = await waitForManagerEvent(
    manager,
    'BIND_RESULT',
    (valueActId, valueResult) => (valueActId === actId ? valueResult : undefined),
    () => callManager(manager, 'RequestBind', actId, inviteCode),
    ANNIVERSARY_BIND_WAIT_MS,
    globalObject
  );
  if (typeof result === 'number') return result;
  return null;
}
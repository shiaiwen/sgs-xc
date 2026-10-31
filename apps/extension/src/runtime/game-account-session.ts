/**
 * 判断三国杀账号是否已登录，供启动与面板挂载使用。
 */

import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../adapters/laya-object-locator.ts';

type UnknownRecord = Record<string, unknown>;

export interface ReadUserDataSelfOptions {
  /** 登录过程中不要弹生日窗探测账号，否则会打断进大厅。 */
  allowBirthdayWishProbe?: boolean;
}

export function isValidGameAccountId(value: unknown): boolean {
  if (value == null) return false;
  const text = String(value).trim();
  return text.length > 0 && text !== '0';
}

function readUserDataClassSelf(globalObject: LayaRuntimeWindow): UnknownRecord | null {
  const classUtils = globalObject.Laya?.ClassUtils as {
    getClass?: (name: string) => { Self?: unknown };
  } | undefined;
  if (!classUtils) return null;
  const direct = asRecord(classUtils.getClass?.('UserData')?.Self);
  if (direct?.clientId || direct?.ClientId || direct?.ClientID) return direct;
  return null;
}

/**
 * UserData 不在管理器事件表里时，可选通过生日窗 refreshIcon 读 Self。
 * 默认关闭，登录阶段禁止走这条路径。
 */
export function readUserDataSelf(
  globalObject: LayaRuntimeWindow,
  options: ReadUserDataSelfOptions = {}
): UnknownRecord | null {
  const direct = readUserDataClassSelf(globalObject);
  if (direct) return direct;
  if (!options.allowBirthdayWishProbe) return null;
  const classUtils = globalObject.Laya?.ClassUtils as {
    getInstance?: (name: string, args?: unknown) => UnknownRecord | null;
  } | undefined;
  if (!classUtils) return null;
  let wish: UnknownRecord | null = null;
  try {
    wish = asRecord(classUtils.getInstance?.('BirthdayWishWin', null));
    if (typeof wish?.refreshIcon === 'function') (wish.refreshIcon as () => void).call(wish);
  } catch {
    wish = null;
  }
  const userData = asRecord(wish?.userData);
  const ctor = userData ? asRecord(Object.getPrototypeOf(userData)?.constructor) : null;
  const self = asRecord(ctor?.Self) ?? userData;
  if (wish && !wish.parent) {
    try {
      if (typeof wish.Close === 'function') (wish.Close as () => void).call(wish);
      else if (typeof wish.destroy === 'function') (wish.destroy as (all?: boolean) => void).call(wish, true);
    } catch {
      // 临时窗口关掉失败不影响读取账号。
    }
  }
  return self;
}

export function resolveGameAccountId(
  globalObject: LayaRuntimeWindow,
  locator?: LayaObjectLocator,
  userDataSelf: UnknownRecord | null = null,
  options: ReadUserDataSelfOptions = {}
): string {
  const resolvedLocator = locator ?? createLayaObjectLocator(globalObject);
  const manager = resolvedLocator.manager('UserInfoManger');
  const managerSelf = asRecord(manager?.Self) ?? asRecord(manager?.self);
  const fromManager = managerSelf?.clientId
    ?? managerSelf?.ClientId
    ?? managerSelf?.ClientID
    ?? manager?.clientId
    ?? manager?.ClientId
    ?? manager?.userID
    ?? manager?.UserID;
  if (isValidGameAccountId(fromManager)) return String(fromManager).trim();

  const self = userDataSelf ?? readUserDataSelf(globalObject, options);
  const value = self?.clientId ?? self?.ClientId ?? self?.ClientID;
  return isValidGameAccountId(value) ? String(value).trim() : '';
}

export function isGameAccountLoggedIn(globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow): boolean {
  return resolveGameAccountId(globalObject).length > 0;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

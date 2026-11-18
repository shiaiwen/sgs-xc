/**
 * 判断三国杀账号是否已登录，读游戏用户编号和这个号的登录账号。
 */

import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../adapters/laya-object-locator.ts';
import { LOGIN_ACCOUNT_RETRY_MS } from '../const/account-sync.ts';
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

function hasAccountId(record: UnknownRecord | null): boolean {
  return isValidGameAccountId(record?.clientId ?? record?.ClientId ?? record?.ClientID);
}

let cachedUserDataClass: UnknownRecord | null = null;

/**
 * 账号数据类不再注册到类表后，从开窗事件的监听者身上找：大厅组件会把自己的账号数据挂在字段上，
 * 这份数据的类上有静态 Self。
 */
function readUserDataSelfFromListeners(globalObject: LayaRuntimeWindow): UnknownRecord | null {
  // 换号登录后类上的 Self 会换成新账号，所以只缓存类，每次重新读 Self。
  if (cachedUserDataClass) {
    try {
      const cached = asRecord(cachedUserDataClass.Self);
      if (hasAccountId(cached)) return cached;
    } catch {
      // 读不到就重新找。
    }
  }
  const events = asRecord(createLayaObjectLocator(globalObject).dispatcher()?._events);
  if (!events) return null;
  const seen = new Set<UnknownRecord>();
  for (const bucket of Object.values(events)) {
    for (const listener of Array.isArray(bucket) ? bucket : [bucket]) {
      const caller = asRecord(asRecord(listener)?.caller);
      if (!caller || seen.has(caller)) continue;
      seen.add(caller);
      for (const key of Object.keys(caller)) {
        let field: UnknownRecord | null = null;
        try {
          field = asRecord(caller[key]);
        } catch {
          continue;
        }
        if (!field || typeof field !== 'object') continue;
        const ctor = asRecord(field.constructor);
        if (!ctor || !Object.prototype.hasOwnProperty.call(ctor, 'Self')) continue;
        let self: UnknownRecord | null = null;
        try {
          self = asRecord(ctor.Self);
        } catch {
          continue;
        }
        // 别的单例类也可能带静态 Self，要同时有账号编号和昵称才算账号数据。
        if (hasAccountId(self) && self && ('Nickname' in self || 'nickname' in self)) {
          cachedUserDataClass = ctor;
          return self;
        }
      }
    }
  }
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
  const fromListeners = readUserDataSelfFromListeners(globalObject);
  if (fromListeners) return fromListeners;
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

function readGameUserId(
  globalObject: LayaRuntimeWindow,
  locator: LayaObjectLocator,
  userDataSelf: UnknownRecord | null,
  options: ReadUserDataSelfOptions
): string {
  const manager = locator.manager('UserInfoManger');
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

/** 每个游戏用户编号登录时用的账号。换过的号都留着，换号前没传完的改动还能传给原来那个号。 */
const loginAccountByUserId = new Map<string, string>();
let pairedUserId = '';
let nextPairAttemptAt = 0;

/**
 * 登录成功时游戏写下登录账号和用户编号，之后在线期间登录账号不会变。
 * 换号要先下线，再点登录时登录账号马上换成新输入的，编号要等登录成功才换。
 * 所以只在在线时读，配上之后同一个编号不再重读，等编号换了再读。
 */
function pairLoginAccount(userId: string, locator: LayaObjectLocator): void {
  if (userId === pairedUserId || Date.now() < nextPairAttemptAt) return;
  nextPairAttemptAt = Date.now() + LOGIN_ACCOUNT_RETRY_MS;
  try {
    const manager = locator.manager('LoginManager');
    if (!manager || manager.IsOnLine === false) return;
    const name = manager.loginUserName ?? manager.LoginUserName;
    // 游戏登录时自己也把输入的账号转成小写，大小写不同的是同一个号。
    const loginAccount = typeof name === 'string' ? name.trim().toLowerCase() : '';
    if (!loginAccount) return;
    pairedUserId = userId;
    loginAccountByUserId.set(userId, loginAccount);
  } catch {
    // 读不到登录账号时这个号先按用户编号和服务器往来，读用户编号不受影响。
  }
}

/** 这个游戏用户编号登录时用的账号。游戏里没找到时返回空。 */
export function gameLoginAccountOf(userId: string): string {
  return loginAccountByUserId.get(userId) ?? '';
}

export function resolveGameAccountId(
  globalObject: LayaRuntimeWindow,
  locator?: LayaObjectLocator,
  userDataSelf: UnknownRecord | null = null,
  options: ReadUserDataSelfOptions = {}
): string {
  const resolvedLocator = locator ?? createLayaObjectLocator(globalObject);
  const userId = readGameUserId(globalObject, resolvedLocator, userDataSelf, options);
  if (userId) pairLoginAccount(userId, resolvedLocator);
  return userId;
}

export function isGameAccountLoggedIn(globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow): boolean {
  return resolveGameAccountId(globalObject).length > 0;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

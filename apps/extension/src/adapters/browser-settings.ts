/**
 * 页面设置读写。微端有本机共享存储时优先用它，网页存储被清掉后还能读回来。
 *
 * 桶选择：有 window.xiaochaoStorage（preload 注入）就走跨窗口共享；
 * 否则退回本页 localStorage。每个 key 首次读写时 registerKeys，
 * 让主进程把本页旧值与共享权威值合并。
 */

type SettingBucket = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  registerKeys?(keys: string[]): unknown;
};

/** 已向共享存储登记过的 key，避免每次读写都重复 registerKeys。 */
const registered = new Set<string>();

/** preload 暴露的跨窗口共享存储；油猴环境为 null。 */
function sharedBucket(): SettingBucket | null {
  const shared = (globalThis as { xiaochaoStorage?: SettingBucket }).xiaochaoStorage;
  return shared && typeof shared.getItem === 'function' ? shared : null;
}

/** 本页 localStorage；隐私模式或禁用存储时可能抛错。 */
function pageBucket(): SettingBucket | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * 选定读写桶。共享可用时始终返回共享桶（首次顺带登记 key）；
 * 登记失败也不退回页面桶——后续 get/set 仍走共享 API，由其内部降级。
 */
function bucketFor(key: string): SettingBucket | null {
  const shared = sharedBucket();
  if (!shared) return pageBucket();
  if (!registered.has(key)) {
    registered.add(key);
    try {
      shared.registerKeys?.([key]);
    } catch {
      // 本机存储暂时不可用时仍写页面存储。
    }
  }
  return shared;
}

/** 读设置；桶不可用或抛错时返回 null。 */
export function readBrowserSetting(key: string): string | null {
  try {
    return bucketFor(key)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** 写设置；失败静默忽略，避免设置面板因存储异常崩掉。 */
export function writeBrowserSetting(key: string, value: string): void {
  try {
    bucketFor(key)?.setItem(key, value);
  } catch {
    // 存储不可用时放弃本次保存。
  }
}

/** 删设置；失败静默忽略。 */
export function removeBrowserSetting(key: string): void {
  try {
    bucketFor(key)?.removeItem(key);
  } catch {
    // 存储不可用时忽略。
  }
}

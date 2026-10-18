/**
 * 页面设置读写。微端有本机共享存储时优先用它，网页存储被清掉后还能读回来。
 */

type SettingBucket = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  registerKeys?(keys: string[]): unknown;
};

const registered = new Set<string>();

function sharedBucket(): SettingBucket | null {
  const shared = (globalThis as { xiaochaoStorage?: SettingBucket }).xiaochaoStorage;
  return shared && typeof shared.getItem === 'function' ? shared : null;
}

function pageBucket(): SettingBucket | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

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

export function readBrowserSetting(key: string): string | null {
  try {
    return bucketFor(key)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeBrowserSetting(key: string, value: string): void {
  try {
    bucketFor(key)?.setItem(key, value);
  } catch {
    // 存储不可用时放弃本次保存。
  }
}

export function removeBrowserSetting(key: string): void {
  try {
    bucketFor(key)?.removeItem(key);
  } catch {
    // 存储不可用时忽略。
  }
}

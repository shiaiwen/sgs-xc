/**
 * 清除本页小抄全部本地数据：配置、皮肤元数据、自定义背景、凭证与会话缓存。
 * 微端与油猴共用；微端会同步删除 shared.json 里已登记的配置键。
 */

import { removeBrowserSetting } from '../adapters/browser-settings.ts';
import { CHOOSE_FIGURE_LOCK_KEY_BASE } from '../const/choose-figure-lock.ts';
import { KNOWN_HAND_STORAGE_KEY_BASE } from '../const/known-hands.ts';
import { CONFIG_SCHEMA, type XiaochaoConfigKey } from '../config/config-schema.ts';
import type { XiaochaoConfigStore } from '../config/config-store.ts';
import {
  LEGACY_FAVORITES_SUFFIX,
  LEGACY_OFFICIAL_CHOICE_SUFFIX,
  LEGACY_PAPER_RESOURCE_SUFFIX
} from '../features/skin-background/skin-background-document.ts';
import { clearAllCustomBackgroundPersistence } from '../features/skin-background/custom-background-store.ts';

const CREDENTIAL_KEYS = [
  'sgsol.rememberedCredentials.v2',
  'sgsol.rememberedCredentials.v2.4399'
] as const;

const LEGACY_CONFIG_KEYS = new Set<string>(
  (Object.keys(CONFIG_SCHEMA) as XiaochaoConfigKey[])
    .map((key) => CONFIG_SCHEMA[key].previousStorageKey)
    .filter((key): key is string => Boolean(key))
);

/** 判断是否为小抄写入 localStorage 的键。 */
export function isXiaochaoLocalStorageKey(key: string): boolean {
  if (!key) return false;
  if (key.startsWith('XC::') || key.startsWith('sgsol.') || key.startsWith('XC_')) return true;
  if (key.includes('::XC::')) return true;
  if (LEGACY_CONFIG_KEYS.has(key)) return true;
  if (key.endsWith(LEGACY_PAPER_RESOURCE_SUFFIX)) return true;
  if (key.endsWith(LEGACY_FAVORITES_SUFFIX)) return true;
  if (key.endsWith(LEGACY_OFFICIAL_CHOICE_SUFFIX)) return true;
  if (key.endsWith('::XC_GAME_GIFT_CODE_ATTEMPTS')) return true;
  if (key.endsWith('::XC_DAILY_AUTO_CLAIM_RECORD')) return true;
  return false;
}

export function isXiaochaoSessionStorageKey(key: string): boolean {
  if (!key) return false;
  const lower = key.toLowerCase();
  if (key.startsWith('XC') || lower.includes('xiaochao')) return true;
  if (key.startsWith(KNOWN_HAND_STORAGE_KEY_BASE)) return true;
  if (key.startsWith(CHOOSE_FIGURE_LOCK_KEY_BASE)) return true;
  return false;
}

function pageLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function pageSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function removePersistedKey(key: string): void {
  removeBrowserSetting(key);
  try {
    pageLocalStorage()?.removeItem(key);
  } catch {
    // 页面存储删不掉时忽略。
  }
}

/** 收集本页 localStorage 里所有小抄相关键。 */
export function collectXiaochaoLocalStorageKeys(storage: Storage | null = pageLocalStorage()): string[] {
  if (!storage) return [];
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isXiaochaoLocalStorageKey(key)) keys.push(key);
  }
  return keys;
}

function clearSessionXiaochaoKeys(): void {
  const session = pageSessionStorage();
  if (!session) return;
  const keys = Object.keys(session).filter(isXiaochaoSessionStorageKey);
  for (const key of keys) session.removeItem(key);
}

function clearCredentials(): void {
  const shared = (globalThis as {
    xiaochaoStorage?: { saveCredentials?: (scope: 'official' | '4399', credentials: unknown[]) => unknown };
  }).xiaochaoStorage;
  for (const key of CREDENTIAL_KEYS) {
    removePersistedKey(key);
    const scope = key.endsWith('.4399') ? '4399' : 'official';
    try {
      shared?.saveCredentials?.(scope, []);
    } catch {
      // 忽略。
    }
  }
}

/** 清除小抄本地数据并重置配置为默认值。 */
export async function resetXiaochaoUserData(configStore: XiaochaoConfigStore): Promise<void> {
  const keys = collectXiaochaoLocalStorageKeys();
  const shared = (globalThis as { xiaochaoStorage?: { registerKeys?: (keys: string[]) => unknown } }).xiaochaoStorage;
  try {
    shared?.registerKeys?.(keys);
  } catch {
    // 微端共享存储不可用时仍清页面 localStorage。
  }
  for (const key of keys) removePersistedKey(key);
  clearCredentials();
  clearSessionXiaochaoKeys();
  await clearAllCustomBackgroundPersistence();
  configStore.resetAll();
}

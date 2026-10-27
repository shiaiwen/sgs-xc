/**
 * 更新提示的「稍后 / 已打开更新页」按本机一份存，不按游戏账号分。
 */

import { readBrowserSetting, writeBrowserSetting } from '../../adapters/browser-settings.ts';
import { CONFIG_STORAGE_KEY } from '../../config/config-schema.ts';
import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import { compareVersions, newerVersion } from './update-manifest.ts';

const UPDATE_DEVICE_STATE_KEY = 'XC::update-device-state';

export interface UpdateDeviceState {
  dismissedVersion: string;
  installedVersion: string;
  /** 已对某远程版本触发过油猴自动安装页，避免重复开 tab。 */
  lastAutoUpdateVersion: string;
}

function emptyState(): UpdateDeviceState {
  return { dismissedVersion: '', installedVersion: '', lastAutoUpdateVersion: '' };
}

export function readUpdateDeviceState(): UpdateDeviceState {
  try {
    const raw = readBrowserSetting(UPDATE_DEVICE_STATE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<UpdateDeviceState>;
    return {
      dismissedVersion: typeof parsed.dismissedVersion === 'string' ? parsed.dismissedVersion : '',
      installedVersion: typeof parsed.installedVersion === 'string' ? parsed.installedVersion : '',
      lastAutoUpdateVersion: typeof parsed.lastAutoUpdateVersion === 'string'
        ? parsed.lastAutoUpdateVersion
        : ''
    };
  } catch {
    return emptyState();
  }
}

export function writeUpdateDeviceState(patch: Partial<UpdateDeviceState>): UpdateDeviceState {
  const current = readUpdateDeviceState();
  const next: UpdateDeviceState = {
    dismissedVersion: patch.dismissedVersion ?? current.dismissedVersion,
    installedVersion: patch.installedVersion ?? current.installedVersion,
    lastAutoUpdateVersion: patch.lastAutoUpdateVersion ?? current.lastAutoUpdateVersion
  };
  writeBrowserSetting(UPDATE_DEVICE_STATE_KEY, JSON.stringify(next));
  return next;
}

function mergeLegacyState(target: UpdateDeviceState, dismissed: unknown, installed: unknown): void {
  if (typeof dismissed === 'string' && dismissed.trim()) {
    target.dismissedVersion = newerVersion(target.dismissedVersion, dismissed.trim());
  }
  if (typeof installed === 'string' && installed.trim()) {
    target.installedVersion = newerVersion(target.installedVersion, installed.trim());
  }
}

function readLegacyFromConfigDocument(raw: string | null): Partial<UpdateDeviceState> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { values?: Record<string, unknown> };
    const values = parsed?.values;
    if (!values || typeof values !== 'object') return {};
    return {
      dismissedVersion: typeof values['update.dismissedVersion'] === 'string'
        ? values['update.dismissedVersion']
        : '',
      installedVersion: typeof values['update.installedVersion'] === 'string'
        ? values['update.installedVersion']
        : ''
    };
  } catch {
    return {};
  }
}

/** 从旧版「按账号配置」里合并更新记录到本机键，只跑一次。 */
export function migrateUpdateDeviceStateFromLegacy(configStore: XiaochaoConfigStore): void {
  const merged = readUpdateDeviceState();
  if (merged.dismissedVersion || merged.installedVersion) return;

  const snapshot = configStore.snapshot() as Record<string, unknown>;
  mergeLegacyState(merged, snapshot['update.dismissedVersion'], snapshot['update.installedVersion']);

  try {
    const storage = typeof localStorage === 'undefined' ? null : localStorage;
    if (storage) {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key) continue;
        if (key === CONFIG_STORAGE_KEY || key.startsWith(`${CONFIG_STORAGE_KEY}::`)) keys.push(key);
      }
      for (const key of keys) {
        const legacy = readLegacyFromConfigDocument(storage.getItem(key));
        mergeLegacyState(merged, legacy.dismissedVersion, legacy.installedVersion);
      }
    }
  } catch {
    // 页面存储不可用时只保留当前配置快照里的迁移结果。
  }

  const legacyGlobal = readLegacyFromConfigDocument(readBrowserSetting(CONFIG_STORAGE_KEY));
  mergeLegacyState(merged, legacyGlobal.dismissedVersion, legacyGlobal.installedVersion);

  if (!merged.dismissedVersion && !merged.installedVersion) return;
  writeUpdateDeviceState(merged);
}

export function rememberDismissedVersion(version: string): void {
  const next = String(version || '').trim();
  if (!/^\d+(?:\.\d+)*$/.test(next)) return;
  const current = readUpdateDeviceState();
  if (current.dismissedVersion && compareVersions(next, current.dismissedVersion) <= 0) return;
  writeUpdateDeviceState({ dismissedVersion: next });
}

export function rememberInstalledVersion(version: string): void {
  const next = String(version || '').trim();
  if (!/^\d+(?:\.\d+)*$/.test(next)) return;
  const current = readUpdateDeviceState();
  if (current.installedVersion && compareVersions(next, current.installedVersion) <= 0) return;
  writeUpdateDeviceState({ installedVersion: next });
}

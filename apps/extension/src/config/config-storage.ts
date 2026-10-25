/**
 * 配置持久化适配：读写 XC::config 文档，损坏回退默认值并迁移历史独立键。
 */

import type { PlatformAdapter } from '../adapters/platform';
import { accountStorageKey } from '../features/skin-background/skin-runtime.ts';
import {
  CONFIG_DOCUMENT_VERSION,
  CONFIG_SCHEMA,
  CONFIG_STORAGE_KEY,
  getDefaultConfig,
  type XiaochaoConfig,
  type XiaochaoConfigKey
} from './config-schema.ts';

interface StoredConfigDocument {
  version: number;
  values: Partial<XiaochaoConfig>;
}

export interface ConfigStorage {
  read(): XiaochaoConfig;
  write(config: XiaochaoConfig): void;
  clear(): void;
  hasAccount(accountId: string): boolean;
}

/** 当前登录账号。还没登录时用 default，登录后再换到这个账号自己的配置。 */
export function currentConfigAccount(): string {
  try {
    return accountStorageKey(typeof localStorage === 'undefined' ? undefined : localStorage);
  } catch {
    return 'default';
  }
}

/**
 * 按游戏登录账号分开的配置键。面板位置、功能开关、皮肤等都在各自账号下。
 * 版本更新提示的「稍后 / 已打开更新页」不在此文件，见 update-device-state 整机一份。
 * 旧的 XC::config 只在迁移时读一次。
 */
export function accountConfigStorageKey(accountId: string): string {
  const safe = accountId.replace(/[^\w.@+-]/g, '_').slice(0, 64) || 'default';
  return `${CONFIG_STORAGE_KEY}::${safe}`;
}

/** 使用平台设置 API 持久化，并负责损坏数据回退和历史独立键迁移。 */
export function createPlatformConfigStorage(platform: PlatformAdapter): ConfigStorage {
  return {
    read() {
      const defaults = getDefaultConfig();
      const accountId = currentConfigAccount();
      const accountKey = accountConfigStorageKey(accountId);
      const ownRaw = platform.getSetting(accountKey);
      let raw = ownRaw;
      let migratedLegacy = false;
      if (!ownRaw) {
        raw = platform.getSetting(CONFIG_STORAGE_KEY);
        migratedLegacy = Boolean(raw);
      }
      const document = parseStoredDocument(raw);
      const source: Record<string, unknown> = { ...(document?.values || {}) };
      let shouldPersist = !document || document.version !== CONFIG_DOCUMENT_VERSION || migratedLegacy;
      if (source['rogue.mapEnabled'] !== undefined && source['shanhetu.mapEnabled'] === undefined) {
        source['shanhetu.mapEnabled'] = source['rogue.mapEnabled'];
        shouldPersist = true;
      }
      if (source['rogue.hideStory'] !== undefined && source['shanhetu.hideStory'] === undefined) {
        source['shanhetu.hideStory'] = source['rogue.hideStory'];
        shouldPersist = true;
      }
      const adoptShared = !ownRaw;

      for (const key of Object.keys(CONFIG_SCHEMA) as XiaochaoConfigKey[]) {
        const definition = CONFIG_SCHEMA[key];
        let candidate: unknown = source[key as string];
        if (candidate === undefined && adoptShared && definition.previousStorageKey) {
          candidate = parsePreviousValue(platform.getSetting(definition.previousStorageKey));
          if (candidate !== undefined) shouldPersist = true;
        }
        const parsed = definition.parse(candidate);
        if (parsed !== undefined) (defaults as any)[key] = parsed;
        else if (candidate !== undefined) shouldPersist = true;
      }

      if (shouldPersist) this.write(defaults);
      if (adoptShared) {
        platform.removeSetting(CONFIG_STORAGE_KEY);
        for (const key of Object.keys(CONFIG_SCHEMA) as XiaochaoConfigKey[]) {
          const previousKey = CONFIG_SCHEMA[key].previousStorageKey;
          if (previousKey) platform.removeSetting(previousKey);
        }
      }
      return defaults;
    },
    write(config) {
      const document: StoredConfigDocument = {
        version: CONFIG_DOCUMENT_VERSION,
        values: config
      };
      const accountId = currentConfigAccount();
      platform.setSetting(accountConfigStorageKey(accountId), JSON.stringify(document));
      if (accountId !== 'default') platform.removeSetting(CONFIG_STORAGE_KEY);
    },
    hasAccount(accountId) {
      return platform.getSetting(accountConfigStorageKey(accountId)) !== null;
    },
    clear() {
      platform.removeSetting(accountConfigStorageKey(currentConfigAccount()));
      platform.removeSetting(CONFIG_STORAGE_KEY);
      for (const key of Object.keys(CONFIG_SCHEMA) as XiaochaoConfigKey[]) {
        const previousKey = CONFIG_SCHEMA[key].previousStorageKey;
        if (previousKey) platform.removeSetting(previousKey);
      }
    }
  };
}

function parseStoredDocument(rawValue: string | null): StoredConfigDocument | undefined {
  if (!rawValue) return undefined;
  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object' || !parsed.values || typeof parsed.values !== 'object') {
      return undefined;
    }
    return {
      version: Number(parsed.version) || 0,
      values: parsed.values
    };
  } catch {
    return undefined;
  }
}

function parsePreviousValue(rawValue: string | null): unknown {
  if (rawValue === null) return undefined;
  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}

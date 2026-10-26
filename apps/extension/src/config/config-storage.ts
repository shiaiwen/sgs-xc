/**
 * 配置持久化适配：读写 XC::config 文档，损坏回退默认值并迁移历史独立键。
 *
 * 读路径优先级：账号键 → 旧共享 XC::config → schema.previousStorageKey。
 * 首次落到账号键时会清掉共享键与各 previousStorageKey，避免下次再迁一遍。
 * rogue.* → shanhetu.* 在文档内就地改名。
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

/** 落盘形态：version + 部分键值；缺键读时补默认。 */
interface StoredConfigDocument {
  version: number;
  values: Partial<XiaochaoConfig>;
}

/** 平台无关的配置读写面；createPlatformConfigStorage 是默认实现。 */
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
  // 裁剪非法字符并限长，避免设置后端对 key 长度/字符集敏感
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
      // 尚无账号文档时，尝试吃掉旧的共享 XC::config
      if (!ownRaw) {
        raw = platform.getSetting(CONFIG_STORAGE_KEY);
        migratedLegacy = Boolean(raw);
      }
      const document = parseStoredDocument(raw);
      const source: Record<string, unknown> = { ...(document?.values || {}) };
      let shouldPersist = !document || document.version !== CONFIG_DOCUMENT_VERSION || migratedLegacy;
      // 文档内键改名：rogue → shanhetu（只在新键缺失时拷贝）
      if (source['rogue.mapEnabled'] !== undefined && source['shanhetu.mapEnabled'] === undefined) {
        source['shanhetu.mapEnabled'] = source['rogue.mapEnabled'];
        shouldPersist = true;
      }
      if (source['rogue.hideStory'] !== undefined && source['shanhetu.hideStory'] === undefined) {
        source['shanhetu.hideStory'] = source['rogue.hideStory'];
        shouldPersist = true;
      }
      // 仅在「借了共享/旧键」时才去扫 previousStorageKey 并在读完后清理
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
        // 有原始值但 parse 失败：丢掉脏值并回写干净默认
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
      // 已登录账号不再保留共享键，防止其它账号误读
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

/** 解析整份配置文档；JSON/结构损坏时返回 undefined，由上层回退默认。 */
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

/** 旧独立键可能是 JSON 或纯字符串；解析失败则原样交给 schema.parse。 */
function parsePreviousValue(rawValue: string | null): unknown {
  if (rawValue === null) return undefined;
  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}

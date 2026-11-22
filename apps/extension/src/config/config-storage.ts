/**
 * 配置持久化适配：读写 XC::config::<游戏账号编号> 文档，损坏回退默认值。
 *
 * 每个账号只读写自己的那份。读不到账号编号时用默认值，也不写盘。
 * rogue.* → shanhetu.* 在文档内就地改名。
 */

import type { PlatformAdapter } from '../adapters/platform';
import { currentGameAccountId, safeAccountKeyPart } from '../features/skin-background/skin-runtime.ts';
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
}

/** 还没读到游戏账号时的占位。这时只用默认值，不写盘。 */
export const NO_CONFIG_ACCOUNT = 'default';

/** 当前游戏账号编号。还没读到时用 default，读到后再换到这个账号自己的配置。 */
export function currentConfigAccount(): string {
  return currentGameAccountId() || NO_CONFIG_ACCOUNT;
}

/**
 * 按游戏账号分开的配置键。面板位置、功能开关、皮肤等都在各自账号下。
 * 版本更新提示的「稍后 / 已打开更新页」不在此文件，见 update-device-state 整机一份。
 */
export function accountConfigStorageKey(accountId: string): string {
  // 裁剪非法字符并限长，避免设置后端对 key 长度/字符集敏感
  const safe = safeAccountKeyPart(accountId) || NO_CONFIG_ACCOUNT;
  return `${CONFIG_STORAGE_KEY}::${safe}`;
}

/** 使用平台设置 API 持久化，并负责损坏数据回退。 */
export function createPlatformConfigStorage(platform: PlatformAdapter): ConfigStorage {
  return {
    read() {
      const defaults = getDefaultConfig();
      const accountId = currentConfigAccount();
      if (accountId === NO_CONFIG_ACCOUNT) return defaults;
      const raw = platform.getSetting(accountConfigStorageKey(accountId));
      const document = parseStoredDocument(raw);
      const source: Record<string, unknown> = { ...(document?.values || {}) };
      let shouldPersist = Boolean(document) && document?.version !== CONFIG_DOCUMENT_VERSION;
      // 文档内键改名：rogue → shanhetu（只在新键缺失时拷贝）
      if (source['rogue.mapEnabled'] !== undefined && source['shanhetu.mapEnabled'] === undefined) {
        source['shanhetu.mapEnabled'] = source['rogue.mapEnabled'];
        shouldPersist = true;
      }
      if (source['rogue.hideStory'] !== undefined && source['shanhetu.hideStory'] === undefined) {
        source['shanhetu.hideStory'] = source['rogue.hideStory'];
        shouldPersist = true;
      }

      const legacyAssist = source['assist.extraEnabled'];
      if (typeof legacyAssist === 'boolean') {
        for (const key of ['assist.sunquanEnabled', 'assist.peixiuEnabled', 'assist.xushaoEnabled']) {
          source[key] = legacyAssist && source[key] !== false;
        }
        shouldPersist = true;
      }

      for (const key of Object.keys(CONFIG_SCHEMA) as XiaochaoConfigKey[]) {
        const candidate: unknown = source[key as string];
        const parsed = CONFIG_SCHEMA[key].parse(candidate);
        if (parsed !== undefined) (defaults as any)[key] = parsed;
        // 有原始值但 parse 失败：丢掉脏值并回写干净默认
        else if (candidate !== undefined) shouldPersist = true;
      }

      if (shouldPersist) this.write(defaults);
      return defaults;
    },
    write(config) {
      const accountId = currentConfigAccount();
      if (accountId === NO_CONFIG_ACCOUNT) return;
      const document: StoredConfigDocument = {
        version: CONFIG_DOCUMENT_VERSION,
        values: config
      };
      platform.setSetting(accountConfigStorageKey(accountId), JSON.stringify(document));
    },
    clear() {
      const accountId = currentConfigAccount();
      if (accountId === NO_CONFIG_ACCOUNT) return;
      platform.removeSetting(accountConfigStorageKey(accountId));
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

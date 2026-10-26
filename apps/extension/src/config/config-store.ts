/**
 * 配置仓库：Schema 校验后读写平台存储，并通知键级订阅者与 DOM 自定义事件。
 */

import {
  CONFIG_SCHEMA,
  getDefaultConfig,
  type XiaochaoConfig,
  type XiaochaoConfigKey
} from './config-schema.ts';
import { currentConfigAccount, type ConfigStorage } from './config-storage.ts';

/** DOM 自定义事件名；detail 为 ConfigChangeDetail，供非模块订阅方监听。 */
export const CONFIG_CHANGE_EVENT = 'xc:config-change';

export interface ConfigChangeDetail<Key extends XiaochaoConfigKey = XiaochaoConfigKey> {
  key: Key;
  value: XiaochaoConfig[Key];
  previousValue: XiaochaoConfig[Key];
}

type ConfigSubscriber<Key extends XiaochaoConfigKey> = (
  detail: ConfigChangeDetail<Key>
) => void;

export interface XiaochaoConfigStore {
  get<Key extends XiaochaoConfigKey>(key: Key): XiaochaoConfig[Key];
  set<Key extends XiaochaoConfigKey>(key: Key, value: XiaochaoConfig[Key]): void;
  reset<Key extends XiaochaoConfigKey>(key: Key): void;
  /** 按键订阅；返回取消函数。 */
  subscribe<Key extends XiaochaoConfigKey>(
    key: Key,
    subscriber: ConfigSubscriber<Key>
  ): () => void;
  snapshot(): XiaochaoConfig;
  resetAll(): void;
  /** 登录态变化时切换账号配置桶；default→新账号且尚无文档时先落盘当前值。 */
  syncAccount(): void;
}

/** 配置仓库是业务层唯一读写入口，同时通知模块订阅者和 DOM 事件消费者。 */
export function createConfigStore(
  storage: ConfigStorage,
  eventTarget: EventTarget | undefined = typeof window === 'undefined' ? undefined : window
): XiaochaoConfigStore {
  let values = storage.read();
  let accountId = currentConfigAccount();
  const subscribers = new Map<XiaochaoConfigKey, Set<ConfigSubscriber<any>>>();

  /** 只对实际变化的键通知订阅者并派发 DOM 事件（批量重置/换账号时用）。 */
  function publish(previousValues: XiaochaoConfig, nextValues: XiaochaoConfig): void {
    for (const key of Object.keys(CONFIG_SCHEMA) as XiaochaoConfigKey[]) {
      if (isSameValue(previousValues[key], nextValues[key])) continue;
      const detail = {
        key,
        value: nextValues[key],
        previousValue: previousValues[key]
      } as ConfigChangeDetail;
      subscribers.get(key)?.forEach((subscriber) => subscriber(detail));
      if (eventTarget && typeof CustomEvent !== 'undefined') {
        eventTarget.dispatchEvent(new CustomEvent(CONFIG_CHANGE_EVENT, { detail }));
      }
    }
  }

  function syncAccount(): void {
    const nextAccount = currentConfigAccount();
    if (nextAccount === accountId) return;
    const previousAccount = accountId;
    accountId = nextAccount;
    // 未登录阶段改过的开关，首次登录且该账号尚无文档时一并带过去
    if (previousAccount === 'default' && !storage.hasAccount(nextAccount)) {
      storage.write(values);
    }
    const previousValues = values;
    values = storage.read();
    publish(previousValues, values);
  }

  function get<Key extends XiaochaoConfigKey>(key: Key): XiaochaoConfig[Key] {
    return values[key];
  }

  function set<Key extends XiaochaoConfigKey>(key: Key, value: XiaochaoConfig[Key]): void {
    const parsedValue = CONFIG_SCHEMA[key].parse(value) as XiaochaoConfig[Key] | undefined;
    if (parsedValue === undefined) throw new TypeError(`无效的小抄配置：${key}`);
    const previousValue = values[key];
    // 同值短路，避免无意义写盘与事件风暴
    if (isSameValue(previousValue, parsedValue)) return;
    values = { ...values, [key]: parsedValue };
    storage.write(values);
    const detail = { key, value: parsedValue, previousValue } as ConfigChangeDetail<Key>;
    subscribers.get(key)?.forEach((subscriber) => subscriber(detail));
    if (eventTarget && typeof CustomEvent !== 'undefined') {
      eventTarget.dispatchEvent(new CustomEvent(CONFIG_CHANGE_EVENT, { detail }));
    }
  }

  function reset<Key extends XiaochaoConfigKey>(key: Key): void {
    set(key, CONFIG_SCHEMA[key].defaultValue as XiaochaoConfig[Key]);
  }

  function resetAll(): void {
    const previousValues = values;
    values = getDefaultConfig();
    storage.clear();
    storage.write(values);
    publish(previousValues, values);
  }

  function subscribe<Key extends XiaochaoConfigKey>(
    key: Key,
    subscriber: ConfigSubscriber<Key>
  ): () => void {
    const keySubscribers = subscribers.get(key) || new Set();
    keySubscribers.add(subscriber);
    subscribers.set(key, keySubscribers);
    return () => {
      keySubscribers.delete(subscriber);
      if (!keySubscribers.size) subscribers.delete(key);
    };
  }

  return {
    get,
    set,
    reset,
    subscribe,
    snapshot: () => cloneConfigValues(values),
    resetAll,
    syncAccount
  };
}

/** 配置值均为 JSON 可序列化；用 stringify 比较对象/数组，避免引用相等误判。 */
function isSameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** 配置均为 JSON 可序列化值；避免依赖 structuredClone，以兼容旧版 Chromium。 */
function cloneConfigValues(source: XiaochaoConfig): XiaochaoConfig {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(source);
  }
  return JSON.parse(JSON.stringify(source)) as XiaochaoConfig;
}

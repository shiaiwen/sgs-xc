import type { XiaochaoConfigKey } from '../config/config-schema.ts';

/** 改了配置后等这么久再传给服务器，这段时间里的改动合成一次传，单位毫秒。 */
export const ACCOUNT_SYNC_PUSH_WAIT_MS = 5_000;

/** 读或传服务器失败后，隔这么久再试，单位毫秒。 */
export const ACCOUNT_SYNC_RETRY_MS = 60_000;

/** 重置小抄时等服务器回话最多这么久，单位毫秒。 */
export const ACCOUNT_RESET_TIMEOUT_MS = 5_000;

/** 页面关掉时还能发出去的请求，正文最多这么多字节。 */
export const KEEPALIVE_BODY_MAX_BYTES = 60 * 1024;

/** 服务器上开关和背景那份文档的格式版本，服务端用同一个数。 */
export const ACCOUNT_CONFIG_DOCUMENT_VERSION = 2;

/** 开始和服务器同步之前本机就改过的项记成这个时间：比没改过的默认值新，比之后任何一次真正的改动旧。 */
export const ACCOUNT_CONFIG_UNSYNCED_SAVED_AT = 1;

/** 跟屏幕和这台设备有关的项只存本机，不传服务器。 */
export const DEVICE_ONLY_CONFIG_KEYS: readonly XiaochaoConfigKey[] = [
  'panel.activeTab',
  'panel.collapsed',
  'panel.dockedRight',
  'panel.position',
  'cards.handSortPosition',
  'update.autoUpdateEnabled'
];

/** 每个账号记录哪些项改过、什么时候改的，键后面接账号编号。 */
export const ACCOUNT_CONFIG_LEDGER_KEY_BASE = 'XC::configSync';

/** 改了配置后等这么久再传给服务器，这段时间里的改动合成一次传，单位毫秒。 */
export const ACCOUNT_SYNC_PUSH_WAIT_MS = 5_000;

/** 读或传服务器失败后，隔这么久再试，单位毫秒。 */
export const ACCOUNT_SYNC_RETRY_MS = 60_000;

/** 游戏里没读到登录账号时，隔这么久再读一次，单位毫秒。 */
export const LOGIN_ACCOUNT_RETRY_MS = 1_000;

/** 重置小抄时等服务器回话最多这么久，单位毫秒。 */
export const ACCOUNT_RESET_TIMEOUT_MS = 5_000;

/** 页面关掉时还能发出去的请求，正文最多这么多字节。 */
export const KEEPALIVE_BODY_MAX_BYTES = 60 * 1024;

/** 服务器上开关和背景那份文档的格式版本，服务端用同一个数。 */
export const ACCOUNT_CONFIG_DOCUMENT_VERSION = 2;

/** 开始和服务器同步之前本机就改过的项记成这个时间：比没改过的默认值新，比之后任何一次真正的改动旧。 */
export const ACCOUNT_CONFIG_UNSYNCED_SAVED_AT = 1;

/** 启动自动操作前等待当前账号的云配置，超时回退到本地配置，单位毫秒。 */
export const ACCOUNT_CONFIG_STARTUP_WAIT_MS = 3_000;

/** 每个账号记录哪些项改过、什么时候改的，键后面接账号编号。 */
export const ACCOUNT_CONFIG_LEDGER_KEY_BASE = 'XC::configSync';

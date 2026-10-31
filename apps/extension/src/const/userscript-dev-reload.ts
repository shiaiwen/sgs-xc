/** 本机 dev 构建号 HTTP 路径，与 dist/userscript/xiaochao-dev-build-id.txt 同步。 */
export const USERSCRIPT_DEV_BUILD_ID_PATH = '/xiaochao-dev-build-id';

/** 本标签页第一次打开游戏后，短暂不因 dev 构建刷新，避免加载条卡死。 */
export const USERSCRIPT_DEV_RELOAD_WARMUP_MS = 12_000;

/** 连续两次自动刷新之间的最短间隔。 */
export const USERSCRIPT_DEV_RELOAD_COOLDOWN_MS = 2_000;

/** 检测到新构建后稍等再刷新，给本机油猴更新页确认留时间。 */
export const USERSCRIPT_DEV_RELOAD_AFTER_BUILD_MS = 8_000;

/** 轮询本机 build 号的间隔。 */
export const USERSCRIPT_DEV_RELOAD_POLL_MS = 800;

export const USERSCRIPT_DEV_RELOAD_WARMUP_UNTIL_KEY = 'xcDevReloadWarmupUntil';

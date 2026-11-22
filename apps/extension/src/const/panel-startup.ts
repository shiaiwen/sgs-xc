/** 首页识别失败时，引擎就绪超过该毫秒数仍挂载小抄面板。 */
export const PANEL_MOUNT_ENGINE_READY_FALLBACK_MS = 2_000;

/** 面板挂载前检查游戏和账号的间隔。挂载后恢复常驻的账号同步间隔。 */
export const PANEL_STARTUP_CHECK_MS = 200;

/** 进大厅后等游戏账号编号的最长毫秒数。超时仍读不到就按默认配置启动功能。 */
export const ACCOUNT_ID_WAIT_MS = 10_000;

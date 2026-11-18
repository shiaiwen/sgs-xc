/** 新版下好以后，等玩家不在打牌时刷新游戏页用到的页面名和时间。 */

/** 只在这两个页面刷新：登录后的首页和大厅房间列表。 */
export const UPDATE_RELOAD_SCENE_NAMES: readonly string[] = ['ModeScene', 'HallScene'];

/** 新版下好以后，多久看一次现在能不能刷新，单位毫秒。 */
export const UPDATE_RELOAD_CHECK_MS = 5000;

/** 连续这么多次都能刷新才动手，避开正好在切页面、点开始匹配的那一下。 */
export const UPDATE_RELOAD_STABLE_CHECKS = 2;

/** 窗口在前台时，玩家这么久没动鼠标键盘才算走开了，单位毫秒。 */
export const UPDATE_RELOAD_FOREGROUND_IDLE_MS = 5 * 60 * 1000;

/** 后台还在下新版时，多久问一次下好了没有，单位毫秒。 */
export const UPDATE_PREPARE_POLL_MS = 15_000;

/** 发现新版这么久还没下好，就亮出「去更新」让玩家手动装，单位毫秒。 */
export const UPDATE_PREPARE_GRACE_MS = 10 * 60 * 1000;

/** 刷新后「小抄已更新」提示停留多久，单位毫秒。 */
export const UPDATE_DONE_TOAST_MS = 6000;

/** 刷新前写进这一页会话存储的记录：刷新后据此提示已更新，没换成新版时不再为同一版本刷新。 */
export const UPDATE_RELOAD_SESSION_KEY = 'XC::update-reload';

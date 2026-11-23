/** 各功能常驻轮询的间隔，单位毫秒。 */

/** 同步账号、检查小抄能不能启动。 */
export const ACCOUNT_SESSION_SYNC_MS = 1000;

/** 皮肤解锁：检查是不是换了账号，换了就从服务器读这个账号存的皮肤。 */
export const SKIN_CHOICE_ACCOUNT_CHECK_MS = 2000;

/** 游戏把 console.log 换掉以后，重新接管它的检查间隔（自愈兜底）。 */
export const CONSOLE_LOG_HOOK_HEAL_MS = 5000;

/** 补挂游戏协议分发钩子。 */
export const PROTOCOL_HOOK_SCAN_MS = 300;

/** 局后界面保护：检查结算界面。 */
export const POST_GAME_GUARD_POLL_MS = 1000;

/** 卡牌标签刷新（事件驱动后的兜底）。 */
export const CARD_LABEL_REFRESH_MS = 5000;

/** 倒计时秒数：秒数每秒才变一次，不到一秒查一次就跟得上，同时少遍历几次显示树。 */
export const COUNTDOWN_SYNC_MS = 800;

/** 手牌整理按钮。 */
export const HAND_SORT_SYNC_MS = 500;

/** 最近用牌框。 */
export const RECENT_CARD_SYNC_MS = 500;

/** 牌局记录按钮。 */
export const DECK_RECORD_SYNC_MS = 500;

/** 身份锁定。 */
export const CHOOSE_FIGURE_APPLY_MS = 1000;

/** 山河图集市透视：在地图场景内轮询 manager / 集市窗。 */
export const SHANHETU_SHOP_SYNC_MS = 2000;

/** 山河集市缺少 shopData 时重复请求 RogueLikeDataReq 的最小间隔。 */
export const SHANHETU_SHOP_DATA_REQUEST_COOLDOWN_MS = 12_000;

/** 没找到山河管理器后，隔这么久才重新扫一遍游戏事件监听。不在山河图时一直找不到，扫得太勤会卡。 */
export const SHANHETU_MANAGER_RETRY_MS = 5000;

/** 找房间座位管理器，用来清掉换人后留在座位上的旧 IP。 */
export const ROOM_SEAT_IP_GUARD_SCAN_MS = 2000;

/** 删重复座位延后到协议回包处理完成之后，避免进房加载中被打断卡在进度条。 */
export const ROOM_SEAT_DUPLICATE_DROP_DELAY_MS = 300;

/** 铁索重铸：兜底轮询。补丁主要靠开局/重连事件装上，这里只覆盖「已开局才加载」等没事件的边角。 */
export const TIESUO_POLL_BACKUP_MS = 2000;

/** 人机提示：刚装上、还没判断在不在牌局时。 */
export const AI_PLAYER_SCAN_START_MS = 1000;

/** 人机提示：在牌局里。 */
export const AI_PLAYER_SCAN_IN_GAME_MS = 500;

/** 人机提示：不在牌局里（资料页人机提示用，只需低频兜底）。 */
export const AI_PLAYER_SCAN_OUT_OF_GAME_MS = 5000;

/** 屏蔽跑马灯：反复清掉已经出来的跑马灯。 */
export const MARQUEE_SWEEP_MS = 500;

/** 阵营聊天面板。 */
export const CAMP_CHAT_PANEL_SYNC_MS = 500;

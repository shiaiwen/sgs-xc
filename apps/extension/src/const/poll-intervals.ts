/** 各功能常驻轮询的间隔，单位毫秒。 */

/** 同步账号、检查小抄能不能启动。 */
export const ACCOUNT_SESSION_SYNC_MS = 1000;

/** 皮肤解锁：检查是不是换了账号，换了就从服务器读这个账号存的皮肤。 */
export const SKIN_CHOICE_ACCOUNT_CHECK_MS = 2000;

/** 游戏把 console.log 换掉以后，重新接管它的检查间隔。 */
export const CONSOLE_LOG_HOOK_HEAL_MS = 2000;

/** 补挂游戏协议分发钩子。 */
export const PROTOCOL_HOOK_SCAN_MS = 300;

/** 技能提示常驻：检查新弹出的技能提示。 */
export const SKILL_TIP_STAY_TICK_MS = 50;

/** 局后界面保护：检查结算界面。 */
export const POST_GAME_GUARD_POLL_MS = 1000;

/** 卡牌标签刷新。 */
export const CARD_LABEL_REFRESH_MS = 2000;

/** 技能辅助刷新技能可见性。 */
export const SKILL_ASSIST_REFRESH_MS = 1000;

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

/** 铁索重铸：自己座位还没出来时。 */
export const TIESUO_POLL_IDLE_MS = 500;

/** 铁索重铸：自己座位在场时，要赶在游戏关掉确定按钮之后马上点亮。 */
export const TIESUO_POLL_ACTIVE_MS = 100;

/** 人机提示：刚装上、还没判断在不在牌局时。 */
export const AI_PLAYER_SCAN_START_MS = 1000;

/** 人机提示：在牌局里。 */
export const AI_PLAYER_SCAN_IN_GAME_MS = 500;

/** 人机提示：不在牌局里。 */
export const AI_PLAYER_SCAN_OUT_OF_GAME_MS = 2000;

/** 屏蔽跑马灯：反复清掉已经出来的跑马灯。 */
export const MARQUEE_SWEEP_MS = 500;

/** 阵营聊天面板。 */
export const CAMP_CHAT_PANEL_SYNC_MS = 500;

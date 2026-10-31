/** 进大厅后延迟挂背景面板钩子，避免登录切场景时卡住。 */
export const WALLPAPER_MENU_HOOK_DELAY_MS = 2500;

/** 子节点搜索背景面板时的最大深度。 */
export const WALLPAPER_MENU_TREE_SEARCH_DEPTH = 5;

/** 从舞台根节点搜索背景面板时的最大深度。 */
export const WALLPAPER_MENU_STAGE_SEARCH_DEPTH = 14;

/** 顶栏上可能打开选背景面板的方法名，只包装当前 topMenu 实例。 */
export const WALLPAPER_TOP_MENU_OPEN_METHODS = [
  'onClickSkin',
  'usuallyWallBtnClick',
  'UsuallyWallBtnClick'
] as const;

/** 等 wallPaperUI 页签就绪的轮询间隔与次数。 */
export const WALLPAPER_MENU_READY_POLL_MS = 100;
export const WALLPAPER_MENU_READY_POLL_ATTEMPTS = 100;

/** 用户已打开面板时，补挂页签的轮询次数。 */
export const WALLPAPER_VISIBLE_MENU_POLL_MS = 200;
export const WALLPAPER_VISIBLE_MENU_POLL_ATTEMPTS = 30;

/** 静默建面板后从舞台找面板的浅层深度。 */
export const WALLPAPER_MENU_ATTACH_STAGE_DEPTH = 8;

/** 在大厅场景子树里找能打开选背景面板的顶栏宿主。 */
export const WALLPAPER_TOP_MENU_SEARCH_DEPTH = 8;

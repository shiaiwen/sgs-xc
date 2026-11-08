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

/** 顶栏换背景按钮节点字段名。 */
export const WALLPAPER_TOP_MENU_SKIN_BUTTON_KEY = 'skinBtn';

/** 包装 onClickSkin 前保留的游戏原方法，供 skinBtn 重绑。 */
export const WALLPAPER_TOP_MENU_NATIVE_ON_CLICK_SKIN_KEY = '__xcWallPaperNativeOnClickSkin';

/** 等 wallPaperUI 页签就绪的轮询间隔与次数。 */
export const WALLPAPER_MENU_READY_POLL_MS = 100;
export const WALLPAPER_MENU_READY_POLL_ATTEMPTS = 100;

/** 参考 Sa 里 Ug 轮询：0x64 ms、0x32 次。 */
export const WALLPAPER_MENU_SA_POLL_MS = 100;
export const WALLPAPER_MENU_SA_POLL_ATTEMPTS = 50;

/** 用户已打开面板时，补挂页签的轮询次数。 */
export const WALLPAPER_VISIBLE_MENU_POLL_MS = 200;
export const WALLPAPER_VISIBLE_MENU_POLL_ATTEMPTS = 30;

/** 静默建面板后从舞台找面板的浅层深度。 */
export const WALLPAPER_MENU_ATTACH_STAGE_DEPTH = 8;

/** 在大厅场景子树里找能打开选背景面板的顶栏宿主。 */
export const WALLPAPER_TOP_MENU_SEARCH_DEPTH = 8;

/** 参考 S5：除 topMenu.wallPaperUI 外可能承载页签的背景设置视图类名。 */
export const WALLPAPER_BG_SET_VIEW_CLASS_CANDIDATES = [
  'BgSetView',
  'WallPaperView',
  'WallPaperUIView'
] as const;

/** 藏主题格子前记下游戏原来的显隐。「查看更多」没展开的格子原来是藏着的。 */
export const WALLPAPER_ITEM_SAVED_VISIBLE_KEY = '__xcWallpaperItemSavedVisible';

export function rememberWallpaperItemVisible(item: Record<string, unknown>): void {
  if (item.visible === false) return;
  item[WALLPAPER_ITEM_SAVED_VISIBLE_KEY] = true;
}

export function restoreWallpaperItemVisible(item: Record<string, unknown>): void {
  if (item[WALLPAPER_ITEM_SAVED_VISIBLE_KEY] === true) item.visible = true;
  delete item[WALLPAPER_ITEM_SAVED_VISIBLE_KEY];
}

/** 点主题格子后，这段时间内游戏换上的主题不再被小抄图盖回去。 */
export const THEME_CLICK_WALLPAPER_PASS_MS = 800;

/** 官方背景面板「主题背景」页签的 SelectedValue / tab.value。 */
export const WALLPAPER_MENU_TAB_THEME = 0;

/** 官方背景面板「皮肤背景」页签的 SelectedValue / tab.value。 */
export const WALLPAPER_MENU_TAB_SKIN = 1;

/** 官方背景面板「动态皮肤」页签的 SelectedValue / tab.value。 */
export const WALLPAPER_MENU_TAB_LIVE = 2;

/** 背景面板上「动态皮肤」页签的列表面板属性名。 */
export const WALLPAPER_LIVE_PANEL_KEY = 'livePanel';

/** 本地记住的官方背景编号。 */
export const WALLPAPER_OFFICIAL_CHOICE_SUFFIX = '::XC_OFFICIAL_BACKGROUND_CHOICE';

/** 小抄「小抄背景」页签的 SelectedValue / tab.value。 */
export const WALLPAPER_MENU_TAB_XC_FAVORITES = 'xcSkinBackgroundFavorites';

/** 用户点顶栏衬衫收起背景面板后，小抄页不要再把它撑开。 */
export const WALLPAPER_USER_FOLDED_KEY = '__xcWallpaperUserFolded';

/** 主题、静态皮肤、动态皮肤共用一个勾，点中一项就要清掉另外两栏。 */
export const WALLPAPER_CHOICE_LIST_KEYS = ['wallPaperItems', 'wallPaperSkinItems', 'wallPaperLiveItems'] as const;

/** 勾选图在格子里的层级，保证盖在缩略图上面。 */
export const WALLPAPER_SELECTED_MARK_Z_ORDER = 999;

/** 参考 SR：包装前 wallPaperUI 原型上的原生 onTabClick。 */
export const WALLPAPER_MENU_PROTO_NATIVE_TAB_CLICK_KEY = '__onTabClick';

/** 原生 onTabClick 备份；勿再占用 __onTabClick，否则 SelectTab 直调原生会关窗。 */
export const WALLPAPER_MENU_NATIVE_TAB_CLICK_STORE_KEY = '__xcWallPaperNativeTabClick';

/** 参考 SR：wallPaperUI 原型 onTabClick 已替换为包装实现。 */
export const WALLPAPER_MENU_SR_ON_TAB_CLICK_INSTALLED_KEY = '__xcSrWallPaperOnTabClickInstalled';

/** 参考 SR：tabGroup 已绑 TAP_CLICKED 时记在 menu 上。 */
export const WALLPAPER_FAVORITES_TAB_BOUND_KEY = '__xcSkinBackgroundFavoritesTabBound';

/** 参考 SR：tabGroup 使用的事件名。 */
export const WALLPAPER_FAVORITES_TAB_EVENT_KEY = '__xcSkinBackgroundFavoritesTabEvent';

/** 参考 SR：解绑 tabGroup 时用的原生 handler。 */
export const WALLPAPER_FAVORITES_NATIVE_TAB_HANDLER_KEY = '__xcSkinBackgroundFavoritesNativeHandler';

/** 参考 SR：解绑 tabGroup 时用的包装 handler。 */
export const WALLPAPER_FAVORITES_PATCHED_TAB_HANDLER_KEY = '__xcSkinBackgroundFavoritesPatchedHandler';

export function isWallpaperMenuFavoritesTabValue(value: unknown): boolean {
  return value === WALLPAPER_MENU_TAB_XC_FAVORITES
    || String(value ?? '') === WALLPAPER_MENU_TAB_XC_FAVORITES;
}

export function isWallpaperMenuThemeTabValue(value: unknown): boolean {
  return value === WALLPAPER_MENU_TAB_THEME || String(value ?? '') === String(WALLPAPER_MENU_TAB_THEME);
}

export function isWallpaperMenuSkinTabValue(value: unknown): boolean {
  return value === WALLPAPER_MENU_TAB_SKIN || String(value ?? '') === String(WALLPAPER_MENU_TAB_SKIN);
}

export function isWallpaperMenuLiveTabValue(value: unknown): boolean {
  return value === WALLPAPER_MENU_TAB_LIVE || String(value ?? '') === String(WALLPAPER_MENU_TAB_LIVE);
}

/** 动态皮肤等其它官方页签，显隐交给游戏自己，不要按主题或静态皮肤去藏。 */
export function shouldLeaveWallpaperTabToGame(value: unknown): boolean {
  if (value == null || value === '') return false;
  return !isWallpaperMenuFavoritesTabValue(value)
    && !isWallpaperMenuSkinTabValue(value)
    && !isWallpaperMenuThemeTabValue(value);
}

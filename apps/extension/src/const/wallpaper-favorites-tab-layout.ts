/** 挂小抄页前保存官方页签宽度的键，与参考脚本 `__xcBackgroundTabLayout` 一致。 */
export const WALLPAPER_BACKGROUND_TAB_LAYOUT_KEY = '__xcBackgroundTabLayout';

/** 小抄页隐藏「应用到所有模式」时保存可见状态的键，与参考 `__xcBackgroundFooterVisibility` 一致。 */
export const WALLPAPER_BACKGROUND_FOOTER_VISIBILITY_KEY = '__xcBackgroundFooterVisibility';

/** 参考 zb：小抄页展开时面板高度相对 panelHeight 的增量。 */
export const WALLPAPER_FAVORITES_PANEL_HEIGHT_EXTRA = 4;

/** 兼容旧逻辑：曾只记前两个官方页签宽度；现快照改为排除小抄后的全部原生页签。 */
export const WALLPAPER_TAB_LAYOUT_OFFICIAL_BUTTON_COUNT = 2;

/** 背景面板页签组里「小抄背景」页签（挂在原生页签之后）的最小宽度。 */
export const WALLPAPER_FAVORITES_TAB_MIN_WIDTH = 72;

/** 页签底图左右两侧各有这么宽的半透明阴影，按原图像素计；排版时让阴影压到相邻页签下面。 */
export const WALLPAPER_TAB_TEXTURE_SHADOW_WIDTH = 3;

/** 页签高度缺省值，与官方皮肤页签接近。 */
export const WALLPAPER_FAVORITES_TAB_DEFAULT_HEIGHT = 28;

/** 点小抄页签后短时内拦截原生 Close，避免 SelectTab 连带关窗。 */
export const WALLPAPER_FAVORITES_NATIVE_CLOSE_SUPPRESS_MS = 900;

/** 页签数超过此值的菜单视为大厅多分类面板，不挂小抄背景页。 */
export const WALLPAPER_FAVORITES_ATTACH_MAX_TAB_COUNT = 8;

/** 这些 name 的窗口不是局内换背景面板，禁止挂小抄页签。 */
export const WALLPAPER_FAVORITES_ATTACH_EXCLUDED_MENU_NAMES = ['SkinWindow'] as const;

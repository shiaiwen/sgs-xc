/** 背景面板实例上常见「刚显示」钩子，用于二次打开时重挂小抄页。 */
export const WALLPAPER_MENU_SHOW_METHODS = [
  'onShow',
  'Show',
  'show',
  'InitData',
  'initData'
] as const;

/** 背景面板关闭时钩子，用于清绑定状态、保留页签。 */
export const WALLPAPER_MENU_HIDE_METHODS = [
  'Close',
  'close',
  'onClose',
  'onDisable'
] as const;

/** 面板可见期间轮询补挂小抄页签的间隔。 */
export const WALLPAPER_MENU_VISIBILITY_POLL_MS = 400;

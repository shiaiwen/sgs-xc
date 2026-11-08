/** 背景面板皮肤列表项在 Laya 里的类名，按常见命名依次尝试。 */
export const WALLPAPER_SKIN_ITEM_CLASS_CANDIDATES = [
  'WallPaperSkinItem',
  'WallpaperSkinItem',
  'WallPaperSkinCell',
  'GameWallPaperSkinItem',
  'WallPaperItemSkin'
] as const;

/** 背景面板主题列表项在 Laya 里的类名。 */
export const WALLPAPER_THEME_ITEM_CLASS_CANDIDATES = [
  'WallPaperItem',
  'WallpaperItem',
  'GameWallPaperItem',
  'WallPaperThemeItem',
  'WallPaperCell'
] as const;

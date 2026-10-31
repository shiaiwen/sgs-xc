/** 皮肤详情 / 皮肤管理弹窗在 WindowManager 里的类名。 */
export const SKIN_DETAIL_WINDOW_NAMES = [
  'SkinInfoWindow',
  'SkinWindow',
  'SkinManageWindow',
  'GeneralSkinInfoWindow',
  'SkinDetailWindow',
  'SkinPreviewWindow',
  'GeneralSkinWindow',
  'SkinPopWindow'
] as const;

/** 皮肤列表 / 选将换肤等窗口，禁止挂详情三按钮。带 Detail / Info / Manage 的仍视为详情。 */
export const SKIN_DETAIL_WINDOW_BLOCK_NAME_PATTERN = /Collect|Gallery|List|Select|ChangeSkin|Book|WallPaper|册/i;

export const SKIN_DETAIL_WINDOW_BLOCK_NAME_ALLOW_PATTERN = /Info|Detail|Manage|Preview|Pop/i;

/** Laya 舞台 WindowLayer / TopUILayer 的 layerOrder，与 laya-object-locator 一致。 */
export const LAYA_WINDOW_LAYER_ORDER = 4;
export const LAYA_TOP_UI_LAYER_ORDER = 5;

/** 在 WindowLayer 上扫描皮肤详情窗时的深度与节点上限。 */
export const SKIN_DETAIL_LAYER_SCAN_DEPTH = 12;
export const SKIN_DETAIL_LAYER_SCAN_MAX_NODES = 600;

/** 无「牌局背景」条时，按钮贴在立绘框下方的间距。 */
export const SKIN_DETAIL_BUTTON_BELOW_FRAME_GAP = 10;

/** 保存 / 设为背景 / 收藏条贴在立绘框上方的间距。 */
export const SKIN_DETAIL_BUTTON_ABOVE_FRAME_GAP = 8;

/** 参考包在 contentSprite 上用的按钮皮肤。 */
export const SKIN_DETAIL_FLAT_BUTTON_SKINS = [
  'skinInfo_dynamicBtn_normal',
  'skinInfo_dynamicBtn_over',
  'skinInfo_dynamicBtn_down',
  'skinInfo_dynamicBtn_disable'
] as const;

/** 参考包 myFuncBtn 高度。 */
export const SKIN_DETAIL_BUTTON_HEIGHT = 50;

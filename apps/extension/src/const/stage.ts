/** 读不到舞台尺寸时用的设计分辨率。 */

export const DEFAULT_STAGE_WIDTH = 1920;
export const DEFAULT_STAGE_HEIGHT = 1080;

/** 自定义底图默认 zOrder，实际以背景层官方壁纸 sibling 为准再 +1。 */
export const CUSTOM_BACKGROUND_Z_ORDER = 100;

/** DOM 视口铺底 host，须在 Laya 画布容器之下。 */
export const DOM_PAGE_BG_Z_INDEX = 0;

/** Laya 外层容器 stack 顺序，保证 canvas 在 DOM 铺底之上。 */
export const DOM_LAYA_HOST_Z_INDEX = 2;

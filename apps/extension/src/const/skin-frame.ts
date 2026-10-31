/** 皮肤详情窗口里三种展示框。这是窗口格子，不是原图宽高。 */

export const SKIN_FRAME_WIDE = { width: 594, height: 335 };
export const SKIN_FRAME_HORIZONTAL = { width: 536, height: 380 };
export const SKIN_FRAME_PORTRAIT = { width: 350, height: 464 };

export const SKIN_FRAME_SIZES = [
  SKIN_FRAME_WIDE,
  SKIN_FRAME_HORIZONTAL,
  SKIN_FRAME_PORTRAIT
] as const;

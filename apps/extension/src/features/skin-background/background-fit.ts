import { SKIN_FRAME_SIZES } from '../../const/skin-frame.ts';

/** 皮肤详情窗口的展示框，不是原图自己的宽高。 */

export function isSkinFrameSize(width: number, height: number): boolean {
  return SKIN_FRAME_SIZES.some((frame) => frame.width === width && frame.height === height);
}

/**
 * 有原图像素时用原图，避免被拉变形。
 * 原图还没读到时，先用已有宽高把画面铺上，否则藏掉游戏底图后会黑屏。
 */
export function resolveBackgroundSourceSize(
  textureWidth: number,
  textureHeight: number,
  fallbackWidth: number,
  fallbackHeight: number
): { width: number; height: number } {
  if (textureWidth > 0 && textureHeight > 0) return { width: textureWidth, height: textureHeight };
  if (fallbackWidth > 0 && fallbackHeight > 0) return { width: fallbackWidth, height: fallbackHeight };
  return { width: 0, height: 0 };
}

/** 铺满画面时宽高用同一个倍数，多出来的边裁掉，不把原图拉变形。 */
export function uniformCoverScale(
  stageWidth: number,
  stageHeight: number,
  sourceWidth: number,
  sourceHeight: number
): number {
  if (!(stageWidth > 0 && stageHeight > 0 && sourceWidth > 0 && sourceHeight > 0)) return 1;
  return Math.max(stageWidth / sourceWidth, stageHeight / sourceHeight);
}

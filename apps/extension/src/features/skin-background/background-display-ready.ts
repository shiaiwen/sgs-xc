import {
  BACKGROUND_RESOURCE_TYPE_IMAGE,
  BACKGROUND_RESOURCE_TYPE_SK_EFFECT,
  BACKGROUND_RESOURCE_TYPE_SPINE,
  BACKGROUND_RESOURCE_TYPE_VIDEO
} from '../../const/background-resource-type.ts';

export interface BackgroundDisplayReadyInput {
  type: number;
  bitmapWidth: number;
  bitmapHeight: number;
  videoFrameReady: boolean;
  videoDrawWidth: number;
  videoDrawHeight: number;
  effectIdleCount: number;
}

/** 自定义背景已能遮住官方底图时才返回 true，避免仅填了地址就藏底图导致黑屏。 */
export function isBackgroundDisplayReady(input: BackgroundDisplayReadyInput): boolean {
  const typeNum = Number(input.type) || BACKGROUND_RESOURCE_TYPE_IMAGE;
  if (typeNum === BACKGROUND_RESOURCE_TYPE_IMAGE) {
    return input.bitmapWidth > 0 && input.bitmapHeight > 0;
  }
  if (typeNum === BACKGROUND_RESOURCE_TYPE_VIDEO) {
    return input.videoFrameReady
      && input.videoDrawWidth > 0
      && input.videoDrawHeight > 0;
  }
  if (typeNum === BACKGROUND_RESOURCE_TYPE_SK_EFFECT || typeNum === BACKGROUND_RESOURCE_TYPE_SPINE) {
    return input.effectIdleCount > 0;
  }
  return false;
}

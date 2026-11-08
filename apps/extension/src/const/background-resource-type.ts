/** 自定义背景资源类型，与本地存储及 Laya 渲染分支一致。 */
export const BACKGROUND_RESOURCE_TYPE_IMAGE = 0;
export const BACKGROUND_RESOURCE_TYPE_VIDEO = 1;
export const BACKGROUND_RESOURCE_TYPE_SK_EFFECT = 2;
export const BACKGROUND_RESOURCE_TYPE_SPINE = 3;
/** 旧版骨骼背景。没有新骨架地址时用这一类。 */
export const BACKGROUND_RESOURCE_TYPE_LEGACY_SPINE = 4;
export const BACKGROUND_RESOURCE_TYPE_CROSS_SERVER = 5;

/** 用特效或骨骼画的动态背景类型。 */
export const DYNAMIC_EFFECT_BACKGROUND_TYPES: number[] = [
  BACKGROUND_RESOURCE_TYPE_SK_EFFECT,
  BACKGROUND_RESOURCE_TYPE_SPINE,
  BACKGROUND_RESOURCE_TYPE_LEGACY_SPINE
];

export function isBackgroundResourceVideo(type: number): boolean {
  return Number(type) === BACKGROUND_RESOURCE_TYPE_VIDEO;
}

export function isBackgroundResourceImage(type: number): boolean {
  return Number(type) === BACKGROUND_RESOURCE_TYPE_IMAGE;
}

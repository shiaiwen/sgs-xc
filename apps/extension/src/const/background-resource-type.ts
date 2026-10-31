/** 自定义背景资源类型，与本地存储及 Laya 渲染分支一致。 */
export const BACKGROUND_RESOURCE_TYPE_IMAGE = 0;
export const BACKGROUND_RESOURCE_TYPE_VIDEO = 1;
export const BACKGROUND_RESOURCE_TYPE_SK_EFFECT = 2;
export const BACKGROUND_RESOURCE_TYPE_SPINE = 3;

export function isBackgroundResourceVideo(type: number): boolean {
  return Number(type) === BACKGROUND_RESOURCE_TYPE_VIDEO;
}

export function isBackgroundResourceImage(type: number): boolean {
  return Number(type) === BACKGROUND_RESOURCE_TYPE_IMAGE;
}

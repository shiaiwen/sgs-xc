import { BACKGROUND_RESOURCE_TYPE_CROSS_SERVER } from './background-resource-type.ts';
import { DEFAULT_STAGE_HEIGHT, DEFAULT_STAGE_WIDTH } from './stage.ts';

/** 与参考 z3 一致：跨服动效类型与 skinExtension 标记的背景不当作 paperRes，除非本地换肤例外。 */
export function isPaperBackgroundResourceUsable(
  resource: { type?: unknown; skinExtension?: unknown } | null | undefined,
  localSkinPaperActive = false
): boolean {
  if (!resource) return false;
  const type = Number(resource.type);
  const skinExtension = resource.skinExtension === true;
  if (localSkinPaperActive) return true;
  if (type === BACKGROUND_RESOURCE_TYPE_CROSS_SERVER) return false;
  if (skinExtension) return false;
  return true;
}

/** 判断两项是否同一套 paperRes，忽略 blob 临时播放地址。 */
export function isSamePaperBackgroundResource(
  left: Partial<{ url?: unknown; type?: unknown }> | null | undefined,
  right: Partial<{ url?: unknown; type?: unknown }> | null | undefined
): boolean {
  const leftUrl = String(left?.url || '').trim();
  const rightUrl = String(right?.url || '').trim();
  if (!leftUrl || !rightUrl) return false;
  if (leftUrl.startsWith('blob:') || rightUrl.startsWith('blob:')) return false;
  return leftUrl === rightUrl && Number(left?.type) === Number(right?.type);
}

/** 写入 paperRes 前去掉 blob 播放地址，保留原 CDN 地址。 */
export function canonicalPaperBackgroundResource(
  resource: Partial<{ url?: unknown; type?: unknown; width?: unknown; height?: unknown }>
): { url: string; type: number; width: number; height: number } | null {
  const url = String(resource.url || '').trim();
  if (!url || url.startsWith('blob:')) return null;
  let width = Number(resource.width);
  let height = Number(resource.height);
  if (!(width > 0 && height > 0)) {
    width = DEFAULT_STAGE_WIDTH;
    height = DEFAULT_STAGE_HEIGHT;
  }
  return { url, type: Number(resource.type) || 0, width, height };
}

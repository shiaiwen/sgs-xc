import { DEFAULT_STAGE_HEIGHT, DEFAULT_STAGE_WIDTH } from '../../const/stage.ts';

/** type：0 静态图，1 视频，2 骨骼 .sk，3 新版 Spine，4 旧版 Spine。 */
export interface BackgroundResource {
  url: string;
  type: number;
  width: number;
  height: number;
}

/** 「小抄背景」收藏项。 */
export interface BackgroundFavorite {
  id: string;
  skinId: string;
  generalId: number;
  state: number;
  name: string;
  generalName: string;
  previewUrl: string;
  resource: BackgroundResource;
  savedAt: number;
}

/** 把收藏记录收成统一字段。 */
export function normalizeFavorite(value: unknown): BackgroundFavorite | null {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const resource = record?.resource && typeof record.resource === 'object'
    ? record.resource as Record<string, unknown>
    : null;
  if (!record?.id || !resource?.url) return null;
  const type = Number.isFinite(Number(resource.type)) ? Number(resource.type) : 0;
  let width = Number(resource.width);
  let height = Number(resource.height);
  if (!(width > 0 && height > 0)) {
    width = DEFAULT_STAGE_WIDTH;
    height = DEFAULT_STAGE_HEIGHT;
  }
  return {
    id: String(record.id),
    skinId: String(record.skinId || ''),
    generalId: Number(record.generalId) || 0,
    state: Number(record.state) || 0,
    name: String(record.name || '三国杀皮肤'),
    generalName: String(record.generalName || ''),
    previewUrl: String(record.previewUrl || ''),
    resource: { url: String(resource.url), type, width, height },
    savedAt: Number(record.savedAt) || 0
  };
}

/** 上传的图片、视频在小抄背景列表里当作一项收藏，背景地址用这个前缀指向本机存的文件。 */
export const UPLOADED_BACKGROUND_URL_PREFIX = 'xc-upload:';

/** 上传项的收藏编号前缀。 */
export const UPLOADED_BACKGROUND_FAVORITE_ID_PREFIX = 'upload:';

/** 本机文件键：账号键后面接这一段，再接上传编号。 */
export const UPLOADED_BACKGROUND_FILE_KEY_SEPARATOR = ':upload:';

export const UPLOADED_BACKGROUND_VIDEO_NAME = '我的视频';
export const UPLOADED_BACKGROUND_IMAGE_NAME = '我的图片';

export const UPLOADED_BACKGROUND_FILE_ACCEPT = 'image/png,image/jpeg,image/webp,video/mp4,video/webm,.mp4,.webm';

/** 视频预览图取第几秒的画面，视频比这短时取中间。 */
export const UPLOADED_BACKGROUND_PREVIEW_SEEK_SECONDS = 1;
/** 预览图宽度，列表格子只有 95 宽，取大一点裁切后仍清楚。 */
export const UPLOADED_BACKGROUND_PREVIEW_WIDTH = 320;
export const UPLOADED_BACKGROUND_PREVIEW_JPEG_QUALITY = 0.8;
export const UPLOADED_BACKGROUND_PREVIEW_TIMEOUT_MS = 8_000;

/** 列表最后的上传格子。 */
export const UPLOAD_TILE_FILL = 'rgba(26,22,19,0.6)';
export const UPLOAD_TILE_BORDER = '#8A7650';
export const UPLOAD_TILE_TEXT_COLOR = '#DDCF98';
export const UPLOAD_TILE_PLUS_FONT_SIZE = 28;
export const UPLOAD_TILE_LABEL = '上传图片/视频';
export const UPLOAD_TILE_LABEL_FONT_SIZE = 12;

/** 上传项的名字取文件名，去掉扩展名。没有文件名时按类型给个默认名。 */
export function uploadedBackgroundName(fileName: string, isVideo: boolean): string {
  const base = String(fileName || '').replace(/\.[^./\\]+$/, '').trim();
  if (base) return base;
  return isVideo ? UPLOADED_BACKGROUND_VIDEO_NAME : UPLOADED_BACKGROUND_IMAGE_NAME;
}

export function uploadedBackgroundUrl(id: string): string {
  return `${UPLOADED_BACKGROUND_URL_PREFIX}${id}`;
}

export function isUploadedBackgroundUrl(url: unknown): boolean {
  return String(url || '').startsWith(UPLOADED_BACKGROUND_URL_PREFIX);
}

export function uploadedBackgroundIdFromUrl(url: unknown): string {
  const text = String(url || '');
  return text.startsWith(UPLOADED_BACKGROUND_URL_PREFIX) ? text.slice(UPLOADED_BACKGROUND_URL_PREFIX.length) : '';
}

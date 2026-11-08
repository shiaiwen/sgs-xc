/**
 * 小抄背景列表缩略图。
 * 格子不能直接塞全图，也不能只靠经常打不开的大图地址。
 * 做法：优先试大图地址，否则下载全图，缩小后转成 data URL。
 */

const STATIC_DIR = '/big/static/';
const BIG_SKIN_DIR = '/big/bigSkin/';
/** 缩略图最长边不超过 784×476，jpeg 质量 0.82。 */
const THUMB_MAX_WIDTH = 784;
const THUMB_MAX_HEIGHT = 476;
const THUMB_JPEG_QUALITY = 0.82;

const thumbCache = new Map<string, Promise<string>>();
/** 已完成的 data URL，供首帧同步 peek，避免先画全图再替换闪一下。 */
const thumbResolved = new Map<string, string>();

/** 若该源图缩略图已算完，同步返回 data URL；否则空串。 */
export function peekFavoriteListThumbDataUrl(sourceUrl: string): string {
  const url = String(sourceUrl || '').trim();
  if (!url) return '';
  if (url.startsWith('data:')) return url;
  return thumbResolved.get(url) || '';
}

export type FavoriteThumbBg = {
  skin?: unknown;
  loadImage?: (...args: unknown[]) => unknown;
  loadComplete?: (texture: unknown, url: string) => unknown;
  __xcFavoriteDataUrlLoadPatched?: boolean;
  [key: string]: unknown;
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

async function fetchFavoriteImage(sourceUrl: string): Promise<Response> {
  const url = String(sourceUrl || '').trim();
  if (!url) throw new Error('empty favorite preview url');
  if (url.includes(STATIC_DIR)) {
    const bigSkinUrl = url.split(STATIC_DIR).join(BIG_SKIN_DIR);
    try {
      const bigSkinResponse = await fetch(bigSkinUrl);
      if (bigSkinResponse.ok) return bigSkinResponse;
    } catch {
      // bigSkin 常 404，回落 static
    }
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`favorite preview download failed: ${response.status}`);
  return response;
}

/** 生成列表用 data URL；同 URL 共用进行中的 Promise。 */
export function resolveFavoriteListThumbDataUrl(sourceUrl: string): Promise<string> {
  const url = String(sourceUrl || '').trim();
  if (!url) return Promise.resolve('');
  if (url.startsWith('data:')) return Promise.resolve(url);
  const cached = thumbCache.get(url);
  if (cached) return cached;
  const pending = (async () => {
    const response = await fetchFavoriteImage(url);
    const blob = await response.blob();
    let dataUrl: string;
    // Always downscale before data URL; never feed full static into the 95x40 cell.
    let sourceImage;
    if (typeof createImageBitmap === 'function') {
      sourceImage = await createImageBitmap(blob);
    } else {
      sourceImage = await new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('favorite preview image decode failed'));
        };
        image.src = objectUrl;
      });
    }
    try {
      const sourceWidth = Math.max(1, Number(sourceImage.width) || Number(sourceImage.naturalWidth) || 1);
      const sourceHeight = Math.max(1, Number(sourceImage.height) || Number(sourceImage.naturalHeight) || 1);
      const scale = Math.min(THUMB_MAX_WIDTH / sourceWidth, THUMB_MAX_HEIGHT / sourceHeight, 1);
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas 2d unavailable');
      context.drawImage(sourceImage, 0, 0, width, height);
      const out = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', THUMB_JPEG_QUALITY);
      });
      dataUrl = out
        ? await blobToDataUrl(out)
        : canvas.toDataURL('image/jpeg', THUMB_JPEG_QUALITY);
    } finally {
      if (sourceImage && typeof sourceImage.close === 'function') sourceImage.close();
    }
    thumbResolved.set(url, dataUrl);
    return dataUrl;
  })().catch((error) => {
    thumbCache.delete(url);
    thumbResolved.delete(url);
    throw error;
  });
  thumbCache.set(url, pending);
  return pending;
}

type LayaLike = {
  loader?: { load?: (...args: unknown[]) => unknown };
  Handler?: { create?: (caller: unknown, method: (...args: unknown[]) => unknown) => unknown };
  Loader?: { IMAGE?: unknown };
};

/** Laya 图片默认加载不吃 data: 地址，改走加载器。 */
export function patchFavoriteBgLoadImageForDataUrl(
  background: FavoriteThumbBg | null | undefined,
  laya: LayaLike | null | undefined
): void {
  if (!background || background.__xcFavoriteDataUrlLoadPatched) return;
  const native = background.loadImage;
  if (typeof native !== 'function') return;
  background.loadImage = function (this: FavoriteThumbBg, ...args: unknown[]) {
    const skin = String(this.skin || '');
    if (!skin.startsWith('data:')) {
      return native.apply(this, args);
    }
    const loader = laya?.loader;
    const Handler = laya?.Handler;
    const imageType = laya?.Loader?.IMAGE;
    if (typeof loader?.load !== 'function' || typeof Handler?.create !== 'function') {
      return native.apply(this, args);
    }
    const complete = Handler.create(this, (texture: unknown) => {
      if (typeof this.loadComplete === 'function') this.loadComplete(texture, skin);
    });
    return loader.load(skin, complete, null, imageType);
  };
  background.__xcFavoriteDataUrlLoadPatched = true;
}

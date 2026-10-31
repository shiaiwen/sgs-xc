/**
 * 自定义背景文件：识别图片/视频并读取宽高，上传前校验能否解码。
 */

/** 与上传前探测、局内视频首帧等待共用。 */
export const CUSTOM_BACKGROUND_MEDIA_PROBE_TIMEOUT_MS = 20_000;

const VIDEO_NAME = /\.(mp4|webm|m4v)$/i;
const IMAGE_NAME = /\.(png|jpe?g|webp|gif|bmp)$/i;

export interface CustomBackgroundProbeResult {
  isVideo: boolean;
  width: number;
  height: number;
  mime: string;
}

export function detectCustomBackgroundVideo(file: Blob, fileName = ''): boolean {
  const mime = String(file.type || '').toLowerCase();
  if (mime.startsWith('video/')) return true;
  const name = fileName || (file instanceof File ? file.name : '');
  return VIDEO_NAME.test(name);
}

export function detectCustomBackgroundImage(file: Blob, fileName = ''): boolean {
  const mime = String(file.type || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  const name = fileName || (file instanceof File ? file.name : '');
  return IMAGE_NAME.test(name);
}

export function assertCustomBackgroundMediaKind(file: Blob, fileName = ''): void {
  if (detectCustomBackgroundVideo(file, fileName) || detectCustomBackgroundImage(file, fileName)) return;
  throw new Error('请选择图片或视频文件');
}

export async function probeCustomBackgroundFile(file: File): Promise<CustomBackgroundProbeResult> {
  assertCustomBackgroundMediaKind(file, file.name);
  const isVideo = detectCustomBackgroundVideo(file, file.name);
  const url = URL.createObjectURL(file);
  const element = document.createElement(isVideo ? 'video' : 'img');
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('读取文件超时')),
        CUSTOM_BACKGROUND_MEDIA_PROBE_TIMEOUT_MS
      );
      const finish = (error?: Error) => {
        window.clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      element.onerror = () => finish(new Error('无法读取此文件，请使用浏览器支持的图片或视频格式'));
      if (isVideo) {
        const video = element as HTMLVideoElement;
        video.muted = true;
        video.preload = 'metadata';
        video.playsInline = true;
        video.onloadedmetadata = () => finish();
      } else {
        (element as HTMLImageElement).onload = () => finish();
      }
      element.src = url;
    });
    const width = isVideo
      ? (element as HTMLVideoElement).videoWidth
      : (element as HTMLImageElement).naturalWidth;
    const height = isVideo
      ? (element as HTMLVideoElement).videoHeight
      : (element as HTMLImageElement).naturalHeight;
    if (!width || !height) throw new Error('无法识别文件尺寸');
    const mime = String(file.type || '').toLowerCase()
      || (isVideo ? 'video/mp4' : 'image/png');
    return { isVideo, width, height, mime };
  } finally {
    element.onerror = null;
    if (isVideo) {
      const video = element as HTMLVideoElement;
      video.onloadedmetadata = null;
      try {
        video.pause();
      } catch {
        // 忽略暂停失败。
      }
      video.removeAttribute('src');
      video.load();
    } else {
      (element as HTMLImageElement).onload = null;
      element.removeAttribute('src');
    }
    URL.revokeObjectURL(url);
  }
}

export function blobForBackgroundPlayback(blob: Blob, isVideo: boolean, mimeHint = ''): Blob {
  if (blob.type) return blob;
  const mime = mimeHint || (isVideo ? 'video/mp4' : 'image/png');
  return new Blob([blob], { type: mime });
}

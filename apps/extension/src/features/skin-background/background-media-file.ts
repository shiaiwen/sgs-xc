/**
 * 上传的背景文件：识别图片/视频并读取宽高，上传前校验能否解码，生成列表预览图。
 */

import {
  UPLOADED_BACKGROUND_PREVIEW_JPEG_QUALITY,
  UPLOADED_BACKGROUND_PREVIEW_SEEK_SECONDS,
  UPLOADED_BACKGROUND_PREVIEW_TIMEOUT_MS,
  UPLOADED_BACKGROUND_PREVIEW_WIDTH
} from '../../const/uploaded-background.ts';

/** 与上传前探测、局内视频首帧等待共用。 */
export const BACKGROUND_MEDIA_PROBE_TIMEOUT_MS = 20_000;

const VIDEO_NAME = /\.(mp4|webm|m4v)$/i;
const IMAGE_NAME = /\.(png|jpe?g|webp|gif|bmp)$/i;

export interface BackgroundFileProbeResult {
  isVideo: boolean;
  width: number;
  height: number;
  mime: string;
}

export function detectBackgroundVideoFile(file: Blob, fileName = ''): boolean {
  const mime = String(file.type || '').toLowerCase();
  if (mime.startsWith('video/')) return true;
  const name = fileName || (file instanceof File ? file.name : '');
  return VIDEO_NAME.test(name);
}

export function detectBackgroundImageFile(file: Blob, fileName = ''): boolean {
  const mime = String(file.type || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  const name = fileName || (file instanceof File ? file.name : '');
  return IMAGE_NAME.test(name);
}

export function assertBackgroundMediaFile(file: Blob, fileName = ''): void {
  if (detectBackgroundVideoFile(file, fileName) || detectBackgroundImageFile(file, fileName)) return;
  throw new Error('请选择图片或视频文件');
}

export async function probeBackgroundFile(file: File): Promise<BackgroundFileProbeResult> {
  assertBackgroundMediaFile(file, file.name);
  const isVideo = detectBackgroundVideoFile(file, file.name);
  const url = URL.createObjectURL(file);
  const element = document.createElement(isVideo ? 'video' : 'img');
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('读取文件超时')),
        BACKGROUND_MEDIA_PROBE_TIMEOUT_MS
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

/** 视频取一帧画成图片，读不出画面时返回空。 */
async function captureVideoFrame(blob: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    const ready = await new Promise<boolean>((resolve) => {
      const timeout = window.setTimeout(() => resolve(false), UPLOADED_BACKGROUND_PREVIEW_TIMEOUT_MS);
      const finish = (ok: boolean) => {
        window.clearTimeout(timeout);
        resolve(ok);
      };
      video.onerror = () => finish(false);
      video.onseeked = () => finish(true);
      video.onloadeddata = () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        video.currentTime = Math.min(UPLOADED_BACKGROUND_PREVIEW_SEEK_SECONDS, duration / 2);
      };
      video.src = url;
    });
    if (!ready || !video.videoWidth || !video.videoHeight) return null;
    const canvas = document.createElement('canvas');
    canvas.width = UPLOADED_BACKGROUND_PREVIEW_WIDTH;
    canvas.height = Math.round(UPLOADED_BACKGROUND_PREVIEW_WIDTH * video.videoHeight / video.videoWidth);
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', UPLOADED_BACKGROUND_PREVIEW_JPEG_QUALITY);
    });
  } catch {
    return null;
  } finally {
    video.onerror = null;
    video.onseeked = null;
    video.onloadeddata = null;
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** 列表格子用的预览图地址。图片直接用本身，视频取一帧。用完由调用方释放。 */
export async function createBackgroundPreviewUrl(blob: Blob, isVideo: boolean): Promise<string> {
  if (!isVideo) return URL.createObjectURL(blob);
  const frame = await captureVideoFrame(blob);
  return frame ? URL.createObjectURL(frame) : '';
}

export function blobForBackgroundPlayback(blob: Blob, isVideo: boolean, mimeHint = ''): Blob {
  if (blob.type) return blob;
  const mime = mimeHint || (isVideo ? 'video/mp4' : 'image/png');
  return new Blob([blob], { type: mime });
}

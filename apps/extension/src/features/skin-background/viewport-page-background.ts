/**
 * 画布比例与窗口不一致时，画布外和画布内留白都需要 DOM 全屏铺底。
 */

import { BACKGROUND_RESOURCE_TYPE_VIDEO } from '../../const/background-resource-type.ts';
import { DOM_LAYA_HOST_Z_INDEX, DOM_PAGE_BG_Z_INDEX } from '../../const/stage.ts';

const MARKER = 'data-xc-viewport-page-bg';
const HOST_ID = 'xcViewportPageBgHost';
const HTML_CLASS = 'xc-skin-page-bg';
const STYLE_ID = 'xc-skin-page-bg-style';

const LAYA_HOST_SELECTORS = ['#layaContainer', '#laya_container', '#GameDiv', '#layaStage'];

export interface ViewportPageBackgroundResource {
  url: string;
  type: number;
}

export interface ViewportPageBackground {
  apply(resource: ViewportPageBackgroundResource): void;
  /** 只铺 html/容器 margin，不插全屏 fixed 层，避免盖住 canvas。 */
  applyMargins(resource: ViewportPageBackgroundResource): void;
  clear(): void;
}

function ensureStyleSheet(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
html.${HTML_CLASS},
html.${HTML_CLASS} body {
  margin: 0;
  min-height: 100%;
  background-color: #080808 !important;
  background-size: cover !important;
  background-position: center center !important;
  background-repeat: no-repeat !important;
}
html.${HTML_CLASS} canvas {
  background: transparent !important;
}
html.${HTML_CLASS} #layaContainer,
html.${HTML_CLASS} #laya_container,
html.${HTML_CLASS} #GameDiv {
  background-size: cover !important;
  background-position: center center !important;
  background-repeat: no-repeat !important;
}
`.trim();
  document.head.appendChild(style);
}

function cssBackground(url: string): string {
  return `url(${JSON.stringify(url)})`;
}

function ensureHost(): HTMLElement {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute(MARKER, 'host');
    Object.assign(host.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
      pointerEvents: 'none',
      zIndex: String(DOM_PAGE_BG_Z_INDEX)
    });
    document.body.prepend(host);
  }
  return host;
}

function applyMediaStyle(el: HTMLElement): void {
  Object.assign(el.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    pointerEvents: 'none'
  });
}

/** 跨域 http(s) 用 CSS 铺底即可；只有 blob/data 才挂 img/video，避免左上角裂图。 */
function canUseDomMediaElement(url: string): boolean {
  return url.startsWith('blob:') || url.startsWith('data:');
}

const canvasBackgroundSnapshot = new WeakMap<HTMLCanvasElement, string>();

function setCanvasBackgroundTransparent(reveal: boolean): void {
  for (const canvas of document.querySelectorAll('canvas')) {
    if (!(canvas instanceof HTMLCanvasElement)) continue;
    if (reveal) {
      if (!canvasBackgroundSnapshot.has(canvas)) {
        canvasBackgroundSnapshot.set(canvas, canvas.style.background || '');
      }
      canvas.style.background = 'transparent';
      continue;
    }
    const previous = canvasBackgroundSnapshot.get(canvas);
    if (previous !== undefined) canvas.style.background = previous;
    else canvas.style.removeProperty('background');
    canvasBackgroundSnapshot.delete(canvas);
  }
}

function paintCssHosts(url: string): void {
  const bg = cssBackground(url);
  document.documentElement.style.setProperty('background-image', bg);
  document.body.style.setProperty('background-image', bg);
  for (const selector of LAYA_HOST_SELECTORS) {
    const node = document.querySelector(selector);
    if (!(node instanceof HTMLElement)) continue;
    node.style.setProperty('background-image', bg);
    node.style.position = node.style.position && node.style.position !== 'static' ? node.style.position : 'relative';
    node.style.zIndex = String(DOM_LAYA_HOST_Z_INDEX);
  }
}

function clearCssHosts(): void {
  setCanvasBackgroundTransparent(false);
  document.documentElement.classList.remove(HTML_CLASS);
  document.documentElement.style.backgroundImage = '';
  document.body.style.backgroundImage = '';
  document.body.style.backgroundColor = '';
  document.documentElement.style.backgroundColor = '';
  for (const selector of LAYA_HOST_SELECTORS) {
    const node = document.querySelector(selector);
    if (!(node instanceof HTMLElement)) continue;
    node.style.backgroundImage = '';
  }
}

function revealCanvasWhenBackgroundPaintable(url: string, onReady: () => void): void {
  if (!url.startsWith('blob:') && !url.startsWith('data:')) {
    const probe = new Image();
    probe.onload = () => onReady();
    probe.onerror = () => undefined;
    probe.src = url;
    return;
  }
  onReady();
}

let viewportPageBackgroundSingleton: ViewportPageBackground | null = null;

/** 进程内唯一实例，避免每次 create 清空另一份状态。 */
export function getViewportPageBackground(): ViewportPageBackground {
  if (!viewportPageBackgroundSingleton) viewportPageBackgroundSingleton = createViewportPageBackground();
  return viewportPageBackgroundSingleton;
}

/** 全视口铺底，与 Laya BackgroundLayer 同时使用。 */
export function createViewportPageBackground(): ViewportPageBackground {
  let activeUrl = '';
  let media: HTMLImageElement | HTMLVideoElement | null = null;

  function removeHostMedia(): void {
    const node = media;
    media = null;
    if (node?.getAttribute(MARKER) === '1') node.remove();
  }

  function clear(): void {
    activeUrl = '';
    removeHostMedia();
    clearCssHosts();
  }

  function applyMargins(resource: ViewportPageBackgroundResource): void {
    const url = String(resource.url || '').trim();
    if (!url) {
      clear();
      return;
    }
    if (activeUrl === url && document.documentElement.classList.contains(HTML_CLASS) && !media) return;
    removeHostMedia();
    activeUrl = url;
    ensureStyleSheet();
    document.documentElement.classList.add(HTML_CLASS);
    paintCssHosts(url);
    revealCanvasWhenBackgroundPaintable(url, () => setCanvasBackgroundTransparent(true));
  }

  function apply(resource: ViewportPageBackgroundResource): void {
    const url = String(resource.url || '').trim();
    if (!url) {
      clear();
      return;
    }
    const typeNum = Number(resource.type);
    if (activeUrl === url && media?.isConnected && document.documentElement.classList.contains(HTML_CLASS)) {
      if (typeNum === BACKGROUND_RESOURCE_TYPE_VIDEO && media instanceof HTMLVideoElement) {
        void media.play().catch(() => undefined);
      }
      return;
    }
    clear();
    activeUrl = url;
    ensureStyleSheet();
    document.documentElement.classList.add(HTML_CLASS);
    paintCssHosts(url);
    const revealCanvas = () => setCanvasBackgroundTransparent(true);
    if (!canUseDomMediaElement(url)) {
      removeHostMedia();
      revealCanvasWhenBackgroundPaintable(url, revealCanvas);
      return;
    }
    const host = ensureHost();
    const dropMediaOnFailure = () => {
      removeHostMedia();
      setCanvasBackgroundTransparent(false);
    };
    if (typeNum === BACKGROUND_RESOURCE_TYPE_VIDEO) {
      const video = document.createElement('video');
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = true;
      video.setAttribute(MARKER, '1');
      applyMediaStyle(video);
      video.addEventListener('error', dropMediaOnFailure, { once: true });
      video.addEventListener('loadeddata', revealCanvas, { once: true });
      host.appendChild(video);
      media = video;
      video.src = url;
      video.load();
      void video.play().catch(() => dropMediaOnFailure());
      return;
    }

    const image = document.createElement('img');
    image.setAttribute(MARKER, '1');
    applyMediaStyle(image);
    image.alt = '';
    image.addEventListener('error', dropMediaOnFailure, { once: true });
    image.addEventListener('load', revealCanvas, { once: true });
    host.appendChild(image);
    media = image;
    image.src = url;
  }

  return { apply, applyMargins, clear };
}

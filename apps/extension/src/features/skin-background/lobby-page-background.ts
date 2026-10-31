/**
 * 大厅等非对局界面：官方底图在 #bgDiv DOM 层，Laya BackgroundLayer 常被画布挡住。
 */

import { BACKGROUND_RESOURCE_TYPE_VIDEO } from '../../const/background-resource-type.ts';

const MARKER = 'data-xc-lobby-page-bg';
const VIDEO_ID = 'xcLobbyPageBgVideo';

/**
 * 仅「有 bgDiv、且同页没有 Laya 画布」时用 DOM 底图。
 * 浏览器 / webview 游戏页常有 bgDiv 命名冲突，必须让 Laya BackgroundLayer 接管。
 */
export function hasLobbyPageBackgroundContainer(): boolean {
  const bg = document.getElementById('bgDiv');
  if (!bg) return false;
  if (document.getElementById('layaContainer')
    || document.getElementById('laya_container')
    || document.getElementById('GameDiv')
    || document.querySelector('canvas')) {
    return false;
  }
  return true;
}

export interface LobbyPageBackgroundResource {
  url: string;
  type: number;
}

export interface LobbyPageBackground {
  apply(resource: LobbyPageBackgroundResource): void;
  clear(): void;
  isActive(): boolean;
}

type HiddenStyle = { visibility: string; display: string };
type HiddenPeerEntry = { element: HTMLElement; style: HiddenStyle };

function mountContainer(): HTMLElement | null {
  return document.getElementById('bgDiv');
}

function hidePeerMedia(container: HTMLElement, keep: HTMLElement): HiddenPeerEntry[] {
  const hidden: HiddenPeerEntry[] = [];
  for (const child of container.children) {
    if (child === keep || !(child instanceof HTMLElement)) continue;
    if (child instanceof HTMLImageElement || child instanceof HTMLVideoElement) {
      hidden.push({
        element: child,
        style: { visibility: child.style.visibility, display: child.style.display }
      });
      child.style.visibility = 'hidden';
      child.style.display = 'none';
    }
  }
  return hidden;
}

function restorePeers(hidden: HiddenPeerEntry[]): void {
  for (const { element, style } of hidden) {
    element.style.visibility = style.visibility;
    element.style.display = style.display;
  }
}

function applyMediaStyle(el: HTMLElement): void {
  el.style.position = 'absolute';
  el.style.left = '0';
  el.style.top = '0';
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.objectFit = 'cover';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '0';
}

let lobbyPageBackgroundSingleton: LobbyPageBackground | null = null;

/** 进程内唯一实例，避免每次 create 清空另一份状态。 */
export function getLobbyPageBackground(): LobbyPageBackground {
  if (!lobbyPageBackgroundSingleton) lobbyPageBackgroundSingleton = createLobbyPageBackground();
  return lobbyPageBackgroundSingleton;
}

/** 非对局全屏 DOM 背景，与 Laya 局内背景互斥。 */
export function createLobbyPageBackground(): LobbyPageBackground {
  let activeUrl = '';
  let hiddenPeers: HiddenPeerEntry[] = [];
  let media: HTMLImageElement | HTMLVideoElement | null = null;

  function clear(): void {
    activeUrl = '';
    restorePeers(hiddenPeers);
    hiddenPeers = [];
    const node = media;
    media = null;
    if (!node) return;
    if (node.getAttribute(MARKER) !== '1') return;
    if (node instanceof HTMLVideoElement) {
      try {
        node.pause();
        node.removeAttribute('src');
        node.load();
      } catch {
        // 忽略清理失败。
      }
    }
    node.remove();
  }

  function apply(resource: LobbyPageBackgroundResource): void {
    const url = String(resource.url || '').trim();
    if (!url) {
      clear();
      return;
    }
    const container = mountContainer();
    if (!container) return;

    const typeNum = Number(resource.type);
    if (activeUrl === url && media?.isConnected) {
      if (typeNum === BACKGROUND_RESOURCE_TYPE_VIDEO && media instanceof HTMLVideoElement) {
        void media.play().catch(() => undefined);
      }
      return;
    }

    clear();
    activeUrl = url;
    restorePeers(hiddenPeers);
    hiddenPeers = [];

    const hidePeersAfterReady = (node: HTMLImageElement | HTMLVideoElement) => {
      hiddenPeers = hidePeerMedia(container, node);
    };

    if (typeNum === BACKGROUND_RESOURCE_TYPE_VIDEO) {
      let video = document.getElementById(VIDEO_ID);
      if (!(video instanceof HTMLVideoElement)) {
        video = document.createElement('video');
        video.id = VIDEO_ID;
        container.appendChild(video);
      }
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = true;
      video.setAttribute(MARKER, '1');
      applyMediaStyle(video);
      media = video;
      video.addEventListener('error', () => clear(), { once: true });
      video.addEventListener('loadeddata', () => hidePeersAfterReady(video), { once: true });
      video.src = url;
      video.load();
      void video.play().catch(() => clear());
      return;
    }

    if (!url.startsWith('blob:') && !url.startsWith('data:')) return;

    const image = document.createElement('img');
    image.setAttribute(MARKER, '1');
    applyMediaStyle(image);
    image.alt = '';
    image.addEventListener('error', () => clear(), { once: true });
    image.addEventListener('load', () => hidePeersAfterReady(image), { once: true });
    container.appendChild(image);
    media = image;
    image.src = url;
  }

  return {
    apply,
    clear,
    isActive: () => Boolean(activeUrl)
  };
}

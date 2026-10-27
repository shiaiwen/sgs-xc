/**
 * 皮肤/背景渲染：应用本地皮肤与壁纸资源到游戏显示对象。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import type { BackgroundResource, SkinBackgroundStore } from './skin-background-store.ts';
import { asRecord, callMethod, type TaskScope, type UnknownRecord } from './skin-runtime.ts';

/** 背景整体压暗到 0.8，避免抢夺牌局前景。 */
const DIM_MATRIX = [0.8, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 1, 0];
const ACTIONS = ['ChuChang', 'GongJi', 'HuDong'];
const SPRITE_MARKER = '__xcSkinBackgroundSprite';

export type EffectClassKind = 'BaseEffect' | 'BaseSpineEffect';
type EffectConstructor = new () => UnknownRecord;

export interface SkinBackgroundRenderer {
  readonly resource: Partial<BackgroundResource>;
  hasBackground(): boolean;
  setBackground(resource?: Partial<BackgroundResource>, persist?: boolean): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
  /** 清除当前背景；forget 为 true 时同时删除本地记录（改用官方背景时）。 */
  clearBackground(forget?: boolean): void;
  /** 新版 Spine 背景播放出场、攻击、互动动作。 */
  playAction(name: string): boolean;
  rememberEffectClass(kind: EffectClassKind, constructor: unknown): void;
  dispose(): void;
}

export interface SkinBackgroundRendererOptions {
  globalObject: LayaRuntimeWindow;
  locator: LayaObjectLocator;
  store: SkinBackgroundStore;
  tasks: TaskScope;
}

/** 在 BackgroundLayer 上绘制静态图或骨骼动画背景。 */
export function createSkinBackgroundRenderer(options: SkinBackgroundRendererOptions): SkinBackgroundRenderer {
  const { globalObject, locator, store, tasks } = options;
  const effectClasses = new Map<EffectClassKind, EffectConstructor>();
  const resizeOwner = {};
  let resource: Partial<BackgroundResource> = store.loadResource();
  let sprite: UnknownRecord | undefined;
  let spriteUrl = '';
  let spriteSize = { width: 0, height: 0 };
  let idleEffects: Record<string, UnknownRecord> = {};
  let actionEffects: UnknownRecord[] = [];
  let actionToken = 0;
  let resizeBound = false;
  let videoElement: HTMLVideoElement | null = null;
  let videoBitmap: UnknownRecord | null = null;
  let videoDisplaySprite: UnknownRecord | null = null;
  let videoTexture: UnknownRecord | null = null;
  let videoDrawSize = { width: 0, height: 0 };
  let videoFrameLoop = false;
  let videoFrameRaf = 0;
  let lastVideoFrameTime = -1;

  const laya = () => asRecord(globalObject.Laya);
  const layaEvent = () => asRecord(laya()?.Event);
  const layaTimer = () => asRecord(laya()?.timer);

  function gameSize(): { width: number; height: number } {
    const context = asRecord((globalObject as unknown as { SystemContext?: unknown }).SystemContext);
    const stage = asRecord(laya()?.stage);
    return {
      width: Number(context?.gameWidth) || Number(stage?.width) || 0,
      height: Number(context?.gameHeight) || Number(stage?.height) || 0
    };
  }

  function layout(): void {
    if (!sprite) return;
    const { width, height } = gameSize();
    const scale = Math.max(
      spriteSize.width ? width / spriteSize.width : 1,
      spriteSize.height ? height / spriteSize.height : 1
    );
    callMethod(sprite, 'scale', scale, scale);
    callMethod(sprite, 'pos', width / 2, height / 2);
  }

  function bindResize(): void {
    if (resizeBound) return;
    const stage = asRecord(laya()?.stage);
    const eventName = layaEvent()?.RESIZE;
    if (!stage || !eventName) return;
    callMethod(stage, 'on', eventName, resizeOwner, layout);
    resizeBound = true;
  }

  function init(): boolean {
    if (sprite?._parent) return true;
    const layer = locator.layer('BackgroundLayer');
    const SpriteClass = laya()?.Sprite as (new () => UnknownRecord) | undefined;
    if (!layer || !SpriteClass) return false;
    sprite = sprite ?? asRecord(layer[SPRITE_MARKER]) ?? new SpriteClass();
    layer[SPRITE_MARKER] = sprite;
    callMethod(layer, 'addChild', sprite);
    sprite.zOrder = 0;
    const ColorFilter = laya()?.ColorFilter as (new (matrix: number[]) => unknown) | undefined;
    if (ColorFilter) sprite.filters = [new ColorFilter(DIM_MATRIX)];
    bindResize();
    return true;
  }

  function resolveEffectClass(kind: EffectClassKind): EffectConstructor | null {
    const cached = effectClasses.get(kind);
    if (cached) return cached;
    const selfSeatUi = asRecord(locator.gameScene()?.SelfSeatUi);
    try {
      const effect = asRecord(callMethod(selfSeatUi, 'getEffectType', kind === 'BaseEffect' ? 2 : 4));
      if (typeof effect?.constructor === 'function') {
        effectClasses.set(kind, effect.constructor as EffectConstructor);
        return effectClasses.get(kind)!;
      }
    } catch {
      // 回退到皮肤详情窗口。
    }
    if (kind === 'BaseEffect') {
      const prototype = locator.baseEffectPrototype();
      if (typeof prototype?.constructor === 'function') {
        effectClasses.set(kind, prototype.constructor as EffectConstructor);
        return effectClasses.get(kind)!;
      }
    }
    captureClassesFromSkinInfoWindow();
    return effectClasses.get(kind) ?? null;
  }

  /** 大厅没有座位时，临时建一个皮肤详情窗口读取特效类。 */
  function captureClassesFromSkinInfoWindow(): void {
    const win = locator.createInstance('SkinInfoWindow');
    const bigSprites = asRecord(win?.skinBigSps);
    if (!win || !bigSprites) return;
    try {
      Object.assign(win, { skinData: { skinBaseVo: {} }, generalinfo: { ItemID: 1 } });
      callMethod(win, 'showRightInfo');
      callMethod(bigSprites, 'CreateBgEffect');
      callMethod(bigSprites, 'CreateSpineEffect');
      rememberEffectClass('BaseEffect', asRecord(bigSprites.bgEffect)?.constructor);
      rememberEffectClass('BaseSpineEffect', asRecord(bigSprites.spineBg)?.constructor);
    } catch {
      // 取不到时该类型背景无法显示。
    } finally {
      try {
        callMethod(win, 'destroy', true);
      } catch {
        // 忽略临时窗口销毁失败。
      }
    }
  }

  function rememberEffectClass(kind: EffectClassKind, constructor: unknown): void {
    if (typeof constructor === 'function') effectClasses.set(kind, constructor as EffectConstructor);
  }

  function clearAction(): void {
    actionToken += 1;
    actionEffects.splice(0).forEach((effect) => callMethod(effect, 'destroy'));
    Object.values(idleEffects).forEach((effect) => {
      effect.visible = true;
    });
  }

  function mountVideoToDom(video: HTMLVideoElement): void {
    const body = globalObject.document?.body;
    if (!body || video.isConnected) return;
    video.style.cssText =
      'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
    body.appendChild(video);
  }

  function clearVideoFrameLoop(): void {
    videoFrameLoop = false;
    if (videoFrameRaf) {
      const cancel = globalObject.cancelAnimationFrame?.bind(globalObject) ?? globalThis.cancelAnimationFrame;
      cancel(videoFrameRaf);
      videoFrameRaf = 0;
    }
    const timer = layaTimer();
    const clear = timer?.clear;
    if (typeof clear === 'function') clear.call(timer, resizeOwner, drawVideoFrame);
  }

  function startVideoFrameLoop(): void {
    clearVideoFrameLoop();
    videoFrameLoop = true;
    const timer = layaTimer();
    const frameLoop = timer?.frameLoop;
    const loop = timer?.loop;
    if (typeof frameLoop === 'function') frameLoop.call(timer, 1, resizeOwner, drawVideoFrame);
    else if (typeof loop === 'function') loop.call(timer, 1, resizeOwner, drawVideoFrame);
    const raf = globalObject.requestAnimationFrame?.bind(globalObject) ?? globalThis.requestAnimationFrame;
    if (typeof raf !== 'function') return;
    const tick = (): void => {
      if (!videoFrameLoop || !videoElement) {
        videoFrameRaf = 0;
        return;
      }
      drawVideoFrame();
      videoFrameRaf = raf(tick);
    };
    videoFrameRaf = raf(tick);
  }

  function pauseVideoPlayback(): void {
    clearVideoFrameLoop();
    try {
      videoElement?.pause();
    } catch {
      // 忽略暂停失败。
    }
  }

  function stopVideoPlayback(): void {
    clearVideoFrameLoop();
    lastVideoFrameTime = -1;
    videoDisplaySprite = null;
    videoTexture = null;
    videoDrawSize = { width: 0, height: 0 };
    if (videoElement) {
      try {
        videoElement.pause();
        videoElement.removeAttribute('src');
        videoElement.load();
        videoElement.remove();
      } catch {
        // 忽略销毁失败。
      }
      videoElement = null;
    }
    if (videoBitmap) {
      try {
        callMethod(videoBitmap, 'destroy', false);
      } catch {
        // 忽略纹理销毁失败。
      }
      videoBitmap = null;
    }
  }

  function redrawVideoTexture(): void {
    const texture = videoTexture;
    const panel = videoDisplaySprite;
    const graphics = panel ? asRecord(panel.graphics) : null;
    if (!texture || !graphics) return;
    const { width, height } = videoDrawSize;
    callMethod(graphics, 'clear');
    callMethod(graphics, 'drawTexture', texture, -width / 2, -height / 2, width, height);
  }

  function drawVideoFrame(): void {
    const video = videoElement;
    const bitmap = videoBitmap;
    if (!video || !bitmap || video.readyState < 2) return;
    if (video.currentTime === lastVideoFrameTime) return;
    lastVideoFrameTime = video.currentTime;
    callMethod(bitmap, '_updateVideoData');
    redrawVideoTexture();
    if (videoDisplaySprite) callMethod(videoDisplaySprite, 'repaint');
    callMethod(sprite, 'repaint');
  }

  async function resumeVideoPlayback(): Promise<void> {
    if (Number(resource.type) !== 1 || !videoElement || !videoBitmap) return;
    if (!sprite?._parent && !(await tasks.poll(() => init(), 20, 500))) return;
    layout();
    try {
      await videoElement.play();
    } catch {
      return;
    }
    videoBitmap.updatable = true;
    lastVideoFrameTime = -1;
    drawVideoFrame();
    startVideoFrameLoop();
  }

  function clearContent(): void {
    stopVideoPlayback();
    clearAction();
    idleEffects = {};
    while (Number(sprite?.numChildren) > 0) {
      callMethod(callMethod(sprite, 'removeChildAt', 0), 'destroy');
    }
    spriteUrl = '';
  }

  function drawStatic(url: string, width: number, height: number): void {
    const SpriteClass = laya()?.Sprite as (new () => UnknownRecord) | undefined;
    if (!SpriteClass || !sprite) return;
    const image = new SpriteClass();
    callMethod(image, 'loadImage', url);
    callMethod(image, 'pos', -width / 2, -height / 2);
    callMethod(sprite, 'addChild', image);
  }

  async function waitVideoMetadata(video: HTMLVideoElement): Promise<void> {
    if (video.readyState >= 1) return;
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        video.removeEventListener('loadedmetadata', onReady);
        video.removeEventListener('error', onError);
        resolve();
      };
      const onError = () => {
        video.removeEventListener('loadedmetadata', onReady);
        video.removeEventListener('error', onError);
        reject(new Error('video metadata load failed'));
      };
      video.addEventListener('loadedmetadata', onReady);
      video.addEventListener('error', onError);
    });
  }

  async function drawVideo(url: string, width: number, height: number): Promise<void> {
    const documentObject = globalObject.document;
    const VideoTextureClass = laya()?.VideoTexture as (new () => UnknownRecord) | undefined;
    const TextureClass = laya()?.Texture as (new (source: unknown) => UnknownRecord) | undefined;
    const SpriteClass = laya()?.Sprite as (new () => UnknownRecord) | undefined;
    if (!documentObject || !VideoTextureClass || !TextureClass || !SpriteClass || !sprite) return;

    stopVideoPlayback();
    const video = documentObject.createElement('video');
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.src = url;
    videoElement = video;
    mountVideoToDom(video);

    try {
      await waitVideoMetadata(video);
    } catch {
      stopVideoPlayback();
      return;
    }
    if (videoElement !== video) return;

    const drawWidth = video.videoWidth > 0 ? video.videoWidth : width;
    const drawHeight = video.videoHeight > 0 ? video.videoHeight : height;
    spriteSize = { width: drawWidth, height: drawHeight };
    videoDrawSize = { width: drawWidth, height: drawHeight };

    const bitmap = new VideoTextureClass();
    bitmap.video = video;
    videoBitmap = bitmap;
    const texture = new TextureClass(bitmap);
    videoTexture = texture;
    const panel = new SpriteClass();
    videoDisplaySprite = panel;
    redrawVideoTexture();
    callMethod(sprite, 'addChild', panel);

    try {
      await video.play();
    } catch {
      stopVideoPlayback();
      return;
    }
    if (videoElement !== video) return;

    bitmap.updatable = true;
    lastVideoFrameTime = -1;
    drawVideoFrame();
    startVideoFrameLoop();
  }

  function drawEffects(url: string, type: number, width: number, height: number): void {
    const EffectClass = resolveEffectClass(type === 2 ? 'BaseEffect' : 'BaseSpineEffect');
    if (!EffectClass || !sprite) return;
    const extension = type === 2 ? 'sk' : 'json';
    const [parts, action] = type === 3
      ? [['beijing', 'daiji', 'qianjing'], 'DaiJi']
      : [['beijing', 'xingxiang'], 'play'];
    for (const part of parts) {
      const effect = new EffectClass();
      callMethod(sprite, 'addChild', effect);
      effect.AutoReleaseRes = true;
      callMethod(effect, 'InitEffect', `${url}/${part}.${extension}`, action, true);
      callMethod(effect, 'playEffect');
      if (type === 2) callMethod(effect, 'size', width, height);
      idleEffects[part] = effect;
    }
  }

  async function setBackground(next: Partial<BackgroundResource> = resource, persist = true): Promise<boolean> {
    const { url, type = 0, width = 0, height = 0 } = next;
    if (!url) return false;
    if (!sprite?._parent && !(await tasks.poll(() => init(), 20, 500))) return false;
    const typeNum = Number(type);
    const urlChanged = spriteUrl !== url;
    if (urlChanged) {
      clearContent();
      spriteSize = { width: Number(width), height: Number(height) };
      if (typeNum === 0) drawStatic(url, Number(width), Number(height));
      else if (typeNum === 1) await drawVideo(url, Number(width), Number(height));
      else drawEffects(url, typeNum, Number(width), Number(height));
      layout();
      spriteUrl = url;
      resource = { url, type: typeNum, width: Number(width), height: Number(height) };
      if (persist) store.saveResource(resource as BackgroundResource);
    } else if (typeNum === 1) {
      await resumeVideoPlayback();
    }
    return true;
  }

  function removeActionEffect(effect: UnknownRecord, idleKey: string, token: number): void {
    if (token !== actionToken) return;
    const index = actionEffects.indexOf(effect);
    if (index >= 0) actionEffects.splice(index, 1);
    callMethod(effect, 'destroy');
    if (idleEffects[idleKey]) idleEffects[idleKey].visible = true;
  }

  function playAction(name: string): boolean {
    if (!sprite?._parent || Number(resource.type) !== 3 || !ACTIONS.includes(name)) return false;
    const SpineClass = resolveEffectClass('BaseSpineEffect');
    if (!SpineClass || actionEffects.length) return false;
    clearAction();
    const token = actionToken;
    const parts = name === 'ChuChang' ? ['daiji', 'qianjing'] : ['xingxiang', 'qianjing'];
    const [first] = parts;
    for (const part of parts) {
      if (token !== actionToken) break;
      const idleKey = part === 'xingxiang' ? 'daiji' : part;
      if (idleEffects[idleKey]) idleEffects[idleKey].visible = false;
      const effect = new SpineClass();
      actionEffects.push(effect);
      callMethod(sprite, 'addChild', effect);
      effect.AutoReleaseRes = true;
      const done = () => {
        if (token !== actionToken) return;
        if (part === first) clearAction();
        else removeActionEffect(effect, idleKey, token);
      };
      callMethod(effect, 'once', layaEvent()?.STOPPED, resizeOwner, done);
      const loseEvent = (SpineClass as unknown as UnknownRecord).PLAY_NAME_LOSE;
      if (loseEvent) callMethod(effect, 'once', loseEvent, resizeOwner, done);
      callMethod(effect, 'InitEffect', `${resource.url}/${part}.json`, name, false);
      if (token !== actionToken) break;
      callMethod(effect, 'playEffect');
    }
    return true;
  }

  function clearBackground(forget = false): void {
    clearContent();
    resource = {};
    if (!forget) return;
    store.clearResource();
    const layer = locator.layer('BackgroundLayer');
    callMethod(sprite, 'removeSelf');
    if (layer && layer[SPRITE_MARKER] === sprite) delete layer[SPRITE_MARKER];
    sprite = undefined;
  }

  return {
    get resource() {
      return resource;
    },
    hasBackground: () => Boolean(resource.url || sprite || store.loadResource().url),
    setBackground,
    async setEnabled(enabled) {
      if (enabled) {
        // 启动时尚未登录，账号键可能不对；每次显示都以存储中当前账号的记录为准。
        const saved = store.loadResource();
        if (saved.url) resource = saved;
        await setBackground();
        if (Number(resource.type) === 1) await resumeVideoPlayback();
        return;
      }
      pauseVideoPlayback();
      clearAction();
      callMethod(sprite, 'removeSelf');
    },
    clearBackground,
    playAction,
    rememberEffectClass,
    dispose() {
      clearContent();
      callMethod(sprite, 'removeSelf');
      const stage = asRecord(laya()?.stage);
      if (resizeBound) callMethod(stage, 'off', layaEvent()?.RESIZE, resizeOwner, layout);
      resizeBound = false;
    }
  };
}

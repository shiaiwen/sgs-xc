/**
 * 皮肤/背景渲染：应用本地皮肤与壁纸资源到游戏显示对象。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import type { MethodPatcher } from '../../runtime/method-patch.ts';
import { BACKGROUND_DIM_MATRIX } from '../../const/background-dim.ts';
import {
  BACKGROUND_RESOURCE_TYPE_IMAGE,
  BACKGROUND_RESOURCE_TYPE_SK_EFFECT,
  BACKGROUND_RESOURCE_TYPE_SPINE,
  BACKGROUND_RESOURCE_TYPE_VIDEO
} from '../../const/background-resource-type.ts';
import { CUSTOM_BACKGROUND_Z_ORDER, DEFAULT_STAGE_HEIGHT, DEFAULT_STAGE_WIDTH } from '../../const/stage.ts';
import { isBackgroundDisplayReady } from './background-display-ready.ts';
import { isSkinFrameSize, resolveBackgroundSourceSize, uniformCoverScale } from './background-fit.ts';
import { CUSTOM_BACKGROUND_MEDIA_PROBE_TIMEOUT_MS } from './custom-background-media.ts';
import type { BackgroundResource, SkinBackgroundStore } from './skin-background-store.ts';
import { asRecord, callMethod, type TaskScope, type UnknownRecord } from './skin-runtime.ts';

const ACTIONS = ['ChuChang', 'GongJi', 'HuDong'];
const SPRITE_MARKER = '__xcSkinBackgroundSprite';

export type EffectClassKind = 'BaseEffect' | 'BaseSpineEffect';
type EffectConstructor = new () => UnknownRecord;

export interface SkinBackgroundRenderer {
  readonly resource: Partial<BackgroundResource>;
  hasBackground(): boolean;
  setBackground(resource?: Partial<BackgroundResource>, persist?: boolean): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<boolean>;
  /** 清除当前背景；forget 为 true 时同时删除本地记录（改用官方背景时）。 */
  clearBackground(forget?: boolean): void;
  /** 新版 Spine 背景播放出场、攻击、互动动作。 */
  playAction(name: string): boolean;
  rememberEffectClass(kind: EffectClassKind, constructor: unknown): void;
  /** 按全局背景开关与是否显示，同步官方底图遮挡与精灵挂载。 */
  syncSceneVisibility(shouldShow: boolean, allPaper: boolean): Promise<void>;
  /** 从当前账号的本地存储重新加载背景资源。 */
  reloadStoredResource(): Partial<BackgroundResource>;
  /** 场景切换后重扫官方壁纸层。 */
  onSceneChange(allPaper: boolean): void;
  /** 自定义背景是否已挂到 Laya 层上。 */
  isMounted(): boolean;
  /** 背景精灵是否挂在当前 BackgroundLayer 上。 */
  isLayerAttached(): boolean;
  dispose(): void;
}

export interface SkinBackgroundRendererOptions {
  globalObject: LayaRuntimeWindow;
  locator: LayaObjectLocator;
  store: SkinBackgroundStore;
  tasks: TaskScope;
  patcher?: MethodPatcher;
}

/** 在 BackgroundLayer 上绘制静态图或骨骼动画背景。 */
export function createSkinBackgroundRenderer(options: SkinBackgroundRendererOptions): SkinBackgroundRenderer {
  const { globalObject, locator, store, tasks, patcher } = options;
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
  let videoUsesCanvas = false;
  let videoCanvas: HTMLCanvasElement | null = null;
  let videoCanvasCtx: CanvasRenderingContext2D | null = null;
  type NativeBackgroundState = {
    blocked: boolean;
    layer: UnknownRecord;
    image: UnknownRecord | null;
    url?: unknown;
    visible?: unknown;
    layerBgVisible?: unknown;
  };
  let nativeBackground: NativeBackgroundState | null = null;
  let sceneBackgroundSnapshot: { node: UnknownRecord; visible: unknown } | null = null;
  let nativeBgSnapshot:
    | {
        bgSprite?: UnknownRecord;
        bgSpriteVisible?: unknown;
        bgEffect?: UnknownRecord;
        bgEffectVisible?: unknown;
      }
    | null = null;
  let stageBgSnapshot: unknown;
  let onLayoutResize: (() => void) | null = null;
  let videoFirstFrameDrawn = false;
  let globalLayerActive = false;
  let globalLayerSnapshot:
    | {
        layer: UnknownRecord;
        image: UnknownRecord;
        skin: unknown;
        visible: unknown;
        x: unknown;
        y: unknown;
        scaleX: unknown;
        scaleY: unknown;
        width: unknown;
        height: unknown;
        bgSpriteVisible: unknown;
      }
    | null = null;

  const laya = () => asRecord(globalObject.Laya);
  const layaEvent = () => asRecord(laya()?.Event);
  const layaTimer = () => asRecord(laya()?.timer);

  function gameSize(): { width: number; height: number } {
    const context = asRecord((globalObject as unknown as { SystemContext?: unknown }).SystemContext);
    const stage = asRecord(laya()?.stage);
    const width = Number(context?.gameWidth) || Number(stage?.width) || DEFAULT_STAGE_WIDTH;
    const height = Number(context?.gameHeight) || Number(stage?.height) || DEFAULT_STAGE_HEIGHT;
    return { width, height };
  }

  function customPictureReady(): boolean {
    const flat = asRecord(sprite?.bg);
    const bitmap = bitmapSize(flat);
    const typeNum = Number(resource.type) || BACKGROUND_RESOURCE_TYPE_IMAGE;
    const video = videoElement;
    return isBackgroundDisplayReady({
      type: typeNum,
      bitmapWidth: bitmap.width,
      bitmapHeight: bitmap.height,
      videoFrameReady: Boolean(video && video.readyState >= 2 && videoFirstFrameDrawn),
      videoDrawWidth: videoDrawSize.width,
      videoDrawHeight: videoDrawSize.height,
      effectIdleCount: Object.keys(idleEffects).length
    });
  }

  function globalNativeLayerReady(): boolean {
    const flat = globalLayerSnapshot?.image;
    const bitmap = bitmapSize(flat ?? null);
    return bitmap.width > 0 && bitmap.height > 0;
  }

  /** 自己的图还没画出来时，留下游戏原来的底图，避免整屏变黑。 */
  function revealCustomBackground(): void {
    if (!customPictureReady()) {
      if (sprite) sprite.visible = false;
      restoreNativeGameBackground();
      return;
    }
    if (sprite) sprite.visible = true;
    layout();
    raiseSpriteAboveWallpaper();
    suppressNativeGameBackground();
    applyStageBackdrop(true);
  }

  function applyStageBackdrop(active: boolean): void {
    const stage = asRecord(laya()?.stage);
    if (!stage) return;
    if (active) {
      if (stageBgSnapshot === undefined) stageBgSnapshot = stage.bgColor;
      stage.bgColor = null;
      return;
    }
    if (stageBgSnapshot !== undefined) {
      stage.bgColor = stageBgSnapshot;
      stageBgSnapshot = undefined;
    }
  }

  function bitmapSize(node: UnknownRecord | null): { width: number; height: number } {
    const texture = asRecord(node?.texture);
    return {
      width: Number(texture?.sourceWidth) || Number(texture?.width) || 0,
      height: Number(texture?.sourceHeight) || Number(texture?.height) || 0
    };
  }

  /** 按原图像素铺满。宽高用同一个倍数，不用皮肤窗口那一格的宽高去拉图片。 */
  function layoutNativeLayerBg(flat: UnknownRecord, imgW: number, imgH: number): void {
    const { width, height } = gameSize();
    const bitmap = bitmapSize(flat);
    const source = resolveBackgroundSourceSize(bitmap.width, bitmap.height, imgW, imgH);
    const sourceW = source.width;
    const sourceH = source.height;
    const scale = uniformCoverScale(width, height, sourceW, sourceH);
    flat.visible = true;
    if (typeof flat.scale === 'function') callMethod(flat, 'scale', scale, scale);
    else {
      flat.scaleX = scale;
      flat.scaleY = scale;
    }
    if (typeof flat.pos === 'function') callMethod(flat, 'pos', width / 2, height / 2);
    else {
      flat.x = width / 2;
      flat.y = height / 2;
    }
    if (sourceW > 0 && sourceH > 0) callMethod(flat, 'size', sourceW, sourceH);
  }

  function restoreGlobalLayerBackground(): void {
    globalLayerActive = false;
    const snap = globalLayerSnapshot;
    globalLayerSnapshot = null;
    if (!snap?.image || snap.image.destroyed === true) return;
    snap.image.skin = snap.skin;
    snap.image.visible = snap.visible;
    snap.image.x = snap.x;
    snap.image.y = snap.y;
    snap.image.scaleX = snap.scaleX;
    snap.image.scaleY = snap.scaleY;
    const width = Number(snap.width);
    const height = Number(snap.height);
    if (width > 0 && height > 0) callMethod(snap.image, 'size', width, height);
    const bgSprite = asRecord(snap.layer.bgSprite);
    if (bgSprite && snap.bgSpriteVisible !== undefined) bgSprite.visible = snap.bgSpriteVisible;
  }

  function rememberGlobalLayerSnapshot(
    layer: UnknownRecord,
    layerBg: UnknownRecord,
    bgSprite: UnknownRecord | null
  ): void {
    if (globalLayerSnapshot?.image === layerBg) return;
    restoreGlobalLayerBackground();
    globalLayerSnapshot = {
      layer,
      image: layerBg,
      skin: layerBg.skin,
      visible: layerBg.visible,
      x: layerBg.x,
      y: layerBg.y,
      scaleX: layerBg.scaleX,
      scaleY: layerBg.scaleY,
      width: layerBg.width,
      height: layerBg.height,
      bgSpriteVisible: bgSprite?.visible
    };
  }

  /** 全局背景：直接替换 BackgroundLayer.bg 官方壁纸平面。失败时不改 sprite 状态。 */
  function applyGlobalBackgroundToLayer(next: Partial<BackgroundResource>): boolean {
    try {
      const url = String(next.url || '').trim();
      if (!url) return false;
      const layer = backgroundLayer();
      const layerBg = asRecord(layer?.bg);
      const bgSprite = asRecord(layer?.bgSprite);
      if (!layer || !layerBg) return false;

      rememberGlobalLayerSnapshot(layer, layerBg, bgSprite);
      globalLayerActive = true;
      if (nativeBackground?.image === layerBg) nativeBackground.blocked = false;

      if (bgSprite) bgSprite.visible = false;
      layerBg.visible = true;

      const imgW = Number(next.width) || 0;
      const imgH = Number(next.height) || 0;
      if (typeof layerBg.loadImage === 'function') callMethod(layerBg, 'loadImage', url);
      else layerBg.skin = url;
      layoutNativeLayerBg(layerBg, imgW, imgH);

      const event = layaEvent()?.COMPLETE;
      if (event) {
        callMethod(layerBg, 'off', event, resizeOwner, onNativeLayerBgLoaded);
        callMethod(layerBg, 'once', event, resizeOwner, onNativeLayerBgLoaded);
      }

      detachOwnSprite();
      if (sprite) sprite.visible = false;
      spriteUrl = url;
      persistResourceRecord({
        url,
        type: Number(next.type) || 0,
        width: imgW,
        height: imgH
      });
      return true;
    } catch (error) {
      console.warn('[皮肤做背景] 全局壁纸层替换失败:', error);
      restoreGlobalLayerBackground();
      return false;
    }
  }

  function persistResourceRecord(next: Partial<BackgroundResource>): void {
    const url = String(next.url || '').trim();
    if (!url) return;
    let width = Number(next.width) || 0;
    let height = Number(next.height) || 0;
    if (!(width > 0 && height > 0)) {
      const size = gameSize();
      width = size.width || DEFAULT_STAGE_WIDTH;
      height = size.height || DEFAULT_STAGE_HEIGHT;
    }
    const record: BackgroundResource = {
      url,
      type: Number(next.type) || 0,
      width,
      height
    };
    resource = record;
    store.saveResource(record);
  }

  function onNativeLayerBgLoaded(this: UnknownRecord): void {
    if (!globalLayerActive) return;
    const texture = asRecord(this.texture);
    const width = Number(texture?.width) || Number(resource.width) || 0;
    const height = Number(texture?.height) || Number(resource.height) || 0;
    layoutNativeLayerBg(this, width, height);
    if (resource.url) persistResourceRecord({ ...resource, width, height });
    if (globalNativeLayerReady()) applyStageBackdrop(true);
  }

  function relayoutGlobalNativeLayer(): void {
    if (!globalLayerActive) return;
    const flat = globalLayerSnapshot?.image;
    if (!flat || flat.destroyed === true) return;
    const texture = asRecord(flat.texture);
    layoutNativeLayerBg(
      flat,
      Number(texture?.width) || Number(resource.width) || 0,
      Number(texture?.height) || Number(resource.height) || 0
    );
  }

  function placeFlatAtSpriteCenter(flat: UnknownRecord, sourceW: number, sourceH: number): void {
    callMethod(flat, 'size', sourceW, sourceH);
    const offsetX = -sourceW / 2;
    const offsetY = -sourceH / 2;
    if (typeof flat.posInteger === 'function') callMethod(flat, 'posInteger', offsetX, offsetY);
    else if (typeof flat.pos === 'function') callMethod(flat, 'pos', offsetX, offsetY);
    else {
      flat.x = offsetX;
      flat.y = offsetY;
    }
  }

  function applySpriteLayoutFromStage(): void {
    if (!sprite) return;
    const { width, height } = gameSize();
    const flat = asRecord(sprite.bg);
    const bitmap = bitmapSize(flat);
    const source = resolveBackgroundSourceSize(
      bitmap.width,
      bitmap.height,
      spriteSize.width || Number(sprite.width) || 0,
      spriteSize.height || Number(sprite.height) || 0
    );
    if (source.width > 0 && source.height > 0) spriteSize = source;
    const scale = uniformCoverScale(width, height, source.width, source.height);
    callMethod(sprite, 'scale', scale, scale);
    callMethod(sprite, 'pos', width / 2, height / 2);
    if (flat && source.width > 0 && source.height > 0) placeFlatAtSpriteCenter(flat, source.width, source.height);
  }

  function layout(): void {
    applySpriteLayoutFromStage();
  }

  function bindSpriteStageResize(): void {
    if (!sprite || sprite.__xcPaperStageResizeBound === true) return;
    sprite.__xcPaperStageResizeBound = true;
    const original = sprite.OnStageResize;
    if (typeof original === 'function') sprite.__xcOnStageResizeOrig = original;
    sprite.OnStageResize = function (this: UnknownRecord) {
      const orig = this.__xcOnStageResizeOrig;
      const wrapped = this.OnStageResize;
      if (typeof orig === 'function') {
        this.OnStageResize = orig;
        try {
          orig.apply(this);
        } finally {
          this.OnStageResize = wrapped;
        }
      }
      applySpriteLayoutFromStage();
    };
    applySpriteLayoutFromStage();
  }

  function bindResize(): void {
    if (resizeBound) return;
    const stage = asRecord(laya()?.stage);
    const eventName = layaEvent()?.RESIZE;
    if (!stage || !eventName) return;
    onLayoutResize = () => {
      if (globalLayerActive) relayoutGlobalNativeLayer();
      else layout();
    };
    callMethod(stage, 'on', eventName, resizeOwner, onLayoutResize);
    globalObject.addEventListener?.('resize', onLayoutResize);
    resizeBound = true;
  }

  function ensureFlatBackgroundImage(): UnknownRecord | null {
    if (!sprite) return null;
    const existing = asRecord(sprite.bg);
    if (existing) return existing;
    const flat = locator.createInstance('SgsFlatImage')
      ?? (() => {
        const classUtils = asRecord(laya()?.ClassUtils);
        const ctor = classUtils?.getClass?.('SgsFlatImage') as (new () => UnknownRecord) | undefined;
        return typeof ctor === 'function' ? new ctor() : null;
      })();
    if (!flat) return null;
    sprite.bg = flat;
    callMethod(sprite, 'addChild', flat);
    return flat;
  }

  function backgroundLayer(): UnknownRecord | null {
    return locator.layer('BackgroundLayer');
  }

  /** 自定义底图 zOrder：紧贴官方壁纸 sibling 之上，不压过背景层其它玩法节点。 */
  function wallpaperStackZOrder(layer: UnknownRecord | null): number {
    if (!layer) return CUSTOM_BACKGROUND_Z_ORDER;
    const layerBg = asRecord(layer.bg);
    const bgSprite = asRecord(layer.bgSprite);
    const base = Math.max(Number(layerBg?.zOrder) || 0, Number(bgSprite?.zOrder) || 0);
    return base + 1;
  }

  function raiseSpriteAboveWallpaper(): void {
    if (!sprite) return;
    const layer = backgroundLayer();
    const next = wallpaperStackZOrder(layer);
    if (Number(sprite.zOrder) === next) return;
    sprite.zOrder = next;
    if (layer && typeof layer.updateZOrder === 'function') callMethod(layer, 'updateZOrder');
  }

  function isLayerAttached(): boolean {
    const layer = backgroundLayer();
    if (!sprite || sprite.destroyed === true || !layer || layer.destroyed === true) return false;
    let node: UnknownRecord | null = sprite;
    while (node) {
      if (node === layer) return true;
      node = asRecord(node._parent ?? node.parent);
    }
    return false;
  }

  function needsBackgroundReapply(): boolean {
    if (!sprite || sprite.destroyed === true) return true;
    if (!isLayerAttached()) return true;
    if (Number(resource.type) === BACKGROUND_RESOURCE_TYPE_IMAGE || !resource.type) {
      const flat = asRecord(sprite.bg);
      const texture = asRecord(flat?.texture);
      const skin = String(flat?.skin ?? sprite.url ?? '').trim();
      if (!texture?.width && !skin) return true;
    }
    return false;
  }

  function init(): boolean {
    if (sprite?.destroyed === true) sprite = undefined;
    if (sprite?._parent && needsBackgroundReapply()) detachOwnSprite();
    if (sprite?._parent && !needsBackgroundReapply()) return true;
    const layer = backgroundLayer();
    if (!layer) return false;

    const officialBackground = asRecord(layer.myBg);
    const marked = asRecord(layer[SPRITE_MARKER]);
    if (!sprite || sprite === officialBackground) {
      sprite = marked && marked !== officialBackground ? marked : undefined;
    }
    if (!sprite || sprite === officialBackground) sprite = locator.createInstance('SgsSprite') ?? undefined;
    if (!sprite || sprite === officialBackground) {
      const SpriteClass = laya()?.Sprite as (new () => UnknownRecord) | undefined;
      if (!SpriteClass) return false;
      sprite = new SpriteClass();
    }

    layer[SPRITE_MARKER] = sprite;
    sprite.alpha = 1;
    const resourceWidth = Number(resource.width) || spriteSize.width || 0;
    const resourceHeight = Number(resource.height) || spriteSize.height || 0;
    if (resourceWidth > 0 && resourceHeight > 0) {
      sprite.width = resourceWidth;
      sprite.height = resourceHeight;
      if (!spriteSize.width) spriteSize = { width: resourceWidth, height: resourceHeight };
    }
    ensureFlatBackgroundImage();
    bindSpriteStageResize();

    if (!sprite._parent) {
      callMethod(layer, 'addChild', sprite);
      sprite.zOrder = wallpaperStackZOrder(layer);
      if (typeof layer.updateZOrder === 'function') callMethod(layer, 'updateZOrder');
    } else {
      raiseSpriteAboveWallpaper();
    }
    bindResize();
    return true;
  }

  /** 只摘掉自己盖上去的图。游戏原来的底图还要继续加载，摘掉的话开局会一直等。 */
  function detachOwnSprite(): void {
    if (!sprite) return;
    if (sprite === asRecord(backgroundLayer()?.myBg)) return;
    callMethod(sprite, 'removeSelf');
  }

  function setFlatBackgroundVisible(visible: boolean): void {
    const flat = asRecord(sprite?.bg);
    if (flat) flat.visible = visible;
  }

  function restoreSceneBackground(): void {
    const snap = sceneBackgroundSnapshot;
    sceneBackgroundSnapshot = null;
    if (!snap?.node || snap.node.destroyed === true) return;
    snap.node.visible = snap.visible;
  }

  function restoreNativeBackground(): void {
    const state = nativeBackground;
    nativeBackground = null;
    if (!state?.blocked) return;
    state.blocked = false;
    if (state.layer.destroyed === true) return;
    const bgSprite = asRecord(state.layer.bgSprite);
    if (bgSprite && state.visible !== undefined) bgSprite.visible = state.visible;
    const image = state.image;
    if (!image || image.destroyed === true) return;
    if (state.layerBgVisible !== undefined) image.visible = state.layerBgVisible;
    if (state.url && image.skin !== state.url) image.skin = state.url;
  }

  function restoreNativeGameBackground(): void {
    applyStageBackdrop(false);
    restoreGlobalLayerBackground();
    restoreSceneBackground();
    restoreNativeBackground();
    const snap = nativeBgSnapshot;
    nativeBgSnapshot = null;
    if (!snap) return;
    if (snap.bgSprite && snap.bgSpriteVisible !== undefined) snap.bgSprite.visible = snap.bgSpriteVisible;
    if (snap.bgEffect && snap.bgEffectVisible !== undefined) snap.bgEffect.visible = snap.bgEffectVisible;
  }

  /** 挡住 BackgroundLayer 官方壁纸 flat。 */
  function suppressNativeBackground(): void {
    if (globalLayerActive) return;
    const layer = asRecord(sprite?._parent) ?? backgroundLayer();
    const layerBg = asRecord(layer?.bg);
    const bgSprite = asRecord(layer?.bgSprite);
    if (!layer) return;
    if (!bgSprite && !layerBg) return;
    if (!bgSprite && layerBg) {
      let state = nativeBackground;
      if (state?.image === layerBg) {
        state.blocked = true;
        return;
      }
      if (state?.layer === layer && state.image !== layerBg) restoreNativeBackground();
      const nextState: NativeBackgroundState = {
        blocked: true,
        layer,
        image: layerBg,
        url: layerBg.skin,
        visible: undefined,
        layerBgVisible: layerBg.visible
      };
      nativeBackground = nextState;
      layerBg.visible = false;
      return;
    }
    if (!bgSprite) return;

    let state = nativeBackground;
    if (!layerBg) {
      if (state?.layer === layer) restoreNativeBackground();
      if (!state || state.layer !== layer) {
        state = {
          blocked: true,
          layer,
          image: null,
          visible: bgSprite.visible
        };
        nativeBackground = state;
      }
      state.blocked = true;
      bgSprite.visible = false;
      return;
    }

    if (state?.image === layerBg) {
      state.blocked = true;
      bgSprite.visible = false;
      return;
    }

    if (state?.layer === layer && state.image !== layerBg) restoreNativeBackground();

    const bgSpriteVisible = state?.layer === layer ? state.visible : bgSprite.visible;
    const nextState: NativeBackgroundState = {
      blocked: true,
      layer,
      image: layerBg,
      url: layerBg.skin,
      visible: bgSpriteVisible,
      layerBgVisible: layerBg.visible
    };
    nativeBackground = nextState;
    nextState.url = layerBg.skin;
    nextState.blocked = true;
    layerBg.visible = false;
    bgSprite.visible = false;
  }

  function syncSceneBackground(): void {
    restoreSceneBackground();
  }

  function suppressNativeGameBackground(): void {
    suppressNativeBackground();
    const snap: NonNullable<typeof nativeBgSnapshot> = {};
    const scene = locator.scene();
    const bgEffect = asRecord(locator.gameScene()?.bgEffect) ?? asRecord(scene?.bgEffect);
    if (bgEffect) {
      snap.bgEffect = bgEffect;
      snap.bgEffectVisible = bgEffect.visible;
      bgEffect.visible = false;
    }
    if (snap.bgEffect) nativeBgSnapshot = snap;
  }

  function reloadStoredResource(): Partial<BackgroundResource> {
    const saved = store.loadResource();
    const url = String(saved.url || '').trim();
    if (url) {
      resource = {
        url,
        type: Number(saved.type) || 0,
        width: Number(saved.width) || 0,
        height: Number(saved.height) || 0
      };
      if (spriteUrl !== url) spriteUrl = '';
    } else {
      resource = {};
      spriteUrl = '';
      if (globalLayerActive) restoreGlobalLayerBackground();
    }
    return resource;
  }

  function customBackgroundMounted(): boolean {
    if (!isLayerAttached() || !sprite || sprite.destroyed === true) return false;
    if (sprite.visible === false) return false;
    return true;
  }

  async function syncSceneVisibility(shouldShow: boolean, allPaper: boolean): Promise<void> {
    if (!shouldShow) {
      globalObject.removeEventListener?.('resize', relayoutGlobalNativeLayer);
      pauseVideoPlayback();
      detachOwnSprite();
      restoreGlobalLayerBackground();
      restoreNativeGameBackground();
      return;
    }
    if (!resource.url) reloadStoredResource();
    const url = String(resource.url || '').trim();
    if (!url) return;

    const inTable = Boolean(locator.gameScene());
    if (globalLayerActive && inTable) restoreGlobalLayerBackground();

    if (!customBackgroundMounted() && url) {
      await setBackground(resource, false);
    }
    if (!customBackgroundMounted() && allPaper && !inTable) {
      if (applyGlobalBackgroundToLayer(resource)) {
        globalObject.addEventListener?.('resize', relayoutGlobalNativeLayer);
        if (globalNativeLayerReady()) applyStageBackdrop(true);
        return;
      }
    }
    if (!customBackgroundMounted()) {
      restoreNativeGameBackground();
      return;
    }
    revealCustomBackground();
    if (customPictureReady()) syncSceneBackground();
    if (Number(resource.type) === BACKGROUND_RESOURCE_TYPE_VIDEO) await resumeVideoPlayback();
  }

  function onSceneChange(allPaper: boolean): void {
    const url = String(resource.url || '').trim();
    if (!url) {
      restoreNativeGameBackground();
      return;
    }
    void syncSceneVisibility(true, allPaper);
  }

  function applyPresentationFilter(typeNum: number): void {
    if (!sprite) return;
    const ColorFilter = laya()?.ColorFilter as (new (matrix: number[]) => unknown) | undefined;
    if (!ColorFilter) return;
    sprite.filters = typeNum === BACKGROUND_RESOURCE_TYPE_VIDEO ? null : [new ColorFilter(BACKGROUND_DIM_MATRIX)];
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

  function createVideoElement(): HTMLVideoElement {
    return globalObject.document!.createElement('video');
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
    if (typeof frameLoop === 'function') {
      frameLoop.call(timer, 1, resizeOwner, drawVideoFrame);
      return;
    }
    if (typeof loop === 'function') {
      loop.call(timer, 1, resizeOwner, drawVideoFrame);
      return;
    }
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
    videoFirstFrameDrawn = false;
    videoUsesCanvas = false;
    videoCanvas = null;
    videoCanvasCtx = null;
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

  function layoutFlatBackground(width: number, height: number): void {
    const flat = asRecord(sprite?.bg);
    if (!flat) return;
    if (typeof flat.posInteger === 'function') callMethod(flat, 'posInteger', -width / 2, -height / 2);
    else if (typeof flat.pos === 'function') callMethod(flat, 'pos', -width / 2, -height / 2);
    else {
      flat.x = -width / 2;
      flat.y = -height / 2;
    }
    if (typeof flat.size === 'function') callMethod(flat, 'size', width, height);
  }

  /** 视频帧贴到 SgsFlatImage；子 Sprite 的 graphics 在局内不显示。 */
  function redrawVideoTexture(): void {
    const texture = videoTexture;
    const flat = asRecord(sprite?.bg);
    if (!texture || !flat) return;
    const { width, height } = videoDrawSize;
    setFlatBackgroundVisible(true);
    flat.texture = texture;
    flat.skin = null;
    layoutFlatBackground(width, height);
    if (typeof flat.repaint === 'function') callMethod(flat, 'repaint');
  }

  function updateVideoBitmapData(bitmap: UnknownRecord): void {
    if (typeof bitmap._updateVideoData === 'function') callMethod(bitmap, '_updateVideoData');
    else if (typeof bitmap.onVideoMetaLoaded === 'function') callMethod(bitmap, 'onVideoMetaLoaded');
  }

  function refreshCanvasVideoTexture(): void {
    const video = videoElement;
    const canvas = videoCanvas;
    const ctx = videoCanvasCtx;
    const texture = videoTexture;
    if (!video || !canvas || !ctx || !texture || video.readyState < 2) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const bitmap = asRecord(texture.bitmap ?? texture);
    if (bitmap) bitmap.lock = false;
  }

  function drawVideoFrame(): void {
    const video = videoElement;
    if (!video || video.readyState < 2) return;
    if (video.currentTime === lastVideoFrameTime) return;
    lastVideoFrameTime = video.currentTime;
    videoFirstFrameDrawn = true;
    if (videoUsesCanvas) refreshCanvasVideoTexture();
    else {
      const bitmap = videoBitmap;
      if (!bitmap) return;
      updateVideoBitmapData(bitmap);
    }
    redrawVideoTexture();
    callMethod(sprite, 'repaint');
    if (customPictureReady()) revealCustomBackground();
  }

  async function resumeVideoPlayback(): Promise<void> {
    if (Number(resource.type) !== BACKGROUND_RESOURCE_TYPE_VIDEO || !videoElement) return;
    if (!videoUsesCanvas && !videoBitmap) return;
    if (!sprite?._parent && !(await tasks.poll(() => init(), 20, 500))) return;
    layout();
    await startVideoElementPlayback(videoElement);
    if (videoBitmap) videoBitmap.updatable = true;
    lastVideoFrameTime = -1;
    if (videoUsesCanvas) refreshCanvasVideoTexture();
    else if (videoBitmap) updateVideoBitmapData(videoBitmap);
    redrawVideoTexture();
    drawVideoFrame();
    startVideoFrameLoop();
  }

  function clearContent(): void {
    stopVideoPlayback();
    clearAction();
    idleEffects = {};
    const flat = asRecord(sprite?.bg);
    const destroyTargets: UnknownRecord[] = [];
    const count = Number(sprite?.numChildren ?? 0);
    for (let index = 0; index < count; index += 1) {
      const child = asRecord(callMethod(sprite, 'getChildAt', index));
      if (child && child !== flat) destroyTargets.push(child);
    }
    for (const child of destroyTargets) {
      callMethod(child, 'removeSelf');
      callMethod(child, 'destroy');
    }
    if (flat) {
      flat.skin = null;
      flat.visible = true;
    }
    spriteUrl = '';
  }

  function relayoutFromFlatTexture(this: UnknownRecord): void {
    const flat = asRecord(this);
    if (!flat) return;
    const texture = asRecord(flat.texture);
    const textureWidth = Number(texture?.width ?? flat.width);
    const textureHeight = Number(texture?.height ?? flat.height);
    if (!(textureWidth > 0 && textureHeight > 0)) return;
    spriteSize = { width: textureWidth, height: textureHeight };
    revealCustomBackground();
  }

  function armStaticLayout(flat: UnknownRecord): void {
    const event = layaEvent()?.COMPLETE;
    if (!event) return;
    callMethod(flat, 'off', event, resizeOwner, relayoutFromFlatTexture);
    callMethod(flat, 'once', event, resizeOwner, relayoutFromFlatTexture);
  }

  function drawStatic(url: string, width: number, height: number): void {
    if (!sprite) return;
    const flat = ensureFlatBackgroundImage();
    if (!flat) return;
    setFlatBackgroundVisible(true);
    const measured = resolveBackgroundSourceSize(0, 0, Number(width), Number(height));
    if (measured.width > 0 && measured.height > 0) spriteSize = measured;
    try {
      if (typeof flat.loadImage === 'function') callMethod(flat, 'loadImage', url);
      else flat.skin = url;
    } catch (error) {
      console.warn('[皮肤做背景] 静态底图 loadImage 失败:', error);
      flat.skin = url;
    }
    armStaticLayout(flat);
    relayoutFromFlatTexture(flat);
    if (!(Number(flat.texture ? asRecord(flat.texture)?.width : 0) > 0) && measured.width > 0 && measured.height > 0) {
      placeFlatAtSpriteCenter(flat, measured.width, measured.height);
      layout();
    }
  }

  async function waitVideoFrameReady(video: HTMLVideoElement): Promise<void> {
    if (video.readyState >= 2) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error('视频加载超时，已恢复官方底图'));
      }, CUSTOM_BACKGROUND_MEDIA_PROBE_TIMEOUT_MS);
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('视频解码失败，已恢复官方底图'));
      };
      const cleanup = () => {
        window.clearTimeout(timeout);
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('loadeddata', onReady);
      video.addEventListener('canplay', onReady);
      video.addEventListener('error', onError);
    });
  }

  async function startVideoElementPlayback(video: HTMLVideoElement): Promise<void> {
    const tryPlay = async (): Promise<boolean> => {
      try {
        await video.play();
        return !video.paused;
      } catch {
        return false;
      }
    };
    if (await tryPlay()) return;
    await new Promise<void>((resolve) => {
      const onCanPlay = () => {
        video.removeEventListener('canplay', onCanPlay);
        void tryPlay().finally(resolve);
      };
      video.addEventListener('canplay', onCanPlay);
      window.setTimeout(() => {
        video.removeEventListener('canplay', onCanPlay);
        void tryPlay().finally(resolve);
      }, 500);
    });
  }

  function configureBackgroundVideo(video: HTMLVideoElement): void {
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.setAttribute('muted', 'true');
  }

  async function prepareBackgroundVideo(url: string, width: number, height: number): Promise<{
    video: HTMLVideoElement;
    drawWidth: number;
    drawHeight: number;
  } | null> {
    stopVideoPlayback();
    const video = createVideoElement();
    configureBackgroundVideo(video);
    videoElement = video;
    mountVideoToDom(video);
    video.src = url;
    video.load();
    try {
      await waitVideoFrameReady(video);
    } catch (error) {
      console.warn('[皮肤背景]', error instanceof Error ? error.message : error);
      stopVideoPlayback();
      restoreNativeGameBackground();
      return null;
    }
    if (videoElement !== video || video.error) {
      stopVideoPlayback();
      return null;
    }
    const drawWidth = video.videoWidth > 0 ? video.videoWidth : width;
    const drawHeight = video.videoHeight > 0 ? video.videoHeight : height;
    if (!drawWidth || !drawHeight) {
      stopVideoPlayback();
      return null;
    }
    spriteSize = { width: drawWidth, height: drawHeight };
    videoDrawSize = { width: drawWidth, height: drawHeight };
    return { video, drawWidth, drawHeight };
  }

  async function finalizeBackgroundVideo(video: HTMLVideoElement): Promise<boolean> {
    await startVideoElementPlayback(video);
    if (videoElement !== video || video.error || video.paused) {
      stopVideoPlayback();
      return false;
    }
    lastVideoFrameTime = -1;
    drawVideoFrame();
    startVideoFrameLoop();
    return true;
  }

  function createCanvasVideoTexture(
    TextureClass: new (source: unknown) => UnknownRecord,
    canvas: HTMLCanvasElement,
    drawWidth: number,
    drawHeight: number
  ): UnknownRecord {
    const fromStatic = callMethod(TextureClass, 'create', canvas, 0, 0, drawWidth, drawHeight);
    if (fromStatic) return fromStatic as UnknownRecord;
    return new TextureClass(canvas);
  }

  async function attachVideoTexturePanel(
    video: HTMLVideoElement,
    width: number,
    height: number
  ): Promise<boolean> {
    const VideoTextureClass = laya()?.VideoTexture as (new () => UnknownRecord) | undefined;
    const TextureClass = laya()?.Texture as (new (source: unknown) => UnknownRecord) | undefined;
    if (!VideoTextureClass || !TextureClass || !sprite || !ensureFlatBackgroundImage()) return false;
    if (video.readyState < 2 || video.error) return false;

    const drawWidth = video.videoWidth > 0 ? video.videoWidth : width;
    const drawHeight = video.videoHeight > 0 ? video.videoHeight : height;
    if (!drawWidth || !drawHeight) return false;
    spriteSize = { width: drawWidth, height: drawHeight };
    videoDrawSize = { width: drawWidth, height: drawHeight };

    const bitmap = new VideoTextureClass();
    bitmap.video = video;
    videoBitmap = bitmap;
    videoTexture = new TextureClass(bitmap);
    videoDisplaySprite = null;
    bitmap.updatable = true;
    updateVideoBitmapData(bitmap);
    redrawVideoTexture();
    return finalizeBackgroundVideo(video);
  }

  async function drawVideoFromCanvas(url: string, width: number, height: number): Promise<boolean> {
    const documentObject = globalObject.document;
    const TextureClass = laya()?.Texture as
      | (new (source: unknown) => UnknownRecord)
      | undefined;
    if (!documentObject || !TextureClass || !sprite || !ensureFlatBackgroundImage()) return false;

    try {
      const prepared = await prepareBackgroundVideo(url, width, height);
      if (!prepared) return false;
      const { video, drawWidth, drawHeight } = prepared;
      mountVideoToDom(video);

      const canvas = documentObject.createElement('canvas');
      canvas.width = drawWidth;
      canvas.height = drawHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        stopVideoPlayback();
        return false;
      }

      videoUsesCanvas = true;
      videoCanvas = canvas;
      videoCanvasCtx = ctx;
      videoTexture = createCanvasVideoTexture(TextureClass, canvas, drawWidth, drawHeight);
      videoDisplaySprite = null;
      refreshCanvasVideoTexture();
      redrawVideoTexture();
      return finalizeBackgroundVideo(video);
    } catch (error) {
      console.warn('[皮肤背景] canvas 视频背景失败:', error);
      stopVideoPlayback();
      return false;
    }
  }

  async function drawVideoFromVideoTexture(url: string, width: number, height: number): Promise<boolean> {
    const VideoTextureClass = laya()?.VideoTexture as (new () => UnknownRecord) | undefined;
    const TextureClass = laya()?.Texture as (new (source: unknown) => UnknownRecord) | undefined;
    const SpriteClass = laya()?.Sprite as (new () => UnknownRecord) | undefined;
    if (!VideoTextureClass || !TextureClass || !SpriteClass || !sprite) {
      console.warn('[皮肤背景] 当前环境不支持 VideoTexture，无法播放视频背景');
      return false;
    }

    try {
      const prepared = await prepareBackgroundVideo(url, width, height);
      if (!prepared) return false;
      return attachVideoTexturePanel(prepared.video, width, height);
    } catch (error) {
      console.warn('[皮肤背景] VideoTexture 视频背景失败:', error);
      stopVideoPlayback();
      return false;
    }
  }

  async function drawVideo(url: string, width: number, height: number): Promise<boolean> {
    if (await drawVideoFromVideoTexture(url, width, height)) return true;
    if (url.startsWith('blob:')) {
      console.warn('[皮肤背景] VideoTexture 不可用，尝试 canvas 回退');
      return drawVideoFromCanvas(url, width, height);
    }
    console.warn('[皮肤背景] VideoTexture 不可用，尝试 canvas 回退');
    return drawVideoFromCanvas(url, width, height);
  }

  function drawEffects(url: string, type: number, width: number, height: number): void {
    const EffectClass = resolveEffectClass(type === BACKGROUND_RESOURCE_TYPE_SK_EFFECT ? 'BaseEffect' : 'BaseSpineEffect');
    if (!EffectClass || !sprite) return;
    const extension = type === BACKGROUND_RESOURCE_TYPE_SK_EFFECT ? 'sk' : 'json';
    const [parts, action] = type === BACKGROUND_RESOURCE_TYPE_SPINE
      ? [['beijing', 'daiji', 'qianjing'], 'DaiJi']
      : [['beijing', 'xingxiang'], 'play'];
    for (const part of parts) {
      const effect = new EffectClass();
      callMethod(sprite, 'addChild', effect);
      effect.AutoReleaseRes = true;
      callMethod(effect, 'InitEffect', `${url}/${part}.${extension}`, action, true);
      callMethod(effect, 'playEffect');
      if (type === BACKGROUND_RESOURCE_TYPE_SK_EFFECT && width > 0 && height > 0 && !isSkinFrameSize(width, height)) {
        callMethod(effect, 'size', width, height);
      }
      idleEffects[part] = effect;
    }
  }

  function commitNativeSuppressionOrRestore(): boolean {
    if (!customBackgroundMounted()) {
      restoreNativeGameBackground();
      return false;
    }
    if (!customPictureReady()) {
      if (sprite) sprite.visible = false;
      restoreNativeGameBackground();
      return false;
    }
    raiseSpriteAboveWallpaper();
    suppressNativeGameBackground();
    applyStageBackdrop(true);
    return true;
  }

  async function setBackground(next: Partial<BackgroundResource> = resource, persist = true): Promise<boolean> {
    const { url, type = 0, width = 0, height = 0 } = next;
    if (!url) return false;
    const initPromise = tasks.poll(() => backgroundLayer() && init(), 160, 500);
    if (!(await initPromise)) return false;
    const typeNum = Number(type);
    const reapply = needsBackgroundReapply() || spriteUrl !== url;
    if (reapply) {
      clearContent();
      spriteSize = { width: Number(width), height: Number(height) };
      let applied = false;
      if (typeNum === BACKGROUND_RESOURCE_TYPE_IMAGE) {
        drawStatic(url, Number(width), Number(height));
        applied = true;
      } else if (typeNum === BACKGROUND_RESOURCE_TYPE_VIDEO) {
        applied = await drawVideo(url, Number(width), Number(height));
        if (!applied) restoreNativeGameBackground();
      } else {
        drawEffects(url, typeNum, Number(width), Number(height));
        applied = true;
      }
      if (!applied) return false;
      applyPresentationFilter(typeNum);
      revealCustomBackground();
      if (customPictureReady() && !commitNativeSuppressionOrRestore()) return false;
      spriteUrl = url;
      resource = { url, type: typeNum, width: Number(width), height: Number(height) };
      if (persist) store.saveResource(resource as BackgroundResource);
    } else if (typeNum === BACKGROUND_RESOURCE_TYPE_VIDEO) {
      applyPresentationFilter(typeNum);
      revealCustomBackground();
      if (customPictureReady() && !commitNativeSuppressionOrRestore()) return false;
      await resumeVideoPlayback();
    } else {
      applyPresentationFilter(typeNum);
      revealCustomBackground();
      if (customPictureReady() && !commitNativeSuppressionOrRestore()) return false;
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
    if (!sprite?._parent || Number(resource.type) !== BACKGROUND_RESOURCE_TYPE_SPINE || !ACTIONS.includes(name)) {
      return false;
    }
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
    restoreNativeGameBackground();
    clearContent();
    resource = {};
    if (!forget) return;
    store.clearResource();
    const layer = locator.layer('BackgroundLayer');
    detachOwnSprite();
    if (layer && layer[SPRITE_MARKER] === sprite) delete layer[SPRITE_MARKER];
    sprite = undefined;
  }

  return {
    get resource() {
      return resource;
    },
    hasBackground: () => Boolean(resource.url || sprite || store.loadResource().url),
    setBackground,
    isMounted() {
      return isLayerAttached();
    },
    isLayerAttached() {
      return isLayerAttached();
    },
    async setEnabled(enabled) {
      if (enabled) {
        reloadStoredResource();
        if (!resource.url) return false;
        return setBackground();
      }
      pauseVideoPlayback();
      clearAction();
      detachOwnSprite();
      restoreNativeGameBackground();
      return true;
    },
    syncSceneVisibility,
    reloadStoredResource,
    onSceneChange,
    clearBackground,
    playAction,
    rememberEffectClass,
    dispose() {
      restoreNativeGameBackground();
      clearContent();
      detachOwnSprite();
      const stage = asRecord(laya()?.stage);
      if (resizeBound && onLayoutResize) {
        callMethod(stage, 'off', layaEvent()?.RESIZE, resizeOwner, onLayoutResize);
        globalObject.removeEventListener?.('resize', onLayoutResize);
      }
      onLayoutResize = null;
      resizeBound = false;
    }
  };
}

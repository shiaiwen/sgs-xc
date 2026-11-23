/**
 * 皮肤纸控制器：本家/全场皮肤纸开关与壁纸菜单扩展。
 */

import { CONFIG_ACCOUNT_SYNC_EVENT, type XiaochaoConfigStore } from '../../config/config-store.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { resolveGameAccountId } from '../../runtime/game-account-session.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { showToast } from '../../ui/toast/show-toast.ts';
import { isFavoriteInUse } from './favorite-in-use.ts';
import type { WallpaperMenuExtension } from './official-background-controller.ts';
import { createFavoritesTab } from './skin-background-favorites-tab.ts';
import { onSkinBackgroundSynced } from './skin-background-document.ts';
import { createSkinBackgroundRenderer } from './skin-background-renderer.ts';
import { createSkinBackgroundStore, type BackgroundFavorite, type BackgroundResource } from './skin-background-store.ts';
import { SKIN_FRAME_HORIZONTAL, SKIN_FRAME_PORTRAIT, SKIN_FRAME_WIDE } from '../../const/skin-frame.ts';
import {
  SKIN_DETAIL_BUTTON_HEIGHT,
  SKIN_DETAIL_BUTTON_RECHECK_ROUND_INTERVAL,
  SKIN_DETAIL_FLAT_BUTTON_SKINS,
  SKIN_DETAIL_WINDOW_NAMES
} from '../../const/skin-detail-window.ts';
import {
  BACKGROUND_RESOURCE_TYPE_IMAGE,
  BACKGROUND_RESOURCE_TYPE_LEGACY_SPINE,
  BACKGROUND_RESOURCE_TYPE_SK_EFFECT,
  BACKGROUND_RESOURCE_TYPE_SPINE,
  BACKGROUND_RESOURCE_TYPE_VIDEO,
  DYNAMIC_EFFECT_BACKGROUND_TYPES,
  isBackgroundResourceVideo
} from '../../const/background-resource-type.ts';
import {
  cleanupMisplacedDetailButtons,
  computeDetailButtonLayout,
  hideInjectedDetailButtons,
  hookSkinDetailWindowRefresh,
  isPortraitSkinDetail,
  isSkinDetailWindowCandidate,
  resolveSkinDetailMount,
  resolveSkinDetailWindow,
  wireNativeSkinDetailButtons
} from './skin-detail-buttons.ts';
import { DEFAULT_STAGE_HEIGHT, DEFAULT_STAGE_WIDTH } from '../../const/stage.ts';
import { getUploadedBackgroundStore, type UploadedBackgroundFile } from './uploaded-background-store.ts';
import { createBackgroundPreviewUrl } from './background-media-file.ts';
import {
  UPLOADED_BACKGROUND_FAVORITE_ID_PREFIX,
  isUploadedBackgroundUrl,
  uploadedBackgroundName,
  uploadedBackgroundIdFromUrl,
  uploadedBackgroundUrl
} from '../../const/uploaded-background.ts';
import {
  getLobbyPageBackground,
  hasLobbyPageBackgroundContainer
} from './lobby-page-background.ts';
import { getViewportPageBackground } from './viewport-page-background.ts';
import { PAPER_HOME_SCENE_NAMES, PAPER_LOBBY_SCENE_NAMES } from '../../const/paper-all-paper-scene.ts';
import { isMatchSceneName, isPaperUiScene, mayMutateSkinBackground } from './skin-background-session.ts';
import {
  asRecord,
  callMethod,
  createTaskScope,
  skinTrace,
  supportsDynamicSkin,
  isBackgroundUiScene,
  isXiaochaoGameplayUiReady,
  watchSceneSwitch,
  watchSceneSwitchRequest,
  watchWindowShow,
  type UnknownRecord
} from './skin-runtime.ts';

const DETAIL_BUTTON_GAP = 3;
const DETAIL_BUTTON_HEIGHT = SKIN_DETAIL_BUTTON_HEIGHT;
const ICON_SIZE = 28;
/** 多形态皮肤原画数量缺省表（其余按文件名是否带 _N 推断）。 */
const SKIN_STATE_COUNTS: Record<number, number> = { 60500: 3, 62300: 2, 66100: 2 };

type SkinStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type IconKind = 'background' | 'favorite';

export interface SkinPaperController {
  readonly menuExtension: WallpaperMenuExtension;
  /** 协议分发前调用：出场、出杀、互动表情时播放背景动作。 */
  filterMessage(payload: UnknownRecord, className: string): void;
  dispose(): void;
}

export interface SkinPaperOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  storage?: SkinStorage;
  selfSeatId(): number | null;
  /** 开关变化时重新同步游戏背景面板（由官方背景控制器提供）。 */
  syncWallpaperMenu(): void;
  gameEvents?: GameEventBus;
}

/** 背景尺寸取皮肤窗口的展示框。竖版不支持做背景。 */
function backgroundSize(is169: unknown, isHorizontal: unknown): { width: number; height: number } {
  if (is169) return { width: SKIN_FRAME_WIDE.width, height: SKIN_FRAME_WIDE.height };
  if (isHorizontal) return { width: SKIN_FRAME_HORIZONTAL.width, height: SKIN_FRAME_HORIZONTAL.height };
  return { width: SKIN_FRAME_PORTRAIT.width, height: SKIN_FRAME_PORTRAIT.height };
}

function isPortrait(is169: unknown, isHorizontal: unknown): boolean {
  return !is169 && !isHorizontal;
}

/**
 * 皮肤做背景与全局背景：
 * 皮肤详情可保存图片、设为背景；换肤窗口悬停出“设为背景”图标。
 */
export function installSkinPaperController(
  configStore: XiaochaoConfigStore,
  options: SkinPaperOptions
): SkinPaperController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const storage = options.storage ?? globalObject.localStorage;
  const patcher = createMethodPatcher();
  const tasks = createTaskScope('小抄背景');
  function paperAccountId(): string {
    return resolveGameAccountId(globalObject, locator);
  }

  const store = createSkinBackgroundStore(storage, { resolveAccountId: paperAccountId });
  const renderer = createSkinBackgroundRenderer({
    globalObject,
    locator,
    store,
    tasks,
    patcher,
    resolveUploaded: (resource) => resolvePlayableResource(resource)
  });
  const lobbyPageBackground = getLobbyPageBackground();
  const viewportPageBackground = getViewportPageBackground();
  lobbyPageBackground.clear();
  viewportPageBackground.clear();
  const laya = () => asRecord(globalObject.Laya);
  const layaEvent = () => asRecord(laya()?.Event);

  const isOn = () => configStore.get('skin.skinPaper') === true;
  const uploads = getUploadedBackgroundStore();
  /** 上传项的列表预览图，按上传编号存。 */
  const uploadPreviews = new Map<string, Promise<string>>();
  let syncingVisibility = false;
  /** 同步途中又来了同步请求，这一轮做完要按最新状态再跑一遍。 */
  let visibilitySyncQueued = false;
  let runtimeBlobUrl = '';
  /** 当前临时地址是从哪个原图地址拉下来的。收藏项靠它判断是否正在使用。 */
  let runtimeBlobSourceUrl = '';
  /** 游戏已发出切到牌局以外页面的通知、新页面还没换上。 */
  let leavingMatch = false;

  function revokeRuntimeBlobUrl(): void {
    if (!runtimeBlobUrl.startsWith('blob:')) return;
    try {
      URL.revokeObjectURL(runtimeBlobUrl);
    } catch {
      // 忽略 revoke 失败。
    }
    runtimeBlobUrl = '';
    runtimeBlobSourceUrl = '';
  }

  /** 正在读的上传文件。几处同时要同一个文件时共用一次读取，免得后读完的把先读完、正在画的地址撤掉。 */
  const uploadLoads = new Map<string, Promise<string>>();

  /** 上传项按编号读出本机文件。同一个文件只读一次，地址不变，正在放的视频不会被重新加载。 */
  async function resolveUploadedResource(resource: Partial<BackgroundResource>, url: string): Promise<Partial<BackgroundResource>> {
    if (runtimeBlobUrl && runtimeBlobSourceUrl === url) return { ...resource, url: runtimeBlobUrl };
    let loading = uploadLoads.get(url);
    if (!loading) {
      loading = uploads.load(uploadedBackgroundIdFromUrl(url))
        .then((blob) => {
          if (!blob) return '';
          if (runtimeBlobUrl && runtimeBlobSourceUrl === url) return runtimeBlobUrl;
          revokeRuntimeBlobUrl();
          runtimeBlobUrl = URL.createObjectURL(blob);
          runtimeBlobSourceUrl = url;
          return runtimeBlobUrl;
        })
        .catch((error) => {
          console.warn('[小抄背景] 读取上传的背景失败:', error);
          return '';
        })
        .finally(() => uploadLoads.delete(url));
      uploadLoads.set(url, loading);
    }
    const playableUrl = await loading;
    return playableUrl ? { ...resource, url: playableUrl } : resource;
  }

  /** 跨域原画转 blob，避免 Laya loadImage 因 CORS 静默失败。上传项转成本机文件地址。 */
  async function resolvePlayableResource(resource: Partial<BackgroundResource>): Promise<Partial<BackgroundResource>> {
    const url = String(resource.url || '').trim();
    if (isUploadedBackgroundUrl(url)) return resolveUploadedResource(resource, url);
    if (!url.startsWith('http://') && !url.startsWith('https://')) return resource;
    try {
      const found = await fetchSkinImage(url).catch(() => null);
      const fetchUrl = found?.url || url;
      const response = found?.response ?? await fetch(fetchUrl);
      if (!response.ok) return resource;
      const blob = await response.blob();
      revokeRuntimeBlobUrl();
      runtimeBlobUrl = URL.createObjectURL(blob);
      runtimeBlobSourceUrl = url;
      return { ...resource, url: runtimeBlobUrl };
    } catch (error) {
      console.warn('[皮肤做背景] 背景资源拉取失败，仍尝试原地址:', error);
      return resource;
    }
  }
  const favoritesTab = createFavoritesTab({
    globalObject,
    store,
    patcher,
    enabled: isOn,
    applyFavorite: (resource) => applyBackground(resource),
    isCurrent: (favorite) => isCurrentFavorite(favorite),
    isUploaded: (favorite) => isUploadedBackgroundUrl(favorite.resource.url),
    uploadPreview: (favorite) => uploadPreview(favorite),
    upload: (file) => uploadBackground(file),
    removeFavorite: (favorite) => removeFavorite(favorite)
  });

  /** 用户手动设过的皮肤或上传的背景，优先于山河图等地图场景自带底图。 */
  function hasStoredPicture(): boolean {
    const saved = store.loadResource();
    return Boolean(String(saved.url || renderer.resource.url || '').trim());
  }

  /**
   * 正在牌局页面里，旁观也算。首页、房间列表、开局前和局后的房间、山河图地图页都不算。
   * 游戏发出离开牌局的通知后就不算了，新页面可能还要加载好几秒。
   */
  function inMatch(): boolean {
    return !leavingMatch && Boolean(locator.gameScene());
  }

  /** 全局背景开着时哪一页都显示，关着时只在牌局里显示。 */
  function shouldShow(): boolean {
    if (!hasStoredPicture()) return false;
    if (configStore.get('skin.allPaper') === true) return true;
    return inMatch();
  }

  function hideBackground(): void {
    void renderer.syncSceneVisibility(false, false);
    clearDomPageBackgrounds();
  }

  /** 牌局里才放视频时，在牌局以外的页面先把视频文件读进内存，进牌局只剩解码第一帧。 */
  function warmMatchBackgroundFile(): void {
    if (!isOn()) return;
    const stored = store.loadResource();
    if (Number(stored.type) !== BACKGROUND_RESOURCE_TYPE_VIDEO) return;
    void resolvePlayableResource(stored);
  }

  /**
   * 全局背景关着时，游戏一发出切到牌局以外页面的通知就收起背景，不等新页面加载完。
   * 只有切去别的牌局不算离开。
   * 牌局页面要等好几秒才会被认定为没了，等到那时再收，背景会在房间或房间列表上多放好几秒。
   */
  function onSceneSwitchRequest(sceneName: string): void {
    leavingMatch = !isMatchSceneName(locator, sceneName);
    if (leavingMatch && !shouldShow()) hideBackground();
  }

  function reloadAccountBackground(): void {
    configStore.syncAccount();
    renderer.reloadStoredResource();
  }

  /** 登录后从 paperRes 重新挂背景，不依赖开关订阅再触发一次。 */
  async function reapplyStoredBackground(): Promise<boolean> {
    reloadAccountBackground();
    const saved = store.loadResource();
    const url = String(saved.url || '').trim();
    if (!url || !isOn()) return false;
    return renderer.setBackground(await resolvePlayableResource(saved), false, url);
  }

  // ---------- 资源解析 ----------

  async function fetchSkinImage(url: string, preferBigSkin = true): Promise<{ response: Response; url: string } | null> {
    if (preferBigSkin) {
      const bigUrl = url.replace('/big/static/', '/big/bigSkin/');
      const response = await fetch(bigUrl);
      if (response.ok) return { response, url: bigUrl };
    }
    const response = await fetch(url);
    return response.ok ? { response, url } : null;
  }

  /** 静态原画优先取高清版并量出真实尺寸。 */
  async function measureStatic(url: string, width: number, height: number): Promise<BackgroundResource> {
    if (!url) return { url: '', type: BACKGROUND_RESOURCE_TYPE_IMAGE, width, height };
    const found = await fetchSkinImage(url).catch(() => null);
    const finalUrl = found?.url || url;
    if (!found?.response.ok || typeof createImageBitmap !== 'function') return { url: finalUrl, type: BACKGROUND_RESOURCE_TYPE_IMAGE, width, height };
    try {
      const bitmap = await createImageBitmap(await found.response.blob());
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return { url: finalUrl, type: BACKGROUND_RESOURCE_TYPE_IMAGE, ...size };
    } catch {
      return { url: finalUrl, type: BACKGROUND_RESOURCE_TYPE_IMAGE, width, height };
    }
  }

  function rememberDetailEffectClasses(win: UnknownRecord): void {
    const bigSprites = asRecord(win.skinBigSps);
    renderer.rememberEffectClass('BaseEffect', asRecord(bigSprites?.bgEffect)?.constructor);
    renderer.rememberEffectClass('BaseSpineEffect', asRecord(bigSprites?.spineBg)?.constructor);
  }

  /** 皮肤详情窗口当前展示的背景资源；视频皮肤返回 videoUrl。 */
  async function resolveDetailResource(win: UnknownRecord): Promise<{ resource?: BackgroundResource; videoUrl?: string } | null> {
    if (isPortrait(win.is169, win.isHor)) return null;
    const imageUrl = String(asRecord(win.skinImg)?.skin || '');
    if (!imageUrl) return null;
    const base = asRecord(asRecord(win.skinData)?.skinBaseVo);
    let { width, height } = backgroundSize(win.is169, win.isHor);
    let type = Number(win.isDynamicPlay) === 1 ? Number(base?.ResType) || 0 : 0;
    let url = String(base?.DynamicSkinBigSkeletonUrl || '');
    rememberDetailEffectClasses(win);
    if (type === BACKGROUND_RESOURCE_TYPE_VIDEO) return { videoUrl: `${String(base?.DynamicSkinBigUrl || '')}.mp4` };
    if (type === BACKGROUND_RESOURCE_TYPE_SPINE) {
      if (base?.NewSkinJudge) url = String(callMethod(base, 'DynamicSkinBigSkeletonUrlNew', win.juexingState) || '');
      else type = BACKGROUND_RESOURCE_TYPE_LEGACY_SPINE;
    } else if (type !== BACKGROUND_RESOURCE_TYPE_SK_EFFECT && type !== BACKGROUND_RESOURCE_TYPE_LEGACY_SPINE) {
      ({ url, width, height } = await measureStatic(imageUrl, width, height));
      type = BACKGROUND_RESOURCE_TYPE_IMAGE;
    }
    return { resource: { url, type, width, height } };
  }

  /** 换肤窗口列表项对应的背景资源。 */
  async function resolveItem(item: UnknownRecord): Promise<{ state: number; previewUrl: string; resource: BackgroundResource } | null> {
    const data = asRecord(item.skinData);
    const general = asRecord(item.paperGeneralInfo);
    if (!data || isPortrait(data.Is169, data.IsBanner)) return null;
    const state = Number(item.CurDynamicState) || 1;
    const { width, height } = backgroundSize(data.Is169, data.IsBanner);
    const dynamic = supportsDynamicSkin(item);
    let type = dynamic ? Number(data.ResType) || 0 : 0;
    let url = dynamic ? String(data.DynamicSkinBigSkeletonUrl || '') : '';
    if (type === BACKGROUND_RESOURCE_TYPE_VIDEO) type = BACKGROUND_RESOURCE_TYPE_IMAGE;
    if (type === BACKGROUND_RESOURCE_TYPE_SPINE) {
      if (data.NewSkinJudge) url = String(callMethod(data, 'DynamicSkinBigSkeletonUrlNew', state) || '');
      else type = BACKGROUND_RESOURCE_TYPE_LEGACY_SPINE;
    }
    const bigUrl = String(callMethod(data, 'SkinBigUrl', state) || '');
    if (!DYNAMIC_EFFECT_BACKGROUND_TYPES.includes(type) || !url) {
      const imageUrl = bigUrl || String(general?.GeneralBigImgUrl || '');
      return { state: 0, previewUrl: imageUrl, resource: await measureStatic(imageUrl, width, height) };
    }
    return { state, previewUrl: bigUrl, resource: { url, type, width, height } };
  }

  // ---------- 收藏 ----------

  function skinIdOf(source: UnknownRecord | null): string {
    const value = source?.skinID ?? source?.SkinID ?? source?.ID ?? source?.id ?? source?.baseID;
    return value === undefined || value === null ? '' : String(value);
  }

  function detailFavoriteId(win: UnknownRecord): string {
    const base = asRecord(asRecord(win.skinData)?.skinBaseVo);
    const generalId = Number(asRecord(win.skinData)?.generalID) || 0;
    const state = Number(win.juexingState ?? win.CurDynamicState ?? 0) || 0;
    const skinId = skinIdOf(base);
    if (skinId) return `${generalId}:${skinId}:${state}`;
    const image = String(asRecord(win.skinImg)?.skin || '');
    return image ? `resource:${image}:${state}` : '';
  }

  function itemFavoriteState(item: UnknownRecord): number {
    const type = Number(asRecord(item.skinData)?.ResType) || 0;
    return supportsDynamicSkin(item) && [2, 3, 4].includes(type) ? Number(item.CurDynamicState) || 1 : 0;
  }

  function itemFavoriteId(item: UnknownRecord, state: number): string {
    const data = asRecord(item.skinData);
    const skinId = data?.skinID ?? data?.SkinID ?? item.skinId ?? item.SkinID;
    if (skinId === undefined || skinId === null || skinId === '') return '';
    const generalId = Number(data?.generalID ?? asRecord(item.paperGeneralInfo)?.GeneralID) || 0;
    return `${generalId}:${String(skinId)}:${Number(state) || 0}`;
  }

  function isCurrentFavorite(favorite: BackgroundFavorite): boolean {
    const current = renderer.resource;
    return isFavoriteInUse({
      currentUrl: current.url,
      currentType: current.type,
      favoriteUrl: String(favorite.resource.url ?? ''),
      favoriteType: favorite.resource.type,
      runtimeBlobUrl,
      runtimeBlobSourceUrl
    });
  }

  // ---------- 设为背景 ----------

  async function applyBackground(resource: Partial<BackgroundResource> | undefined, win?: UnknownRecord): Promise<boolean> {
    if (!resource?.url) {
      showToast('当前皮肤未找到可用背景资源', 'warning', 4000);
      return false;
    }
    callMethod(win, 'Close');
    try {
      if (win) await new Promise((resolve) => tasks.later(() => resolve(undefined), 300));
      const playable = await resolvePlayableResource(resource);
      if (!(await renderer.setBackground(playable, true, String(resource.url)))) {
        showToast('背景设置失败，请重试', 'error', 4000);
        return false;
      }
      await syncVisibility();
      favoritesTab.refreshSelection();
      refreshChangeSkinWindow();
      showToast(shouldShow() ? '背景设置成功' : '背景已设好，进牌局后显示', 'success', 4000);
      return true;
    } catch (error) {
      console.warn('[皮肤做背景] 设置失败:', error);
      showToast('背景设置失败，请重试', 'error', 4000);
      return false;
    }
  }

  // ---------- 上传的背景 ----------

  function uploadedFavorite(file: UploadedBackgroundFile): BackgroundFavorite {
    return {
      id: `${UPLOADED_BACKGROUND_FAVORITE_ID_PREFIX}${file.id}`,
      skinId: '',
      generalId: 0,
      state: 0,
      name: uploadedBackgroundName(file.fileName, file.isVideo),
      generalName: '',
      previewUrl: '',
      resource: {
        url: uploadedBackgroundUrl(file.id),
        type: file.isVideo ? BACKGROUND_RESOURCE_TYPE_VIDEO : BACKGROUND_RESOURCE_TYPE_IMAGE,
        width: file.width || DEFAULT_STAGE_WIDTH,
        height: file.height || DEFAULT_STAGE_HEIGHT
      },
      savedAt: Date.now()
    };
  }

  function uploadPreview(favorite: BackgroundFavorite): Promise<string> {
    const id = uploadedBackgroundIdFromUrl(favorite.resource.url);
    if (!id) return Promise.resolve('');
    let preview = uploadPreviews.get(id);
    if (!preview) {
      preview = uploads.load(id)
        .then((blob) => blob ? createBackgroundPreviewUrl(blob, isBackgroundResourceVideo(favorite.resource.type)) : '')
        .catch(() => '');
      uploadPreviews.set(id, preview);
    }
    return preview;
  }

  function releaseUploadPreview(id: string): void {
    const preview = uploadPreviews.get(id);
    uploadPreviews.delete(id);
    void preview?.then((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }

  /** 存下文件，加进小抄背景列表，再像点列表里的任何一项一样设为背景。 */
  async function uploadBackground(file: File): Promise<boolean> {
    let saved: UploadedBackgroundFile;
    try {
      saved = await uploads.save(file);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '上传失败', 'error', 4000);
      return false;
    }
    const favorite = uploadedFavorite(saved);
    store.addFavorite(favorite);
    const applied = await applyBackground(favorite.resource);
    if (!applied && saved.isVideo) showToast('视频背景加载失败，换 H.264 编码的 MP4 或先用图片', 'error', 5000);
    return applied;
  }

  /** 从列表删掉一项，上传项连本机文件一起删。正在用的那项不让删。 */
  async function removeFavorite(favorite: BackgroundFavorite): Promise<void> {
    if (isCurrentFavorite(favorite) || store.loadResource().url === favorite.resource.url) {
      showToast('正在用的背景不能删，先换一个', 'warning');
      return;
    }
    store.removeFavorite(favorite.id);
    refreshChangeSkinWindow();
    const id = uploadedBackgroundIdFromUrl(favorite.resource.url);
    if (!id) return;
    releaseUploadPreview(id);
    try {
      await uploads.remove(id);
    } catch (error) {
      console.warn('[小抄背景] 删除上传的文件失败:', error);
    }
  }

  /** 已经把早先单独存的那份上传背景转进列表的账号。 */
  let legacyUploadCheckedAccount = '';

  /** 早先每个账号单独存的一份上传背景，转成小抄背景列表里的一项；当时正在用就记成当前背景。 */
  async function migrateLegacyUpload(): Promise<void> {
    const account = paperAccountId();
    if (!account || account === legacyUploadCheckedAccount) return;
    legacyUploadCheckedAccount = account;
    try {
      const legacy = await uploads.takeLegacy();
      if (!legacy) return;
      const favorite = uploadedFavorite(legacy.file);
      store.addFavorite(favorite);
      if (legacy.active) store.saveResource(favorite.resource);
    } catch (error) {
      console.warn('[小抄背景] 转移早先的上传背景失败:', error);
    }
  }

  // ---------- 皮肤详情窗口按钮 ----------

  function isVideoDetail(win: UnknownRecord): boolean {
    return Number(win.isDynamicPlay) === 1 && isBackgroundResourceVideo(Number(asRecord(asRecord(win.skinData)?.skinBaseVo)?.ResType));
  }

  function setButtonPhase(button: UnknownRecord | null, phase: number): void {
    if (!button || (button.enabled === false && phase !== 3)) return;
    button.phase = phase;
    callMethod(button, 'changeState');
  }

  function drawHitArea(hit: UnknownRecord): void {
    const graphics = asRecord(hit.graphics);
    callMethod(graphics, 'clear');
    callMethod(graphics, 'drawRect', 0, 0, hit.width, hit.height, 'rgba(0,0,0,0.001)', null, 0);
  }

  /** 按钮本体不接收鼠标，由透明热区驱动按下态并响应点击。 */
  function ensureHitArea(
    win: UnknownRecord,
    content: UnknownRecord,
    index: number,
    button: UnknownRecord,
    width: number,
    onClick: (win: UnknownRecord) => unknown
  ): UnknownRecord | null {
    const key = `myFuncBtnHit${index}`;
    let hit = asRecord(win[key]);
    const SpriteClass = laya()?.Sprite as (new () => UnknownRecord) | undefined;
    if (!hit) {
      if (!SpriteClass || !content) return null;
      hit = new SpriteClass();
      Object.assign(hit, {
        name: `xcSkinInfoActionHit${index}`,
        mouseEnabled: true,
        mouseChildren: false,
        mouseThrough: false,
        hitTestPrior: false
      });
      const event = layaEvent();
      callMethod(hit, 'on', event?.MOUSE_OVER, hit, () => setButtonPhase(button, 1));
      callMethod(hit, 'on', event?.MOUSE_OUT, hit, () => setButtonPhase(button, 0));
      callMethod(hit, 'on', event?.MOUSE_DOWN, hit, () => setButtonPhase(button, 2));
      callMethod(hit, 'on', event?.MOUSE_UP, hit, () => setButtonPhase(button, 1));
      callMethod(hit, 'on', event?.CLICK, win, (clickEvent: unknown) => {
        callMethod(clickEvent, 'stopPropagation');
        void onClick(win);
      });
      win[key] = hit;
      callMethod(content, 'addChild', hit);
    }
    callMethod(hit, 'size', width, DETAIL_BUTTON_HEIGHT);
    callMethod(hit, 'pos', button.x, button.y);
    hit.zOrder = Math.max(Number(button.zOrder) + 2 || 50, 50);
    const Rectangle = laya()?.Rectangle as (new (x: number, y: number, w: number, h: number) => unknown) | undefined;
    hit.hitArea = Rectangle ? new Rectangle(0, 0, width, DETAIL_BUTTON_HEIGHT) : null;
    hit.mouseEnabled = true;
    drawHitArea(hit);
    setButtonPhase(button, button.enabled === false ? 3 : 0);
    return hit;
  }

  function createFlatButton(): UnknownRecord | null {
    const button = locator.createInstance('SgsFlatButton');
    if (button) return button;
    const template = asRecord(asRecord(locator.scene()?.topMenu)?.settingBtn);
    try {
      return typeof template?.constructor === 'function' ? new (template.constructor as new () => UnknownRecord)() : null;
    } catch {
      return null;
    }
  }

  async function saveDetailImage(win: UnknownRecord, videoUrl?: string): Promise<void> {
    const base = asRecord(asRecord(win.skinData)?.skinBaseVo);
    const name = String(base?.name || '三国杀皮肤');
    const source = videoUrl || String(asRecord(win.skinImg)?.skin || '');
    if (!source) return;
    const match = source.match(/\/([0-9]+)(_[0-9])?(\.png|\.mp4)/i);
    if (!match) {
      showToast('当前皮肤资源地址无法识别', 'warning', 4000);
      return;
    }
    const skinNumber = Number(match[1]);
    const count = SKIN_STATE_COUNTS[skinNumber] || (match[2] ? 2 : 1);
    const suffixes = count > 1 ? Array.from({ length: count }, (_, index) => `_${index + 1}`) : [''];
    for (const suffix of suffixes) {
      const url = source.replace(/(\/[0-9]+)(_[0-9])?(\.png|\.mp4)/i, `$1${suffix}$3`);
      const found = await fetchSkinImage(url, Boolean(base?.bigSkin)).catch(() => null);
      if (!found?.response.ok) continue;
      const objectUrl = URL.createObjectURL(await found.response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${name}${suffix}${match[3]}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function setDetailAsBackground(win: UnknownRecord): Promise<boolean> {
    if (isPortrait(win.is169, win.isHor)) return false;
    const resolved = await resolveDetailResource(win);
    if (resolved?.videoUrl) {
      await saveDetailImage(win, resolved.videoUrl);
      return false;
    }
    if (!resolved) return false;
    return applyBackground(resolved.resource, win);
  }

  /** 同步「收藏背景」按钮文字。 */
  function updateDetailFavoriteButton(win: UnknownRecord): void {
    const button = asRecord(win.myFuncBtn2);
    if (!button) return;
    const id = detailFavoriteId(win);
    const favorited = Boolean(id) && store.isFavorite(id);
    const video = isVideoDetail(win);
    Object.assign(button, {
      label: video ? '无法收藏' : favorited ? '取消收藏' : '收藏背景',
      enabled: !video,
      mouseEnabled: false,
      labelSize: favorited ? 15 : 16,
      phase: video ? 3 : 0
    });
    callMethod(button, 'changeState');
    const hit = asRecord(win.myFuncBtnHit2);
    if (hit) hit.mouseEnabled = !video;
  }

  async function toggleDetailFavorite(win: UnknownRecord): Promise<boolean> {
    if (isPortrait(win.is169, win.isHor)) return false;
    if (!isOn()) {
      showToast('请先打开皮肤做背景', 'warning', 4000);
      return false;
    }
    const id = detailFavoriteId(win);
    if (!id) {
      showToast('当前皮肤信息不完整，暂时无法收藏', 'warning', 4000);
      return false;
    }
    if (store.isFavorite(id)) {
      store.removeFavorite(id);
      updateDetailFavoriteButton(win);
      showToast('已取消收藏背景', 'success', 3000);
      return true;
    }
    const resolved = await resolveDetailResource(win);
    if (resolved?.videoUrl) {
      showToast('视频皮肤暂不支持做背景和收藏', 'warning', 4000);
      return false;
    }
    if (!resolved?.resource?.url) {
      showToast('当前皮肤未找到可收藏的背景资源', 'warning', 4000);
      return false;
    }
    const base = asRecord(asRecord(win.skinData)?.skinBaseVo);
    store.addFavorite({
      id,
      skinId: skinIdOf(base),
      generalId: Number(asRecord(win.skinData)?.generalID) || 0,
      state: Number(win.juexingState ?? win.CurDynamicState ?? 0) || 0,
      name: String(base?.name || base?.skinname || '三国杀皮肤'),
      generalName: '',
      previewUrl: String(asRecord(win.skinImg)?.skin || ''),
      resource: resolved.resource,
      savedAt: Date.now()
    });
    updateDetailFavoriteButton(win);
    showToast('已收藏到“小抄背景”', 'success', 3000);
    return true;
  }

  const detailInstallSignature = new WeakMap<UnknownRecord, string>();

  function installDetailButtons(win: UnknownRecord): boolean {
    if (!isSkinDetailWindowCandidate(win)) {
      hideInjectedDetailButtons(win);
      return false;
    }
    const mount = resolveSkinDetailMount(win);
    if (!mount) {
      skinTrace('skin-detail-mount-missing', {
        hasContentSprite: Boolean(win.contentSprite),
        hasSkinFrame: Boolean(win.skinFrame),
        hasSkinImg: Boolean(win.skinImg),
        windowName: String(win.name ?? win.sceneName ?? '')
      });
      return false;
    }
    const { mountParent, frame } = mount;
    hookSkinDetailWindowRefresh(win, patcher, () => tryInstallDetailButtons());
    const layout = computeDetailButtonLayout(win, frame, mountParent);
    rememberDetailEffectClasses(win);
    wireNativeSkinDetailButtons(win, patcher, {
      save: () => saveDetailImage(win),
      background: () => setDetailAsBackground(win),
      favorite: () => toggleDetailFavorite(win)
    });
    const favoriteId = detailFavoriteId(win);
    const favorited = Boolean(favoriteId) && store.isFavorite(favoriteId);
    const video = isVideoDetail(win);
    const signature = `v6-three:${layout.left}:${layout.top}:${layout.totalWidth}:${Boolean(win.isDynamicPlay)}:${favorited}:${video}`;
    if (detailInstallSignature.get(win) === signature) return true;
    detailInstallSignature.set(win, signature);
    const totalWidth = layout.totalWidth;
    const detailHandlers: Array<(target: UnknownRecord) => unknown> = [
      (target) => saveDetailImage(target),
      setDetailAsBackground,
      toggleDetailFavorite
    ];
    const buttonCount = 3;
    const width = Math.floor((totalWidth - DETAIL_BUTTON_GAP * (buttonCount - 1)) / buttonCount);
    const left = layout.left;
    for (let index = 0; index < buttonCount; index += 1) {
      const handler = detailHandlers[index]!;
      let button = asRecord(win[`myFuncBtn${index}`]);
      const existingHit = asRecord(win[`myFuncBtnHit${index}`]);
      if (!button) {
        button = createFlatButton();
        if (!button) return false;
        callMethod(button, 'InitSkin', ...SKIN_DETAIL_FLAT_BUTTON_SKINS);
        win[`myFuncBtn${index}`] = button;
        if (typeof mountParent.addDrawChild === 'function') callMethod(mountParent, 'addDrawChild', button);
        else callMethod(mountParent, 'addChild', button);
      }
      callMethod(button, 'removeEventListener');
      const favoriteDisabled = index === 2 && video;
      Object.assign(button, {
        label: ['保存图片', video ? '保存视频' : '设为背景', '收藏背景'][index],
        width,
        height: DETAIL_BUTTON_HEIGHT,
        labelSize: 16,
        labelFont: 'fzltchjw',
        labelPadding: '0,0,10,0',
        labelColors: '#FCE1AA,#FCE1AA,#FCE1AA,#FCE1AA',
        align: 'center',
        valign: 'middle',
        visible: true,
        mouseEnabled: false,
        mouseChildren: false,
        enabled: !favoriteDisabled,
        phase: favoriteDisabled ? 3 : 0,
        zOrder: Math.max(Number(frame.zOrder) + 5 || 60, 60)
      });
      callMethod(button, 'changeState');
      callMethod(button, 'pos', left + index * (width + DETAIL_BUTTON_GAP), layout.top);
      const hit = ensureHitArea(win, mountParent, index, button, width, handler);
      if (hit) {
        hit.visible = true;
        hit.mouseEnabled = !favoriteDisabled;
      }
      if (existingHit && existingHit.parent !== mountParent) {
        callMethod(asRecord(existingHit.parent), 'removeChild', existingHit);
        callMethod(mountParent, 'addChild', existingHit);
      }
    }
    updateDetailFavoriteButton(win);
    return true;
  }

  let cachedDetailWindow: UnknownRecord | null = null;
  /** 皮肤详情窗口是单例，缓存住避免每次维护循环都重扫窗口层/舞台树。 */
  function resolveDetailWindow(): UnknownRecord | null {
    if (cachedDetailWindow && !cachedDetailWindow.destroyed && cachedDetailWindow.visible !== false) {
      return cachedDetailWindow;
    }
    cachedDetailWindow = resolveSkinDetailWindow(locator, globalObject);
    return cachedDetailWindow;
  }

  function tryInstallDetailButtons(): void {
    cleanupMisplacedDetailButtons(locator, globalObject);
    const win = resolveDetailWindow();
    if (!win || win.destroyed || win.visible === false || !isOn()) return;
    if (!isSkinDetailWindowCandidate(win)) return;
    const installed = installDetailButtons(win);
    if (!installed) {
      skinTrace('skin-detail-install-failed', { windowName: String(win.name ?? win.sceneName ?? '') });
    } else {
      skinTrace('skin-detail-install-ok', { windowName: String(win.name ?? win.sceneName ?? '') });
    }
  }

  function onSkinInfoWindow(): void {
    void tasks.poll(() => {
      const win = resolveDetailWindow();
      if (!win || win.destroyed || win.visible === false) return null;
      return win;
    }, 80, 120).then((win) => {
      if (!win || win.destroyed || !isOn()) return;
      tryInstallDetailButtons();
      tasks.later(() => tryInstallDetailButtons(), 250);
      tasks.later(() => tryInstallDetailButtons(), 800);
      tasks.later(() => tryInstallDetailButtons(), 1600);
      startActiveDetailWatch();
    });
  }

  let detailWatchRunning = false;
  let detailWatchRound = 0;

  /** 皮肤详情窗口打开期间的维护循环：每 700ms 复查按钮是否漂移/需要复位。 */
  function startActiveDetailWatch(): void {
    if (detailWatchRunning) return;
    detailWatchRunning = true;
    detailWatchRound = 0;
    const tick = () => {
      const win = resolveDetailWindow();
      if (win && win.visible !== false && !win.destroyed) {
        detailWatchRound += 1;
        if (detailWatchRound % SKIN_DETAIL_BUTTON_RECHECK_ROUND_INTERVAL === 1) tryInstallDetailButtons();
        tasks.later(tick, 700);
      } else {
        // 窗口关了，停止维护；再次打开由 watchWindowShow 事件驱动。
        detailWatchRunning = false;
      }
    };
    tasks.later(tick, 700);
  }

  let skinDetailHooksStarted = false;

  function startSkinDetailHooks(): void {
    if (skinDetailHooksStarted) return;
    skinDetailHooksStarted = true;
    skinTrace('skin-detail-hooks', {
      phase: 'started',
      scene: String(locator.scene()?.SceneName ?? ''),
      gameplayReady: isXiaochaoGameplayUiReady(locator, globalObject)
    });
    watchWindowShow(locator, patcher, tasks, [...SKIN_DETAIL_WINDOW_NAMES], () => onSkinInfoWindow(), globalObject);
    tryInstallDetailButtons();
  }

  function waitForSkinDetailHooks(): void {
    void tasks.poll(() => {
      if (!isOn() || !isXiaochaoGameplayUiReady(locator, globalObject)) return null;
      return true;
    }, Infinity, 800).then(() => startSkinDetailHooks());
  }

  // ---------- 换肤窗口悬停图标 ----------

  function drawIcon(icon: unknown, kind: IconKind, active = false, hovered = false): void {
    const graphics = asRecord(asRecord(icon)?.graphics);
    if (!graphics) return;
    const color = hovered ? '#FFF2C8' : '#F7D88A';
    callMethod(graphics, 'clear');
    callMethod(graphics, 'drawCircle', 14, 14, 13, hovered ? 'rgba(68,45,25,0.96)' : 'rgba(39,29,22,0.88)', active ? '#FFE28A' : '#B98B4C', 1);
    if (kind === 'background') {
      callMethod(graphics, 'drawRect', 6.5, 7.5, 15, 12, null, color, 1.5);
      callMethod(graphics, 'drawCircle', 17.5, 11, 1.5, color);
      callMethod(graphics, 'drawPoly', 8, 18, [0, 0, 4.5, -5, 7.5, -2.5, 10.5, -6, 12, 0], color);
      return;
    }
    callMethod(graphics, 'drawPoly', 14, 14,
      [0, -8, 2.4, -2.8, 8, -2.3, 3.8, 1.4, 5.1, 7, 0, 4, -5.1, 7, -3.8, 1.4, -8, -2.3, -2.4, -2.8],
      active ? '#FFD866' : null, color, 1.5);
  }

  function drawFavoriteIcon(item: UnknownRecord, hovered = false): void {
    const actions = asRecord(item.myFuncBtnPaperActions);
    drawIcon(callMethod(actions, 'getChildAt', 1), 'favorite', Boolean(item.__xcPaperFavoriteActive), hovered);
  }

  function setItemHover(item: UnknownRecord, hovered: boolean, source: 'surface' | 'actions' = 'surface'): void {
    if (source === 'actions') item.__xcPaperActionsHovered = hovered;
    else item.__xcPaperSurfaceHovered = hovered;
    const icon = asRecord(item.myFuncBtnPaperActions);
    if (!icon) return;
    const update = () => {
      const data = asRecord(item.skinData);
      const canUse = isOn() && !isPortrait(data?.Is169, data?.IsBanner);
      const hovered = Boolean(item.__xcPaperSurfaceHovered || item.__xcPaperActionsHovered);
      const visible = canUse && (hovered || item.__xcPaperActionsPinned !== false);
      Object.assign(icon, { visible, mouseEnabled: canUse, alpha: hovered ? 1 : 0.82 });
    };
    // 从图标移到列表项时 MOUSE_OUT 先于 MOUSE_OVER，延后一拍避免闪烁。
    if (hovered) update();
    else tasks.later(update, 0);
  }

  async function setItemAsBackground(item: UnknownRecord): Promise<boolean> {
    if (!isOn()) {
      showToast('请先打开皮肤做背景', 'warning', 4000);
      return false;
    }
    try {
      const resolved = await resolveItem(item);
      return resolved ? applyBackground(resolved.resource) : false;
    } catch (error) {
      console.warn('[皮肤做背景] 换肤窗口设背景失败:', error);
      showToast('设背景失败，请重试', 'error', 4000);
      return false;
    }
  }

  /** 换肤窗口里收藏或取消收藏。 */
  async function toggleItemFavorite(item: UnknownRecord): Promise<boolean> {
    if (!isOn()) {
      showToast('请先打开皮肤做背景', 'warning', 4000);
      return false;
    }
    try {
      const resolved = await resolveItem(item);
      if (!resolved?.resource.url) return false;
      const id = itemFavoriteId(item, resolved.state);
      if (!id) return false;
      if (store.isFavorite(id)) {
        store.removeFavorite(id);
        item.__xcPaperFavoriteActive = false;
        drawFavoriteIcon(item);
        showToast('已取消收藏背景', 'success', 3000);
        return true;
      }
      const data = asRecord(item.skinData);
      store.addFavorite({
        id,
        skinId: String(data?.skinID ?? data?.SkinID ?? item.skinId ?? item.SkinID ?? ''),
        generalId: Number(data?.generalID ?? asRecord(item.paperGeneralInfo)?.GeneralID) || 0,
        state: resolved.state,
        name: String(data?.name || data?.skinname || '三国杀皮肤'),
        generalName: '',
        previewUrl: resolved.previewUrl,
        resource: resolved.resource,
        savedAt: Date.now()
      });
      item.__xcPaperFavoriteActive = true;
      drawFavoriteIcon(item);
      showToast('已收藏到“小抄背景”', 'success', 3000);
      return true;
    } catch (error) {
      console.warn('[皮肤做背景] 换肤窗口收藏失败:', error);
      showToast('收藏背景失败，请重试', 'error', 4000);
      return false;
    }
  }

  function positionIcon(item: UnknownRecord, actions: UnknownRecord): void {
    callMethod(actions, 'pos', Number(item.x) + 8, Number(item.y) + Number(item.height) - ICON_SIZE - 8);
  }

  function createIcon(item: UnknownRecord, kind: IconKind, onClick: (item: UnknownRecord) => unknown): UnknownRecord | null {
    const SpriteClass = laya()?.Sprite as (new () => UnknownRecord) | undefined;
    if (!SpriteClass) return null;
    const icon = new SpriteClass();
    const event = layaEvent();
    icon.name = kind === 'background' ? 'xcSetSkinBackgroundIcon' : 'xcFavoriteSkinBackgroundIcon';
    callMethod(icon, 'size', ICON_SIZE, ICON_SIZE);
    Object.assign(icon, { mouseEnabled: true, mouseChildren: false, toolTip: kind === 'background' ? '设为背景' : '收藏背景' });
    const active = () => kind === 'favorite' && Boolean(item.__xcPaperFavoriteActive);
    callMethod(icon, 'on', event?.CLICK, item, (clickEvent: unknown) => {
      callMethod(clickEvent, 'stopPropagation');
      void onClick(item);
    });
    callMethod(icon, 'on', event?.MOUSE_OVER, icon, () => {
      setItemHover(item, true, 'actions');
      drawIcon(icon, kind, active(), true);
    });
    callMethod(icon, 'on', event?.MOUSE_OUT, icon, () => {
      drawIcon(icon, kind, active(), false);
      setItemHover(item, false, 'actions');
    });
    drawIcon(icon, kind);
    return icon;
  }

  function createActions(item: UnknownRecord): UnknownRecord | null {
    const SpriteClass = laya()?.Sprite as (new () => UnknownRecord) | undefined;
    const background = createIcon(item, 'background', setItemAsBackground);
    const favorite = createIcon(item, 'favorite', toggleItemFavorite);
    if (!SpriteClass || !background || !favorite) return null;
    const actions = new SpriteClass();
    actions.name = 'xcSkinBackgroundActions';
    callMethod(actions, 'size', ICON_SIZE * 2 + 4, ICON_SIZE);
    actions.zOrder = 10000;
    callMethod(favorite, 'pos', ICON_SIZE + 4, 0);
    callMethod(actions, 'addChild', background);
    callMethod(actions, 'addChild', favorite);
    const event = layaEvent();
    callMethod(actions, 'on', event?.MOUSE_OVER, item, () => setItemHover(item, true, 'actions'));
    callMethod(actions, 'on', event?.MOUSE_OUT, item, () => setItemHover(item, false, 'actions'));
    return actions;
  }

  function prepareItemIcon(item: UnknownRecord, container: UnknownRecord, view: UnknownRecord): UnknownRecord | null {
    item.paperGeneralInfo = view.generalInfo;
    let icon = asRecord(item.myFuncBtnPaperActions);
    if (!icon) {
      icon = createActions(item);
      if (!icon) return null;
      item.myFuncBtnPaperActions = icon;
      callMethod(container, 'addChild', icon);
      const event = layaEvent();
      const over = () => setItemHover(item, true);
      const out = () => setItemHover(item, false);
      callMethod(item, 'on', event?.MOUSE_OVER, item, over);
      callMethod(item, 'on', event?.MOUSE_OUT, item, out);
      callMethod(item.bg, 'on', event?.MOUSE_OVER, item, over);
      callMethod(item.bg, 'on', event?.MOUSE_OUT, item, out);
    }
    const favoriteId = itemFavoriteId(item, itemFavoriteState(item));
    item.__xcPaperFavoriteActive = Boolean(favoriteId) && store.isFavorite(favoriteId);
    drawFavoriteIcon(item);
    positionIcon(item, icon);
    item.__xcPaperSurfaceHovered = false;
    item.__xcPaperActionsHovered = false;
    setItemHover(item, false);
    if (!item.__xcPaperRenderBound && typeof item.render === 'function') {
      patcher.wrap(item, 'render', (original) => function (this: UnknownRecord, ...args: unknown[]) {
        const result = original.apply(this, args);
        const ownIcon = asRecord(this.myFuncBtnPaperActions);
        if (ownIcon) {
          positionIcon(this, ownIcon);
          this.__xcPaperSurfaceHovered = false;
          this.__xcPaperActionsHovered = false;
          setItemHover(this, false);
        }
        return result;
      });
      item.__xcPaperRenderBound = true;
    }
    return icon;
  }

  function hideAllIcons(view: UnknownRecord | null): void {
    const icons = view?.__xcPaperButtons;
    if (icons instanceof Set) {
      icons.forEach((icon) => Object.assign(icon as UnknownRecord, { visible: false, mouseEnabled: false }));
    }
  }

  let preparingPaperWindow = false;

  async function prepareChangeSkinWindow(win: UnknownRecord): Promise<boolean> {
    if (preparingPaperWindow) return false;
    if (!isOn()) {
      hideAllIcons(asRecord(win.selectView));
      return false;
    }
    preparingPaperWindow = true;
    try {
    const view = await tasks.poll(() => {
      const selectView = asRecord(win.selectView);
      const list = selectView?.itemList;
      return Array.isArray(list) && list.length ? selectView : null;
    }, 20, 100);
    const container = asRecord(view?.pannelContent) ?? view;
    if (!view || !container || !Array.isArray(view.itemList)) return false;
    const all = view.__xcPaperButtons instanceof Set ? view.__xcPaperButtons as Set<UnknownRecord> : new Set<UnknownRecord>();
    view.__xcPaperButtons = all;
    const current = new Set<UnknownRecord>();
    for (const entry of view.itemList) {
      const item = asRecord(entry);
      if (!item) continue;
      const icon = prepareItemIcon(item, container, view);
      if (!icon) continue;
      current.add(icon);
      all.add(icon);
    }
    all.forEach((icon) => {
      if (!current.has(icon)) Object.assign(icon, { visible: false, mouseEnabled: false });
    });
    const panel = asRecord(view.pannel);
    if (panel && !panel.__xcPaperRefreshBound && typeof panel.refresh === 'function') {
      patcher.wrap(panel, 'refresh', (original) => function (this: unknown, ...args: unknown[]) {
        const result = original.apply(this, args);
        if (!preparingPaperWindow) queueMicrotask(() => void prepareChangeSkinWindow(win));
        return result;
      });
      panel.__xcPaperRefreshBound = true;
    }
    if (view && !view.__xcPaperUpdateBound && typeof view.updateContent === 'function') {
      patcher.wrap(view, 'updateContent', (original) => function (this: unknown, ...args: unknown[]) {
        const result = original.apply(this, args);
        if (!preparingPaperWindow) queueMicrotask(() => void prepareChangeSkinWindow(win));
        return result;
      });
      view.__xcPaperUpdateBound = true;
    }
    return true;
    } finally {
      preparingPaperWindow = false;
    }
  }

  function refreshChangeSkinWindow(): void {
    const win = locator.window('ChangeSkinWindow');
    if (win) void prepareChangeSkinWindow(win);
  }

  function onChangeSkinWindow(): void {
    void tasks.poll(() => locator.window('ChangeSkinWindow'), 20, 100).then((win) => {
      if (win) void prepareChangeSkinWindow(win);
    });
  }

  // ---------- 开关与场景 ----------

  function currentBackgroundResource(): BackgroundResource | null {
    const saved = store.loadResource();
    if (String(saved.url || '').trim()) return saved as BackgroundResource;
    const live = renderer.resource;
    if (String(live.url || '').trim()) return live as BackgroundResource;
    return null;
  }

  function clearDomPageBackgrounds(): void {
    lobbyPageBackground.clear();
    viewportPageBackground.clear();
  }

  /** 微端/浏览器：画布外留白与大厅页用 DOM 铺底，与 Laya 层配合。 */
  function syncDomPageBackgrounds(show: boolean): void {
    // 首页的背景只铺在游戏区域内，游戏区域外保持官方样子，不用页面铺底。
    if (!show || PAPER_HOME_SCENE_NAMES.includes(String(locator.scene()?.SceneName ?? ''))) {
      clearDomPageBackgrounds();
      return;
    }
    const res = currentBackgroundResource();
    const storedUrl = String(res?.url || '').trim();
    const url = runtimeBlobUrl || storedUrl;
    if (!url) {
      clearDomPageBackgrounds();
      return;
    }
    const payload = { url, type: Number(res?.type) || 0 };
    const inTable = Boolean(locator.gameScene());
    const hallAllPaper = configStore.get('skin.allPaper') === true && !inTable;
    if (inTable) {
      viewportPageBackground.applyMargins(payload);
    } else {
      viewportPageBackground.apply(payload);
    }
    if (hasLobbyPageBackgroundContainer() && hallAllPaper) {
      lobbyPageBackground.clear();
    } else if (hasLobbyPageBackgroundContainer()) {
      lobbyPageBackground.apply(payload);
    } else {
      lobbyPageBackground.clear();
    }
  }

  /** 开关和 paperRes 都在，但 Laya 层上还没挂上背景。 */
  function needsBackgroundRestore(): boolean {
    if (!shouldShow()) return false;
    const url = String(currentBackgroundResource()?.url || '').trim();
    if (!url) return false;
    return !renderer.isMounted();
  }

  /** 按开关和场景同步皮肤背景是否显示。 */
  async function syncVisibility(): Promise<boolean> {
    if (syncingVisibility) {
      visibilitySyncQueued = true;
      return true;
    }
    syncingVisibility = true;
    try {
      let applied = await syncVisibilityOnce();
      while (visibilitySyncQueued) {
        visibilitySyncQueued = false;
        applied = await syncVisibilityOnce();
      }
      return applied;
    } finally {
      syncingVisibility = false;
    }
  }

  /** 加载要等一会儿，每等完一步都重新判断：这时可能已经开始退回大厅，不能再把背景亮出来。 */
  async function syncVisibilityOnce(): Promise<boolean> {
    if (!isPaperUiScene(locator, globalObject) || !mayMutateSkinBackground(locator, globalObject, () => true)) {
      return true;
    }
    reloadAccountBackground();
    const show = shouldShow();
    skinTrace('paper-visibility', {
      show,
      sceneName: locator.scene()?.SceneName,
      inGame: Boolean(locator.gameScene()),
      allPaper: configStore.get('skin.allPaper'),
      resource: renderer.resource,
      layerFound: Boolean(locator.layer('BackgroundLayer')),
      sceneLayerFound: Boolean(locator.layer('SceneLayer'))
    });
    if (!show) {
      hideBackground();
      return true;
    }
    let applied = await renderer.setEnabled(true);
    if (!applied && shouldShow()) applied = await reapplyStoredBackground();
    if (!applied && shouldShow()) {
      const stored = store.loadResource();
      const saved = await resolvePlayableResource(stored);
      applied = await renderer.setBackground(saved, false, String(stored.url ?? ''));
    }
    if (!applied) {
      hideBackground();
      return false;
    }
    if (!shouldShow()) {
      hideBackground();
      return true;
    }
    await renderer.syncSceneVisibility(true, configStore.get('skin.allPaper') === true);
    if (!shouldShow()) {
      hideBackground();
      return true;
    }
    syncDomPageBackgrounds(true);
    return true;
  }

  function onSkinPaperSwitchChanged(): void {
    options.syncWallpaperMenu();
    refreshChangeSkinWindow();
  }

  function onAllPaperSwitchChanged(): void {
    if (configStore.get('skin.allPaper') === true) {
      void syncVisibility();
      return;
    }
    if (inMatch()) return;
    hideBackground();
  }

  function onOfficialSwitchChanged(): void {
    options.syncWallpaperMenu();
  }

  // ---------- 背景动作 ----------

  function filterMessage(payload: UnknownRecord, className: string): void {
    if (!isOn()) return;
    if (className === 'decodeGameChooseAllGenNtf') {
      renderer.playAction('ChuChang');
      return;
    }
    const selfSeatId = options.selfSeatId();
    if (selfSeatId === null) return;
    if (className === 'PubGsCUseCard') {
      if (Number(payload.SeatID) === selfSeatId && Number(payload.useType) === 1
        && Number(payload.spellID) === 1 && !payload.isSend) {
        renderer.playAction('GongJi');
      }
      return;
    }
    if (className === 'GsClientBroadcastChatGoods') {
      const proto = asRecord(payload.ProtoObj);
      const seatInfo = proto?.seatInfo;
      const involved = (Array.isArray(seatInfo) && seatInfo.some((seat) => Number(asRecord(seat)?.seatId) === selfSeatId))
        || Number(proto?.seatid) === selfSeatId;
      if (involved) renderer.playAction('HuDong');
    }
  }

  const menuExtension: WallpaperMenuExtension = {
    enabled: isOn,
    onOfficialWallpaperUsed() {
      // 改用官方背景时清掉小抄背景，上传的文件还留在列表里。
      if (renderer.hasBackground()) renderer.clearBackground(true);
      clearDomPageBackgrounds();
      favoritesTab.refreshSelection();
    },
    usingXiaochaoBackground: () => renderer.hasBackground(),
    attachMenu: (menu) => favoritesTab.attach(menu),
    detachMenu: (menu) => favoritesTab.detach(menu)
  };

  const unsubscribes = [
    configStore.subscribe('skin.skinPaper', onSkinPaperSwitchChanged),
    configStore.subscribe('skin.allPaper', onAllPaperSwitchChanged),
    configStore.subscribe('skin.officialBackground', onOfficialSwitchChanged)
  ];
  if (options.gameEvents) {
    unsubscribes.push(options.gameEvents.subscribe((event) => {
      // 结束通知要等牌局页面没了好几秒才来，这时可能已经进了下一局，得按当前页面判断。
      if (event.type === 'game-ended') {
        if (shouldShow()) void syncVisibility();
        else hideBackground();
      } else if (event.type === 'game-started') void migrateLegacyUpload().then(() => syncVisibility());
    }));
  }
  async function applyHallBackgroundOnce(): Promise<void> {
    reloadAccountBackground();
    await syncVisibility();
  }

  const wantsHallAutoBackground = () => configStore.get('skin.allPaper') === true;

  function onBackgroundSceneReady(): void {
    leavingMatch = false;
    if (paperAccountId() && paperAccountId() !== legacyUploadCheckedAccount) {
      void migrateLegacyUpload().then(() => onBackgroundSceneReady());
      return;
    }
    const sceneName = String(locator.scene()?.SceneName ?? '');
    if (PAPER_LOBBY_SCENE_NAMES.includes(sceneName)) {
      if (!wantsHallAutoBackground() || !hasStoredPicture()) {
        hideBackground();
        warmMatchBackgroundFile();
        return;
      }
      if (sceneName === 'HallScene') {
        if (isBackgroundUiScene(locator, globalObject)) void applyHallBackgroundOnce();
        return;
      }
    }
    if (!mayMutateSkinBackground(locator, globalObject, () => true)) return;
    // 这个页面不该显示时直接收起，不能先挂出来再等下一轮判断，否则会闪一下。
    if (!shouldShow()) {
      hideBackground();
      warmMatchBackgroundFile();
      return;
    }
    void syncVisibility();
  }

  let backgroundHooksStarted = false;

  function startBackgroundLifecycleHooks(): void {
    if (backgroundHooksStarted) return;
    backgroundHooksStarted = true;
    watchWindowShow(locator, patcher, tasks, ['ChangeSkinWindow'], () => onChangeSkinWindow(), globalObject);
    watchSceneSwitchRequest(locator, patcher, tasks, onSceneSwitchRequest);
    warmMatchBackgroundFile();
    watchSceneSwitch(
      locator, patcher, tasks, onBackgroundSceneReady, globalObject, undefined,
      () => isPaperUiScene(locator, globalObject)
    );
    void tasks.poll(() => {
      if (!mayMutateSkinBackground(locator, globalObject, () => hasStoredPicture())) return null;
      return true;
    }, Infinity, 2000).then(() => {
      void syncVisibility();
    });
  }

  function waitForSafeBackgroundHooks(): void {
    void tasks.poll(() => {
      if (!isPaperUiScene(locator, globalObject)) return null;
      return true;
    }, Infinity, 1000).then(() => startBackgroundLifecycleHooks());
  }

  if (isOn()) waitForSkinDetailHooks();
  else {
    const unsubPaper = configStore.subscribe('skin.skinPaper', (detail) => {
      if (detail.value !== true) return;
      waitForSkinDetailHooks();
    });
    unsubscribes.push(unsubPaper);
  }
  waitForSafeBackgroundHooks();
  const onAccountBucketChange = () => {
    if (!mayMutateSkinBackground(locator, globalObject, isOn)) return;
    void migrateLegacyUpload().then(() => syncVisibility());
  };
  if (typeof window !== 'undefined') {
    window.addEventListener(CONFIG_ACCOUNT_SYNC_EVENT, onAccountBucketChange);
  }
  // 服务器上较新的背景写进本机后，背景、收藏列表和勾都按新存的内容来。背景被别处清掉时换回游戏自己的。
  unsubscribes.push(onSkinBackgroundSynced((accountId) => {
    if (accountId !== paperAccountId()) return;
    if (!String(store.loadResource().url || '').trim() && renderer.hasBackground()) renderer.clearBackground(false);
    favoritesTab.refreshList();
    refreshChangeSkinWindow();
    options.syncWallpaperMenu();
    void syncVisibility().then(() => favoritesTab.refreshSelection());
  }));

  return {
    menuExtension,
    filterMessage,
    dispose() {
      if (typeof window !== 'undefined') {
        window.removeEventListener(CONFIG_ACCOUNT_SYNC_EVENT, onAccountBucketChange);
      }
      revokeRuntimeBlobUrl();
      [...uploadPreviews.keys()].forEach(releaseUploadPreview);
      clearDomPageBackgrounds();
      unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
      tasks.dispose();
      favoritesTab.dispose();
      renderer.dispose();
      patcher.restoreAll();
    }
  };
}

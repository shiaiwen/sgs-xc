/**
 * 皮肤纸控制器：本家/全场皮肤纸开关与壁纸菜单扩展。
 */

import { CONFIG_ACCOUNT_SYNC_EVENT, type XiaochaoConfigStore } from '../../config/config-store.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { readSeatStateFromGameScene } from '../seat-display/seat-game-adapter.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import { resolveGameAccountId } from '../../runtime/game-account-session.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { showToast } from '../../ui/toast/show-toast.ts';
import type { WallpaperMenuExtension } from './official-background-controller.ts';
import { createFavoritesTab } from './skin-background-favorites-tab.ts';
import { createSkinBackgroundRenderer } from './skin-background-renderer.ts';
import { createSkinBackgroundStore, type BackgroundFavorite, type BackgroundResource } from './skin-background-store.ts';
import { SKIN_FRAME_HORIZONTAL, SKIN_FRAME_PORTRAIT, SKIN_FRAME_WIDE } from '../../const/skin-frame.ts';
import { SKIN_DETAIL_BUTTON_HEIGHT, SKIN_DETAIL_FLAT_BUTTON_SKINS, SKIN_DETAIL_WINDOW_NAMES } from '../../const/skin-detail-window.ts';
import {
  cleanupMisplacedDetailButtons,
  computeDetailButtonLayout,
  hideInjectedDetailButtons,
  hookSkinDetailWindowRefresh,
  isPortraitSkinDetail,
  isSkinDetailWindowCandidate,
  resolveSkinDetailMount,
  resolveSkinDetailWindow,
  wireNativeSkinDetailButtons,
  type SkinDetailResolveProbe
} from './skin-detail-buttons.ts';
import { DEFAULT_STAGE_HEIGHT, DEFAULT_STAGE_WIDTH } from '../../const/stage.ts';
import {
  bindCustomBackgroundActions,
  getCustomBackgroundStore,
  isCustomBackgroundVideo,
  type CustomBackgroundRecord
} from './custom-background-store.ts';
import { blobForBackgroundPlayback, detectCustomBackgroundVideo } from './custom-background-media.ts';
import {
  getLobbyPageBackground,
  hasLobbyPageBackgroundContainer
} from './lobby-page-background.ts';
import { getViewportPageBackground } from './viewport-page-background.ts';
import { mayMutateSkinBackground } from './skin-background-session.ts';
import {
  accountStorageKey,
  asRecord,
  callMethod,
  createTaskScope,
  skinTrace,
  supportsDynamicSkin,
  isBackgroundUiScene,
  isXiaochaoGameplayUiReady,
  watchSceneSwitch,
  watchWindowShow,
  type UnknownRecord
} from './skin-runtime.ts';

const MAP_SCENES = ['RogueLikeBigMapScene', 'RogueSmallMapScene'];
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
  const tasks = createTaskScope();
  function paperAccountId(): string {
    const gameId = resolveGameAccountId(globalObject, locator);
    if (gameId) return gameId;
    return accountStorageKey(storage);
  }

  const store = createSkinBackgroundStore(storage, { resolveAccountId: paperAccountId });
  const renderer = createSkinBackgroundRenderer({ globalObject, locator, store, tasks, patcher });
  const lobbyPageBackground = getLobbyPageBackground();
  const viewportPageBackground = getViewportPageBackground();
  lobbyPageBackground.clear();
  viewportPageBackground.clear();
  const laya = () => asRecord(globalObject.Laya);
  const layaEvent = () => asRecord(laya()?.Event);

  const isOn = () => configStore.get('skin.skinPaper') === true;
  const customStore = getCustomBackgroundStore();
  let customResource: BackgroundResource | null = null;
  let useCustom = false;
  let syncingVisibility = false;
  let runtimeBlobUrl = '';

  function revokeRuntimeBlobUrl(): void {
    if (!runtimeBlobUrl.startsWith('blob:')) return;
    try {
      URL.revokeObjectURL(runtimeBlobUrl);
    } catch {
      // 忽略 revoke 失败。
    }
    runtimeBlobUrl = '';
  }

  /** 跨域原画转 blob，避免 Laya loadImage 因 CORS 静默失败。 */
  async function resolvePlayableResource(resource: Partial<BackgroundResource>): Promise<Partial<BackgroundResource>> {
    const url = String(resource.url || '').trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) return resource;
    try {
      const found = await fetchSkinImage(url).catch(() => null);
      const fetchUrl = found?.url || url;
      const response = found?.response ?? await fetch(fetchUrl);
      if (!response.ok) return resource;
      const blob = await response.blob();
      revokeRuntimeBlobUrl();
      runtimeBlobUrl = URL.createObjectURL(blob);
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
    isCurrent: (favorite) => isCurrentFavorite(favorite)
  });

  /** 用户手动设过的皮肤/自定义背景，优先于山河图等地图场景自带底图。 */
  function hasManualBackground(): boolean {
    if (useCustom && customResource?.url) return true;
    if (!isOn()) return false;
    const saved = store.loadResource();
    return Boolean(String(saved.url || renderer.resource.url || '').trim());
  }

  /** 对局内才展示牌桌背景；局后结算、进房加载仍视为非对局。 */
  function seatInActiveMatch(): boolean {
    if (!locator.gameScene()) return false;
    const sceneName = String(locator.scene()?.SceneName ?? '');
    if (MAP_SCENES.includes(sceneName)) return true;
    return Boolean(readSeatStateFromGameScene(locateGameScene(globalObject)).inGame);
  }

  function shouldShow(): boolean {
    const sceneName = String(locator.scene()?.SceneName ?? '');
    const mapScene = MAP_SCENES.includes(sceneName);
    if (mapScene) return hasManualBackground();
    if (useCustom && customResource) {
      if (configStore.get('skin.allPaper') === true) return hasManualBackground();
      return seatInActiveMatch();
    }
    if (!isOn()) return false;
    if (configStore.get('skin.allPaper') === true) return hasManualBackground();
    return seatInActiveMatch();
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
    if (useCustom && customResource?.url) {
      return renderer.setBackground(await resolvePlayableResource(customResource), false);
    }
    return renderer.setBackground(await resolvePlayableResource(saved), false);
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
    if (!url) return { url: '', type: 0, width, height };
    const found = await fetchSkinImage(url).catch(() => null);
    const finalUrl = found?.url || url;
    if (!found?.response.ok || typeof createImageBitmap !== 'function') return { url: finalUrl, type: 0, width, height };
    try {
      const bitmap = await createImageBitmap(await found.response.blob());
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return { url: finalUrl, type: 0, ...size };
    } catch {
      return { url: finalUrl, type: 0, width, height };
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
    if (type === 1) return { videoUrl: `${String(base?.DynamicSkinBigUrl || '')}.mp4` };
    if (type === 3) {
      if (base?.NewSkinJudge) url = String(callMethod(base, 'DynamicSkinBigSkeletonUrlNew', win.juexingState) || '');
      else type = 4;
    } else if (type !== 2 && type !== 4) {
      ({ url, width, height } = await measureStatic(imageUrl, width, height));
      type = 0;
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
    if (type === 1) type = 0;
    if (type === 3) {
      if (data.NewSkinJudge) url = String(callMethod(data, 'DynamicSkinBigSkeletonUrlNew', state) || '');
      else type = 4;
    }
    const bigUrl = String(callMethod(data, 'SkinBigUrl', state) || '');
    if (![2, 3, 4].includes(type) || !url) {
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
    return current.url === favorite.resource.url && Number(current.type) === Number(favorite.resource.type);
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
      if (!(await renderer.setBackground(playable))) {
        showToast('背景设置失败，请重试', 'error', 4000);
        return false;
      }
      await syncVisibility();
      favoritesTab.refreshSelection();
      refreshChangeSkinWindow();
      showToast('背景设置成功', 'success', 4000);
      return true;
    } catch (error) {
      console.warn('[皮肤做背景] 设置失败:', error);
      showToast('背景设置失败，请重试', 'error', 4000);
      return false;
    }
  }

  // ---------- 皮肤详情窗口按钮 ----------

  function isVideoDetail(win: UnknownRecord): boolean {
    return Number(win.isDynamicPlay) === 1 && Number(asRecord(asRecord(win.skinData)?.skinBaseVo)?.ResType) === 1;
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

  function tryInstallDetailButtons(): void {
    cleanupMisplacedDetailButtons(locator, globalObject);
    const win = resolveSkinDetailWindow(locator, globalObject);
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
      const win = resolveSkinDetailWindow(locator, globalObject);
      if (!win || win.destroyed || win.visible === false) return null;
      return win;
    }, 80, 120).then((win) => {
      if (!win || win.destroyed || !isOn()) return;
      tryInstallDetailButtons();
      tasks.later(() => tryInstallDetailButtons(), 250);
      tasks.later(() => tryInstallDetailButtons(), 800);
      tasks.later(() => tryInstallDetailButtons(), 1600);
    });
  }

  let detailButtonPollStarted = false;

  function startDetailButtonPoll(): void {
    if (detailButtonPollStarted) return;
    detailButtonPollStarted = true;
    let idleRounds = 0;
    let activeRounds = 0;
    let probeCounter = 0;
    const tick = () => {
      if (!isOn()) {
        tasks.later(tick, 2000);
        return;
      }
      const probe: SkinDetailResolveProbe = { dictKeys: [], layerHits: 0, picked: '' };
      const win = resolveSkinDetailWindow(locator, globalObject, probe);
      if (win && win.visible !== false && !win.destroyed) {
        idleRounds = 0;
        activeRounds += 1;
        if (activeRounds % 4 === 1) tryInstallDetailButtons();
      } else {
        idleRounds += 1;
        activeRounds = 0;
        probeCounter += 1;
        if (probeCounter % 6 === 0) {
          skinTrace('skin-detail-probe', {
            idleRounds,
            layerHits: probe.layerHits,
            picked: probe.picked,
            scene: String(locator.scene()?.SceneName ?? '')
          });
        }
      }
      const delay = idleRounds > 8 ? 2500 : 700;
      tasks.later(tick, delay);
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
    startDetailButtonPoll();
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
    if (useCustom && customResource?.url) return customResource;
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
    if (!show) {
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
    if (!isOn() || !shouldShow()) return false;
    const url = String(currentBackgroundResource()?.url || '').trim();
    if (!url) return false;
    if (useCustom && customResource?.url) return !renderer.isMounted();
    return !renderer.isMounted();
  }

  /** 按开关和场景同步皮肤背景是否显示。 */
  async function syncVisibility(): Promise<boolean> {
    if (syncingVisibility) return true;
    syncingVisibility = true;
    try {
      if (!isBackgroundUiScene(locator, globalObject) || !mayMutateSkinBackground(locator, globalObject, isOn)) {
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
        customResource,
        useCustom,
        layerFound: Boolean(locator.layer('BackgroundLayer')),
        sceneLayerFound: Boolean(locator.layer('SceneLayer'))
      });
      const allPaper = configStore.get('skin.allPaper') === true;
      if (!show) {
        await renderer.syncSceneVisibility(false, allPaper);
        clearDomPageBackgrounds();
        return true;
      }
      if (useCustom && customResource) {
        const playable = await resolvePlayableResource(customResource);
        const ok = await renderer.setBackground(playable, false);
        if (ok) {
          await renderer.syncSceneVisibility(true, allPaper);
          syncDomPageBackgrounds(true);
        } else clearDomPageBackgrounds();
        return ok;
      }
      let applied = await renderer.setEnabled(true);
      if (!applied) {
        applied = await reapplyStoredBackground();
      }
      if (!applied && show) {
        const saved = await resolvePlayableResource(store.loadResource());
        applied = await renderer.setBackground(saved, false);
      }
      if (!applied) {
        await renderer.syncSceneVisibility(false, allPaper);
        clearDomPageBackgrounds();
        return false;
      }
      await renderer.syncSceneVisibility(true, allPaper);
      syncDomPageBackgrounds(true);
      return true;
    } finally {
      syncingVisibility = false;
    }
  }

  async function measureUpload(
    file: Blob,
    options: {
      preferVideo?: boolean;
      isVideo?: boolean;
      width?: number;
      height?: number;
      fileName?: string;
    } = {}
  ): Promise<BackgroundResource> {
    const video = options.preferVideo === true || isCustomBackgroundVideo(file, options);
    const playback = blobForBackgroundPlayback(
      file,
      video,
      video ? 'video/mp4' : 'image/png'
    );
    const url = URL.createObjectURL(playback);
    if (video) {
      return {
        url,
        type: 1,
        width: Number(options.width) || DEFAULT_STAGE_WIDTH,
        height: Number(options.height) || DEFAULT_STAGE_HEIGHT
      };
    }
    if (Number(options.width) > 0 && Number(options.height) > 0) {
      return { url, type: 0, width: Number(options.width), height: Number(options.height) };
    }
    if (typeof createImageBitmap !== 'function') return { url, type: 0, width: DEFAULT_STAGE_WIDTH, height: DEFAULT_STAGE_HEIGHT };
    try {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return { url, type: 0, ...size };
    } catch {
      if (detectCustomBackgroundVideo(file, options)) {
        return { url, type: 1, width: Number(options.width) || DEFAULT_STAGE_WIDTH, height: Number(options.height) || DEFAULT_STAGE_HEIGHT };
      }
      return { url, type: 0, width: DEFAULT_STAGE_WIDTH, height: DEFAULT_STAGE_HEIGHT };
    }
  }

  async function applyCustom(record: CustomBackgroundRecord): Promise<void> {
    if (customResource?.url.startsWith('blob:')) URL.revokeObjectURL(customResource.url);
    customResource = await measureUpload(record.blob, {
      preferVideo: record.isVideo === true,
      width: record.width,
      height: record.height,
      fileName: record.fileName,
      isVideo: record.isVideo
    });
    useCustom = true;
    let applied = false;
    try {
      applied = await syncVisibility();
    } catch (error) {
      console.warn('[自定义背景] 应用失败:', error);
      applied = false;
    }
    if (!applied) {
      showToast(
        customResource && Number(customResource.type) === 1
          ? '视频背景加载失败，换 H.264 编码的 MP4 或先用图片'
          : '背景加载失败，换一张图或稍后再试',
        'error',
        5000
      );
      return;
    }
    if (!shouldShow()) showToast('已保存，进局后会换成这张背景', 'success');
    else showToast(
      isCustomBackgroundVideo(record.blob, record) ? '背景已换成上传的视频' : '背景已换成上传的图片',
      'success'
    );
  }

  async function clearCustom(): Promise<void> {
    useCustom = false;
    if (customResource?.url.startsWith('blob:')) URL.revokeObjectURL(customResource.url);
    customResource = null;
    await customStore.clear();
    // 上传图只画在上层。不先撤掉的话，开关仍开着时会按内存里的地址再画一遍。
    if (String(renderer.resource.url || '').startsWith('blob:')) renderer.clearBackground(false);
    await syncVisibility();
  }

  async function restoreCustom(): Promise<void> {
    const saved = await customStore.load();
    if (customResource?.url.startsWith('blob:')) URL.revokeObjectURL(customResource.url);
    if (saved?.active) {
      customResource = await measureUpload(saved.blob, {
        preferVideo: saved.isVideo === true,
        width: saved.width,
        height: saved.height,
        fileName: saved.fileName,
        isVideo: saved.isVideo
      });
      useCustom = true;
    } else {
      customResource = null;
      useCustom = false;
      if (String(renderer.resource.url || '').startsWith('blob:')) renderer.clearBackground(false);
    }
    await syncVisibility();
  }

  function onSwitchChanged(): void {
    options.syncWallpaperMenu();
    if (!isOn()) {
      if (isBackgroundUiScene(locator, globalObject)) void renderer.syncSceneVisibility(false, false);
      clearDomPageBackgrounds();
      refreshChangeSkinWindow();
      return;
    }
    if (mayMutateSkinBackground(locator, globalObject, isOn)) {
      void syncVisibility();
    }
    refreshChangeSkinWindow();
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
      // 改用官方背景时清掉皮肤背景，上传的图先让开，文件还留着。
      useCustom = false;
      void customStore.setActive(false);
      if (renderer.hasBackground()) renderer.clearBackground(true);
      clearDomPageBackgrounds();
      favoritesTab.refreshSelection();
    },
    attachMenu: (menu) => favoritesTab.attach(menu),
    detachMenu: (menu) => favoritesTab.detach(menu)
  };

  async function releaseMatchBackground(): Promise<void> {
    if (!isOn()) return;
    const allPaper = configStore.get('skin.allPaper') === true;
    if (allPaper) {
      await syncVisibility();
      return;
    }
    await renderer.syncSceneVisibility(false, allPaper);
    clearDomPageBackgrounds();
  }

  const unsubscribes = [
    configStore.subscribe('skin.skinPaper', onSwitchChanged),
    configStore.subscribe('skin.allPaper', onSwitchChanged),
    configStore.subscribe('skin.officialBackground', onSwitchChanged)
  ];
  if (options.gameEvents) {
    unsubscribes.push(options.gameEvents.subscribe((event) => {
      if (event.type === 'game-ended') void releaseMatchBackground();
      else if (event.type === 'game-started') void syncVisibility();
    }));
  }
  const unbindCustom = bindCustomBackgroundActions({
    apply: applyCustom,
    clear: clearCustom
  });
  async function applyHallBackgroundOnce(): Promise<void> {
    if (!isOn()) return;
    reloadAccountBackground();
    await restoreCustom();
    await syncVisibility();
  }

  const wantsHallAutoBackground = () => configStore.get('skin.allPaper') === true;

  function onBackgroundSceneReady(): void {
    if (!isOn()) return;
    const allPaper = configStore.get('skin.allPaper') === true;
    const sceneName = String(locator.scene()?.SceneName ?? '');
    if (sceneName === 'HallScene') {
      if (!isBackgroundUiScene(locator, globalObject)) return;
      if (wantsHallAutoBackground()) void applyHallBackgroundOnce();
      else void renderer.syncSceneVisibility(false, false);
      return;
    }
    if (!mayMutateSkinBackground(locator, globalObject, isOn)) return;
    renderer.onSceneChange(allPaper);
    void syncVisibility();
  }

  let backgroundHooksStarted = false;

  function startBackgroundLifecycleHooks(): void {
    if (backgroundHooksStarted) return;
    backgroundHooksStarted = true;
    watchWindowShow(locator, patcher, tasks, ['ChangeSkinWindow'], () => onChangeSkinWindow(), globalObject);
    watchSceneSwitch(locator, patcher, tasks, onBackgroundSceneReady, globalObject);
    void tasks.poll(() => {
      if (!isOn() || !mayMutateSkinBackground(locator, globalObject, isOn)) return null;
      return true;
    }, Infinity, 2000).then(() => {
      void syncVisibility();
    });
  }

  function waitForSafeBackgroundHooks(): void {
    void tasks.poll(() => {
      if (!isOn() || !isBackgroundUiScene(locator, globalObject)) return null;
      return true;
    }, Infinity, 1000).then(() => startBackgroundLifecycleHooks());
  }

  if (isOn()) {
    waitForSkinDetailHooks();
    waitForSafeBackgroundHooks();
  } else {
    const unsubPaper = configStore.subscribe('skin.skinPaper', (detail) => {
      if (detail.value !== true) return;
      waitForSkinDetailHooks();
      waitForSafeBackgroundHooks();
    });
    unsubscribes.push(unsubPaper);
  }
  const onAccountBucketChange = () => {
    if (!mayMutateSkinBackground(locator, globalObject, isOn)) return;
    void syncVisibility();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener(CONFIG_ACCOUNT_SYNC_EVENT, onAccountBucketChange);
  }

  return {
    menuExtension,
    filterMessage,
    dispose() {
      if (typeof window !== 'undefined') {
        window.removeEventListener(CONFIG_ACCOUNT_SYNC_EVENT, onAccountBucketChange);
      }
      revokeRuntimeBlobUrl();
      clearDomPageBackgrounds();
      unbindCustom();
      unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
      tasks.dispose();
      favoritesTab.dispose();
      renderer.dispose();
      patcher.restoreAll();
    }
  };
}

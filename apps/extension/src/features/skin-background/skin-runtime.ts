/**
 * 皮肤运行时工具：查找皮肤资源与应用状态。
 */

import { readBrowserSetting, removeBrowserSetting, writeBrowserSetting } from '../../adapters/browser-settings.ts';
import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { locateSceneManager } from '../seat-display/game-scene-locator.ts';
import { PANEL_MOUNT_ENGINE_READY_FALLBACK_MS } from '../../const/panel-startup.ts';
import {
  WALLPAPER_MENU_STAGE_SEARCH_DEPTH,
  WALLPAPER_MENU_TREE_SEARCH_DEPTH,
  WALLPAPER_TOP_MENU_OPEN_METHODS,
  WALLPAPER_TOP_MENU_SEARCH_DEPTH
} from '../../const/wallpaper-menu.ts';
import type { MethodPatcher } from '../../runtime/method-patch.ts';

export type UnknownRecord = Record<string, unknown>;

/** 把未知值收成对象，不是对象时返回空。 */
export function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

/** 安全调用对象上的方法。 */
export function callMethod(target: unknown, name: string, ...args: unknown[]): unknown {
  const record = asRecord(target);
  const method = record?.[name];
  return typeof method === 'function' ? method.apply(record, args) : undefined;
}

/** 读取对象原型。 */
export function prototypeOf(target: unknown): UnknownRecord | null {
  const record = asRecord(target);
  return asRecord(record ? Object.getPrototypeOf(record) : null)
    ?? asRecord(asRecord(record?.constructor)?.prototype);
}

const TRACE_LIMIT = 300;

function pushSkinTraceEntry(
  host: { __XIAOCHAO_SKIN_TRACE__?: unknown[] },
  entry: { time: number; kind: string; detail: Record<string, unknown> }
): void {
  const buffer = Array.isArray(host.__XIAOCHAO_SKIN_TRACE__) ? host.__XIAOCHAO_SKIN_TRACE__ : [];
  host.__XIAOCHAO_SKIN_TRACE__ = buffer;
  buffer.push(entry);
  if (buffer.length > TRACE_LIMIT) buffer.splice(0, buffer.length - TRACE_LIMIT);
}

/** 实机诊断：记录到页面全局缓冲，开发版主进程定时取走写入 .dev-data/skin-trace.log。 */
export function skinTrace(kind: string, detail: Record<string, unknown> = {}): void {
  const entry = { time: Date.now(), kind, detail };
  const roots: unknown[] = [];
  if (typeof window !== 'undefined') roots.push(window);
  if (typeof globalThis !== 'undefined' && !roots.includes(globalThis)) roots.push(globalThis);
  for (const root of roots) {
    try {
      pushSkinTraceEntry(root as { __XIAOCHAO_SKIN_TRACE__?: unknown[] }, entry);
    } catch {
      // 诊断失败不影响功能。
    }
  }
  const mirrorToStartup = kind.includes('wallpaper') || kind.includes('skin-detail');
  if (!mirrorToStartup) return;
  try {
    const startupHost = (typeof window !== 'undefined' ? window : globalThis) as {
      __XIAOCHAO_STARTUP__?: Record<string, unknown>;
    };
    const startup = startupHost.__XIAOCHAO_STARTUP__;
    if (!startup) return;
    if (kind.includes('skin-detail')) {
      const skinDetailTrace = Array.isArray(startup.skinDetailTrace)
        ? startup.skinDetailTrace as typeof entry[]
        : [];
      startup.skinDetailTrace = skinDetailTrace;
      skinDetailTrace.push(entry);
      if (skinDetailTrace.length > TRACE_LIMIT) skinDetailTrace.splice(0, skinDetailTrace.length - TRACE_LIMIT);
    }
    if (kind.includes('wallpaper')) {
      const wallpaperTrace = Array.isArray(startup.wallpaperTrace)
        ? startup.wallpaperTrace as typeof entry[]
        : [];
      startup.wallpaperTrace = wallpaperTrace;
      wallpaperTrace.push(entry);
      if (wallpaperTrace.length > TRACE_LIMIT) wallpaperTrace.splice(0, wallpaperTrace.length - TRACE_LIMIT);
    }
  } catch {
    // 诊断失败不影响功能。
  }
}

/** 从存储里读 JSON，失败时返回空。 */
export function readJson<T>(storage: Pick<Storage, 'getItem'> | undefined, key: string, fallback: T): T {
  try {
    const raw = readBrowserSetting(key) ?? storage?.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

/** 把数据写成 JSON，同时写入本机配置，避免更新后丢失。 */
export function writeJson(storage: Pick<Storage, 'setItem'> | undefined, key: string, value: unknown): void {
  const raw = JSON.stringify(value);
  writeBrowserSetting(key, raw);
  try {
    storage?.setItem(key, raw);
  } catch {
    // 页面存储不可用时，本机配置里仍有一份。
  }
}

/** 从本机配置和页面存储里删掉同一条。 */
export function removeStored(storage: Pick<Storage, 'removeItem'> | undefined, key: string): void {
  removeBrowserSetting(key);
  try {
    storage?.removeItem(key);
  } catch {
    // 页面存储不可用时忽略。
  }
}

/** 当前登录账号，用作按账号区分的本地存储前缀。 */
export function accountStorageKey(storage: Pick<Storage, 'getItem'> | undefined): string {
  return storage?.getItem('LastUserName')
    || storage?.getItem('SGS_LASTLOGIN_ACCOUNT')
    || storage?.getItem('SGS_LASTLOGIN_ACCOUNT1')
    || 'default';
}

/** 配置项按当前登录账号分开存。 */
export function accountScopedStorageKey(base: string, storage?: Pick<Storage, 'getItem'>): string {
  let account = 'default';
  try {
    account = accountStorageKey(storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage));
  } catch {
    account = 'default';
  }
  const safe = account.replace(/[^\w.@+-]/g, '_').slice(0, 64) || 'default';
  return `${base}::${safe}`;
}

/** 定时任务作用域：控制器销毁后所有回调自动失效。 */
export interface TaskScope {
  readonly disposed: boolean;
  later(callback: () => void, delay: number): void;
  poll<T>(probe: () => T | null | undefined | false, retries: number, interval: number): Promise<T | null>;
  dispose(): void;
}

/** 创建可取消的延时任务范围。 */
export function createTaskScope(): TaskScope {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;

  function later(callback: () => void, delay: number): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, delay);
    timers.add(timer);
  }

  return {
    get disposed() {
      return disposed;
    },
    later,
    poll(probe, retries, interval) {
      return new Promise((resolve) => {
        const attempt = (remaining: number) => {
          if (disposed) return resolve(null);
          let value = null as ReturnType<typeof probe>;
          try {
            value = probe();
          } catch {
            value = null;
          }
          if (value) return resolve(value);
          if (remaining <= 0) return resolve(null);
          later(() => attempt(remaining - 1), interval);
        };
        attempt(retries);
      });
    },
    dispose() {
      disposed = true;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    }
  };
}

/** 游戏打开指定窗口后回调（包装 GameEventDispatcher.ShowWindow）。 */
export function watchWindowShow(
  locator: LayaObjectLocator,
  patcher: MethodPatcher,
  tasks: TaskScope,
  windowNames: readonly string[],
  onShow: (windowName: string, args: unknown[]) => void,
  globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow
): void {
  const followUpDelaysMs = [0, 200, 600];
  void tasks.poll(() => {
    if (!isBackgroundUiScene(locator, globalObject)) return null;
    const dispatcher = locator.dispatcher();
    const methodNames = dispatcher ? locator.listShowWindowMethodNames(dispatcher) : [];
    return dispatcher && methodNames.length ? { dispatcher, methodNames } : null;
  }, Infinity, 1000).then((found) => {
    if (!found) return;
    const scheduleShow = (windowName: string, args: unknown[]) => {
      for (const delay of followUpDelaysMs) {
        tasks.later(() => {
          try {
            onShow(windowName, args);
          } catch (error) {
            console.warn('[皮肤与背景] 窗口处理失败:', windowName, error);
          }
        }, delay);
      }
    };
    const hook = (original: (...hookArgs: unknown[]) => unknown) => function (
      this: unknown,
      windowName: unknown,
      ...rest: unknown[]
    ) {
      const result = original.call(this, windowName, ...rest);
      if (typeof windowName === 'string' && windowNames.includes(windowName) && isBackgroundUiScene(locator, globalObject)) {
        scheduleShow(windowName, rest);
      }
      return result;
    };
    for (const methodName of found.methodNames) {
      if (patcher.isWrapped(found.dispatcher, methodName)) continue;
      patcher.wrap(found.dispatcher, methodName, hook);
    }
  });
}

/** 大厅子控件已创建且未被隐藏。 */
export function isHallUiNodeReady(node: unknown): boolean {
  const record = asRecord(node);
  if (!record) return false;
  return record.visible !== false;
}

function hallSceneName(scene: UnknownRecord | null): string {
  return String(scene?.SceneName ?? scene?.sceneName ?? '');
}

const HALL_SCENE_NAME_PATTERN = /Hall|Lobby|MainCity/i;
const BLOCKED_LOBBY_PROBE_SCENE_PATTERN = /Login|Splash|Loading/i;

const HALL_BOTTOM_BAR_KEYS = [
  'bottomBar',
  'bottomMenu',
  'hallBottomBar',
  'mainBottom',
  'navBar',
  'tabBar',
  'menuBar'
] as const;

function isBlockedLobbyProbeScene(scene: UnknownRecord | null): boolean {
  return BLOCKED_LOBBY_PROBE_SCENE_PATTERN.test(hallSceneName(scene));
}

function isHallLikeSceneRecord(scene: UnknownRecord | null): boolean {
  if (!scene || isBlockedLobbyProbeScene(scene)) return false;
  const name = hallSceneName(scene);
  if (name === 'HallScene' || HALL_SCENE_NAME_PATTERN.test(name)) return true;
  if (scene.roomListView != null) return true;
  for (const key of HALL_BOTTOM_BAR_KEYS) {
    if (scene[key] != null) return true;
  }
  return false;
}

/** 活动大厅场景：SceneManager 未登记时从 SceneLayer 向下找 roomListView。 */
export function resolveHallScene(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow = globalThis as LayaRuntimeWindow
): UnknownRecord | null {
  const sceneManager = asRecord(locateSceneManager(globalObject));
  const managed = asRecord(locator.scene());
  if (managed && isHallLikeSceneRecord(managed)) return managed;

  const managerScene = asRecord(sceneManager?.CurrentScene);
  if (managerScene && isHallLikeSceneRecord(managerScene)) {
    return managerScene;
  }
  if (
    managerScene
    && !sceneManager?.IsGameScene
    && !isBlockedLobbyProbeScene(managerScene)
    && isHallUiNodeReady(managerScene)
  ) {
    return managerScene;
  }

  const stageChildren = asRecord(asRecord(globalObject.Laya?.stage)?._children);
  if (!Array.isArray(stageChildren)) return managed ?? managerScene;
  const sceneLayer = stageChildren
    .map((child) => asRecord(child))
    .find((child) => Number(child?.layerOrder) === 2);
  const roots = asRecord(sceneLayer)?._children;
  if (!Array.isArray(roots)) return managed ?? managerScene;
  const pending: Array<{ node: UnknownRecord; depth: number }> = roots
    .map((node) => ({ node: asRecord(node), depth: 0 }))
    .filter((entry): entry is { node: UnknownRecord; depth: number } => Boolean(entry.node));
  while (pending.length) {
    const entry = pending.shift();
    if (!entry) continue;
    const { node, depth } = entry;
    if (isHallLikeSceneRecord(node)) return node;
    if (depth >= 2 || !Array.isArray(node._children)) continue;
    for (const child of node._children) {
      const record = asRecord(child);
      if (record) pending.push({ node: record, depth: depth + 1 });
    }
  }
  return managed ?? managerScene;
}

function hasWallPaperMenuHostMethod(node: UnknownRecord): boolean {
  const proto = prototypeOf(node);
  for (const methodName of WALLPAPER_TOP_MENU_OPEN_METHODS) {
    if (typeof node[methodName] === 'function' || typeof proto?.[methodName] === 'function') {
      return true;
    }
  }
  return Boolean(asRecord(node.wallPaperUI));
}

function findWallPaperMenuHostInTree(root: UnknownRecord, maxDepth: number): UnknownRecord | null {
  const pending: Array<{ node: UnknownRecord; depth: number }> = [{ node: root, depth: 0 }];
  while (pending.length) {
    const entry = pending.shift();
    if (!entry) continue;
    const { node, depth } = entry;
    if (hasWallPaperMenuHostMethod(node)) return node;
    if (depth >= maxDepth || !Array.isArray(node._children)) continue;
    for (const child of node._children) {
      const record = asRecord(child);
      if (record) pending.push({ node: record, depth: depth + 1 });
    }
  }
  return null;
}

/** 顶栏对象：优先 scene.topMenu，否则在大厅子树里找带 onClickSkin 的宿主。 */
export function findHallWallPaperMenuHost(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow = globalThis as LayaRuntimeWindow,
  maxDepth = WALLPAPER_TOP_MENU_SEARCH_DEPTH
): UnknownRecord | null {
  const scene = resolveHallScene(locator, globalObject);
  if (!scene) return null;
  const direct = asRecord(scene.topMenu);
  if (direct) return direct;
  return findWallPaperMenuHostInTree(scene, maxDepth);
}

/** 经典场等子界面：房间列表已经能刷新。登录过渡页也有列表控件，不能算。 */
export function isLobbyUiReady(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow = globalThis as LayaRuntimeWindow
): boolean {
  const scene = resolveHallScene(locator, globalObject);
  if (!scene || !isHallLikeSceneRecord(scene)) return false;
  const roomList = asRecord(scene.roomListView);
  if (!isHallUiNodeReady(roomList)) return false;
  if (typeof roomList?.ReloadRoomList !== 'function') return false;
  const topMenu = asRecord(scene.topMenu);
  if (topMenu && !isHallUiNodeReady(topMenu)) return false;
  return true;
}

function isHallBottomChromeReady(scene: UnknownRecord): boolean {
  for (const key of HALL_BOTTOM_BAR_KEYS) {
    if (isHallUiNodeReady(scene[key])) return true;
  }
  return false;
}

function isHallRoomListStillLoading(scene: UnknownRecord): boolean {
  const roomList = asRecord(scene.roomListView);
  return Boolean(
    roomList
    && roomList.visible !== false
    && typeof roomList.ReloadRoomList !== 'function'
  );
}

/** 已进 HallScene、弹窗系统可用，且不在房间列表加载中间态。 */
function isHallSceneInteractive(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow
): boolean {
  const scene = resolveHallScene(locator, globalObject);
  if (!scene || !isHallLikeSceneRecord(scene)) return false;
  if (locator.gameScene()) return false;
  if (isHallRoomListStillLoading(scene)) return false;
  return Boolean(locator.dispatcher());
}

/** 大厅首页：模式入口和底栏已出来，房间列表可能还没展开。 */
function isHallHomeUiReady(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow = globalThis as LayaRuntimeWindow
): boolean {
  const scene = resolveHallScene(locator, globalObject);
  if (!scene || !isHallLikeSceneRecord(scene)) return false;
  if (isHallRoomListStillLoading(scene)) return false;
  if (isHallBottomChromeReady(scene)) return true;
  return isHallSceneInteractive(locator, globalObject);
}

/** 登录过渡：房间列表已显示但还不能 Reload，此时不挂面板以免打断登录链。 */
export function isHallLoginTransitionLoading(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow = globalThis as LayaRuntimeWindow
): boolean {
  const sceneManager = asRecord(locateSceneManager(globalObject));
  const scene = resolveHallScene(locator, globalObject) ?? asRecord(sceneManager?.CurrentScene);
  if (!scene) return false;
  return isHallRoomListStillLoading(scene);
}

/** 首页场景名对不上时：引擎已就绪超过阈值且不在登录/进局中间态，仍挂面板。 */
export function shouldForcePanelMountOnFirstPage(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow,
  engineReadySinceMs: number,
  nowMs: number = Date.now()
): boolean {
  if (nowMs - engineReadySinceMs < PANEL_MOUNT_ENGINE_READY_FALLBACK_MS) return false;
  if (locator.gameScene()) return false;
  const sceneManager = asRecord(locateSceneManager(globalObject));
  if (sceneManager?.IsGameScene) return false;
  const scene = resolveHallScene(locator, globalObject) ?? asRecord(sceneManager?.CurrentScene);
  if (scene) {
    if (isBlockedLobbyProbeScene(scene)) return false;
    if (isHallRoomListStillLoading(scene)) return false;
    if (isHallUiNodeReady(scene)) return true;
  }
  return Boolean(globalObject.Laya?.stage && globalObject.SystemContext !== undefined);
}

/** 新版首页：已离开登录页、不在局内、当前场景可见且有事件分发器。 */
export function isMainLobbyShellReady(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow = globalThis as LayaRuntimeWindow
): boolean {
  const manager = asRecord(locateSceneManager(globalObject));
  if (!manager || manager.IsGameScene) return false;
  const scene = resolveHallScene(locator, globalObject) ?? asRecord(manager.CurrentScene);
  if (!scene || isBlockedLobbyProbeScene(scene)) return false;
  if (!isHallUiNodeReady(scene)) return false;
  if (isHallRoomListStillLoading(scene)) return false;
  if (locator.gameScene()) return false;
  return Boolean(locator.dispatcher());
}

/** 控制台诊断：为何 GameHallUi 一直不满足。 */
export function describeHallStartupProbe(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow = globalThis as LayaRuntimeWindow
): Record<string, unknown> {
  const manager = asRecord(locateSceneManager(globalObject));
  const scene = resolveHallScene(locator, globalObject);
  return {
    sceneName: hallSceneName(scene),
    currentSceneName: hallSceneName(asRecord(manager?.CurrentScene)),
    isGameScene: Boolean(manager?.IsGameScene),
    hasDispatcher: Boolean(locator.dispatcher()),
    hasWindowManager: Boolean(locator.manager('WindowManager')),
    hallLikeScene: isHallLikeSceneRecord(scene),
    hallGameplayReady: isHallGameplayUiReady(locator, globalObject),
    mainLobbyShellReady: isMainLobbyShellReady(locator, globalObject),
    gameplayReady: isXiaochaoGameplayUiReady(locator, globalObject)
  };
}

/** 大厅任意可交互界面：首页或房间列表页。 */
export function isHallGameplayUiReady(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow = globalThis as LayaRuntimeWindow
): boolean {
  return isLobbyUiReady(locator, globalObject) || isHallHomeUiReady(locator, globalObject);
}

const ROGUE_MAP_SCENE_NAMES = ['RogueLikeBigMapScene', 'RogueSmallMapScene'] as const;

/**
 * 小抄功能总入口可否启动：真进大厅、已在牌局、或山河地图。
 * 登录与 HallScene 未就绪时不启动，避免包装 ShowWindow 等打断底栏初始化。
 */
export function isXiaochaoGameplayUiReady(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow = globalThis as LayaRuntimeWindow
): boolean {
  if (isHallGameplayUiReady(locator, globalObject)) return true;
  if (isMainLobbyShellReady(locator, globalObject)) return true;
  if (locator.gameScene()) return true;
  const sceneName = String(locator.scene()?.SceneName ?? '');
  return (ROGUE_MAP_SCENE_NAMES as readonly string[]).includes(sceneName);
}

/** 选背景面板的页签容器，兼容大小写。 */
export function resolveWallPaperTabGroup(menu: UnknownRecord): UnknownRecord | null {
  return asRecord(menu.tabGroup) ?? asRecord(menu.TabGroup);
}

/** 页签按钮列表：兼容 BtnList / btnList / 类数组。 */
export function wallPaperTabButtons(group: UnknownRecord | null): UnknownRecord[] {
  if (!group) return [];
  const raw = group.BtnList ?? group.btnList;
  if (Array.isArray(raw)) {
    return raw.map(asRecord).filter((button): button is UnknownRecord => button !== null);
  }
  if (raw && typeof raw === 'object' && 'length' in raw) {
    const length = Number((raw as { length: unknown }).length);
    if (!Number.isFinite(length) || length <= 0) return [];
    const buttons: UnknownRecord[] = [];
    for (let index = 0; index < length; index += 1) {
      const button = asRecord((raw as Record<number, unknown>)[index]);
      if (button) buttons.push(button);
    }
    return buttons;
  }
  return [];
}

/** 是否为游戏内选背景面板节点。 */
export function isWallPaperMenuRecord(menu: unknown): menu is UnknownRecord {
  const record = asRecord(menu);
  if (!record) return false;
  const group = resolveWallPaperTabGroup(record);
  const hasTabs = wallPaperTabButtons(group).length > 0
    || group?.SelectedValue !== undefined;
  const hasLists = Array.isArray(record.wallPaperItems) || Array.isArray(record.wallPaperSkinItems);
  if (hasLists && hasTabs) return true;
  if (typeof record.onShowSkinitems === 'function' && hasTabs) return true;
  if (typeof record.RefreList === 'function' && hasLists) return true;
  return false;
}

/** 从 Laya 舞台各层搜索选背景面板。 */
export function findWallPaperMenuOnStage(
  globalObject: LayaRuntimeWindow,
  maxDepth = WALLPAPER_MENU_STAGE_SEARCH_DEPTH
): UnknownRecord | null {
  const stage = asRecord(globalObject.Laya?.stage);
  if (!stage) return null;
  return findWallPaperMenuInTree(stage, maxDepth);
}

/** 在场景子树里找选背景面板，顶栏未挂 wallPaperUI 时兜底。 */
export function findWallPaperMenuInTree(
  root: unknown,
  maxDepth = WALLPAPER_MENU_TREE_SEARCH_DEPTH
): UnknownRecord | null {
  const pending: Array<{ node: UnknownRecord; depth: number }> = [];
  const push = (value: unknown, depth: number) => {
    const record = asRecord(value);
    if (record) pending.push({ node: record, depth });
  };
  push(root, 0);
  while (pending.length) {
    const entry = pending.shift();
    if (!entry) continue;
    const { node, depth } = entry;
    if (isWallPaperMenuRecord(node)) return node;
    const nested = asRecord(node.wallPaperUI);
    if (nested && isWallPaperMenuRecord(nested)) return nested;
    if (depth >= maxDepth || !Array.isArray(node._children)) continue;
    for (const child of node._children) push(child, depth + 1);
  }
  return null;
}

/** 大厅已就绪，或已经在对局场景里，脚本才允许动背景和相关钩子。 */
export function isBackgroundUiScene(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow = globalThis as LayaRuntimeWindow
): boolean {
  if (isHallGameplayUiReady(locator, globalObject)) return true;
  const scene = asRecord(locator.scene());
  if (!scene) return false;
  const name = String(scene.SceneName ?? scene.sceneName ?? '');
  if (!name || !locator.gameScene()) return false;
  return /Game|Table|Mode|Rogue|Arena|Battle/i.test(name);
}

/** 场景切换完成后回调。进大厅前不挂钩子，避免登录切场景时被脚本打断。 */
export function watchSceneSwitch(
  locator: LayaObjectLocator,
  patcher: MethodPatcher,
  tasks: TaskScope,
  onSwitch: () => void,
  globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow
): void {
  void tasks.poll(() => {
    if (!isBackgroundUiScene(locator, globalObject)) return null;
    const listeners = asRecord(locator.dispatcher()?._events)?.SWITCH_SCENE;
    for (const listener of Array.isArray(listeners) ? listeners : [listeners]) {
      const caller = asRecord(asRecord(listener)?.caller);
      if (caller && typeof caller.executeSwitchScene === 'function') return caller;
    }
    return null;
  }, Infinity, 1000).then((sceneManager) => {
    if (!sceneManager) return;
    patcher.wrap(sceneManager, 'executeSwitchScene', (original) => function (this: unknown, ...args: unknown[]) {
      const result = original.apply(this, args);
      tasks.later(() => {
        try {
          if (isBackgroundUiScene(locator, globalObject)) onSwitch();
        } catch (error) {
          console.warn('[皮肤与背景] 场景切换后处理失败:', error);
        }
      }, 0);
      return result;
    });
  });
}

/** 座位上主将、副将的武将与皮肤信息。 */
export interface SeatGeneralInfo {
  seat: UnknownRecord;
  isZhu: boolean;
  general: UnknownRecord;
  generalID: number;
  skinID: number;
  isDynamic: boolean;
  skinType: number;
}

/** 读取座位上的武将对象。 */
export function seatGeneral(seat: unknown, isZhu = true): SeatGeneralInfo | null {
  const record = asRecord(seat);
  if (!record) return null;
  const general = asRecord(isZhu ? record.General ?? record.general : record.General2 ?? record.general2);
  const generalID = Number(isZhu
    ? record.GeneralId ?? record.generalID ?? general?.GeneralId ?? general?.CardId
    : record.General2Id ?? record.general2ID ?? general?.GeneralId ?? general?.CardId);
  if (!(generalID > 0) || !general || general.IsShibing) return null;
  const skinID = isZhu ? record.SkinID ?? general.SkinID : record.Skin2ID ?? general.SkinID;
  const skinType = isZhu ? general.DySkinType ?? record.DySkinType : general.DySkinType ?? record.DySkinType2;
  return {
    seat: record,
    isZhu,
    general,
    generalID,
    skinID: Number(skinID) || 0,
    isDynamic: Boolean(general.IsDynamic),
    skinType: Number(skinType) || 1
  };
}

/** 座位是否持有该武将（含皮肤映射的武将 ID）。 */
export function seatHoldsGeneral(seat: UnknownRecord, info: SeatGeneralInfo, generalID: number): boolean {
  if (info.generalID === generalID) return true;
  try {
    return typeof seat.inSkinGeneralId === 'function'
      && Boolean((seat.inSkinGeneralId as (a: number, b: number) => unknown).call(seat, info.generalID, generalID));
  } catch {
    return false;
  }
}

/** 皮肤详情或换肤项是否支持动态。 */
export function supportsDynamicSkin(item: UnknownRecord): boolean {
  if (item.dynamicState) return true;
  const data = asRecord(item.skinData);
  try {
    if (typeof data?.canUpdateDynamic === 'function' && (data.canUpdateDynamic as () => unknown).call(data)) return true;
  } catch {
    // 忽略游戏数据异常。
  }
  return Boolean(data?.CanUpdate || data?.IsSkillEffect || data?.IsDynamic || Number(data?.ResType) > 0
    || data?.DynamicSkinBigSkeletonUrl || data?.DynamicSkinBigUrl);
}

/**
 * 只看当前画面决定能不能换背景。
 * 登录画面和开局等待不改游戏自己的底图，游戏会一直等那张图加载完。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { readSeatStateFromGameScene } from '../seat-display/seat-game-adapter.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import { PAPER_HOME_SCENE_NAMES, PAPER_MATCH_SCENE_CLASS_NAME } from '../../const/paper-all-paper-scene.ts';
import { hasVisibleWallPaperShirtEntry, isBackgroundUiScene } from './skin-runtime.ts';

/** 山河图等小地图：无座位 UI，不能按是否已开局来挡背景。 */
const MAP_SCENE_NAMES = ['RogueLikeBigMapScene', 'RogueSmallMapScene'];

/** 大厅、牌局、山河图之外，登录后的首页也是能放背景的画面。 */
export function isPaperUiScene(locator: LayaObjectLocator, globalObject: LayaRuntimeWindow): boolean {
  if (isBackgroundUiScene(locator, globalObject)) return true;
  return PAPER_HOME_SCENE_NAMES.includes(String(locator.scene()?.SceneName ?? ''));
}

/** 游戏要切去的页面是不是牌局。游戏按类名建页面，类表里查不到时当作不是牌局。 */
export function isMatchSceneName(locator: LayaObjectLocator, sceneName: string): boolean {
  const matchScene = locator.classPrototype(PAPER_MATCH_SCENE_CLASS_NAME);
  const target = locator.classPrototype(sceneName);
  if (!matchScene || !target) return false;
  return target === matchScene || Object.prototype.isPrototypeOf.call(matchScene, target);
}

/** 开关打开，并且当前已经在大厅或牌局里，才允许盖上自己的背景。 */
export function mayMutateSkinBackground(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow,
  enabled: () => boolean
): boolean {
  if (!enabled()) return false;
  if (!isPaperUiScene(locator, globalObject)) return false;
  const sceneName = String(locator.scene()?.SceneName ?? '');
  if (sceneName === 'HallScene' || MAP_SCENE_NAMES.includes(sceneName)) return true;
  if (PAPER_HOME_SCENE_NAMES.includes(sceneName)) return true;
  if (locator.gameScene()) return true;
  return Boolean(readSeatStateFromGameScene(locateGameScene(globalObject)).inGame);
}

/**
 * 挂「小抄背景」页签：旁观与对局一视同仁；
 * 顶栏 T 恤（skinBtn）已显示，或背景面板已打开，才挂钩子。
 */
export function mayAttachWallPaperMenuExtension(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow,
  enabled: () => boolean,
  wallpaperMenuOpen: () => boolean
): boolean {
  if (!enabled()) return false;
  if (wallpaperMenuOpen()) return true;
  return hasVisibleWallPaperShirtEntry(locator, globalObject);
}

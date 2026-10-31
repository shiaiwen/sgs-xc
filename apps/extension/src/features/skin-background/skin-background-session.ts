/**
 * 只看当前画面决定能不能换背景。
 * 登录画面和开局等待不改游戏自己的底图，游戏会一直等那张图加载完。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { readSeatStateFromGameScene } from '../seat-display/seat-game-adapter.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import { isBackgroundUiScene } from './skin-runtime.ts';

/** 山河图等小地图：无座位 UI，不能按是否已开局来挡背景。 */
const MAP_SCENE_NAMES = ['RogueLikeBigMapScene', 'RogueSmallMapScene'];

/** 开关打开，并且当前已经在大厅或牌局里，才允许盖上自己的背景。 */
export function mayMutateSkinBackground(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow,
  enabled: () => boolean
): boolean {
  if (!enabled()) return false;
  if (!isBackgroundUiScene(locator, globalObject)) return false;
  const sceneName = String(locator.scene()?.SceneName ?? '');
  if (sceneName === 'HallScene' || MAP_SCENE_NAMES.includes(sceneName)) return true;
  return Boolean(readSeatStateFromGameScene(locateGameScene(globalObject)).inGame);
}

/**
 * 挂「小抄背景」页签：面板已经打开时不看是否已开局；
 * 未打开时与换底图条件一致，避免登录页乱挂钩子。
 */
export function mayAttachWallPaperMenuExtension(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow,
  enabled: () => boolean,
  wallpaperMenuOpen: () => boolean
): boolean {
  if (!enabled()) return false;
  if (wallpaperMenuOpen()) return true;
  return mayMutateSkinBackground(locator, globalObject, enabled);
}

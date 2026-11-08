import { PAPER_ALL_PAPER_HIDE_SCENE_BACKGROUND_SCENES } from './paper-all-paper-scene.ts';
import { isPaperBackgroundResourceUsable } from './paper-background-resource.ts';

/**
 * 参考 cB：开全局背景时除 ModeScene 等外都显示；否则只在牌桌 gamescene 显示。
 */
export function shouldShowPaperBackgroundInScene(
  allPaper: boolean,
  sceneName: string,
  hasGameScene: boolean
): boolean {
  if (allPaper) {
    return !PAPER_ALL_PAPER_HIDE_SCENE_BACKGROUND_SCENES.includes(
      sceneName as (typeof PAPER_ALL_PAPER_HIDE_SCENE_BACKGROUND_SCENES)[number]
    );
  }
  return hasGameScene;
}

/** 参考 ch：开关打开、资源可用、且当前场景允许显示。 */
export function canApplyPaperBackground(
  skinPaperOn: boolean,
  resource: { url?: unknown; type?: unknown; skinExtension?: unknown } | null | undefined,
  allPaper: boolean,
  sceneName: string,
  hasGameScene: boolean
): boolean {
  if (!skinPaperOn) return false;
  if (!isPaperBackgroundResourceUsable(resource)) return false;
  if (!String(resource?.url ?? '').trim()) return false;
  return shouldShowPaperBackgroundInScene(allPaper, sceneName, hasGameScene);
}

/** 参考 setBackground 前置：界面就绪且资源过 z3 过滤。 */
export function canSetPaperBackgroundResource(
  gameplayReady: boolean,
  resource: { url?: unknown; type?: unknown; skinExtension?: unknown } | null | undefined,
  localSkinPaperActive = false
): boolean {
  if (!gameplayReady) return false;
  if (!String(resource?.url ?? '').trim()) return false;
  return isPaperBackgroundResourceUsable(resource, localSkinPaperActive);
}

/**
 * 现在刷新游戏页会不会打断玩家。
 * 只有停在首页或大厅房间列表、没在切页面、没在匹配或搜房间、没坐进房间、没跟别人组队时才算可以。
 * 读不到游戏状态时一律当不可以，宁可等下次启动再用新版。
 */
import { createLayaObjectLocator, type LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { UPDATE_RELOAD_SCENE_NAMES } from '../../const/update-reload.ts';
import { locateSceneManager } from '../seat-display/game-scene-locator.ts';

type UnknownRecord = Record<string, unknown>;

/** 返回检查函数；定位器只建一次，游戏单例找到后会缓存。 */
export function createUpdateReloadSafetyCheck(
  globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow
): () => boolean {
  const locator = createLayaObjectLocator(globalObject);
  return () => {
    try {
      const sceneManager = locateSceneManager(globalObject);
      if (!sceneManager) return false;
      if (sceneManager.IsGameScene || sceneManager.IsTableScene || sceneManager.currentCreateScene) return false;
      const sceneName = String(asRecord(sceneManager.CurrentScene)?.SceneName ?? '');
      if (!UPDATE_RELOAD_SCENE_NAMES.includes(sceneName)) return false;
      // 游戏单例表读不到时，没法确认是不是在匹配。
      if (!locator.managerFromList(() => true)) return false;
      return !locator.managerFromList(isBusyManager);
    } catch {
      return false;
    }
  };
}

/** 游戏单例上记着正在匹配、正在快速加入搜房间、坐在房间里，或者队伍里还有别人。 */
function isBusyManager(manager: UnknownRecord): boolean {
  if (manager.isMatching === true || manager.searchRoomStatus === true) return true;
  if ('isTableStart' in manager && Number(manager.tableId) > 0) return true;
  const members = asRecord(asRecord(manager.userTeamInfo)?.TeamUserInfos);
  return Number(members?.length) > 1;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

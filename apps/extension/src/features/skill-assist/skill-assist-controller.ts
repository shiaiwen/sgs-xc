/**
 * 技能辅助控制器：订阅游戏事件写入 SkillAssistStore，驱动面板条文案。
 */

import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import type { GameSceneSeatSource } from '../seat-display/seat-game-adapter.ts';
import { locateGameScene, type GameRuntimeWindow } from '../seat-display/game-scene-locator.ts';
import type { SkillAssistStore } from './skill-assist-store.ts';
import { everyInterval } from '../../runtime/shared-ticker.ts';
import { SKILL_ASSIST_REFRESH_MS } from '../../const/poll-intervals.ts';

export interface SkillAssistControllerOptions {
  pollIntervalMs?: number;
}

/**
 * 轮询座位技能可见性，并把协议事件交给 skill-assist-store。
 * 不读写 legacy DOM。
 */
export function installSkillAssistController(
  store: SkillAssistStore,
  gameEvents: GameEventBus,
  getScene: () => GameSceneSeatSource | null = () => locateGameScene(window),
  globalObject: GameRuntimeWindow = window,
  { pollIntervalMs = 500 }: SkillAssistControllerOptions = {}
): () => void {
  let stopped = false;
  const refresh = () => {
    if (stopped) return;
    store.refreshVisibility(getScene());
  };
  const unsubscribe = gameEvents.subscribe((event) => {
    store.handleGameEvent(event, getScene());
    if (
      event.type === 'game-started'
      || event.type === 'game-ended'
      || event.type === 'turn-started'
      || event.type === 'player-died'
      || event.type === 'seat-state-changed'
    ) {
      refresh();
    }
  });
  refresh();
  const stopRefreshing = everyInterval('技能辅助', SKILL_ASSIST_REFRESH_MS, refresh, {}, globalObject);
  return () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    stopRefreshing();
  };
}

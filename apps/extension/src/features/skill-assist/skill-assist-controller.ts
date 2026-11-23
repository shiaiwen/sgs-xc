/**
 * 技能辅助控制器：订阅游戏事件写入 SkillAssistStore，驱动面板条文案。
 */

import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import type { GameSceneSeatSource } from '../seat-display/seat-game-adapter.ts';
import { locateGameScene, type GameRuntimeWindow } from '../seat-display/game-scene-locator.ts';
import type { SkillAssistStore } from './skill-assist-store.ts';

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
  let refreshPending = false;
  const refresh = () => {
    if (stopped) return;
    store.refreshVisibility(getScene());
  };
  // 同一批事件只刷一次（防抖），不再 1s 轮询。
  const scheduleRefresh = () => {
    if (stopped || refreshPending) return;
    refreshPending = true;
    globalObject.setTimeout(() => {
      refreshPending = false;
      if (!stopped) refresh();
    }, 50);
  };
  const unsubscribe = gameEvents.subscribe((event) => {
    store.handleGameEvent(event, getScene());
    switch (event.type) {
      case 'game-started':
      case 'game-ended':
      case 'game-reconnected':
      case 'turn-started':
      case 'phase-changed':
      case 'cards-moved':
      case 'cards-used':
      case 'hp-updated':
      case 'player-died':
      case 'seat-state-changed':
      case 'spell-data-updated':
        scheduleRefresh();
        break;
    }
  });
  refresh();
  return () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
  };
}

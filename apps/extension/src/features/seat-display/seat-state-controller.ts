/**
 * 座位状态控制器：轮询/监听场景座位，更新 SeatStateStore。
 */

import type { SeatStateStore } from './seat-state-store.ts';
import { locateGameScene, type GameRuntimeWindow } from './game-scene-locator.ts';
import { readSeatStateFromGameScene } from './seat-game-adapter.ts';
import { everyInterval } from '../../runtime/shared-ticker.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';

export interface SeatStateControllerOptions {
  pollIntervalMs?: number;
  /** 场景重建期间保留上一快照，避免一次轮询空窗误判离局。 */
  sceneMissingGraceMs?: number;
  gameEvents?: GameEventBus;
}

/** 读取游戏座位；有事件源时事件驱动刷新 + 慢速兜底，无事件源时纯轮询。 */
export function installSeatStateController(
  store: SeatStateStore,
  globalObject: GameRuntimeWindow = window,
  { pollIntervalMs = 500, sceneMissingGraceMs = 8000, gameEvents }: SeatStateControllerOptions = {}
): () => void {
  let stopped = false;
  let sceneMissingSince = 0;
  let lastSceneSignature = '';
  let refreshPending = false;
  const refresh = () => {
    if (stopped) return;
    const scene = locateGameScene(globalObject);
    if (!scene) {
      if (store.getSnapshot().inGame) {
        if (!sceneMissingSince) sceneMissingSince = Date.now();
        if (Date.now() - sceneMissingSince < sceneMissingGraceMs) return;
      } else {
        // 本来就不在牌局，无需轮询座位。
        return;
      }
    } else {
      sceneMissingSince = 0;
    }
    const next = readSeatStateFromGameScene(scene);
    // 场景未变化时跳过 replace，减少快照发布与下游重绘。
    if (scene) {
      const signature = seatStateSignature(next);
      if (signature === lastSceneSignature) return;
      lastSceneSignature = signature;
    } else {
      lastSceneSignature = '';
    }
    store.replace(next);
  };
  refresh();

  /** 同一批事件只刷一次，避免连发时反复读场景；留一帧让游戏先更新座位 UI。 */
  const scheduleRefresh = () => {
    if (stopped || refreshPending) return;
    refreshPending = true;
    globalObject.setTimeout(() => {
      refreshPending = false;
      if (!stopped) refresh();
    }, 50);
  };

  let unsubEvents: (() => void) | null = null;
  let stopPolling: (() => void) | null = null;

  if (gameEvents) {
    const ensurePolling = () => {
      if (stopped || stopPolling) return;
      stopPolling = everyInterval('座位状态', pollIntervalMs * 4, refresh, {}, globalObject);
    };
    unsubEvents = gameEvents.subscribe((event) => {
      if (event.type === 'game-started' || event.type === 'game-reconnected') {
        ensurePolling();
        scheduleRefresh();
        return;
      }
      if (event.type === 'game-ended') {
        stopPolling?.();
        stopPolling = null;
        scheduleRefresh();
        return;
      }
      switch (event.type) {
        case 'cards-moved':
        case 'cards-used':
        case 'hand-cards-revealed':
        case 'player-died':
        case 'seat-state-changed':
        case 'card-list-ready':
          scheduleRefresh();
          break;
      }
    });
    // 慢速兜底：只在牌局内轮询，接住没有对应事件、只改了游戏画面的座位变化。
    ensurePolling();
  } else {
    stopPolling = everyInterval('座位状态', pollIntervalMs, refresh, {}, globalObject);
  }

  return () => {
    if (stopped) return;
    stopped = true;
    unsubEvents?.();
    stopPolling?.();
    store.clear();
  };
}

function seatStateSignature(state: Partial<import('./seat-state.ts').SeatStateSnapshot>): string {
  const seats = state.seats ?? [];
  const parts = seats.map((seat) => {
    const known = seat.knownCards.map((card) => card.cardId).join(',');
    const equip = (seat.equipmentCards ?? []).map((card) => card.cardId).join(',');
    return `${seat.seatId}:${seat.unknownCardCount ?? 0}:${known}:${equip}:${seat.isAlive ? 1 : 0}`;
  });
  return `${state.inGame ? 1 : 0}:${state.selfSeatId ?? ''}:${parts.join('|')}`;
}

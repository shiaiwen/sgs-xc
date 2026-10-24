/**
 * 座位状态控制器：轮询/监听场景座位，更新 SeatStateStore。
 */

import type { SeatStateStore } from './seat-state-store.ts';
import { locateGameScene, type GameRuntimeWindow } from './game-scene-locator.ts';
import { readSeatStateFromGameScene } from './seat-game-adapter.ts';

export interface SeatStateControllerOptions {
  pollIntervalMs?: number;
  /** 场景重建期间保留上一快照，避免一次轮询空窗误判离局。 */
  sceneMissingGraceMs?: number;
}

/** 周期读取游戏座位；返回值用于统一生命周期清理。 */
export function installSeatStateController(
  store: SeatStateStore,
  globalObject: GameRuntimeWindow = window,
  { pollIntervalMs = 500, sceneMissingGraceMs = 8000 }: SeatStateControllerOptions = {}
): () => void {
  let stopped = false;
  let sceneMissingSince = 0;
  let lastSceneSignature = '';
  const refresh = () => {
    if (stopped) return;
    const scene = locateGameScene(globalObject);
    if (!scene && store.getSnapshot().inGame) {
      if (!sceneMissingSince) sceneMissingSince = Date.now();
      if (Date.now() - sceneMissingSince < sceneMissingGraceMs) return;
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
  const intervalId = globalObject.setInterval(refresh, pollIntervalMs);

  return () => {
    if (stopped) return;
    stopped = true;
    globalObject.clearInterval(intervalId);
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

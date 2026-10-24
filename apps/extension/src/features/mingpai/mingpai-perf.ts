/**
 * 明牌相关热路径性能探针。
 *
 * 由 graph-engine、seat-state-store、native-mingpai-preview-controller 共同写入，
 * 暴露到 __XIAOCHAO_ENGINEERING__.mingpaiNativePerf 供实机排查。
 */

export interface MingpaiPerfSnapshot {
  enginePublishCalls: number;
  enginePublishMs: number;
  engineLastPublishMs: number;
  engineSlowPublishMs: number;
  seatPublishCalls: number;
  seatPublishMs: number;
  seatLastPublishMs: number;
  seatSlowPublishMs: number;
  nativeSyncCalls: number;
  nativeSyncMs: number;
  nativeLastSyncMs: number;
  nativeSlowSyncMs: number;
}

export const mingpaiPerf: MingpaiPerfSnapshot & { reset(): void } = {
  enginePublishCalls: 0,
  enginePublishMs: 0,
  engineLastPublishMs: 0,
  engineSlowPublishMs: 0,
  seatPublishCalls: 0,
  seatPublishMs: 0,
  seatLastPublishMs: 0,
  seatSlowPublishMs: 0,
  nativeSyncCalls: 0,
  nativeSyncMs: 0,
  nativeLastSyncMs: 0,
  nativeSlowSyncMs: 0,
  reset() {
    this.enginePublishCalls = 0;
    this.enginePublishMs = 0;
    this.engineLastPublishMs = 0;
    this.engineSlowPublishMs = 0;
    this.seatPublishCalls = 0;
    this.seatPublishMs = 0;
    this.seatLastPublishMs = 0;
    this.seatSlowPublishMs = 0;
    this.nativeSyncCalls = 0;
    this.nativeSyncMs = 0;
    this.nativeLastSyncMs = 0;
    this.nativeSlowSyncMs = 0;
  }
};

export function recordEnginePublish(elapsedMs: number): void {
  mingpaiPerf.enginePublishCalls += 1;
  mingpaiPerf.enginePublishMs += elapsedMs;
  mingpaiPerf.engineLastPublishMs = elapsedMs;
  if (elapsedMs > mingpaiPerf.engineSlowPublishMs) mingpaiPerf.engineSlowPublishMs = elapsedMs;
}

export function recordSeatPublish(elapsedMs: number): void {
  mingpaiPerf.seatPublishCalls += 1;
  mingpaiPerf.seatPublishMs += elapsedMs;
  mingpaiPerf.seatLastPublishMs = elapsedMs;
  if (elapsedMs > mingpaiPerf.seatSlowPublishMs) mingpaiPerf.seatSlowPublishMs = elapsedMs;
}

export function recordNativeSync(elapsedMs: number): void {
  mingpaiPerf.nativeSyncCalls += 1;
  mingpaiPerf.nativeSyncMs += elapsedMs;
  mingpaiPerf.nativeLastSyncMs = elapsedMs;
  if (elapsedMs > mingpaiPerf.nativeSlowSyncMs) mingpaiPerf.nativeSlowSyncMs = elapsedMs;
}

export function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

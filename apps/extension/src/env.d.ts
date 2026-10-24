/// <reference types="vite/client" />

declare const __XIAOCHAO_VERSION__: string;

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

interface MingpaiPerfSnapshot {
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
  reset(): void;
}

interface Window {
  electron?: {
    openExternal?: (url: string) => Promise<unknown>;
    invoke?: (channel: string, data?: unknown) => Promise<unknown>;
  };
  xiaochaoStorage?: {
    saveCredentials?: (scope: 'official' | '4399', credentials: unknown[]) => unknown;
  };
  __XIAOCHAO_ENGINEERING__?: Record<string, unknown> & {
    probeAutoTask?: () => unknown;
    mingpaiNativePerf?: MingpaiPerfSnapshot;
  };
  __XC_PROBE_AUTO_TASK__?: () => unknown;
  __xcProbeAutoTask?: () => unknown;
  __XIAOCHAO_GAME_SCENE__?: unknown;
  Laya?: {
    ClassUtils?: { getInstance?: (className: string) => unknown };
  };
}

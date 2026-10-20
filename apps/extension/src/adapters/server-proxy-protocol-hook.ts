/**
 * 仅在 ServerProxy / ActivityManager 的 event 上挂协议钩子，避免误伤场景/UI 分发器。
 */

import { createLayaObjectLocator } from './laya-object-locator.ts';

type UnknownRecord = Record<string, unknown>;

export interface ProtocolEventHookHandlers {
  mutate?: (className: string, payload: UnknownRecord) => void;
  shouldDrop?: (className: string, payload: UnknownRecord) => boolean;
  onBeforeForward?: (className: string, payload: UnknownRecord) => void;
}

export interface ProtocolEventHookDiagnostics {
  hookedTargets: string[];
  lastClassName: string;
  calls: number;
  dropped: number;
}

const hookedEventTargets = new WeakSet<UnknownRecord>();

export function installProtocolEventHooks(
  globalObject: Window = window,
  handlers: ProtocolEventHookHandlers = {}
): { restore(): void; diagnostics: ProtocolEventHookDiagnostics } {
  const locator = createLayaObjectLocator(globalObject as never);
  const diagnostics: ProtocolEventHookDiagnostics = {
    hookedTargets: [],
    lastClassName: '',
    calls: 0,
    dropped: 0
  };

  function scan(): void {
    hookEventIfNeeded(locator.manager('ServerProxy'), 'ServerProxy', handlers, diagnostics);
    hookEventIfNeeded(locator.manager('ActivityManager'), 'ActivityManager', handlers, diagnostics);
  }

  scan();
  const timer = setInterval(scan, 300);
  return {
    restore() {
      clearInterval(timer);
    },
    diagnostics
  };
}

function hookEventIfNeeded(
  target: UnknownRecord | null,
  label: string,
  handlers: ProtocolEventHookHandlers,
  diagnostics: ProtocolEventHookDiagnostics
): void {
  if (!target || hookedEventTargets.has(target)) return;
  if (typeof target.event !== 'function') return;
  if (!installPersistentEventHook(target, handlers, diagnostics)) return;
  hookedEventTargets.add(target);
  diagnostics.hookedTargets.push(label);
}

function installPersistentEventHook(
  target: UnknownRecord,
  handlers: ProtocolEventHookHandlers,
  diagnostics: ProtocolEventHookDiagnostics
): boolean {
  const initial = target.event;
  if (typeof initial !== 'function') return false;
  let underlying = initial as (this: unknown, type: unknown, data: unknown, ...rest: unknown[]) => unknown;
  const wrapper = function (this: unknown, type: unknown, data: unknown, ...rest: unknown[]) {
    return runProtocolHook(type, data, handlers, diagnostics, () => (
      underlying.apply(this, [type, data, ...rest])
    ));
  };
  try {
    Object.defineProperty(target, 'event', {
      configurable: true,
      enumerable: true,
      get() {
        return wrapper;
      },
      set(next: unknown) {
        if (typeof next === 'function' && next !== wrapper) {
          underlying = next as (this: unknown, type: unknown, data: unknown, ...rest: unknown[]) => unknown;
        }
      }
    });
    return true;
  } catch {
    return false;
  }
}

function runProtocolHook(
  type: unknown,
  data: unknown,
  handlers: ProtocolEventHookHandlers,
  diagnostics: ProtocolEventHookDiagnostics,
  forward: () => unknown
): unknown {
  diagnostics.calls += 1;
  const payload = data && typeof data === 'object' ? data as UnknownRecord : null;
  const className = resolveClassName(type, payload);
  if (className) diagnostics.lastClassName = className;
  if (payload && className) handlers.mutate?.(className, payload);
  if (payload && className && handlers.shouldDrop?.(className, payload)) {
    diagnostics.dropped += 1;
    return undefined;
  }
  if (payload && className) handlers.onBeforeForward?.(className, payload);
  return forward();
}

function resolveClassName(type: unknown, payload: UnknownRecord | null): string {
  if (typeof type === 'string' && type) return type;
  if (!payload) return '';
  if (typeof payload.ClassName === 'string') return payload.ClassName;
  if (typeof payload.className === 'string') return payload.className;
  return '';
}

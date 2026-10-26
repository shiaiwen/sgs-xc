/**
 * 仅在 ServerProxy / ActivityManager 的 event 上挂协议钩子，避免误伤场景/UI 分发器。
 *
 * 管线：mutate（可改写 payload）→ shouldDrop（整包丢弃）→ onBeforeForward → 原 event。
 * 用 getter/setter 持久化包装：游戏热更或重绑会重新赋值 event，setter 只替换下游，
 * 不丢掉我们的 wrapper，否则钩子会整局失效。
 */

import { createLayaObjectLocator } from './laya-object-locator.ts';

type UnknownRecord = Record<string, unknown>;

/** 钩子回调：改写 / 丢弃 / 转发前旁路（如投递到小抄事件总线）。 */
export interface ProtocolEventHookHandlers {
  mutate?: (className: string, payload: UnknownRecord) => void;
  shouldDrop?: (className: string, payload: UnknownRecord) => boolean;
  onBeforeForward?: (className: string, payload: UnknownRecord) => void;
}

/** 挂接诊断，挂到 __XIAOCHAO_* 上供开发监控读取。 */
export interface ProtocolEventHookDiagnostics {
  hookedTargets: string[];
  lastClassName: string;
  calls: number;
  dropped: number;
}

/** 已挂过钩的 event 宿主；WeakSet 避免拦住对象回收。 */
const hookedEventTargets = new WeakSet<UnknownRecord>();

/**
 * 安装协议钩子。管理器可能晚于脚本出现，故每 300ms 扫一次；
 * restore() 只清定时器，不拆已挂的 getter（页面卸载后无意义）。
 */
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

/** 目标已有 event 且尚未挂过时，装上持久包装。 */
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

/**
 * 把 target.event 换成「永远返回 wrapper」的属性。
 * 外部再赋值 event 时，setter 把新函数存进 underlying，wrapper 仍在。
 */
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

/** 单次 event 调用：诊断计数 → mutate → drop → forward。 */
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

/** 优先用 event 的 type 字符串，否则读 payload.ClassName / className。 */
function resolveClassName(type: unknown, payload: UnknownRecord | null): string {
  if (typeof type === 'string' && type) return type;
  if (!payload) return '';
  if (typeof payload.ClassName === 'string') return payload.ClassName;
  if (typeof payload.className === 'string') return payload.className;
  return '';
}

/**
 * 仅在 ServerProxy / ActivityManager 的 event 上挂协议钩子，避免误伤场景/UI 分发器。
 *
 * 管线：mutate（可改写 payload）→ shouldDrop（整包丢弃）→ onBeforeForward → 原 event。
 * 用 getter/setter 持久化包装：游戏热更或重绑会重新赋值 event，setter 只替换下游，
 * 不丢掉我们的 wrapper，否则钩子会整局失效。
 * 选将和消息源会先后订阅同一个宿主；包装只装一次，回调按订阅分别执行。
 */

import { createLayaObjectLocator } from './laya-object-locator.ts';
import { everyInterval } from '../runtime/shared-ticker.ts';
import { PROTOCOL_HOOK_SCAN_MS } from '../const/poll-intervals.ts';

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

/** 同一个游戏分发器可被多个功能使用；每个宿主只包装一次，回调分别订阅。 */
interface EventHookSubscription {
  handlers: ProtocolEventHookHandlers;
  diagnostics: ProtocolEventHookDiagnostics;
}

interface EventHookRecord {
  subscriptions: Set<EventHookSubscription>;
}

const hookedEventTargets = new WeakMap<UnknownRecord, EventHookRecord>();

/**
 * 安装协议钩子。管理器可能晚于脚本出现，故定时补扫；
 * restore() 清定时器和本次订阅；保留 getter，以便游戏后续重绑 event 时继续接管。
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
  const subscription: EventHookSubscription = { handlers, diagnostics };
  const subscribedTargets = new Set<UnknownRecord>();

  let stopScanning: (() => void) | null = null;

  /** 分发器晚于脚本出现时持续查找；每个订阅者都要登记到同一批宿主上。 */
  function scan(): void {
    hookEventIfNeeded(locator.manager('ServerProxy'), 'ServerProxy', subscription, subscribedTargets);
    hookEventIfNeeded(locator.manager('ActivityManager'), 'ActivityManager', subscription, subscribedTargets);
    // 两个目标都挂上钩后就不再空扫：持久 getter/setter 已能接住游戏后续重绑 event。
    if (diagnostics.hookedTargets.length >= 2 && stopScanning) stopScanning();
  }

  scan();
  stopScanning = everyInterval('协议钩子', PROTOCOL_HOOK_SCAN_MS, scan);
  return {
    restore() {
      stopScanning?.();
      for (const target of subscribedTargets) hookedEventTargets.get(target)?.subscriptions.delete(subscription);
      subscribedTargets.clear();
    },
    diagnostics
  };
}

/** 已包装的目标只追加本功能的回调，避免先安装的选将功能独占浏览器协议。 */
function hookEventIfNeeded(
  target: UnknownRecord | null,
  label: string,
  subscription: EventHookSubscription,
  subscribedTargets: Set<UnknownRecord>
): void {
  if (!target || subscribedTargets.has(target)) return;
  if (typeof target.event !== 'function') return;
  let hook = hookedEventTargets.get(target);
  if (!hook) {
    // 首个功能负责装包装；后来的功能只订阅，不能再次包装或覆盖旧回调。
    hook = { subscriptions: new Set() };
    if (!installPersistentEventHook(target, hook)) return;
    hookedEventTargets.set(target, hook);
  }
  hook.subscriptions.add(subscription);
  subscribedTargets.add(target);
  subscription.diagnostics.hookedTargets.push(label);
}

/**
 * 把 target.event 换成「永远返回 wrapper」的属性。
 * 外部再赋值 event 时，setter 把新函数存进 underlying，wrapper 仍在。
 */
function installPersistentEventHook(
  target: UnknownRecord,
  hook: EventHookRecord
): boolean {
  const initial = target.event;
  if (typeof initial !== 'function') return false;
  let underlying = initial as (this: unknown, type: unknown, data: unknown, ...rest: unknown[]) => unknown;
  const wrapper = function (this: unknown, type: unknown, data: unknown, ...rest: unknown[]) {
    return runProtocolHook(type, data, hook.subscriptions, () => (
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

/** 单次 event 调用：所有订阅者依次改写、判断丢弃、旁路接收，最后交还游戏。 */
function runProtocolHook(
  type: unknown,
  data: unknown,
  subscriptions: Set<EventHookSubscription>,
  forward: () => unknown
): unknown {
  const payload = data && typeof data === 'object' ? data as UnknownRecord : null;
  const className = resolveClassName(type, payload);
  // 诊断属于各个安装者；共用包装也要分别记录它们实际收到的调用。
  for (const { diagnostics } of subscriptions) {
    diagnostics.calls += 1;
    if (className) diagnostics.lastClassName = className;
  }
  // 每个钩子都单独兜底：小抄这段代码跑在游戏自己的协议分发调用栈里，
  // 任一抛错都不能让 forward() 丢、也不能冒进游戏，否则游戏会弹「未知错误」。
  // 先让所有功能改写同一份 payload，再判断是否整包丢弃。
  for (const { handlers } of subscriptions) {
    try {
      if (payload && className) handlers.mutate?.(className, payload);
    } catch (error) {
      console.warn('[小抄] 协议改写抛错', className, error);
    }
  }
  // 任一功能要求丢包就不再转发；其余功能的旁路回调也不应看到这包。
  for (const { handlers, diagnostics } of subscriptions) {
    try {
      if (payload && className && handlers.shouldDrop?.(className, payload)) {
        diagnostics.dropped += 1;
        return undefined;
      }
    } catch (error) {
      console.warn('[小抄] 协议丢弃判断抛错', className, error);
    }
  }
  // 只有保留的协议才分发给明牌等只读观察者，最后交回游戏原 event。
  for (const { handlers } of subscriptions) {
    try {
      if (payload && className) handlers.onBeforeForward?.(className, payload);
    } catch (error) {
      console.warn('[小抄] 协议转发前抛错', className, error);
    }
  }
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

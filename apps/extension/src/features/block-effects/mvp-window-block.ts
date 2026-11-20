/**
 * 屏蔽 MVP / 对局结果页：在 ShowWindow 与开窗事件后等待实例就绪，再多次 laterClose。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import {
  isMvpBlockWindowName,
  MVP_CLOSE_DELAY_MS,
  MVP_SHOW_WAIT_POLL_INTERVAL_MS,
  MVP_SHOW_WAIT_POLL_RETRIES,
  MVP_WINDOW_POLL_INTERVAL_MS,
  MVP_WINDOW_POLL_RETRIES
} from '../../const/block-mvp-window.ts';
import {
  OPEN_WINDOW_EVENT,
  OPENED_WINDOW_EVENT,
  RESHOW_WINDOW_EVENT
} from '../../const/game-window-events.ts';
import type { MethodPatcher } from '../../runtime/method-patch.ts';

type UnknownRecord = Record<string, unknown>;

const MVP_PROTOTYPE_POLL_MS = 500;
const MVP_PROTOTYPE_POLL_RETRIES = 120;

const MVP_WINDOW_DISMISS_EVENTS = [
  OPEN_WINDOW_EVENT,
  OPENED_WINDOW_EVENT,
  RESHOW_WINDOW_EVENT
] as const;

export interface MvpWindowBlockOptions {
  locator: LayaObjectLocator;
  patcher: MethodPatcher;
  globalObject: LayaRuntimeWindow;
  enabled: () => boolean;
  isDisposed: () => boolean;
  later: (callback: () => void, delay?: number) => void;
  poll: <T>(
    probe: () => T | null | undefined | false,
    retries?: number,
    interval?: number
  ) => Promise<T | null>;
  consumeManualRecordView: () => boolean;
  onOpenWindow: (windowName: string) => void;
}

export interface MvpWindowBlock {
  /** 类晚加载时重试挂上 updateBg；返回尚未就绪的类名数量。 */
  installPrototypePatches(): number;
  /** 打开结算窗后按间隔关闭。 */
  dismissSettlementWindow(name: string): void;
  /** 重新绑定开窗事件，避免换场景后分发器换掉。 */
  ensureOpenWindowListener(): void;
  /** 包装分发器 ShowWindow，结算窗不依赖 OPEN_WINDOW 是否派发。 */
  ensureShowWindowHook(): void;
  dispose(): void;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

function callMethod(target: unknown, name: string, ...args: unknown[]): unknown {
  const record = asRecord(target);
  const method = record?.[name];
  return typeof method === 'function' ? method.apply(record, args) : undefined;
}

function resolveOpenWindowName(event: unknown): string {
  if (typeof event === 'string') return event;
  const record = asRecord(event);
  if (typeof record?.WindowName === 'string') return record.WindowName;
  if (typeof record?.windowName === 'string') return record.windowName;
  return '';
}

export function createMvpWindowBlock(options: MvpWindowBlockOptions): MvpWindowBlock {
  const {
    locator,
    patcher,
    enabled,
    isDisposed,
    later,
    poll,
    consumeManualRecordView,
    onOpenWindow
  } = options;

  let updateBgHooked = false;
  let openWindowDispatcher: UnknownRecord | null = null;
  const openWindowHandlers = new Map<string, (event: unknown) => void>();
  const showWindowHookedTargets = new WeakSet<object>();
  const dismissedWindows = new WeakSet<object>();
  const pendingNames = new Set<string>();

  function tryHookUpdateBg(): boolean {
    if (updateBgHooked || !enabled()) return updateBgHooked;
    const prototype = locator.classPrototype('GameMvpWindow');
    if (!prototype || typeof prototype.updateBg !== 'function') return false;
    if (patcher.wrap(prototype, 'updateBg', (original) => function (this: UnknownRecord, ...args) {
      if (enabled() && typeof this.SetSkin === 'function') return this.SetSkin(args[0]);
      return original.apply(this, args);
    })) {
      updateBgHooked = true;
    }
    return updateBgHooked;
  }

  function attemptCloseWindow(name: string): void {
    if (!enabled() || isDisposed()) return;
    const win = locator.window(name) ?? locator.findWindows(name)[0];
    if (!win || win.destroyed || dismissedWindows.has(win)) return;
    if (name === 'RogueLike1v1ZhanJiWindow') {
      if (win.isShare) return;
      if (typeof win.onClickClose !== 'function') return;
      dismissedWindows.add(win);
      callMethod(win, 'onClickClose');
      return;
    }
    if (consumeManualRecordView()) return;
    if (typeof win.laterClose !== 'function') return;
    dismissedWindows.add(win);
    callMethod(win, 'laterClose');
  }

  function dismissSettlementWindow(name: string): void {
    if (!enabled() || isDisposed() || !isMvpBlockWindowName(name) || pendingNames.has(name)) return;
    pendingNames.add(name);

    void (async () => {
      try {
      const win = await poll(() => {
        const candidate = locator.window(name) ?? locator.findWindows(name)[0];
        if (!candidate || candidate.destroyed) return null;
        return candidate;
      }, MVP_WINDOW_POLL_RETRIES, MVP_WINDOW_POLL_INTERVAL_MS);
      if (!win || !enabled() || isDisposed()) return;
      if (win.isShowWait) {
        await poll(() => !win.isShowWait, MVP_SHOW_WAIT_POLL_RETRIES, MVP_SHOW_WAIT_POLL_INTERVAL_MS);
      }
      if (win.destroyed || !enabled() || isDisposed()) return;
      if (name === 'RogueLike1v1ZhanJiWindow') attemptCloseWindow(name);
      else later(() => attemptCloseWindow(name), MVP_CLOSE_DELAY_MS);
      } finally {
        pendingNames.delete(name);
      }
    })();
  }

  function scheduleDismissFromName(windowName: string): void {
    if (!windowName || !isMvpBlockWindowName(windowName) || !enabled()) return;
    onOpenWindow(windowName);
  }

  function unbindOpenWindowListeners(): void {
    if (!openWindowDispatcher) {
      openWindowHandlers.clear();
      return;
    }
    for (const [eventName, handler] of openWindowHandlers) {
      try {
        (openWindowDispatcher.off as (...args: unknown[]) => void)
          .call(openWindowDispatcher, eventName, null, handler);
      } catch {
        // 旧分发器已销毁时忽略。
      }
    }
    openWindowHandlers.clear();
    openWindowDispatcher = null;
  }

  function ensureOpenWindowListener(): void {
    const dispatcher = locator.dispatcher();
    if (!dispatcher || typeof dispatcher.on !== 'function') return;
    if (openWindowDispatcher === dispatcher && openWindowHandlers.size === MVP_WINDOW_DISMISS_EVENTS.length) {
      return;
    }

    unbindOpenWindowListeners();

    const handler = (event: unknown) => {
      const windowName = resolveOpenWindowName(event);
      scheduleDismissFromName(windowName);
    };

    try {
      for (const eventName of MVP_WINDOW_DISMISS_EVENTS) {
        (dispatcher.on as (...args: unknown[]) => void).call(dispatcher, eventName, null, handler);
        openWindowHandlers.set(eventName, handler);
      }
      openWindowDispatcher = dispatcher;
    } catch {
      unbindOpenWindowListeners();
    }
  }

  function hookShowWindowTarget(target: UnknownRecord | null): void {
    if (!target || showWindowHookedTargets.has(target)) return;
    let hooked = false;
    for (const methodName of locator.listShowWindowMethodNames(target)) {
      if (patcher.isWrapped(target, methodName)) continue;
      if (patcher.wrap(target, methodName, (original) => function (this: unknown, windowName: unknown, ...rest: unknown[]) {
        const result = original.apply(this, [windowName, ...rest]);
        if (typeof windowName === 'string') scheduleDismissFromName(windowName);
        return result;
      })) hooked = true;
    }
    if (hooked) showWindowHookedTargets.add(target);
  }

  function ensureShowWindowHook(): void {
    if (!enabled() || isDisposed()) return;
    const dispatcher = locator.dispatcher();
    hookShowWindowTarget(dispatcher);
    hookShowWindowTarget(asRecord(Object.getPrototypeOf(dispatcher)));
  }

  return {
    installPrototypePatches() {
      if (tryHookUpdateBg()) return 0;
      return 1;
    },
    dismissSettlementWindow,
    ensureOpenWindowListener,
    ensureShowWindowHook,
    dispose() {
      unbindOpenWindowListeners();
    }
  };
}

/** 开局后轮询挂上 GameMvpWindow.updateBg。 */
export function scheduleMvpPrototypePatchInstall(
  block: MvpWindowBlock,
  poll: MvpWindowBlockOptions['poll'],
  later: MvpWindowBlockOptions['later'],
  isDisposed: () => boolean
): void {
  void poll(() => block.installPrototypePatches() === 0, MVP_PROTOTYPE_POLL_RETRIES, MVP_PROTOTYPE_POLL_MS);
  later(() => {
    if (isDisposed()) return;
    block.installPrototypePatches();
  }, 0);
}

/**
 * 打开山河图换将窗口时弹出可换武将。
 */

import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { isXiaochaoGameplayUiReady } from '../skin-background/skin-runtime.ts';
import { showToast } from '../../ui/toast/show-toast.ts';
import {
  CHANGE_GENERAL_TOAST_MS,
  type ChangeGeneralNameSource,
  formatChangeGeneralToast,
  readGeneralChangeList,
  ROGUE_SELECT_GENERAL_WINDOW,
  scanObjectForGeneralChange
} from './shanhetu-change-general.ts';

type UnknownRecord = Record<string, unknown>;

const ROGUE_GENERAL_POOL_MESSAGE = /RogueLikeGeneralPool/i;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

function matchesRogueSelectWindow(windowName: unknown): boolean {
  const name = String(windowName ?? '');
  return name === ROGUE_SELECT_GENERAL_WINDOW || name.includes('RogueSelectGeneral');
}

export interface ShanhetuChangeGeneralHandle {
  dispose: () => void;
  filterMessage(payload: UnknownRecord, className: string): void;
}

export function installShanhetuChangeGeneral(options: {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  names: ChangeGeneralNameSource;
}): ShanhetuChangeGeneralHandle {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const patcher = createMethodPatcher();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  let showWindowHooked = false;
  let openWindowListenerInstalled = false;
  let lastToastKey = '';
  let retryTimer: ReturnType<typeof setInterval> | null = null;

  function later(callback: () => void, delay = 0): void {
    if (disposed) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, delay);
    timers.add(timer);
  }

  function announceList(generalChange: unknown[]): void {
    const key = generalChange.map(String).join(',');
    if (!key || key === lastToastKey) return;
    lastToastKey = key;
    const text = formatChangeGeneralToast(generalChange, (id) => options.names.getGeneralName(id));
    if (text) showToast(text, 'warning', CHANGE_GENERAL_TOAST_MS);
  }

  function announceFromPayload(payload: unknown, attemptsLeft = 20): void {
    const generalChange = readGeneralChangeList(payload);
    if (!generalChange?.length) return;
    const waiting = generalChange.some((id) => {
      const numeric = Number(id);
      return Number.isFinite(numeric) && options.names.getGeneralName(numeric) == null;
    });
    if (waiting && !options.names.generalNamesReady() && attemptsLeft > 0) {
      later(() => announceFromPayload(payload, attemptsLeft - 1), 500);
      return;
    }
    announceList(generalChange);
  }

  function scrapeOpenWindow(): void {
    const win = locator.window(ROGUE_SELECT_GENERAL_WINDOW)
      ?? locator.findWindows(ROGUE_SELECT_GENERAL_WINDOW)[0];
    const list = scanObjectForGeneralChange(win);
    if (list?.length) announceList(list);
  }

  function announceFromOpenWindow(windowName: unknown, ...rest: unknown[]): void {
    if (!matchesRogueSelectWindow(windowName)) return;
    for (const arg of rest) announceFromPayload(arg);
    later(scrapeOpenWindow, 0);
    later(scrapeOpenWindow, 150);
  }

  function wrapShowWindowTarget(target: UnknownRecord): boolean {
    let hooked = false;
    for (const methodName of locator.listShowWindowMethodNames(target)) {
      if (patcher.isWrapped(target, methodName)) {
        hooked = true;
        continue;
      }
      if (typeof target[methodName] !== 'function') continue;
      if (!patcher.wrap(target, methodName, (original) => function (this: unknown, windowName: unknown, ...rest: unknown[]) {
        const result = original.call(this, windowName, ...rest);
        announceFromOpenWindow(windowName, ...rest);
        return result;
      })) continue;
      hooked = true;
    }
    if (typeof target.ShowWindowAfterCloseOther === 'function' && !patcher.isWrapped(target, 'ShowWindowAfterCloseOther')) {
      if (patcher.wrap(target, 'ShowWindowAfterCloseOther', (original) => function (this: unknown, windowName: unknown, ...rest: unknown[]) {
        const result = original.apply(this, [windowName, ...rest]);
        announceFromOpenWindow(windowName, ...rest);
        return result;
      })) hooked = true;
    }
    return hooked;
  }

  function wrapWindowManagerHandler(wm: UnknownRecord): boolean {
    let hooked = false;
    for (const methodName of ['showWindowHandler', 'ShowWindowHandler'] as const) {
      if (typeof wm[methodName] !== 'function' || patcher.isWrapped(wm, methodName)) continue;
      if (!patcher.wrap(wm, methodName, (original) => function (this: unknown, ...args: unknown[]) {
        const result = original.apply(this, args);
        for (const arg of args) {
          const record = asRecord(arg);
          const windowName = record?.WindowName ?? record?.windowName;
          announceFromOpenWindow(windowName, arg);
        }
        return result;
      })) continue;
      hooked = true;
    }
    return hooked;
  }

  function installOpenWindowListener(): void {
    if (openWindowListenerInstalled) return;
    const dispatcher = locator.dispatcher();
    if (!dispatcher || typeof dispatcher.on !== 'function') return;
    const handler = (evt: unknown) => {
      const record = asRecord(evt);
      announceFromOpenWindow(record?.WindowName ?? record?.windowName, evt);
    };
    try {
      (dispatcher.on as (...args: unknown[]) => void).call(dispatcher, 'OPEN_WINDOW', null, handler);
      openWindowListenerInstalled = true;
    } catch {
      // 忽略。
    }
  }

  function tryPatchShowWindow(): boolean {
    if (disposed) return showWindowHooked;
    if (!isXiaochaoGameplayUiReady(locator)) return false;
    const dispatcher = locator.dispatcher();
    let hooked = false;
    if (dispatcher) {
      hooked = wrapShowWindowTarget(dispatcher) || hooked;
      const proto = asRecord(Object.getPrototypeOf(dispatcher));
      if (proto) hooked = wrapShowWindowTarget(proto) || hooked;
    }
    const wm = locator.manager('WindowManager');
    if (wm) hooked = wrapWindowManagerHandler(wm) || hooked;
    installOpenWindowListener();
    showWindowHooked = showWindowHooked || hooked;
    return showWindowHooked;
  }

  if (!tryPatchShowWindow()) {
    const attempt = (remaining: number) => {
      if (disposed || showWindowHooked) return;
      if (tryPatchShowWindow() || remaining <= 0) {
        if (!showWindowHooked) console.warn('[山河图] 换将透视未挂上 ShowWindow');
        return;
      }
      later(() => attempt(remaining - 1), 500);
    };
    later(() => attempt(40), 500);
  }

  retryTimer = globalObject.setInterval(() => {
    if (disposed || showWindowHooked) {
      if (retryTimer) globalObject.clearInterval(retryTimer);
      retryTimer = null;
      return;
    }
    tryPatchShowWindow();
  }, 2000);

  return {
    filterMessage(payload: UnknownRecord, className: string) {
      if (!ROGUE_GENERAL_POOL_MESSAGE.test(className)) return;
      announceFromPayload(payload);
      const body = asRecord(payload.ProtoObj)
        ?? asRecord(payload.protoObj)
        ?? asRecord(payload.data)
        ?? payload;
      announceFromPayload(body);
    },
    dispose() {
      disposed = true;
      if (retryTimer) globalObject.clearInterval(retryTimer);
      retryTimer = null;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      patcher.restoreAll();
    }
  };
}

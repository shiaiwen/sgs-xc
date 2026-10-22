/**
 * 打开山河图换将窗口时弹出可换武将。
 */

import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { showToast } from '../../ui/toast/show-toast.ts';
import {
  CHANGE_GENERAL_TOAST_MS,
  type ChangeGeneralNameSource,
  formatChangeGeneralToast,
  ROGUE_SELECT_GENERAL_WINDOW
} from './shanhetu-change-general.ts';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export function installShanhetuChangeGeneral(options: {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  names: ChangeGeneralNameSource;
}): () => void {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const patcher = createMethodPatcher();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  let patched = false;

  function later(callback: () => void, delay = 0): void {
    if (disposed) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, delay);
    timers.add(timer);
  }

  function announce(payload: unknown, attemptsLeft = 20): void {
    const record = asRecord(payload);
    const generalChange = record?.general_change;
    if (!Array.isArray(generalChange) || generalChange.length === 0) return;
    const waiting = generalChange.some((id) => {
      const numeric = Number(id);
      return Number.isFinite(numeric) && options.names.getGeneralName(numeric) == null;
    });
    if (waiting && !options.names.generalNamesReady() && attemptsLeft > 0) {
      later(() => announce(payload, attemptsLeft - 1), 500);
      return;
    }
    const text = formatChangeGeneralToast(generalChange, (id) => options.names.getGeneralName(id));
    if (text) showToast(text, 'warning', CHANGE_GENERAL_TOAST_MS);
  }

  function tryPatch(): boolean {
    if (patched || disposed) return patched;
    const dispatcher = locator.dispatcher();
    if (!dispatcher) return false;
    const showWindowName = locator.obfuscatedMethodName(
      dispatcher,
      'GameEventDispatcher',
      'ShowWindow'
    ) ?? 'ShowWindow';
    if (typeof dispatcher[showWindowName] !== 'function') return false;
    patched = patcher.wrap(dispatcher, showWindowName, (original) => function (this: unknown, windowName: unknown, ...rest: unknown[]) {
      const result = original.call(this, windowName, ...rest);
      if (windowName === ROGUE_SELECT_GENERAL_WINDOW) announce(rest[0]);
      return result;
    });
    return patched;
  }

  if (!tryPatch()) {
    const attempt = (remaining: number) => {
      if (disposed || patched) return;
      if (tryPatch() || remaining <= 0) {
        if (!patched) console.warn('[山河图] 换将透视未挂上窗口');
        return;
      }
      later(() => attempt(remaining - 1), 500);
    };
    later(() => attempt(40), 500);
  }

  return () => {
    disposed = true;
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
    patcher.restoreAll();
  };
}

/**
 * 武将技能详情停驻：关闭钮出现后进入 static 停驻，与客户端一致——
 * 移开鼠标不关，点 X 或悬停另一武将才关；系统确认窗打开时强制收起。
 */

import { createLayaObjectLocator, type LayaRuntimeWindow } from '../adapters/laya-object-locator.ts';
import { GAME_TIP_LAYER_Z } from './game-tip-layer.ts';
import { createMethodPatcher } from './method-patch.ts';

const TIP_NAME = 'GameGeneralToolTip';
const MANAGER_CLASS = 'XHt';
const TIP_CLASS = 'XWi';
const TIPS_OUT_EVENT = 'TIPS_OUT_EVENT';
const TIP_CLICK_BOUND = '__xcGeneralSkillTipClickBound';
const CLOSE_BTN_BOUND = '__xcGeneralSkillTipCloseBtnBound';
const BLOCKING_WINDOW_PATTERN = /退出游戏|LeaveTable|LeaveRoom|MessageBox|ConfirmBox|提示/i;

let nativeCheckButtonMode: NativeFn | null = null;
const wrappedCloseBtnHandlers = new WeakSet<NativeFn>();

type UnknownRecord = Record<string, unknown>;
type NativeFn = (...args: unknown[]) => unknown;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

function tipCloseButtonVisible(tip: UnknownRecord): boolean {
  if (tip.name !== TIP_NAME || tip.destroyed) return false;
  const closeBtn = asRecord(tip.closeBtn);
  if (!closeBtn || closeBtn.destroyed) return false;
  if (closeBtn.visible === false || closeBtn._visible === false) return false;
  return true;
}

function isVisibleGeneralTip(tip: UnknownRecord): boolean {
  if (tip.name !== TIP_NAME || tip.destroyed) return false;
  if (tip.visible === false || tip._visible === false) return false;
  const alpha = Number(tip.alpha);
  if (Number.isFinite(alpha) && alpha <= 0.01) return false;
  return true;
}

function collectVisibleGeneralTips(manager: UnknownRecord | null): UnknownRecord[] {
  if (!manager) return [];
  const found: UnknownRecord[] = [];
  const visit = (raw: unknown) => {
    const tip = asRecord(raw);
    if (!tip || !isVisibleGeneralTip(tip)) return;
    if (!found.includes(tip)) found.push(tip);
  };
  visit(manager.staticTip2);
  visit(manager.currentTip);
  if (Array.isArray(manager.viewArr)) manager.viewArr.forEach(visit);
  return found;
}

/** 停驻未关时又悬了新武将：新详情先展开、关闭钮尚未出现。 */
function hasReplacingHoverTip(manager: UnknownRecord | null): boolean {
  if (!manager) return false;
  const staticTip = asRecord(manager.staticTip2);
  if (!staticTip || !tipCloseButtonVisible(staticTip) || !isVisibleGeneralTip(staticTip)) return false;
  for (const tip of collectVisibleGeneralTips(manager)) {
    if (tip === staticTip) continue;
    if (!tipCloseButtonVisible(tip)) return true;
  }
  return false;
}

function collectStayTips(manager: UnknownRecord | null): UnknownRecord[] {
  if (!manager) return [];
  const found: UnknownRecord[] = [];
  const visit = (raw: unknown) => {
    const tip = asRecord(raw);
    if (!tip || !tipCloseButtonVisible(tip)) return;
    if (!found.includes(tip)) found.push(tip);
  };
  visit(manager.staticTip2);
  visit(manager.currentTip);
  if (Array.isArray(manager.viewArr)) manager.viewArr.forEach(visit);
  return found;
}

function readManager(globalObject: LayaRuntimeWindow): UnknownRecord | null {
  try {
    const ctor = globalObject.Laya?.ClassUtils?.getClass?.(MANAGER_CLASS) as { I?: () => unknown } | undefined;
    const inst = asRecord(typeof ctor?.I === 'function' ? ctor.I() : null);
    if (inst && typeof inst.TipsHide === 'function') return inst;
  } catch {
    // ClassUtils 可能未注册。
  }
  const events = asRecord(createLayaObjectLocator(globalObject).dispatcher()?._events);
  if (!events) return null;
  for (const bucket of Object.values(events)) {
    const list = Array.isArray(bucket) ? bucket : bucket ? [bucket] : [];
    for (const handler of list) {
      const caller = asRecord(asRecord(handler)?.caller);
      if (caller && typeof caller.TipsHide === 'function' && Array.isArray(caller.viewArr)) return caller;
    }
  }
  return null;
}

function readPrototype(
  globalObject: LayaRuntimeWindow,
  className: string,
  methodName: string,
  instance: UnknownRecord | null
): UnknownRecord | null {
  try {
    const ctor = globalObject.Laya?.ClassUtils?.getClass?.(className);
    const fromClass = asRecord(typeof ctor === 'function' ? (ctor as { prototype?: unknown }).prototype : null);
    if (fromClass && typeof fromClass[methodName] === 'function') return fromClass;
  } catch {
    // 忽略。
  }
  if (!instance) return null;
  let proto = asRecord(Object.getPrototypeOf(instance));
  const seen = new Set<object>();
  while (proto && !seen.has(proto)) {
    seen.add(proto);
    if (typeof proto[methodName] === 'function') return proto;
    proto = asRecord(Object.getPrototypeOf(proto));
  }
  return null;
}

function windowIdentity(win: UnknownRecord): string {
  const ctor = asRecord(win.constructor);
  return [String(win.name ?? ''), String(win.sceneName ?? ''), String(ctor?.name ?? '')].join('|');
}

function isVisibleWindow(win: UnknownRecord): boolean {
  if (win.destroyed) return false;
  if (win.visible === false || win._visible === false) return false;
  const alpha = Number(win.alpha);
  if (Number.isFinite(alpha) && alpha <= 0.01) return false;
  return true;
}

function isBlockingGameWindowOpen(globalObject: LayaRuntimeWindow): boolean {
  const context = asRecord(globalObject.GameContext);
  const windowManager = asRecord(context?.WindowManager)
    ?? createLayaObjectLocator(globalObject).manager('WindowManager');
  const dict = asRecord(windowManager?.WindowInstanceDict);
  if (!dict) return false;
  const stack: UnknownRecord[] = [dict];
  const seen = new Set<object>();
  while (stack.length > 0 && seen.size < 48) {
    const record = stack.pop()!;
    if (seen.has(record)) continue;
    seen.add(record);
    for (const value of Object.values(record)) {
      const win = asRecord(value);
      if (!win) continue;
      if (isVisibleWindow(win) && BLOCKING_WINDOW_PATTERN.test(windowIdentity(win))) return true;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) stack.push(win);
    }
  }
  return false;
}

function ensureTipAboveExtension(tip: UnknownRecord): void {
  if (Number(tip.zOrder) < GAME_TIP_LAYER_Z) tip.zOrder = GAME_TIP_LAYER_Z;
  const parent = asRecord(tip.parent);
  if (typeof parent?.sortChildren === 'function') {
    try {
      (parent.sortChildren as NativeFn).call(parent);
    } catch {
      // 忽略。
    }
  }
}

function stopCheckButtonLoop(globalObject: LayaRuntimeWindow, manager: UnknownRecord): void {
  const timer = asRecord(globalObject.Laya?.timer);
  if (typeof timer?.clear !== 'function') {
    manager.addLoop = false;
    return;
  }
  for (const fn of [manager.checkButtonMode, nativeCheckButtonMode]) {
    if (typeof fn !== 'function') continue;
    try {
      (timer.clear as NativeFn).call(timer, manager, fn);
    } catch {
      // 忽略。
    }
  }
  manager.addLoop = false;
}

function withUserClosing<T>(tip: UnknownRecord, userClosing: WeakSet<object>, run: () => T): T {
  userClosing.add(tip);
  try {
    return run();
  } finally {
    userClosing.delete(tip);
  }
}

function bindCloseBtnHandlers(tip: UnknownRecord, userClosing: WeakSet<object>): void {
  const closeBtn = asRecord(tip.closeBtn);
  if (!closeBtn || closeBtn[CLOSE_BTN_BOUND]) return;
  const events = asRecord(closeBtn._events);
  if (!events) return;
  for (const bucket of Object.values(events)) {
    const handlers = Array.isArray(bucket) ? bucket : bucket ? [bucket] : [];
    for (const raw of handlers) {
      const handler = asRecord(raw);
      const method = handler?.method;
      if (typeof method !== 'function') continue;
      const originalMethod = method as NativeFn;
      if (wrappedCloseBtnHandlers.has(originalMethod)) continue;
      const caller = handler.caller ?? closeBtn;
      const wrapped: NativeFn = (...args: unknown[]) => (
        withUserClosing(tip, userClosing, () => originalMethod.apply(caller, args))
      );
      wrappedCloseBtnHandlers.add(wrapped);
      handler.method = wrapped;
    }
  }
  closeBtn[CLOSE_BTN_BOUND] = true;
}

function bindTipCloseClick(tip: UnknownRecord, userClosing: WeakSet<object>): void {
  if (!tip[TIP_CLICK_BOUND]) {
    const original = tip.clickSprite;
    if (typeof original === 'function') {
      tip.clickSprite = (...args: unknown[]) => (
        withUserClosing(tip, userClosing, () => (original as NativeFn).apply(tip, args))
      );
    }
    tip[TIP_CLICK_BOUND] = true;
  }
  bindCloseBtnHandlers(tip, userClosing);
}

function forceDismissStayTips(manager: UnknownRecord | null): void {
  if (!manager || typeof manager.TipsHide !== 'function') return;
  try {
    (manager.TipsHide as NativeFn).call(manager);
  } catch {
    // 忽略。
  }
}

export function installGeneralSkillTipStayCoordinator(
  globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow
): () => void {
  const userClosing = new WeakSet<object>();
  const patcher = createMethodPatcher();
  let dispatcherReady = false;
  let tipProtoReady = false;
  let managerProtoReady = false;

  function shouldKeepStayOpen(manager: UnknownRecord | null): boolean {
    if (isBlockingGameWindowOpen(globalObject)) return false;
    if (hasReplacingHoverTip(manager)) return false;
    const stays = collectStayTips(manager);
    if (stays.length !== 1) return false;
    return !userClosing.has(stays[0]!);
  }

  function installDispatcherGuard(): void {
    if (dispatcherReady) return;
    const ged = createLayaObjectLocator(globalObject).dispatcher();
    const proto = ged ? Object.getPrototypeOf(ged) as UnknownRecord : null;
    if (!proto || typeof proto.event !== 'function') return;
    patcher.wrap(proto, 'event', (original) => function (this: unknown, ...args: unknown[]) {
      if (args[0] === TIPS_OUT_EVENT && shouldKeepStayOpen(readManager(globalObject))) {
        return true;
      }
      return original.apply(this, args);
    });
    dispatcherReady = true;
  }

  function installManagerProto(manager: UnknownRecord): void {
    if (managerProtoReady) return;
    const proto = readPrototype(globalObject, MANAGER_CLASS, 'TipsHide', manager);
    if (!proto) return;
    const block = (self: UnknownRecord) => shouldKeepStayOpen(self);

    patcher.wrap(proto, 'TipsHide', (original) => function (this: unknown, ...args: unknown[]) {
      const self = asRecord(this);
      if (self && block(self)) return undefined;
      return original.apply(this, args);
    });
    patcher.wrap(proto, 'HideTargetTips', (original) => function (this: unknown, ...args: unknown[]) {
      const self = asRecord(this);
      if (self && block(self)) return undefined;
      return original.apply(this, args);
    });
    patcher.wrap(proto, 'clearTips2', (original) => function (this: unknown, ...args: unknown[]) {
      const self = asRecord(this);
      if (self && block(self)) return undefined;
      return original.apply(this, args);
    });
    patcher.wrap(proto, 'onCheckStaticTip2', (original) => function (this: unknown, ...args: unknown[]) {
      const self = asRecord(this);
      if (args[0] === false && self && block(self)) return undefined;
      return original.apply(this, args);
    });
    patcher.wrap(proto, 'checkButtonMode', (original) => {
      nativeCheckButtonMode = original as NativeFn;
      return function (this: unknown, ...args: unknown[]) {
        const self = asRecord(this);
        if (self && block(self)) return undefined;
        return original.apply(this, args);
      };
    });
    managerProtoReady = true;
  }

  function installTipProto(manager: UnknownRecord): void {
    if (tipProtoReady) return;
    const proto = readPrototype(globalObject, TIP_CLASS, 'onTimeComplete', null);
    if (!proto || typeof proto.onTimeComplete !== 'function') return;
    patcher.wrap(proto, 'clickSprite', (original) => function (this: unknown, ...args: unknown[]) {
      const tip = asRecord(this);
      if (!tip) return original.apply(this, args);
      return withUserClosing(tip, userClosing, () => original.apply(this, args));
    });
    patcher.wrap(proto, 'onTimeComplete', (original) => function (this: unknown, ...args: unknown[]) {
      const result = original.apply(this, args);
      const tip = asRecord(this);
      const mgr = readManager(globalObject);
      if (!tip || !mgr || !tipCloseButtonVisible(tip)) return result;
      ensureTipAboveExtension(tip);
      bindTipCloseClick(tip, userClosing);
      stopCheckButtonLoop(globalObject, mgr);
      const tipName = String(tip.name ?? TIP_NAME);
      if (!asRecord(mgr.staticTip2) && typeof mgr.OnChangeTipToStay === 'function') {
        try {
          (mgr.OnChangeTipToStay as NativeFn).call(mgr, tipName);
        } catch {
          // 忽略。
        }
      }
      return result;
    });
    tipProtoReady = true;
  }

  function scanStayTips(manager: UnknownRecord): void {
    for (const tip of collectStayTips(manager)) {
      ensureTipAboveExtension(tip);
      bindTipCloseClick(tip, userClosing);
      stopCheckButtonLoop(globalObject, manager);
    }
  }

  function tick(): void {
    installDispatcherGuard();
    const manager = readManager(globalObject);
    if (!manager) return;
    if (isBlockingGameWindowOpen(globalObject)) {
      forceDismissStayTips(manager);
      return;
    }
    if (collectStayTips(manager).length > 1) {
      try {
        if (typeof manager.onCheckStaticTip2 === 'function') {
          (manager.onCheckStaticTip2 as NativeFn).call(manager, false);
        }
      } catch {
        // 忽略。
      }
      return;
    }
    installManagerProto(manager);
    installTipProto();
    scanStayTips(manager);
  }

  const timer = globalObject.setInterval(tick, 50);
  tick();

  return () => {
    globalObject.clearInterval(timer);
    patcher.restoreAll();
    dispatcherReady = false;
    tipProtoReady = false;
    managerProtoReady = false;
    nativeCheckButtonMode = null;
  };
}

export const generalSkillTipStayCoordinatorTesting = {
  hasReplacingHoverTip,
  collectVisibleGeneralTips,
  isVisibleGeneralTip,
};

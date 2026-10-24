/**
 * 关闭按钮已出现后：停掉旧的 checkButtonMode 循环，拦截自动 TipsHide / TIPS_OUT；
 * 手动点关闭时短暂标记 userClosing，不拦 TipsHide。
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

let nativeCheckButtonMode: NativeFn | null = null;
const wrappedCloseBtnHandlers = new WeakSet<NativeFn>();

type UnknownRecord = Record<string, unknown>;
type NativeFn = (...args: unknown[]) => unknown;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

export function generalTipCloseButtonVisible(tip: unknown): tip is UnknownRecord {
  const node = asRecord(tip);
  if (!node || node.name !== TIP_NAME || node.destroyed) return false;
  const closeBtn = asRecord(node.closeBtn);
  if (!closeBtn || closeBtn.destroyed) return false;
  if (closeBtn.visible === false || closeBtn._visible === false) return false;
  return true;
}

function collectAwaitingManualClose(manager: UnknownRecord | null): UnknownRecord[] {
  if (!manager) return [];
  const found: UnknownRecord[] = [];
  const visit = (raw: unknown) => {
    const tip = asRecord(raw);
    if (!tip || !generalTipCloseButtonVisible(tip)) return;
    if (!found.includes(tip)) found.push(tip);
  };
  visit(manager.staticTip2);
  visit(manager.currentTip);
  if (Array.isArray(manager.viewArr)) manager.viewArr.forEach(visit);
  return found;
}

function shouldBlockAutoHide(
  manager: UnknownRecord | null,
  userClosing: ReadonlySet<object>
): boolean {
  return collectAwaitingManualClose(manager).some((tip) => !userClosing.has(tip));
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

function scanOpenTips(globalObject: LayaRuntimeWindow, userClosing: WeakSet<object>): void {
  const manager = readManager(globalObject);
  if (!manager) return;
  for (const tip of collectAwaitingManualClose(manager)) {
    ensureTipAboveExtension(tip);
    bindTipCloseClick(tip, userClosing);
    stopCheckButtonLoop(globalObject, manager);
  }
}

export function installGeneralSkillTipAutoCloseGuard(
  globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow
): () => void {
  const userClosing = new WeakSet<object>();
  const patcher = createMethodPatcher();
  let managerProtoReady = false;
  let tipProtoReady = false;
  let dispatcherReady = false;

  function installManagerProto(manager: UnknownRecord): void {
    if (managerProtoReady) return;
    const proto = readPrototype(globalObject, MANAGER_CLASS, 'TipsHide', manager);
    if (!proto) return;
    const block = (self: UnknownRecord) => shouldBlockAutoHide(self, userClosing);

    patcher.wrap(proto, 'TipsHide', (original) => function (this: unknown, ...args: unknown[]) {
      const self = asRecord(this);
      if (self && block(self)) return undefined;
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
      if (args[0] === false && self) {
        const tips = collectAwaitingManualClose(self);
        if (tips.length) {
          tips.forEach((tip) => userClosing.add(tip));
          try {
            return original.apply(this, args);
          } finally {
            tips.forEach((tip) => userClosing.delete(tip));
          }
        }
      }
      return original.apply(this, args);
    });
    managerProtoReady = true;
  }

  function installTipProto(manager: UnknownRecord): void {
    if (tipProtoReady) return;
    const proto = readPrototype(globalObject, TIP_CLASS, 'onTimeComplete', manager);
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
      if (!tip || !mgr) return result;
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

  function installDispatcherGuard(): void {
    if (dispatcherReady) return;
    const ged = createLayaObjectLocator(globalObject).dispatcher();
    if (!ged || typeof ged.event !== 'function') return;
    const proto = Object.getPrototypeOf(ged) as UnknownRecord;
    patcher.wrap(proto, 'event', (original) => function (this: unknown, ...args: unknown[]) {
      if (args[0] === TIPS_OUT_EVENT && shouldBlockAutoHide(readManager(globalObject), userClosing)) {
        return true;
      }
      return original.apply(this, args);
    });
    dispatcherReady = true;
  }

  function tick(): void {
    installDispatcherGuard();
    const manager = readManager(globalObject);
    if (!manager) return;
    installManagerProto(manager);
    installTipProto(manager);
    scanOpenTips(globalObject, userClosing);
  }

  const timer = globalObject.setInterval(tick, 100);
  tick();

  return () => {
    globalObject.clearInterval(timer);
    patcher.restoreAll();
    managerProtoReady = false;
    tipProtoReady = false;
    dispatcherReady = false;
    nativeCheckButtonMode = null;
  };
}

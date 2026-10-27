/**
 * 武将技能详情停驻：关闭钮出现后进入 static 停驻，与客户端一致——
 * 移开鼠标不关，点 X 或悬停另一武将才关；系统确认窗打开时强制收起。
 */

import { createLayaObjectLocator, type LayaRuntimeWindow } from '../adapters/laya-object-locator.ts';
import {
  applySeatPopupSafeTipsDismiss,
  isGameSeatUiFlowActive,
  isSeatPlayerMenuProtected,
  isSystemConfirmWindowOpen,
  pushUserInfoGuardTrace,
  shouldBlockGlobalTipsDismissForSeatPopup,
} from './game-native-dialog.ts';
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

function isBlockingGameWindowOpen(globalObject: LayaRuntimeWindow): boolean {
  if (isGameSeatUiFlowActive(globalObject)) return false;
  return isSystemConfirmWindowOpen(globalObject);
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

function forceDismissStayTips(
  globalObject: LayaRuntimeWindow,
  manager: UnknownRecord | null,
): void {
  if (shouldBlockGlobalTipsDismissForSeatPopup(globalObject)) return;
  if (!manager || typeof manager.TipsHide !== 'function') return;
  try {
    (manager.TipsHide as NativeFn).call(manager);
  } catch {
    // 忽略。
  }
}

/** 出牌等特效会调 TipsHide / TIPS_OUT，误关点头像菜单与资料页。 */
function shouldSuppressGlobalTipsHide(globalObject: LayaRuntimeWindow): boolean {
  return shouldBlockGlobalTipsDismissForSeatPopup(globalObject);
}

export function installGeneralSkillTipStayCoordinator(
  globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow
): () => void {
  const bag = globalObject as Record<string, unknown>;
  const prevDispose = bag.__xcGeneralSkillTipStayDispose;
  if (typeof prevDispose === 'function') {
    try { (prevDispose as () => void)(); } catch { /* ignore */ }
  }
  const userClosing = new WeakSet<object>();
  const patcher = createMethodPatcher();
  let dispatcherReady = false;
  let tipProtoReady = false;
  let managerProtoReady = false;

  function shouldKeepStayOpen(manager: UnknownRecord | null): boolean {
    if (isGameSeatUiFlowActive(globalObject)) return false;
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
      if (args[0] === TIPS_OUT_EVENT) {
        if (shouldBlockGlobalTipsDismissForSeatPopup(globalObject)) {
          pushUserInfoGuardTrace('block-TIPS_OUT', { reason: 'seat-popup' });
          applySeatPopupSafeTipsDismiss(globalObject);
          return true;
        }
        if (isSeatPlayerMenuProtected(globalObject)) {
          // Menu open: swallow TIPS_OUT. Do not arm userinfo dismiss guard (false presence release).
          pushUserInfoGuardTrace('block-TIPS_OUT', { reason: 'menu-protected' });
          applySeatPopupSafeTipsDismiss(globalObject);
          return true;
        }
        if (shouldKeepStayOpen(readManager(globalObject))) return true;
      }
      return original.apply(this, args);
    });
    dispatcherReady = true;
  }

  function wrapTipsDismissMethod(target: UnknownRecord, name: string): void {
    patcher.wrap(target, name, (original) => function (this: unknown, ...args: unknown[]) {
      // 资料页打开/守卫期：拦住全局收起，只关技能 tip、保住资料页。
      if (shouldSuppressGlobalTipsHide(globalObject)) {
        pushUserInfoGuardTrace('block-' + name, { reason: 'suppress-global' });
        if (name === 'HideTargetTips') {
          const tipName = String(args[0] ?? '');
          if (tipName === TIP_NAME) return original.apply(this, args);
          applySeatPopupSafeTipsDismiss(globalObject);
          return undefined;
        }
        applySeatPopupSafeTipsDismiss(globalObject);
        return undefined;
      }
      // TipsHide does not close optMenu in vanilla. Allow it while only menu-protected
      // (grace/recent). tips-hold / userinfo still blocked above via shouldSuppress.
      if (isSeatPlayerMenuProtected(globalObject)) {
        pushUserInfoGuardTrace('pass-' + name, { reason: 'menu-protected-allow' });
        return original.apply(this, args);
      }
      // TipsHide / clearTips2 是整管理器级：技能停驻不能拦，否则包裹 CommonPropTip 等不符合原生。
      if (name === 'TipsHide' || name === 'clearTips2') {
        return original.apply(this, args);
      }
      if (name === 'HideTargetTips') {
        const tipName = String(args[0] ?? '');
        if (tipName !== TIP_NAME) return original.apply(this, args);
        const self = asRecord(this);
        if (self && shouldKeepStayOpen(self)) return undefined;
      }
      return original.apply(this, args);
    });
  }

  function installManagerProto(manager: UnknownRecord): void {
    const dismissNames = ['TipsHide', 'HideTargetTips', 'clearTips2'] as const;
    for (const name of dismissNames) {
      wrapTipsDismissMethod(manager, name);
    }
    if (managerProtoReady) return;
    const proto = readPrototype(globalObject, MANAGER_CLASS, 'TipsHide', manager);
    if (!proto) return;
    for (const name of dismissNames) {
      wrapTipsDismissMethod(proto, name);
    }
    patcher.wrap(proto, 'onCheckStaticTip2', (original) => function (this: unknown, ...args: unknown[]) {
      if (args[0] === false && shouldBlockGlobalTipsDismissForSeatPopup(globalObject)) {
        applySeatPopupSafeTipsDismiss(globalObject);
        return undefined;
      }
      if (isGameSeatUiFlowActive(globalObject)) return original.apply(this, args);
      // false = 玩家点关或空白确认，必须走原生关闭，不能走 stay 拦截
      if (args[0] === false) return original.apply(this, args);
      const self = asRecord(this);
      if (self && shouldKeepStayOpen(self)) return undefined;
      return original.apply(this, args);
    });
    patcher.wrap(proto, 'checkButtonMode', (original) => {
      nativeCheckButtonMode = original as NativeFn;
      return function (this: unknown, ...args: unknown[]) {
        // 资料页/座位菜单打开时不要跑原 checkButtonMode，否则会收起刚打开的个人信息窗。
        if (shouldBlockGlobalTipsDismissForSeatPopup(globalObject)) {
          applySeatPopupSafeTipsDismiss(globalObject);
          return undefined;
        }
        if (isGameSeatUiFlowActive(globalObject)) return original.apply(this, args);
        const self = asRecord(this);
        if (self && shouldKeepStayOpen(self)) return undefined;
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
      if (!tip || tip.name !== TIP_NAME) return original.apply(this, args);
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
    if (manager) {
      installManagerProto(manager);
      installTipProto();
    }
    if (isGameSeatUiFlowActive(globalObject)) return;
    if (!manager) return;
    if (isBlockingGameWindowOpen(globalObject)) {
      forceDismissStayTips(globalObject, manager);
      return;
    }
    if (collectStayTips(manager).length > 1) {
      return;
    }
    scanStayTips(manager);
  }

  const timer = globalObject.setInterval(tick, 500); // 降频：开 DevTools 时少打热路径
  tick();

  const dispose = () => {
    globalObject.clearInterval(timer);
    patcher.restoreAll();
    dispatcherReady = false;
    tipProtoReady = false;
    managerProtoReady = false;
    nativeCheckButtonMode = null;
    if (bag.__xcGeneralSkillTipStayDispose === dispose) {
      delete bag.__xcGeneralSkillTipStayDispose;
    }
  };
  bag.__xcGeneralSkillTipStayDispose = dispose;
  return dispose;
}

export const generalSkillTipStayCoordinatorTesting = {
  hasReplacingHoverTip,
  collectVisibleGeneralTips,
  isVisibleGeneralTip,
};

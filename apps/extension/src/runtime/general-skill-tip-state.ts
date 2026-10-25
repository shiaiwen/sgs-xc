/**
 * 只读探测 GameGeneralToolTip 是否处于「已出关闭钮、待手动关」状态。
 * 其它功能在此状态下应让路，不改游戏 tip 管理器。
 */

import { createLayaObjectLocator, type LayaRuntimeWindow } from '../adapters/laya-object-locator.ts';

const TIP_NAME = 'GameGeneralToolTip';
const MANAGER_CLASS = 'XHt';

type UnknownRecord = Record<string, unknown>;

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

function readTipManager(globalObject: LayaRuntimeWindow): UnknownRecord | null {
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

/** 任一武将技能详情已出关闭钮、等待玩家点关。 */
export function isGeneralSkillTipManualCloseVisible(
  globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow
): boolean {
  const manager = readTipManager(globalObject);
  if (!manager) return false;
  const visit = (raw: unknown) => {
    const tip = asRecord(raw);
    return Boolean(tip && tipCloseButtonVisible(tip));
  };
  if (visit(manager.staticTip2) || visit(manager.currentTip)) return true;
  if (Array.isArray(manager.viewArr)) {
    for (const item of manager.viewArr) {
      if (visit(item)) return true;
    }
  }
  return false;
}

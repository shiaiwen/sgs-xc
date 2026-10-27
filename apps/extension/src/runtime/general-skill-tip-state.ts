/**
 * 武将技能 tip 只读探测。
 *
 * 爱文原则：小抄不得拦截/改写游戏原生 tip 关闭（TipsHide / clearTips2 /
 * OnChangeTipToStay / viewArr / TIPS_OUT 等）。本模块只做只读探测；
 * yieldGeneralSkillTipsToSeatUi 为空操作，不再隐藏任何 tip。
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

/**
 * 历史：座位菜单打开时主动藏技能 tip。
 * 现按爱文原则改为空操作——不改 visible / 不调 TipsHide / 不碰 viewArr。
 */
export function yieldGeneralSkillTipsToSeatUi(
  _globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow
): void {
  // no-op
}

/** 任一武将技能详情已出关闭钮（只读；不改游戏状态）。 */
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
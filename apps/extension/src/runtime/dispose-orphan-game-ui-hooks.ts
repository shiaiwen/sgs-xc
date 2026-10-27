import { createLayaObjectLocator, type LayaRuntimeWindow } from '../adapters/laya-object-locator.ts';
import { restoreTaggedMethodPatch } from './method-patch.ts';

const MANAGER_CLASS = 'XHt';
const TIP_CLASS = 'XWi';
const MANAGER_METHODS = ['TipsHide', 'HideTargetTips', 'clearTips2', 'onCheckStaticTip2', 'checkButtonMode'] as const;
const TIP_METHODS = ['onTimeComplete', 'clickSprite'] as const;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

function readClassPrototype(globalObject: LayaRuntimeWindow, className: string): UnknownRecord | null {
  try {
    const ctor = globalObject.Laya?.ClassUtils?.getClass?.(className);
    return asRecord(typeof ctor === 'function' ? (ctor as { prototype?: unknown }).prototype : null);
  } catch {
    return null;
  }
}

/** 旧版 tip 停驻若未 dispose，会留下 TipsHide 等包装。 */
function restoreOrphanGeneralSkillTipPatches(globalObject: LayaRuntimeWindow): void {
  const managerProto = readClassPrototype(globalObject, MANAGER_CLASS);
  if (managerProto) {
    for (const name of MANAGER_METHODS) {
      restoreTaggedMethodPatch(managerProto, name);
    }
  }
  const tipProto = readClassPrototype(globalObject, TIP_CLASS);
  if (tipProto) {
    for (const name of TIP_METHODS) {
      restoreTaggedMethodPatch(tipProto, name);
    }
  }
  const ged = createLayaObjectLocator(globalObject).dispatcher();
  const gedProto = ged ? asRecord(Object.getPrototypeOf(ged)) : null;
  if (gedProto) {
    restoreTaggedMethodPatch(gedProto, 'event');
  }
}

/** 启动时卸掉已删除的 tip 停驻模块可能残留的 hook。 */
export function disposeOrphanTipStayHooks(globalObject: Window = window): void {
  const bag = globalObject as Record<string, unknown>;
  const dispose = bag.__xcGeneralSkillTipStayDispose;
  if (typeof dispose === 'function') {
    try {
      (dispose as () => void)();
    } catch {
      // 忽略
    }
    delete bag.__xcGeneralSkillTipStayDispose;
  }
  restoreOrphanGeneralSkillTipPatches(globalObject as LayaRuntimeWindow);
}

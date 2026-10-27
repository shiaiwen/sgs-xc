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

function readClassPrototype(globalObject: LayaRuntimeWindow, className: string): UnknownRecord | null {
  try {
    const ctor = globalObject.Laya?.ClassUtils?.getClass?.(className);
    return asRecord(typeof ctor === 'function' ? (ctor as { prototype?: unknown }).prototype : null);
  } catch {
    return null;
  }
}

/** 旧版 tip 停驻若未 dispose，会留下 TipsHide / checkButtonMode 等包装，破坏原生常驻。 */
function restoreOrphanGeneralSkillTipPatches(globalObject: LayaRuntimeWindow): void {
  const manager = readTipManager(globalObject);
  if (manager) {
    for (const name of MANAGER_METHODS) {
      restoreTaggedMethodPatch(manager, name);
    }
  }
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

/** 卸掉旧版技能 tip 停驻 hook，并还原可能被包装的 tip 管理器方法。 */
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

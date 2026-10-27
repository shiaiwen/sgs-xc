import { createLayaObjectLocator, type LayaRuntimeWindow } from '../adapters/laya-object-locator.ts';
import { restoreTaggedMethodPatchUntilClean } from './method-patch.ts';

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

function readTipsManagerInstance(globalObject: LayaRuntimeWindow): UnknownRecord | null {
  try {
    const ctor = globalObject.Laya?.ClassUtils?.getClass?.(MANAGER_CLASS) as { I?: () => unknown } | undefined;
    const inst = asRecord(typeof ctor?.I === 'function' ? ctor.I() : null);
    if (inst && typeof inst.TipsHide === 'function') return inst;
  } catch {
    // ClassUtils 可能未注册。
  }
  return null;
}

function forEachPrototype(target: UnknownRecord, visit: (proto: UnknownRecord) => void): void {
  const seen = new Set<UnknownRecord>();
  let cursor: UnknownRecord | null = target;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    visit(cursor);
    const next = Object.getPrototypeOf(cursor) as UnknownRecord | null;
    if (!next || next === Object.prototype) break;
    cursor = next;
  }
}

function restoreMethodsOnTarget(target: UnknownRecord, names: readonly string[]): number {
  let count = 0;
  for (const name of names) {
    count += restoreTaggedMethodPatchUntilClean(target, name);
  }
  return count;
}

/** 旧版 tip 停驻若未 dispose，会在原型或单例实例上留下 TipsHide 等包装。 */
function restoreOrphanGeneralSkillTipPatches(globalObject: LayaRuntimeWindow): number {
  let restored = 0;
  const managerProto = readClassPrototype(globalObject, MANAGER_CLASS);
  if (managerProto) {
    forEachPrototype(managerProto, (proto) => {
      restored += restoreMethodsOnTarget(proto, MANAGER_METHODS);
    });
  }
  const manager = readTipsManagerInstance(globalObject);
  if (manager) {
    forEachPrototype(manager, (layer) => {
      restored += restoreMethodsOnTarget(layer, MANAGER_METHODS);
    });
  }
  const tipProto = readClassPrototype(globalObject, TIP_CLASS);
  if (tipProto) {
    forEachPrototype(tipProto, (proto) => {
      restored += restoreMethodsOnTarget(proto, TIP_METHODS);
    });
  }
  const ged = createLayaObjectLocator(globalObject).dispatcher();
  if (ged) {
    forEachPrototype(ged, (layer) => {
      restored += restoreTaggedMethodPatchUntilClean(layer, 'event');
    });
  }
  return restored;
}

/** 卸掉已删除的 tip 停驻模块可能残留的 hook；进局后 Laya 就绪时再调一次才有效。 */
export function disposeOrphanTipStayHooks(globalObject: Window = window): number {
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
  const restored = restoreOrphanGeneralSkillTipPatches(globalObject as LayaRuntimeWindow);
  try {
    (globalObject as Record<string, unknown>).__xcDisposeOrphanTipStayHooks = () => {
      disposeOrphanTipStayHooks(globalObject);
    };
  } catch {
    // 忽略
  }
  return restored;
}

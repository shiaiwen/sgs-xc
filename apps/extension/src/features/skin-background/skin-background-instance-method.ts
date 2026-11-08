/**
 * 把只在 prototype 上的方法挂到实例上，便于 method-patcher 包装。
 */

import type { MethodPatcher, PatchableFunction } from '../../runtime/method-patch.ts';

export type UnknownRecord = Record<string, unknown>;
type InstanceMethod = (this: unknown, ...args: unknown[]) => unknown;

const hookedMethods = new WeakMap<object, Map<string, () => void>>();

export function ensureInstanceMethodFromPrototype(target: UnknownRecord, methodName: string): boolean {
  if (Object.hasOwn(target, methodName) && typeof target[methodName] === 'function') return true;
  const proto = Object.getPrototypeOf(target) as UnknownRecord | null;
  const inherited = proto?.[methodName];
  if (typeof inherited !== 'function') return false;
  target[methodName] = function (this: UnknownRecord, ...args: unknown[]) {
    return (inherited as InstanceMethod).apply(this === target ? target : this, args);
  };
  return true;
}

/**
 * 共用原型上仍是原来的函数。某个对象第一次调用时，包装只写到这个对象上。
 * 从原型上再取这个方法时，拿到的仍是原来的函数。
 */
export function hookMethodOntoEachInstance(
  patcher: MethodPatcher,
  prototype: object,
  methodName: string,
  createWrapper: (original: PatchableFunction) => PatchableFunction
): (() => void) | null {
  const existing = hookedMethods.get(prototype)?.get(methodName);
  if (existing) return null;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
  const original = descriptor?.value;
  if (!descriptor || typeof original !== 'function' || descriptor.get) return null;
  const install = {
    configurable: true,
    enumerable: descriptor.enumerable ?? false,
    get(this: unknown) {
      if (this === prototype || this === null || (typeof this !== 'object' && typeof this !== 'function')) {
        return original;
      }
      const host = this as UnknownRecord;
      const own = Object.getOwnPropertyDescriptor(host, methodName);
      if (own && 'value' in own) return own.value;
      try {
        Object.defineProperty(host, methodName, {
          value: original,
          writable: true,
          configurable: true,
          enumerable: false
        });
      } catch {
        return original;
      }
      patcher.wrap(host, methodName, createWrapper);
      const wrapped = Object.getOwnPropertyDescriptor(host, methodName);
      return wrapped && 'value' in wrapped ? wrapped.value : original;
    },
    set(this: unknown, value: unknown) {
      if (this === prototype || this === null || (typeof this !== 'object' && typeof this !== 'function')) return;
      Object.defineProperty(this, methodName, {
        value,
        writable: true,
        configurable: true,
        enumerable: false
      });
    }
  };
  try {
    Object.defineProperty(prototype, methodName, install);
  } catch {
    return null;
  }
  const unhook = () => {
    hookedMethods.get(prototype)?.delete(methodName);
    try {
      Object.defineProperty(prototype, methodName, descriptor);
    } catch {
      // 原型属性不可改时，实例上的包装仍由 patcher.restoreAll 摘掉。
    }
  };
  let names = hookedMethods.get(prototype);
  if (!names) {
    names = new Map();
    hookedMethods.set(prototype, names);
  }
  names.set(methodName, unhook);
  return unhook;
}

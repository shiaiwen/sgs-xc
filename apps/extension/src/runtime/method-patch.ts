/**
 * 可撤销方法包装器：闭包保存原方法，支持 wrap / wrapGetter / restoreAll。
 */

export type PatchableFunction = (this: any, ...args: any[]) => any;

export interface MethodPatcher {
  /**
   * 包装 target[name] 当前的方法。同一对象同名方法只包装一次；
   * 包装链中已有其他实现时在其外层继续包装。
   */
  wrap(
    target: unknown,
    name: string,
    createWrapper: (original: PatchableFunction) => PatchableFunction
  ): boolean;
  /** 包装自有属性上的 getter，用于游戏的静态开关属性。 */
  wrapGetter(
    target: unknown,
    name: string,
    createGetter: (originalGet: () => unknown) => () => unknown
  ): boolean;
  isWrapped(target: unknown, name: string): boolean;
  restoreAll(): void;
}

/**
 * 这三个装备动画只能挂在座位实例上。
 * 游戏会从构造函数 prototype 上的同一个方法再进入，写到那一层会再次进入包装函数。
 */
export const SEAT_EQUIP_INSTANCE_METHODS = [
  'playEquipSkillAnimate',
  'play3DEquipSkill',
  'ShowEquipTrailEffect'
] as const;

const SEAT_EQUIP_INSTANCE_METHOD_SET = new Set<string>(SEAT_EQUIP_INSTANCE_METHODS);

/** 装备动画必须把原来的播放做完。直接不播放时，进桌会一直等。 */
export function runSeatEquipMethod(
  _blocked: boolean,
  original: PatchableFunction,
  thisArg: unknown,
  args: readonly unknown[]
): unknown {
  return original.apply(thisArg, args);
}

/** 跨 patcher 识别包装函数；HMR 重装时剥到真实原方法再替换，禁止套娃 */
const XC_METHOD_WRAP = Symbol.for('sgsxc.methodPatch.wrap');
const XC_METHOD_ORIGINAL = Symbol.for('sgsxc.methodPatch.original');

function isConstructorPrototype(target: object): boolean {
  const ctor = (target as { constructor?: unknown }).constructor;
  return typeof ctor === 'function' && (ctor as { prototype?: unknown }).prototype === target;
}

type TaggedFn = PatchableFunction & { [k: symbol]: unknown };

/** 若已是本库包装，沿 ORIGINAL 链剥到游戏原方法，避免层层套娃导致栈溢出 */
function unwrapToOriginal(fn: unknown): PatchableFunction | null {
  if (typeof fn !== 'function') return null;
  let cursor: unknown = fn;
  const seen = new Set<unknown>();
  while (
    typeof cursor === 'function'
    && (cursor as TaggedFn)[XC_METHOD_WRAP]
    && typeof (cursor as TaggedFn)[XC_METHOD_ORIGINAL] === 'function'
  ) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    cursor = (cursor as TaggedFn)[XC_METHOD_ORIGINAL];
  }
  return typeof cursor === 'function' ? cursor as PatchableFunction : null;
}

/**
 * 创建可撤销的方法包装器。
 *
 * 原方法保存在闭包中，不写回游戏对象上的备用属性名，避免与其它补丁互相覆盖。
 * 恢复时若外层已被再次包装，则保留外层但让本层直接透传原方法。
 */
export function createMethodPatcher(): MethodPatcher {
  const wrappedNames = new WeakMap<object, Set<string>>();
  const restores: Array<() => void> = [];

  function claim(target: object, name: string): boolean {
    let names = wrappedNames.get(target);
    if (names?.has(name)) return false;
    if (!names) {
      names = new Set();
      wrappedNames.set(target, names);
    }
    names.add(name);
    return true;
  }

  function release(target: object, name: string): void {
    wrappedNames.get(target)?.delete(name);
  }

  function isObjectLike(value: unknown): value is Record<string, unknown> {
    return value !== null && (typeof value === 'object' || typeof value === 'function');
  }

  return {
    wrap(target, name, createWrapper) {
      if (!isObjectLike(target)) return false;
      if (SEAT_EQUIP_INSTANCE_METHOD_SET.has(name) && isConstructorPrototype(target)) return false;
      const current = target[name];
      if (typeof current !== 'function') return false;
      const original = unwrapToOriginal(current);
      if (!original) return false;
      if (!claim(target, name)) return false;
      const ownDescriptor = Object.getOwnPropertyDescriptor(target, name);
      const active = createWrapper(original);
      let restored = false;
      const wrapper: TaggedFn = function (this: unknown, ...args: unknown[]) {
        return restored ? original.apply(this, args) : active.apply(this, args);
      };
      wrapper[XC_METHOD_WRAP] = true;
      wrapper[XC_METHOD_ORIGINAL] = original;
      try {
        Object.defineProperty(target, name, {
          value: wrapper,
          configurable: true,
          writable: true,
          enumerable: ownDescriptor?.enumerable ?? false
        });
      } catch {
        release(target, name);
        return false;
      }
      restores.push(() => {
        restored = true;
        release(target, name);
        if (target[name] !== wrapper) return;
        try {
          if (ownDescriptor) Object.defineProperty(target, name, ownDescriptor);
          else delete target[name];
        } catch {
          // 不可配置时保留透传包装。
        }
      });
      return true;
    },

    wrapGetter(target, name, createGetter) {
      if (!isObjectLike(target)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      const originalGet = descriptor?.get;
      if (!descriptor || typeof originalGet !== 'function') return false;
      if (!claim(target, name)) return false;
      // 原型上的 getter 由实例触发，originalGet 需以当次访问的实例为 this。
      let receiver: unknown = target;
      const active = createGetter(() => originalGet.call(receiver));
      let restored = false;
      const getter = function (this: unknown) {
        if (restored) return originalGet.call(this);
        const previous = receiver;
        receiver = this;
        try {
          return active();
        } finally {
          receiver = previous;
        }
      };
      try {
        Object.defineProperty(target, name, { ...descriptor, get: getter, configurable: true });
      } catch {
        release(target, name);
        return false;
      }
      restores.push(() => {
        restored = true;
        release(target, name);
        if (Object.getOwnPropertyDescriptor(target, name)?.get !== getter) return;
        try {
          Object.defineProperty(target, name, descriptor);
        } catch {
          // 不可配置时保留透传 getter。
        }
      });
      return true;
    },

    isWrapped(target, name) {
      return isObjectLike(target) && Boolean(wrappedNames.get(target)?.has(name));
    },

    restoreAll() {
      restores.splice(0).reverse().forEach((restore) => restore());
    }
  };
}

/** 剥掉同一方法上多层本库包装，直到没有 wrap 标记为止。 */
export function restoreTaggedMethodPatchUntilClean(target: unknown, name: string): number {
  let restored = 0;
  while (restoreTaggedMethodPatch(target, name)) restored += 1;
  return restored;
}

/** 无 patcher 引用时，把仍带本库标记的包装还原为游戏原方法。 */
export function restoreTaggedMethodPatch(target: unknown, name: string): boolean {
  if (target === null || (typeof target !== 'object' && typeof target !== 'function')) return false;
  const record = target as Record<string, unknown>;
  const current = record[name];
  if (typeof current !== 'function' || !(current as TaggedFn)[XC_METHOD_WRAP]) return false;
  let original: PatchableFunction | null = null;
  let cursor: unknown = current;
  const seen = new Set<unknown>();
  while (
    typeof cursor === 'function'
    && (cursor as TaggedFn)[XC_METHOD_WRAP]
    && typeof (cursor as TaggedFn)[XC_METHOD_ORIGINAL] === 'function'
  ) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    cursor = (cursor as TaggedFn)[XC_METHOD_ORIGINAL];
  }
  if (typeof cursor === 'function') original = cursor as PatchableFunction;
  if (!original || original === current) return false;
  const ownDescriptor = Object.getOwnPropertyDescriptor(record, name);
  try {
    Object.defineProperty(record, name, {
      value: original,
      configurable: true,
      writable: true,
      enumerable: ownDescriptor?.enumerable ?? false
    });
    return true;
  } catch {
    try {
      record[name] = original;
      return true;
    } catch {
      return false;
    }
  }
}
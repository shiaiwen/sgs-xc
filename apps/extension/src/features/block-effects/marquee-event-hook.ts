/**
 * 游戏内 UI 事件分发器上的跑马灯事件拦截，用 accessor 接住后续 event 替换。
 */

type UnknownRecord = Record<string, unknown>;

const hookedDispatchers = new WeakSet<UnknownRecord>();

export function installPersistentMarqueeEventBlock(
  target: UnknownRecord | null,
  isBlocked: () => boolean,
  onBlocked: () => void
): boolean {
  if (!target || hookedDispatchers.has(target)) return false;
  if (typeof target.event !== 'function') return false;
  let underlying = target.event as (this: unknown, type: unknown, data: unknown, ...rest: unknown[]) => unknown;
  const wrapper = function (this: unknown, type: unknown, data: unknown, ...rest: unknown[]) {
    if (isBlocked() && typeof type === 'string' && /MARQUEE/i.test(type)) {
      onBlocked();
      return undefined;
    }
    return underlying.apply(this, [type, data, ...rest]);
  };
  try {
    Object.defineProperty(target, 'event', {
      configurable: true,
      enumerable: true,
      get() {
        return wrapper;
      },
      set(next: unknown) {
        if (typeof next === 'function' && next !== wrapper) {
          underlying = next as (this: unknown, type: unknown, data: unknown, ...rest: unknown[]) => unknown;
        }
      }
    });
    hookedDispatchers.add(target);
    return true;
  } catch {
    return false;
  }
}

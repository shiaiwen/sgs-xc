/**
 * 顶部跑马灯可见性接管：屏蔽时强制不绘制，解除时恢复游戏期望的 visible。
 */

type UnknownRecord = Record<string, unknown>;

interface VisibilityGuard {
  ui: UnknownRecord;
  blocked: boolean;
  /** 游戏在屏蔽期间期望的可见状态，恢复时写回。 */
  requestedVisible: boolean;
  ownVisibleDescriptor?: PropertyDescriptor;
  visibleDescriptor?: PropertyDescriptor;
  ownRenderDescriptor?: PropertyDescriptor;
  fallback: boolean;
}

const GUARD_KEY = '__xcSystemNoticeVisibilityGuard';

/**
 * 顶部跑马灯（狗托弹幕）屏蔽：接管 UI 的 visible 与 Laya 渲染用的 _visible，
 * 屏蔽期间游戏仍可正常设置可见性，但实际始终不绘制。
 */
export function createMarqueeVisibilityBlocker() {
  const guards = new Map<UnknownRecord, VisibilityGuard>();

  function hide(ui: UnknownRecord): boolean {
    if (ui.destroyed) return false;
    const existing = guards.get(ui);
    if (existing) {
      if (existing.fallback && ui.visible !== false) {
        existing.requestedVisible = true;
        ui.visible = false;
      }
      return true;
    }
    const ownVisible = Object.getOwnPropertyDescriptor(ui, 'visible');
    const visible = ownVisible ?? findDescriptor(Object.getPrototypeOf(ui), 'visible');
    const ownRender = Object.getOwnPropertyDescriptor(ui, '_visible');
    const readVisible = typeof visible?.get === 'function'
      ? () => visible.get!.call(ui)
      : () => (ownVisible && 'value' in ownVisible ? ownVisible.value : ui._visible);
    const writeVisible = typeof visible?.set === 'function'
      ? (value: boolean) => visible.set!.call(ui, value)
      : null;
    const guard: VisibilityGuard = {
      ui,
      blocked: true,
      requestedVisible: typeof ui._visible === 'boolean' ? ui._visible : readVisible() !== false,
      ownVisibleDescriptor: ownVisible,
      visibleDescriptor: visible ?? undefined,
      ownRenderDescriptor: ownRender,
      fallback: false
    };
    // 原生跑马灯的 visible setter 会同步自定义绘制子项，必须保留。
    if (writeVisible) {
      writeVisible(false);
      guard.fallback = true;
      guards.set(ui, guard);
      return true;
    }
    try {
      Object.defineProperty(ui, GUARD_KEY, { configurable: true, value: guard });
      if (!ownRender?.configurable || !('value' in ownRender)) throw new Error('_visible 渲染字段不可接管');
      const guardedGet = function (this: UnknownRecord) {
        const current = this[GUARD_KEY] as VisibilityGuard | undefined;
        return current?.blocked ? false : Boolean(current?.requestedVisible);
      };
      Object.defineProperty(ui, '_visible', {
        configurable: true,
        enumerable: ownRender.enumerable,
        get: guardedGet,
        set(this: UnknownRecord, value: unknown) {
          const current = this[GUARD_KEY] as VisibilityGuard | undefined;
          if (current) current.requestedVisible = Boolean(value);
        }
      });
      Object.defineProperty(ui, 'visible', {
        configurable: true,
        enumerable: ownVisible?.enumerable ?? false,
        get: guardedGet,
        set(this: UnknownRecord, value: unknown) {
          const current = this[GUARD_KEY] as VisibilityGuard | undefined;
          if (!current) return;
          current.requestedVisible = Boolean(value);
          if (!current.blocked && writeVisible) writeVisible(Boolean(value));
        }
      });
      guards.set(ui, guard);
      repaint(ui);
      return true;
    } catch {
      guard.fallback = true;
      try {
        if (ownRender) Object.defineProperty(ui, '_visible', ownRender);
        if (ownVisible) Object.defineProperty(ui, 'visible', ownVisible);
        else delete ui.visible;
        delete ui[GUARD_KEY];
        ui.visible = false;
        if ('_visible' in ui) ui._visible = false;
        guards.set(ui, guard);
        return true;
      } catch (error) {
        console.warn('[屏蔽设置] 隐藏顶部广播失败', error);
        return false;
      }
    }
  }

  function restore(guard: VisibilityGuard): boolean {
    guards.delete(guard.ui);
    const { ui } = guard;
    if (ui.destroyed) return false;
    const visible = guard.requestedVisible;
    try {
      if (guard.fallback) {
        ui.visible = visible;
        if ('_visible' in ui) ui._visible = visible;
        return true;
      }
      Object.defineProperty(ui, '_visible', { ...guard.ownRenderDescriptor, value: visible });
      const own = guard.ownVisibleDescriptor;
      if (own) Object.defineProperty(ui, 'visible', 'value' in own ? { ...own, value: visible } : own);
      else delete ui.visible;
      delete ui[GUARD_KEY];
      if (!own && typeof guard.visibleDescriptor?.set === 'function') guard.visibleDescriptor.set.call(ui, visible);
      repaint(ui);
      return true;
    } catch (error) {
      console.warn('[屏蔽设置] 恢复顶部广播失败', error);
      return false;
    }
  }

  function sync(uis: ReadonlySet<UnknownRecord>): void {
    for (const guard of guards.values()) {
      if (!uis.has(guard.ui) || guard.ui.destroyed) restore(guard);
    }
    for (const ui of uis) hide(ui);
  }

  function restoreAll(): void {
    for (const guard of guards.values()) restore(guard);
  }

  return { sync, restoreAll };
}

/** 只收集管理器持有的跑马灯，禁止从舞台或聊天容器推断。 */
const MARQUEE_EVENTS = ['CHAT_MARQUEE_ADD', 'CHAT_MARQUEE2023_ADD', 'CHAT_MARQUEE2023_ACT_ADD'];

/** 创建或刷新跑马灯后要立刻藏掉时，在这些方法外包一层。 */
export const MARQUEE_MANAGER_SYNC_METHODS = [
  'ShowMarquee',
  'ShowOldMarquee',
  'ShowNewMarquee',
  'intActDataMarquee',
  'ShowNextActMarquee'
] as const;

/** 从 PromptLayer 显示树里找跑马灯管理器时的节点上限。 */
const PROMPT_LAYER_MARQUEE_SCAN_MAX = 96;

export function isMarqueeManager(candidate?: UnknownRecord | null): candidate is UnknownRecord {
  return typeof candidate?.ShowMarquee === 'function' && typeof candidate.HideAllMarquee === 'function';
}

export function findMarqueeManagerFromEvents(dispatcher: UnknownRecord | null): UnknownRecord | null {
  const events = asRecord(dispatcher?._events);
  if (!events) return null;
  for (const name of MARQUEE_EVENTS) {
    const bucket = events?.[name];
    if (!bucket) continue;
    for (const listener of Array.isArray(bucket) ? bucket : [bucket]) {
      const caller = asRecord(asRecord(listener)?.caller);
      if (isMarqueeManager(caller)) return caller;
    }
  }
  for (const key of Object.keys(events)) {
    if (!/MARQUEE/i.test(key)) continue;
    const bucket = events[key];
    for (const listener of Array.isArray(bucket) ? bucket : [bucket]) {
      const caller = asRecord(asRecord(listener)?.caller);
      if (isMarqueeManager(caller)) return caller;
    }
  }
  return null;
}

/** 浏览器里分发器监听未必可读时，从 PromptLayer 子树按方法特征找回管理器。 */
export function findMarqueeManagerFromPromptLayer(promptLayer: UnknownRecord | null): UnknownRecord | null {
  if (!promptLayer || promptLayer.destroyed) return null;
  const stack: UnknownRecord[] = [promptLayer];
  const seen = new Set<unknown>();
  let scanned = 0;
  while (stack.length > 0 && scanned < PROMPT_LAYER_MARQUEE_SCAN_MAX) {
    const node = stack.pop();
    if (!node || node.destroyed || seen.has(node)) continue;
    seen.add(node);
    scanned += 1;
    if (isMarqueeManager(node)) return node;
    const childCount = Number(node.numChildren ?? 0);
    const getChildAt = node.getChildAt;
    if (Number.isInteger(childCount) && typeof getChildAt === 'function') {
      for (let index = 0; index < childCount; index += 1) {
        const child = asRecord(getChildAt.call(node, index));
        if (child) stack.push(child);
      }
    }
  }
  return null;
}

function pushMarqueeDisplayNode(found: Set<UnknownRecord>, node: UnknownRecord | null): void {
  if (!node || node.destroyed) return;
  try {
    if (typeof node.visible !== 'boolean' && typeof node._visible !== 'boolean') return;
  } catch {
    return;
  }
  found.add(node);
}

export function collectManagedMarqueeNodes(manager?: UnknownRecord | null): Set<UnknownRecord> {
  const found = new Set<UnknownRecord>();
  if (!isMarqueeManager(manager)) return found;
  for (const value of [
    manager.marqueeUI,
    ...marqueeListItems(manager.marqueeUIList),
    ...marqueeListItems(manager.marqueeUIActList)
  ]) {
    pushMarqueeDisplayNode(found, asRecord(value));
  }
  const childCount = Number(manager.numChildren ?? 0);
  const getChildAt = manager.getChildAt;
  if (Number.isInteger(childCount) && typeof getChildAt === 'function') {
    for (let index = 0; index < childCount; index += 1) {
      const child = asRecord(getChildAt.call(manager, index));
      if (!child || child.destroyed) continue;
      if (typeof child.ShowMsg === 'function') pushMarqueeDisplayNode(found, child);
    }
  }
  return found;
}

function marqueeListItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const list = asRecord(value);
  if (typeof list?.forEach === 'function') {
    const items: unknown[] = [];
    list.forEach((_key: unknown, node: unknown) => items.push(node));
    return items;
  }
  if (Array.isArray(list?.datum)) return list.datum;
  if (Array.isArray(list?._objDatum) && list._objDatum.length) return list._objDatum;
  const maps = asRecord(list?._maps);
  return maps ? Object.values(maps).flat() : [];
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

function findDescriptor(target: unknown, name: string): PropertyDescriptor | undefined {
  for (let current = target; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor) return descriptor;
  }
  return undefined;
}

function repaint(ui: UnknownRecord): void {
  if (typeof ui.repaint === 'function') (ui.repaint as () => void).call(ui);
}

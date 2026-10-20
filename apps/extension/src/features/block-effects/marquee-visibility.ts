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
  const guards = new Set<VisibilityGuard>();

  function hide(ui: UnknownRecord): boolean {
    if (ui.destroyed) return false;
    const existing = ui[GUARD_KEY] as VisibilityGuard | undefined;
    if (existing) {
      existing.blocked = true;
      repaint(ui);
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
      guards.add(guard);
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
        guards.add(guard);
        return true;
      } catch (error) {
        console.warn('[屏蔽设置] 隐藏顶部广播失败', error);
        return false;
      }
    }
  }

  function restore(guard: VisibilityGuard): boolean {
    guards.delete(guard);
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

  /** 按开关同步：关闭或 UI 已销毁时恢复，开启时隐藏当前全部跑马灯 UI。 */
  function sync(uis: UnknownRecord[], blocked: boolean): void {
    Array.from(guards).forEach((guard) => {
      if (guard.ui.destroyed || !blocked) restore(guard);
    });
    if (blocked) uis.forEach(hide);
  }

  function restoreAll(): void {
    Array.from(guards).forEach(restore);
  }

  return { sync, restoreAll };
}

/** 跑马灯管理器上的全部跑马灯 UI（单条、列表、活动列表及后续新增字段）。 */
export function collectMarqueeUis(manager: UnknownRecord): UnknownRecord[] {
  const candidates: unknown[] = [manager.marqueeUI];
  for (const key of Object.keys(manager)) {
    if (!/marquee/i.test(key)) continue;
    const value = manager[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && isDisplayNode(value)) {
      candidates.push(value);
      continue;
    }
    candidates.push(...listItems(value));
  }
  candidates.push(...listItems(manager.marqueeUIList), ...listItems(manager.marqueeUIActList));
  return uniqueLiveNodes(candidates);
}

const MARQUEE_NODE_NAME = /marquee|systemnotice|noticebar|broadcast|chatmsg|chatsys|scrolltip|runtext|跑马|广播|绘卷/i;

/**
 * 管理器未挂上或 UI 不在列表里时，从顶部 UI 层兜底查找跑马灯节点。
 */
export function collectMarqueeUisFromDisplayTree(
  layers: Array<UnknownRecord | null | undefined>
): UnknownRecord[] {
  const found: UnknownRecord[] = [];
  const seen = new Set<UnknownRecord>();
  for (const root of layers) {
    if (!root) continue;
    walkDisplayTree(root, (node) => {
      if (!isDisplayNode(node) || seen.has(node)) return;
      const ctor = String(asRecord(Object.getPrototypeOf(node)?.constructor)?.name ?? '');
      const name = String(node.name ?? '');
      if (!MARQUEE_NODE_NAME.test(name) && !MARQUEE_NODE_NAME.test(ctor)) return;
      seen.add(node);
      found.push(node);
    }, 600);
  }
  return found;
}

function uniqueLiveNodes(candidates: unknown[]): UnknownRecord[] {
  return Array.from(new Set(candidates.filter(
    (ui): ui is UnknownRecord => isDisplayNode(ui) && !ui.destroyed
  )));
}

function isDisplayNode(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

function walkDisplayTree(
  root: UnknownRecord,
  visit: (node: UnknownRecord) => void,
  budget: number
): void {
  const queue: UnknownRecord[] = [root];
  let scanned = 0;
  while (queue.length > 0 && scanned < budget) {
    const node = queue.shift()!;
    scanned += 1;
    visit(node);
    const count = Number(node.numChildren);
    if (!Number.isInteger(count) || typeof node.getChildAt !== 'function') continue;
    for (let index = 0; index < count; index += 1) {
      const child = asRecord(node.getChildAt(index));
      if (child) queue.push(child);
    }
  }
}

/** 兼容数组与 Laya 的几种列表/字典容器。 */
function listItems(list: unknown): unknown[] {
  try {
    if (Array.isArray(list)) return list.filter((item) => item != null);
    const record = list && typeof list === 'object' ? list as UnknownRecord : null;
    if (!record) return [];
    if (Array.isArray(record.datum)) return record.datum.filter((item) => item != null);
    if (Array.isArray(record._objDatum) && record._objDatum.length) return record._objDatum.filter((item) => item != null);
    if (record._maps && typeof record._maps === 'object') {
      return Object.values(record._maps as UnknownRecord).flat().filter((item) => item != null);
    }
  } catch {
    // 容器结构异常时视为空。
  }
  return [];
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

/** 扫描舞台与 DOM，找出当前狗托跑马灯容器节点。 */
export function collectDogTuoBannerNodes(
  globalObject: { Laya?: { stage?: unknown } }
): UnknownRecord[] {
  const found: UnknownRecord[] = [];
  const seen = new Set<UnknownRecord>();
  const stage = asRecord(globalObject.Laya?.stage);
  if (stage) {
    walkDisplayTree(stage, (node) => {
      if (!isDogTuoBannerNode(node)) return;
      const root = findBannerRoot(node);
      if (seen.has(root) || root.destroyed) return;
      seen.add(root);
      found.push(root);
    }, 12000);
  }
  return found;
}

export function isDogTuoBannerNode(node: UnknownRecord): boolean {
  const text = normalizeDogTuoText(collectSubtreeText(node, 14));
  if (text && matchesDogTuoBannerText(text)) return true;
  const rect = readGlobalRect(node);
  if (!rect || rect.y > 140 || rect.width < 160 || rect.height < 10 || rect.height > 180) return false;
  const partial = normalizeDogTuoText(collectSubtreeText(node, 6));
  return /恭喜|绘卷|祈愿台|琳琅/.test(partial) && /抽奖|获得|活动中/.test(partial);
}

/** 协议/UI 管理器未命中时，兜底隐藏 DOM 层狗托条。 */
export function sweepDogTuoTextOnStage(
  globalObject: { Laya?: { stage?: unknown } },
  blocked: boolean
): void {
  if (!blocked) return;
  sweepDogTuoTextInDom();
}

function collectSubtreeText(root: UnknownRecord, maxDepth: number): string {
  const parts: string[] = [];
  const queue: Array<{ node: UnknownRecord; depth: number }> = [{ node: root, depth: 0 }];
  let steps = 0;
  while (queue.length > 0 && steps < 200) {
    const item = queue.shift()!;
    steps += 1;
    const chunk = readDisplayText(item.node);
    if (chunk) parts.push(chunk);
    if (item.depth >= maxDepth) continue;
    const count = Number(item.node.numChildren);
    if (!Number.isInteger(count) || typeof item.node.getChildAt !== 'function') continue;
    for (let index = 0; index < count; index += 1) {
      const child = asRecord(item.node.getChildAt(index));
      if (child) queue.push({ node: child, depth: item.depth + 1 });
    }
  }
  return parts.join('');
}

/** 尽量找到整条横幅容器，避免只藏单个字节点。 */
function findBannerRoot(node: UnknownRecord): UnknownRecord {
  let current: UnknownRecord = node;
  let candidate: UnknownRecord = node;
  for (let depth = 0; depth < 10; depth += 1) {
    const parent = asRecord(current.parent);
    if (!parent) break;
    const merged = normalizeDogTuoText(collectSubtreeText(parent, 14));
    if (merged && matchesDogTuoBannerText(merged)) {
      candidate = parent;
      current = parent;
      continue;
    }
    break;
  }
  return candidate;
}

function sweepDogTuoTextInDom(): void {
  if (typeof document === 'undefined') return;
  const roots = [
    document.getElementById('layaCanvas')?.parentElement,
    document.getElementById('layaContainer'),
    document.body
  ].filter((item): item is HTMLElement => item instanceof HTMLElement);
  for (const root of roots) {
    const nodes = root.querySelectorAll('div, span, p, label');
    for (const element of nodes) {
      const text = normalizeDogTuoText(element.textContent ?? '');
      if (!text || !matchesDogTuoBannerText(text)) continue;
      element.style.setProperty('display', 'none', 'important');
      element.style.setProperty('visibility', 'hidden', 'important');
    }
  }
}

export function matchesDogTuoBannerText(text: string): boolean {
  if (/祈愿台|琳琅绘卷|翻翻乐|天载阁/.test(text)) return true;
  if (/恭喜/.test(text) && /获得|抽奖/.test(text)) return true;
  return /抽奖\d+次/.test(text);
}

function readGlobalRect(node: UnknownRecord): { x: number; y: number; width: number; height: number } | null {
  try {
    const point = typeof node.localToGlobal === 'function'
      ? node.localToGlobal({ x: 0, y: 0 }) as { x?: number; y?: number }
      : null;
    const width = Number(node.width ?? node._width);
    const height = Number(node.height ?? node._height);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    return { x: point.x, y: point.y, width, height };
  } catch {
    return null;
  }
}

function readDisplayText(node: UnknownRecord): string {
  const parts: string[] = [];
  for (const key of ['text', '_text', 'innerHTML', 'innerTEXT', '_innerHTML']) {
    const value = node[key];
    if (typeof value === 'string' && value.trim()) parts.push(value);
  }
  const textField = asRecord(node._tf) ?? asRecord(node.textField) ?? asRecord(node._style);
  if (typeof textField?.text === 'string' && textField.text.trim()) parts.push(textField.text);
  const element = asRecord(node._element) ?? asRecord(node._$element);
  if (typeof element?.innerHTML === 'string' && element.innerHTML.trim()) parts.push(element.innerHTML);
  if (typeof node._innerHTML === 'string' && node._innerHTML.trim()) parts.push(node._innerHTML);
  return parts.join(' ');
}

function normalizeDogTuoText(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/\u0000/g, '').trim();
}

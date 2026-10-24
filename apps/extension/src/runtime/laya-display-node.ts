/**
 * 显示列表里只能挂带 _getBit 的节点。
 * 富文本自己往往有 _getBit，但 innerHTML 会把没有 _getBit 的元素放进子列表。
 * 离开场景时父节点遍历子列表调用 _getBit，抛错后场景切不走。
 */

type LayaLike = {
  _getBit?: unknown;
  _childs?: unknown;
  _children?: unknown;
  innerHTML?: unknown;
  removeSelf?: () => void;
  addChild?: (child: unknown) => unknown;
};

export function isLayaDisplayNode(value: unknown): value is LayaLike {
  if (!value || typeof value !== 'object') return false;
  let current: object | null = value;
  while (current && current !== Object.prototype) {
    if (typeof (current as LayaLike)._getBit === 'function'
      && Object.prototype.hasOwnProperty.call(current, '_getBit')) return true;
    current = Object.getPrototypeOf(current);
  }
  return false;
}

export function canMountLayaChild(child: unknown): boolean {
  if (!isLayaDisplayNode(child)) return false;
  return !carriesHtmlElementList(child);
}

/**
 * 游戏自己往界面上挂节点时，平时都要放行。
 * 技能说明固定前会再挂富文本，这些对象不一定有 _setParent。
 * 只有正在离开场景时，才丢掉没有 _setParent 的对象，避免切换场景中断。
 */
export function shouldAcceptRuntimeAddChild(child: unknown, leavingScene: boolean): boolean {
  if (!leavingScene || child == null) return true;
  return typeof child === 'object'
    && typeof (child as { _setParent?: unknown })._setParent === 'function';
}

export function mountLayaChild(parent: unknown, child: unknown): boolean {
  const host = parent as LayaLike | null;
  if (!host || typeof host.addChild !== 'function' || !canMountLayaChild(child)) return false;
  host.addChild(child);
  return true;
}

export function detachLayaNode(node: unknown): void {
  if (!isLayaDisplayNode(node)) return;
  stripNonNodeChildren(node, new Set());
  if (typeof node.removeSelf === 'function') node.removeSelf();
}

/** 离开当前场景前清掉子列表里的普通对象，避免父节点遍历时中断切换。 */
export function scrubInvalidDisplayChildren(root: unknown): void {
  if (!root || typeof root !== 'object') return;
  stripNonNodeChildren(root, new Set());
}

function carriesHtmlElementList(child: object): boolean {
  return 'innerHTML' in child;
}

function childList(value: unknown): { length: number; [index: number]: unknown } | null {
  if (!value || typeof value !== 'object') return null;
  const length = Number((value as { length?: unknown }).length);
  if (!Number.isInteger(length) || length < 0 || length > 10000) return null;
  return value as { length: number; [index: number]: unknown };
}

function stripNonNodeChildren(node: object, seen: Set<object>): void {
  if (seen.has(node)) return;
  seen.add(node);
  const record = node as LayaLike;
  for (const key of ['_childs', '_children'] as const) {
    const list = childList(record[key]);
    if (!list) continue;
    const kept: unknown[] = [];
    for (let index = 0; index < list.length; index += 1) {
      const child = list[index];
      if (!isLayaDisplayNode(child)) continue;
      kept.push(child);
    }
    if (kept.length !== list.length) {
      for (let index = 0; index < kept.length; index += 1) list[index] = kept[index];
      list.length = kept.length;
    }
    for (const child of kept) stripNonNodeChildren(child, seen);
  }
}

/**
 * 局结束或结算界面出现时，暂停并拆掉局内 Laya HUD，避免挡住「点空白关闭」和加载层。
 * 结算界面常不切换场景，座位 inGame 仍为 true，不能只依赖 game-ended 协议。
 */

import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../adapters/laya-object-locator.ts';
import type { GameEventBus } from './game-event-bus.ts';
import { locateSceneManager } from '../features/seat-display/game-scene-locator.ts';
import { detachLayaNode, isLayaDisplayNode, scrubInvalidDisplayChildren } from './laya-display-node.ts';
import { createMethodPatcher } from './method-patch.ts';

const SETTLEMENT_WINDOW_NAMES = [
  'GameResultWindow',
  'GameMvpWindow',
  'GameZhanJiWindow',
  'GeneralOpenResultWindow',
  'SkinOpenResultWindowNew',
  'RogueLike1v1ZhanJiWindow'
] as const;

const SETTLEMENT_NAME_PATTERN = /Game(Mvp|Result|ZhanJi)|ZhanJiWindow|MvpWindow/i;

let suspended = false;
let sceneLeaving = false;
const teardowns = new Set<() => void>();

export function isNativeHudSuspended(): boolean {
  return suspended;
}

/** 各原生 HUD 在局后/结算期调用自己的 destroy。 */
export function registerNativeHudPostGameTeardown(fn: () => void): () => void {
  teardowns.add(fn);
  return () => {
    teardowns.delete(fn);
  };
}

function runTeardowns(globalObject: LayaRuntimeWindow): void {
  for (const fn of teardowns) {
    try {
      fn();
    } catch (error) {
      console.warn('[xiaochao] 局后原生层清理失败', error);
    }
  }
  softenXiaochaoInteractiveOverlays(globalObject);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function isVisibleWindow(win: Record<string, unknown> | null | undefined): boolean {
  if (!win || win.destroyed) return false;
  if (win.visible === false) return false;
  if (typeof win._visible === 'boolean' && !win._visible) return false;
  const alpha = Number(win.alpha);
  if (Number.isFinite(alpha) && alpha <= 0.01) return false;
  return true;
}

function windowIdentity(win: Record<string, unknown>): string {
  const ctor = asRecord(win.constructor);
  return [
    String(win.name ?? ''),
    String(win.sceneName ?? ''),
    String(ctor?.name ?? '')
  ].join('|');
}

function isSettlementWindow(win: Record<string, unknown>): boolean {
  const id = windowIdentity(win);
  if (SETTLEMENT_WINDOW_NAMES.some((name) => id.includes(name))) return true;
  return SETTLEMENT_NAME_PATTERN.test(id);
}

function readWindowManagerInstances(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow
): Record<string, unknown>[] {
  const context = asRecord(globalObject.GameContext);
  const windowManager = asRecord(context?.WindowManager) ?? locator.manager('WindowManager');
  const dict = asRecord(windowManager?.WindowInstanceDict);
  if (!dict) return [];
  const results: Record<string, unknown>[] = [];
  const push = (value: unknown) => {
    const win = asRecord(value);
    if (win) results.push(win);
  };
  if (typeof dict.forEach === 'function') {
    try {
      dict.forEach((value: unknown) => push(value));
      return results;
    } catch {
      // 部分运行时的 forEach 签名不同，回退到按键遍历。
    }
  }
  for (const value of Object.values(dict)) push(value);
  return results;
}

export function detectSettlementBlockingInput(
  globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow
): boolean {
  const locator = createLayaObjectLocator(globalObject);
  for (const name of SETTLEMENT_WINDOW_NAMES) {
    const win = locator.window(name) ?? locator.findWindows(name)[0];
    if (isVisibleWindow(win)) return true;
  }
  for (const win of readWindowManagerInstances(locator, globalObject)) {
    if (!isVisibleWindow(win)) continue;
    if (isSettlementWindow(win)) return true;
  }
  for (const name of SETTLEMENT_WINDOW_NAMES) {
    for (const win of locator.findWindows(name)) {
      if (isVisibleWindow(win)) return true;
    }
  }
  return false;
}

/** 局后拆掉仍挡点击的小抄 Laya 节点。 */
export function softenXiaochaoInteractiveOverlays(
  globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow
): void {
  const stage = asRecord(globalObject.Laya?.stage);
  if (!stage) return;
  const stack: unknown[] = [stage];
  const removeNames = new Set([
    'xcVueMingpaiCardList',
    'xcNativeDeckRecordList',
    'xcPeiXiuRouteSliderHitRoot'
  ]);
  while (stack.length) {
    const raw = stack.pop();
    const node = asRecord(raw);
    if (!node || node.destroyed) continue;
    const name = String(node.name ?? '');
    if (removeNames.has(name)) {
      try {
        detachLayaNode(node);
        if (isLayaDisplayNode(node)) node.destroy?.(false);
      } catch {
        // 场景切换时节点可能已失效。
      }
      continue;
    }
    if (/^xc/i.test(name) || name.startsWith('xiaochao')) {
      if (node.mouseEnabled === true && node.mouseThrough === false) {
        node.mouseThrough = true;
        node.mouseEnabled = false;
      }
    }
    const children = node._children;
    if (Array.isArray(children)) {
      for (const child of children) stack.push(child);
    } else {
      const count = Number(node.numChildren);
      if (Number.isInteger(count) && count > 0 && typeof node.getChildAt === 'function') {
        for (let index = 0; index < count; index += 1) {
          try {
            stack.push((node.getChildAt as (i: number) => unknown)(index));
          } catch {
            break;
          }
        }
      }
    }
  }
}

function enterPostGameSuspended(globalObject: LayaRuntimeWindow): void {
  suspended = true;
  runTeardowns(globalObject);
}

function noteSuspended(next: boolean, globalObject: LayaRuntimeWindow): void {
  if (!next) return;
  if (!suspended) enterPostGameSuspended(globalObject);
  else softenXiaochaoInteractiveOverlays(globalObject);
}

function readSceneManager(globalObject: LayaRuntimeWindow): Record<string, unknown> | null {
  const direct = asRecord((globalObject as LayaRuntimeWindow & { SceneManager?: unknown }).SceneManager);
  if (typeof direct?.executeSwitchScene === 'function') return direct;
  return locateSceneManager(globalObject);
}

const REMOVAL_METHODS = ['_onRemoved', '_processInactive', '_processInActive', '_inActiveHierarchy'] as const;

function readDisplayPrototypes(globalObject: LayaRuntimeWindow): Record<string, unknown>[] {
  const laya = asRecord(globalObject.Laya);
  if (!laya) return [];
  const found: Record<string, unknown>[] = [];
  const seen = new Set<object>();
  for (const value of Object.values(laya)) {
    if (typeof value !== 'function') continue;
    const prototype = asRecord(value.prototype);
    if (!prototype || seen.has(prototype)) continue;
    const hasRemoval = typeof prototype._setParent === 'function'
      || REMOVAL_METHODS.some((name) => typeof prototype[name] === 'function');
    if (!hasRemoval) continue;
    seen.add(prototype);
    found.push(prototype);
  }
  return found;
}

function continueAfterBrokenNode(run: () => unknown): unknown {
  try {
    return run();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (error instanceof TypeError && (message.includes('_getBit') || message.includes('_setParent'))) return undefined;
    throw error;
  }
}

function isDisplayMethod(value: unknown, name: string): boolean {
  return value != null && typeof value === 'object'
    && typeof (value as Record<string, unknown>)[name] === 'function';
}

function wrapDisplayPrototype(
  prototype: Record<string, unknown>,
  patcher: ReturnType<typeof createMethodPatcher>
): void {
  const scrubThen = (original: (...args: unknown[]) => unknown) => function (this: unknown, ...args: unknown[]) {
    if (!sceneLeaving) return original.apply(this, args);
    scrubInvalidDisplayChildren(this);
    return continueAfterBrokenNode(() => original.apply(this, args));
  };
  if (typeof prototype._setParent === 'function') {
    patcher.wrap(prototype, '_setParent', (original) => function (this: unknown, parent: unknown, ...rest: unknown[]) {
      if (parent != null || !sceneLeaving) return original.call(this, parent, ...rest);
      scrubInvalidDisplayChildren(this);
      return continueAfterBrokenNode(() => original.call(this, parent, ...rest));
    });
  }
  for (const name of REMOVAL_METHODS) {
    if (typeof prototype[name] !== 'function') continue;
    const owner = Object.prototype.hasOwnProperty.call(prototype, name) ? prototype : null;
    if (!owner) continue;
    patcher.wrap(prototype, name, scrubThen);
  }
  if (typeof prototype.addChild === 'function' && Object.prototype.hasOwnProperty.call(prototype, 'addChild')) {
    patcher.wrap(prototype, 'addChild', (original) => function (this: unknown, child: unknown, ...rest: unknown[]) {
      if (child != null && !isDisplayMethod(child, '_setParent')) return this;
      if (sceneLeaving) scrubInvalidDisplayChildren(child);
      return original.call(this, child, ...rest);
    });
  }
}

function pushDisplayChildren(node: object, stack: unknown[]): void {
  const record = node as { _childs?: unknown; _children?: unknown; numChildren?: unknown; getChildAt?: (index: number) => unknown };
  for (const key of ['_childs', '_children'] as const) {
    const list = record[key];
    if (!list || typeof list !== 'object') continue;
    const length = Number((list as { length?: unknown }).length);
    if (!Number.isInteger(length) || length <= 0 || length > 10000) continue;
    for (let index = 0; index < length; index += 1) stack.push((list as Record<number, unknown>)[index]);
  }
}

function wrapLiveDisplayPrototypes(
  roots: unknown[],
  patcher: ReturnType<typeof createMethodPatcher>
): void {
  const stack = [...roots];
  const seen = new Set<object>();
  let budget = 400;
  while (stack.length && budget > 0) {
    const raw = stack.pop();
    if (!raw || typeof raw !== 'object' || seen.has(raw)) continue;
    seen.add(raw);
    budget -= 1;
    const prototype = asRecord(Object.getPrototypeOf(raw));
    if (prototype) wrapDisplayPrototype(prototype, patcher);
    pushDisplayChildren(raw, stack);
  }
}

export function installNativeHudPostGameGuard(
  gameEvents: GameEventBus,
  globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow
): () => void {
  const pollMs = 1000;
  const patcher = createMethodPatcher();
  let sceneHookReady = false;
  let prototypesReady = false;
  let liveWrapped = false;
  const installSceneLeaveScrub = () => {
    if (!prototypesReady) {
      const prototypes = readDisplayPrototypes(globalObject);
      if (prototypes.length) {
        for (const prototype of prototypes) wrapDisplayPrototype(prototype, patcher);
        prototypesReady = true;
      }
    }
    const manager = readSceneManager(globalObject);
    if (!liveWrapped) {
      const locator = createLayaObjectLocator(globalObject);
      const roots = [
        asRecord(globalObject.Laya)?.stage,
        manager?.CurrentScene,
        ...readWindowManagerInstances(locator, globalObject)
      ];
      if (roots.some(Boolean)) {
        wrapLiveDisplayPrototypes(roots, patcher);
        liveWrapped = true;
      }
    }
    if (sceneHookReady || !manager) return;
    sceneHookReady = patcher.wrap(manager, 'executeSwitchScene', (original) => function (this: unknown, ...args: unknown[]) {
      sceneLeaving = true;
      try {
        scrubInvalidDisplayChildren(manager.CurrentScene);
        scrubInvalidDisplayChildren(asRecord(globalObject.Laya)?.stage);
        return original.apply(this, args);
      } finally {
        sceneLeaving = false;
      }
    });
  };
  const onPoll = () => {
    if (!sceneHookReady || !prototypesReady || !liveWrapped) installSceneLeaveScrub();
    if (detectSettlementBlockingInput(globalObject)) noteSuspended(true, globalObject);
  };
  const stopEvents = gameEvents.subscribe((event) => {
    if (event.type === 'game-ended') noteSuspended(true, globalObject);
    if (event.type === 'game-started') suspended = false;
  });
  const timer = globalObject.setInterval(onPoll, pollMs);
  onPoll();
  return () => {
    stopEvents();
    globalObject.clearInterval(timer);
    patcher.restoreAll();
    suspended = false;
  };
}

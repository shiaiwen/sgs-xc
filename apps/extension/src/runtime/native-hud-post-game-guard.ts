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
import { locateGameScene, locateSceneManager } from '../features/seat-display/game-scene-locator.ts';
import { readSeatStateFromGameScene } from '../features/seat-display/seat-game-adapter.ts';
import {
  detachLayaNode,
  isLayaDisplayNode,
  scrubInvalidDisplayChildren
} from './laya-display-node.ts';
import { isBackgroundUiScene } from '../features/skin-background/skin-runtime.ts';
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

export function isNativeSceneLeaving(): boolean {
  return sceneLeaving;
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

export function installNativeHudPostGameGuard(
  gameEvents: GameEventBus,
  globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow
): () => void {
  const pollMs = 1000;
  const patcher = createMethodPatcher();
  const locator = createLayaObjectLocator(globalObject);
  let sceneHookReady = false;
  const installSceneLeaveScrub = () => {
    if (!isBackgroundUiScene(locator, globalObject)) return;
    const manager = readSceneManager(globalObject);
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
  const readSceneInGame = () => Boolean(readSeatStateFromGameScene(locateGameScene(globalObject)).inGame);

  const onPoll = () => {
    if (!sceneHookReady) installSceneLeaveScrub();
    const settlementVisible = detectSettlementBlockingInput(globalObject);
    if (settlementVisible) {
      noteSuspended(true, globalObject);
      return;
    }
    // 连局时座位 inGame 可能一直为 true，只能靠结算窗判断局后；结算关闭且仍在牌局内时应恢复。
    if (readSceneInGame()) suspended = false;
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

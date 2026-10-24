/**
 * 牌局右侧切到阵营页时，游戏会把聊天记录区域藏起来；斗地主等模式需要保持可见。
 */

import { createLayaObjectLocator, type LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { locateGameScene, type GameRuntimeWindow } from '../seat-display/game-scene-locator.ts';
type UnknownRecord = Record<string, unknown>;

const RIGHT_VIEW_PATCHED = '__xcCampChatRightPanelPatched';
const RIGHT_VIEW_METHODS = [
  'tabClicked',
  'onTabClick',
  'onTabClicked',
  'updateFigureUI',
  'UpdateFigureUI',
  'relayoutForPanelToggle'
] as const;

export function installCampChatRightPanelController(
  globalObject: GameRuntimeWindow = window
): { dispose(): void } {
  const locator = createLayaObjectLocator(globalObject as LayaRuntimeWindow);
  const patcher = createMethodPatcher();
  let disposed = false;
  let prototypePatched = false;

  function asRecord(value: unknown): UnknownRecord | null {
    return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
  }

  function isVisible(node: UnknownRecord | null): boolean {
    if (!node || node.destroyed) return false;
    if (node.visible === false || node._visible === false) return false;
    return true;
  }

  function setVisible(node: UnknownRecord, visible: boolean): void {
    if (node.destroyed) return;
    try {
      node.visible = visible;
    } catch {
      // 部分节点只读 visible。
    }
    if ('_visible' in node) node._visible = visible;
  }

  function syncCampChatPanel(gameScene: UnknownRecord): void {
    const rightView = asRecord(gameScene.rightView);
    if (!rightView) return;
    const figureView = asRecord(rightView.figureView);
    if (!isVisible(figureView)) return;

    const traceArea = asRecord(rightView.traceArea);
    const chatViewUI = asRecord(gameScene.chatViewUI) ?? asRecord(rightView.chatViewUI);
    if (traceArea) setVisible(traceArea, true);
    if (chatViewUI) setVisible(chatViewUI, true);

    const msgContainer = asRecord(traceArea?.msgContainer);
    if (msgContainer) setVisible(msgContainer, true);
  }

  function scheduleSync(gameScene: UnknownRecord): void {
    syncCampChatPanel(gameScene);
    const timer = (globalObject as LayaRuntimeWindow).Laya?.timer;
    if (typeof timer?.once === 'function') {
      timer.once(0, null, () => syncCampChatPanel(gameScene));
      timer.once(50, null, () => syncCampChatPanel(gameScene));
      return;
    }
    globalObject.setTimeout(() => syncCampChatPanel(gameScene), 0);
    globalObject.setTimeout(() => syncCampChatPanel(gameScene), 50);
  }

  function patchRightViewPrototype(prototype: UnknownRecord): void {
    if (prototype[RIGHT_VIEW_PATCHED]) return;
    let wrappedAny = false;
    for (const method of RIGHT_VIEW_METHODS) {
      if (typeof prototype[method] !== 'function') continue;
      const ok = patcher.wrap(prototype, method, (original) => function (this: unknown, ...args: unknown[]) {
        const result = original.apply(this, args);
        const scene = locateGameScene(globalObject) ?? locator.gameScene();
        if (scene) scheduleSync(scene as UnknownRecord);
        return result;
      });
      if (ok) wrappedAny = true;
    }
    if (wrappedAny) prototype[RIGHT_VIEW_PATCHED] = true;
  }

  function tryInstall(): void {
    if (disposed) return;
    const gameScene = locateGameScene(globalObject) ?? locator.gameScene();
    if (!gameScene) return;
    const rightView = asRecord((gameScene as UnknownRecord).rightView);
    if (!rightView) return;
    if (!prototypePatched) {
      const prototype = asRecord(Object.getPrototypeOf(rightView));
      if (prototype) {
        patchRightViewPrototype(prototype);
        prototypePatched = true;
      }
    }
    syncCampChatPanel(gameScene as UnknownRecord);
  }

  const timer = globalObject.setInterval(tryInstall, 500);
  tryInstall();

  return {
    dispose() {
      disposed = true;
      globalObject.clearInterval(timer);
      patcher.restoreAll();
    }
  };
}

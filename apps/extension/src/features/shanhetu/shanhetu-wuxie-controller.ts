/** 山河图对局中，所有无懈可击询问自动点取消，自己和别人打出的锦囊都算。 */

import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import { WUXIE_SPELL_ID } from '../../const/wuxie-cancel.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { everyInterval } from '../../runtime/shared-ticker.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import { SHANHETU_AUTO_CANCEL_WUXIE_KEY } from './shanhetu-settings.ts';

type UnknownRecord = Record<string, unknown>;

const WUXIE_SKILL_ID = WUXIE_SPELL_ID;
const SHANHETU_GAME_SCENE = 'RogueLikeGameScene';
/** 参考脚本在 MsgGamePlayCardNtf 的 CardList 中用此卡号识别山河图。 */
const SHANHETU_MODE_CARD_ID = 20100;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

function skillId(value: unknown): number {
  const record = asRecord(value);
  return Number(record?.SkillId ?? record?.skillId ?? 0);
}

function canClick(button: UnknownRecord | null): button is UnknownRecord {
  return !!button && !button.destroyed && button.visible !== false && button._enabled === true;
}

function isShanhetuGame(locator: LayaObjectLocator): boolean {
  const scene = locator.scene();
  if (scene?.isShanHeTu === true) return true;
  const sceneName = String(scene?.SceneName ?? scene?.sceneName ?? scene?.name ?? '');
  if (sceneName === SHANHETU_GAME_SCENE) return true;
  const modeNames = [scene?.modeName, scene?.ModeName, scene?.gameModeName];
  const context = locator.gameContext();
  try {
    const mode = typeof context?.GetModeVO === 'function' ? asRecord(context.GetModeVO()) : null;
    modeNames.push(mode?.ModeName, mode?.modeName, mode?.Name, mode?.name);
  } catch {
    // 模式配置尚未就绪时仍可用场景名识别。
  }
  return modeNames.some((name) => typeof name === 'string' && name.includes('山河图'));
}

/** 只认当前山河图牌局的无懈响应；普通对局和其它操作不会自动点击。 */
export function isShanhetuWuxiePrompt(scene: unknown, isShanhetuMode = false): boolean {
  const game = asRecord(scene);
  if (!game || !isShanhetuMode) return false;
  const self = asRecord(game.SelfSeatUi) ?? asRecord(game.selfSeatUi);
  const container = asRecord(self?.cardContainer);
  const context = asRecord(container?.selectCardContext) ?? asRecord(container?.SelectContext);
  const selector = asRecord(self?.spellSelector) ?? asRecord(self?.SpellSelector);
  return Number(context?.SpecifySkillId) === WUXIE_SKILL_ID
    || skillId(context?.Skill) === WUXIE_SKILL_ID
    || (!!selector?.visible && skillId(selector.spell) === WUXIE_SKILL_ID);
}

/** 优先点选项弹窗的取消；没有弹窗时点操作栏的取消。 */
export function cancelShanhetuWuxie(scene: unknown, isShanhetuMode = false): boolean {
  if (!isShanhetuWuxiePrompt(scene, isShanhetuMode)) return false;
  const game = asRecord(scene)!;
  const self = asRecord(game.SelfSeatUi) ?? asRecord(game.selfSeatUi);
  const selector = asRecord(self?.spellSelector) ?? asRecord(self?.SpellSelector);
  if (selector?.visible) {
    const buttons = Array.isArray(selector.btnList) ? selector.btnList : [];
    const cancel = buttons.map(asRecord).find((button) => {
      if (!canClick(button)) return false;
      const data = asRecord(button.data) ?? asRecord(button.Data);
      const sendData = Number(data?.sendData);
      return sendData === 255 || (sendData === 0 && !data?.callBack);
    });
    if (!cancel || typeof selector.btnClick !== 'function') return false;
    selector.btnClick(cancel);
    return true;
  }
  const bar = asRecord(self?.buttonBar) ?? asRecord(self?.ButtonBar);
  if (!bar || bar.visible === false) return false;
  const buttons = Array.isArray(bar.btns) ? bar.btns : [];
  const cancel = buttons.map(asRecord).find((button) => button?.name === 'btnCancel' && canClick(button));
  if (!cancel || typeof cancel.onClick !== 'function') return false;
  cancel.onClick();
  return true;
}

export function installShanhetuWuxieController(
  configStore: XiaochaoConfigStore,
  options: { globalObject?: LayaRuntimeWindow; locator?: LayaObjectLocator; gameEvents?: GameEventBus } = {}
): () => void {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  let patcher = createMethodPatcher();
  let currentSelf: UnknownRecord | null = null;
  let currentBar: UnknownRecord | null = null;
  let currentSelector: UnknownRecord | null = null;
  let currentContainer: UnknownRecord | null = null;
  let uiBound = false;
  let barRevision = 0;
  let selectorRevision = 0;
  let submittedBar = -1;
  let submittedSelector = -1;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let modeFromCardList: boolean | null = null;

  let stopPolling: (() => void) | null = null;
  const bindRetryTimers: number[] = [];
  function clearBindRetries(): void {
    bindRetryTimers.forEach((timer) => globalObject.clearTimeout(timer));
    bindRetryTimers.length = 0;
  }
  function scheduleBindRetries(): void {
    clearBindRetries();
    // 操作栏可能晚于开局/卡表事件才挂到座位上，补几次绑定。
    for (const delay of [100, 300, 600, 1200, 2500]) {
      bindRetryTimers.push(globalObject.setTimeout(() => {
        if (!disposed) bindUi();
      }, delay) as unknown as number);
    }
  }
  const unsubscribe = options.gameEvents?.subscribe((event) => {
    if (event.type === 'card-list-ready') {
      modeFromCardList = event.cardIds.includes(SHANHETU_MODE_CARD_ID);
      bindUi();
      scheduleBindRetries();
      scheduleCheck();
    } else if (event.type === 'game-ended' && event.settled !== false) {
      modeFromCardList = null;
      clearBindRetries();
      patcher.restoreAll();
    }
  });

  function currentGame(): UnknownRecord | null {
    const direct = asRecord(locator.gameScene());
    if (asRecord(direct?.SelfSeatUi) || asRecord(direct?.selfSeatUi)) return direct;
    return asRecord(locateGameScene(globalObject));
  }

  function check(): void {
    if (configStore.get(SHANHETU_AUTO_CANCEL_WUXIE_KEY) !== true) return;
    const scene = currentGame();
    const mode = modeFromCardList ?? isShanhetuGame(locator);
    if (!isShanhetuWuxiePrompt(scene, mode)) {
      // 询问已经关掉；操作栏在出牌阶段可能一直开着，下一次询问不会再走 Show，必须在这里放行。
      submittedBar = submittedSelector = -1;
      return;
    }
    const self = asRecord(scene?.SelfSeatUi) ?? asRecord(scene?.selfSeatUi);
    const selector = asRecord(self?.spellSelector) ?? asRecord(self?.SpellSelector);
    if (selector?.visible && submittedSelector === selectorRevision) return;
    if (!selector?.visible && submittedBar === barRevision) return;
    try {
      if (!cancelShanhetuWuxie(scene, mode)) return;
      if (selector?.visible) submittedSelector = selectorRevision;
      else submittedBar = barRevision;
    } catch (error) {
      console.warn('[山河图] 自动取消无懈失败:', error);
    }
  }

  function scheduleCheck(): void {
    if (disposed || pending !== null) return;
    pending = setTimeout(() => {
      pending = null;
      if (!disposed) check();
    }, 0);
  }

  function bindUi(): void {
    const scene = currentGame();
    const self = asRecord(scene?.SelfSeatUi) ?? asRecord(scene?.selfSeatUi);
    const bar = asRecord(self?.buttonBar) ?? asRecord(self?.ButtonBar);
    const selector = asRecord(self?.spellSelector) ?? asRecord(self?.SpellSelector);
    const container = asRecord(self?.cardContainer);
    if (uiBound && self === currentSelf && bar === currentBar
      && selector === currentSelector && container === currentContainer) return;
    patcher.restoreAll();
    patcher = createMethodPatcher();
    currentSelf = self;
    currentBar = bar;
    currentSelector = selector;
    currentContainer = container;
    uiBound = !!self && !!bar && !!container;
    barRevision = selectorRevision = 0;
    submittedBar = submittedSelector = -1;
    if (!uiBound || !self) return;
    const wrap = (target: UnknownRecord | null, method: string, after: () => void) => {
      if (!target) return;
      patcher.wrap(target, method, (original) => function (this: unknown, ...args: unknown[]) {
        const result = original.apply(this, args);
        after();
        scheduleCheck();
        return result;
      });
    };
    wrap(bar, 'Show', () => { barRevision += 1; });
    wrap(bar, 'Update', () => undefined);
    wrap(selector, 'Show', () => { selectorRevision += 1; });
    wrap(selector, 'UpdateBtnState', () => undefined);
    wrap(self, 'StartSelectSkillItem', () => undefined);
    scheduleCheck();
  }

  // 取消无懈是事件驱动：进局挂 UI 补丁，后续由 Show/Update 补丁触发 check，不轮询。
  if (options.gameEvents) {
    if (locateGameScene(globalObject) || locator.gameScene()) bindUi();
  } else {
    stopPolling = everyInterval('山河图自动取消无懈', 250, () => {
      if (disposed) return;
      bindUi();
      check();
    }, {}, globalObject);
  }
  return () => {
    disposed = true;
    unsubscribe?.();
    stopPolling?.();
    clearBindRetries();
    if (pending !== null) clearTimeout(pending);
    patcher.restoreAll();
  };
}

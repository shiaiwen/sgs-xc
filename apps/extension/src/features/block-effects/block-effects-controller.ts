/**
 * 屏蔽特效/弹窗总控：按配置关闭广告、MVP、特效资源与协议字段改写。
 */

import { CONFIG_CHANGE_EVENT, type XiaochaoConfigStore } from '../../config/config-store.ts';
import { refreshGameEventDispatcher } from '../../features/seat-display/game-scene-locator.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import {
  createMethodPatcher,
  type PatchableFunction
} from '../../runtime/method-patch.ts';
import { isBackgroundUiScene } from '../skin-background/skin-runtime.ts';
import type { BlockSettingKey } from './block-effect-settings.ts';
import { applyBlockMessageFilters, shouldDropNoticeProtocol } from './block-message-filters.ts';
import { installPersistentMarqueeEventBlock } from './marquee-event-hook.ts';
import {
  collectMarqueeUis,
  collectMarqueeUisFromDisplayTree,
  collectDogTuoBannerNodes,
  createMarqueeVisibilityBlocker,
  isDogTuoBannerNode,
  sweepDogTuoTextOnStage
} from './marquee-visibility.ts';
import {
  hasAnyEffectResourceBlock,
  replaceBlockedEffectUrl,
  type EffectResourceFlags
} from './effect-resource-filter.ts';
import { classifyPlayback, kindFromCard, type PlaybackKind } from './effect-playback.ts';
import {
  isLobbyAdPushWindowName,
  LOBBY_AD_PUSH_WINDOW_NAMES,
  looksLikeAdPushCarouselWindow
} from '../../const/block-ad-window.ts';

type UnknownRecord = Record<string, unknown>;

/** 锦囊技能动画与特效 ID（原版 y0/y1/y2）。 */
const JINNANG_SKILL_IDS = new Set([4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 83, 84, 85]);
const JINNANG_EFFECT_NAMES = new Set(['tiesuo', 'huogong', 'wuxie']);
const JINNANG_PLAY_METHODS = [
  'PlayWuzhongshengyouEffect',
  'PlayTiesuoEffect',
  'PlayHuoGongEffect',
  'PlayWuxieEffect',
  'PlayShunshouEffect',
  'PlayJuedouEffect',
  'PlayTaoyuanEffect'
];
const LOBBY_AD_BUTTON_TYPE = 0x27cb;
const MARQUEE_EVENTS = ['CHAT_MARQUEE_ADD', 'CHAT_MARQUEE2023_ADD', 'CHAT_MARQUEE2023_ACT_ADD'];
const MARQUEE_SHOW_METHODS = ['ShowMarquee', 'intActDataMarquee', 'ShowNextActMarquee'];
const MARQUEE_MANAGER_CLASS_NAMES = [
  'ChatMarqueeManager',
  'MarqueeManager',
  'SystemNoticeManager',
  'ChatSysMarqueeManager',
  'ChatMarquee2023Manager',
  'Marquee2023Manager',
  'ChatSysMarquee2023Manager'
];
const SELF_GENERAL_KEYS = ['generalIds', 'GeneralIds', 'WuJiangs', 'generals'];

/** 显示后需要处理的窗口及其对应开关；未开启时不轮询窗口。 */
const SHOWN_WINDOW_SWITCHES: Record<string, BlockSettingKey> = {
  GetPropSpecialWindow: 'block.probWindow',
  AdPushWindow: 'block.adWindow',
  RogueLike1v1ZhanJiWindow: 'block.mvpWindow',
  GameResultWindow: 'block.mvpWindow',
  GameMvpWindow: 'block.mvpWindow',
  GameZhanJiWindow: 'block.mvpWindow',
  GeneralOpenResultWindow: 'block.packageWindow',
  SkinOpenResultWindowNew: 'block.packageWindow',
  OldbackOneClickDrawAwdWin: 'block.packageWindow',
  SelectSkinWindow: 'block.packageWindow'
};

for (const adWindowName of LOBBY_AD_PUSH_WINDOW_NAMES) {
  SHOWN_WINDOW_SWITCHES[adWindowName] = 'block.adWindow';
}

const CLOSE_BY_SWITCH: Partial<Record<BlockSettingKey, string>> = {
  'block.adWindow': 'AdPushWindow'
};

export interface BlockEffectsController {
  /** 协议分发前调用，按开关改写击杀、皮肤状态与势力口号消息。 */
  filterMessage(payload: UnknownRecord, className: string): void;
  /** 清掉红点树上仍亮着的叶子。 */
  clearRedDots(): { found: boolean; count: number };
  /** 账号或场景就绪后重挂狗托屏蔽，配置已开时不必再拨开关。 */
  armNoticeBlock(): void;
  /** 配置已开时关闭大厅活动广告窗，进大厅后补一次。 */
  armAdBlock(): void;
  dispose(): void;
}

export interface BlockEffectsOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  gameEvents?: GameEventBus;
}

/**
 * 屏蔽设置：逐项移植原版对游戏方法的包装。所有补丁在开关关闭时直接透传原方法，
 * 因此只在启动时安装一次，开关切换无需重装。
 */
export function installBlockEffectsController(
  configStore: XiaochaoConfigStore,
  options: BlockEffectsOptions = {}
): BlockEffectsController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const patcher = createMethodPatcher();
  const marqueeBlocker = createMarqueeVisibilityBlocker();
  const cleanups: Array<() => void> = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const unsubscribes: Array<() => void> = [];
  const skillEffects = new Set<UnknownRecord>();
  const effectControllers = new Set<UnknownRecord>();
  let manualRecordView = false;
  let disposed = false;

  if (options.gameEvents) {
    unsubscribes.push(options.gameEvents.subscribe((event) => {
      if (event.type === 'game-ended') skillEffects.clear();
      if (isOn('block.noticeWindow') && (event.type === 'game-started' || event.type === 'game-reconnected')) {
        applyNoticeBlockState();
      }
    }));
  }

  const isOn = (key: BlockSettingKey) => configStore.get(key) === true;
  const resourceFlags = (): EffectResourceFlags => ({
    sha: isOn('block.shaEffect'),
    shan: isOn('block.shanEffect'),
    heal: isOn('block.healEffect'),
    shake: isOn('block.shakeEffect')
  });
  const KIND_SWITCH: Record<PlaybackKind, BlockSettingKey> = {
    sha: 'block.shaEffect',
    shan: 'block.shanEffect',
    heal: 'block.healEffect',
    trick: 'block.jinnangEffect',
    equip: 'block.equipEffect',
    skill: 'block.skillEffect'
  };
  const kindOn = (kind: string) => {
    const key = KIND_SWITCH[kind as PlaybackKind];
    return key ? isOn(key) : false;
  };
  const skinBlocked = (seat: UnknownRecord | null) => Boolean(seat?.IsSelf)
    ? isOn('block.selfSkinEffect')
    : isOn('block.otherSkinState');
  const replaceUrl = (url: unknown) => {
    if (typeof url !== 'string' || url.length === 0) return url;
    const flags = resourceFlags();
    return hasAnyEffectResourceBlock(flags) ? replaceBlockedEffectUrl(url, flags) : url;
  };

  function later(callback: () => void, delay = 0): void {
    if (disposed) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, delay);
    timers.add(timer);
  }

  /** 原版 y7：每 interval 毫秒重试，直到返回真值或次数用尽。 */
  function poll<T>(probe: () => T | null | undefined | false, retries = 20, interval = 500): Promise<T | null> {
    return new Promise((resolve) => {
      const attempt = (remaining: number) => {
        if (disposed) return resolve(null);
        let value: T | null | undefined | false = null;
        try {
          value = probe();
        } catch {
          value = null;
        }
        if (value) return resolve(value);
        if (remaining <= 0) return resolve(null);
        later(() => attempt(remaining - 1), interval);
      };
      attempt(retries);
    });
  }

  function callMethod(target: unknown, name: string, ...args: unknown[]): unknown {
    const record = asRecord(target);
    const method = record?.[name];
    return typeof method === 'function' ? method.apply(record, args) : undefined;
  }

  function userInfoManager(): UnknownRecord | null {
    return locator.manager('UserInfoManger') ?? locator.manager('UserInfoManager');
  }

  function playNextLegendShow(): void {
    const manager = userInfoManager();
    const eventName = asRecord(manager?.constructor)?.PLAY_NEXT_LEGEND_SHOW ?? manager?.PLAY_NEXT_LEGEND_SHOW;
    callMethod(manager, 'event', eventName);
  }

  // ---------- 弹窗 ----------

  function readWindowManagerInstances(): UnknownRecord[] {
    const context = asRecord(globalObject.GameContext);
    const windowManager = asRecord(context?.WindowManager) ?? asRecord(locator.manager('WindowManager'));
    const dict = asRecord(windowManager?.WindowInstanceDict);
    if (!dict) return [];
    const results: UnknownRecord[] = [];
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

  function closeAdPushWindowInstance(win: UnknownRecord): boolean {
    if (!win || win.destroyed) return false;
    const views = win.curViewList;
    if (Array.isArray(views)) {
      views.forEach((view) => {
        try {
          callMethod(view, 'closeClicker');
        } catch {
          // 单个视图关不掉就跳过。
        }
      });
    }
    let closed = false;
    try {
      if (typeof win.Close === 'function') {
        callMethod(win, 'Close');
        closed = true;
      } else if (typeof win.close === 'function') {
        callMethod(win, 'close');
        closed = true;
      } else if (typeof win.destroy === 'function') {
        callMethod(win, 'destroy', true);
        closed = true;
      }
    } catch (error) {
      console.warn('[屏蔽设置] 关闭广告窗失败:', error);
    }
    return closed;
  }

  /** 按已知类名与轮播广告结构关闭大厅弹窗。 */
  function closeAllAdWindows(retries = 0, interval = 500): boolean {
    if (!isOn('block.adWindow')) return false;
    let closed = false;
    for (const name of LOBBY_AD_PUSH_WINDOW_NAMES) {
      closed = closeWindowByName(name) || closed;
    }
    for (const win of readWindowManagerInstances()) {
      if (!looksLikeAdPushCarouselWindow(win)) continue;
      closed = closeAdPushWindowInstance(win) || closed;
    }
    if (!closed && retries > 0) later(() => closeAllAdWindows(retries - 1, interval), interval);
    return closed;
  }

  /** 按名字关闭 WindowManager 与 WindowLayer 中的窗口。 */
  function closeWindowByName(name: string, retries = 0, interval = 500): boolean {
    let closed = false;
    const windows = new Set([locator.window(name), ...locator.findWindows(name)].filter(Boolean));
    windows.forEach((win) => {
      if (!win || win.destroyed) return;
      try {
        if (typeof win.Close === 'function') {
          win.Close();
          closed = true;
        } else if (typeof win.close === 'function') {
          win.close();
          closed = true;
        } else if (typeof win.destroy === 'function') {
          win.destroy(true);
          closed = true;
        }
      } catch (error) {
        console.warn('[屏蔽设置] 关闭窗口失败:', name, error);
      }
    });
    if (retries > 0) later(() => closeWindowByName(name, retries - 1, interval), interval);
    return closed;
  }

  /** 广告窗口先关闭其内部视图，再关闭窗口本身；未关到时重试。 */
  function closeBySwitch(key: BlockSettingKey, retries = 0, interval = 500): boolean {
    if (!isOn(key)) return false;
    if (key === 'block.adWindow') return closeAllAdWindows(retries, interval);
    const name = CLOSE_BY_SWITCH[key];
    if (!name) return false;
    const closed = closeWindowByName(name);
    if (!closed && retries > 0) later(() => closeBySwitch(key, retries - 1, interval), interval);
    return closed;
  }

  /** 隐藏大厅右侧和底部已经摆出来的广告。 */
  function hideLobbyAd(retries = 0): boolean {
    if (!isOn('block.adWindow')) return false;
    let hidden = false;
    const scenes = new Set([locator.scene(), ...locator.findInLayer('SceneLayer', 'ModeScene')].filter(Boolean));
    scenes.forEach((scene) => {
      if (typeof scene?.hideAdView === 'function') {
        try {
          scene.hideAdView();
          hidden = true;
        } catch (error) {
          console.warn('[屏蔽设置] 隐藏大厅广告失败:', error);
        }
      }
      hidden = hideAdNodes(scene, false) || hidden;
      hidden = hideAdNodes(asRecord(scene?.bottomView), true) || hidden;
      hidden = hideAdNodes(asRecord(scene?.leftView), false) || hidden;
      hidden = hideAdButtons(asRecord(scene?.leftView)) || hidden;
    });
    if (retries > 0) later(() => hideLobbyAd(retries - 1), 500);
    return hidden;
  }

  const AD_NODE_KEYS = ['adView', 'AdView', 'adUI', 'adUi', 'bottomAd', 'bannerView', 'activityAd', 'adSpr', 'adNode'];

  function hideAdNodes(owner: UnknownRecord | null, scanChildren: boolean): boolean {
    if (!owner) return false;
    let hidden = false;
    for (const key of AD_NODE_KEYS) {
      const node = asRecord(owner[key]);
      if (!node || node.visible === false) continue;
      try {
        node.visible = false;
        callMethod(node, 'stop');
        hidden = true;
      } catch {
        // 这个节点藏不了就跳过，不能打断后面的开关。
      }
    }
    if (!scanChildren) return hidden;
    const count = Number(owner.numChildren);
    if (!Number.isInteger(count) || typeof owner.getChildAt !== 'function') return hidden;
    for (let index = 0; index < count; index += 1) {
      const child = asRecord(owner.getChildAt(index));
      const name = String(child?.name ?? '');
      if (!/^(ad|banner|广告)/i.test(name)) continue;
      if (child && child.visible !== false) {
        child.visible = false;
        hidden = true;
      }
    }
    return hidden;
  }

  function hideAdButtons(leftView: UnknownRecord | null): boolean {
    if (!leftView) return false;
    let hidden = false;
    for (const key of ['btnList', 'btns', 'buttonList']) {
      const list = leftView[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const button = asRecord(item);
        if (!button || button.type !== LOBBY_AD_BUTTON_TYPE || button.visible === false) continue;
        button.visible = false;
        hidden = true;
      }
    }
    return hidden;
  }

  async function handleShownWindow(name: string): Promise<void> {
    const key = SHOWN_WINDOW_SWITCHES[name];
    if (!key || !isOn(key)) return;
    const win = await poll(() => locator.window(name));
    if (!win) return;
    await poll(() => !win.isShowWait);
    if (win.destroyed || disposed) return;
    if (isLobbyAdPushWindowName(name)) {
      closeBySwitch('block.adWindow');
      return;
    }
    switch (name) {
      case 'GetPropSpecialWindow':
        callMethod(win, 'Hide');
        callMethod(win, 'Close');
        break;
      case 'RogueLike1v1ZhanJiWindow':
        callMethod(win, 'onClickClose');
        break;
      case 'GameResultWindow':
      case 'GameMvpWindow':
      case 'GameZhanJiWindow':
        // 玩家从牌桌主动查看战绩时不自动关闭。
        if (manualRecordView) {
          manualRecordView = false;
          break;
        }
        later(() => {
          if (win.destroyed || disposed) return;
          callMethod(win, 'laterClose');
        }, 400);
        break;
      case 'GeneralOpenResultWindow':
      case 'SkinOpenResultWindowNew':
      case 'OldbackOneClickDrawAwdWin':
        callMethod(win, 'Close');
        break;
      case 'SelectSkinWindow':
        if (Number(asRecord(win.selectView)?.usingSkinID) >= 0) callMethod(win, 'Close');
        break;
    }
  }

  async function installWindowBlocks(): Promise<void> {
    patcher.wrap(locator.classPrototype('GameMvpWindow'), 'updateBg', (original) => function (this: UnknownRecord, ...args) {
      if (isOn('block.mvpWindow') && typeof this.SetSkin === 'function') return this.SetSkin(args[0]);
      return original.apply(this, args);
    });

    const dispatcher = await poll(() => locator.dispatcher());
    if (dispatcher) {
      const showWindowHook = (original: PatchableFunction) => function (this: unknown, windowName: unknown, ...rest: unknown[]) {
        const result = original.call(this, windowName, ...rest);
        if (typeof windowName === 'string' && isOn('block.adWindow') && isLobbyAdPushWindowName(windowName)) {
          later(() => closeBySwitch('block.adWindow'));
        }
        if (typeof windowName === 'string' && SHOWN_WINDOW_SWITCHES[windowName]) {
          later(() => void handleShownWindow(windowName));
        }
        return result;
      };
      for (const showWindowName of locator.listShowWindowMethodNames(dispatcher)) {
        if (patcher.isWrapped(dispatcher, showWindowName)) continue;
        patcher.wrap(dispatcher, showWindowName, showWindowHook);
      }
    }
  }

  async function installLobbyAdBlock(): Promise<void> {
    patcher.wrap(locator.classPrototype('ModeScene'), 'showAdView', (original) => function (this: unknown, ...args) {
      const result = original.apply(this, args);
      if (isOn('block.adWindow')) hideLobbyAd(0);
      return result;
    });
    const leftViewPrototype = await poll(
      () => {
        const leftView = asRecord(locator.scene()?.leftView);
        return leftView ? asRecord(Object.getPrototypeOf(leftView)) : null;
      },
      1000
    );
    patcher.wrap(leftViewPrototype, 'getBtnRes', (original) => function (this: unknown, ...args) {
      const buttons = original.apply(this, args);
      if (!isOn('block.adWindow') || !Array.isArray(buttons)) return buttons;
      return buttons
        .filter((button) => asRecord(button)?.type !== LOBBY_AD_BUTTON_TYPE)
        .sort((left, right) => {
          const leftIcon = !asRecord(left)?.zhutiIcon;
          const rightIcon = !asRecord(right)?.zhutiIcon;
          return leftIcon === rightIcon ? 0 : asRecord(right)?.zhutiIcon ? 1 : -1;
        });
    });
  }

  // ---------- 狗托（顶部跑马灯） ----------

  let marqueeManager: UnknownRecord | null = null;
  let marqueeDispatcherHooksBound = false;
  const wrappedMarqueePrototypes = new WeakSet<object>();
  const wrappedMarqueeManagerInstances = new WeakSet<UnknownRecord>();
  let noticeManagerHookGeneration = 0;
  let noticeManagerPollActive = false;
  const marqueeSceneHookOwner = {};
  let chatSysNewsIngressWrapped = false;
  let gameDispatcherMarqueeGuardWrapped = false;
  let gedPersistentMarqueeHooked = false;
  let marqueeGedHookTarget: UnknownRecord | null = null;
  let marqueeFrameLoopBound = false;
  let marqueeBlockInstallPromise: Promise<void> | null = null;
  let syncMarqueeScheduled = false;
  let displayAddChildGuardWrapped = false;
  const wrappedMarqueeListenerRecords = new WeakSet<object>();

  function marqueeDisplayLayers(): Array<UnknownRecord | null> {
    // 不要把 ChatSysNewsManager 当显示树根扫描：类名含 ChatSys，会被误判为跑马灯并藏掉，导致对局打不了字。
    return [
      locator.layer('TopUILayer'),
      locator.layer('PromptLayer'),
      locator.layer('WindowLayer'),
      asRecord(locator.scene()?.topView),
      asRecord(locator.scene()?.noticeView),
      asRecord(locator.scene()?.marqueeView),
      asRecord(locator.scene()?.chatMarquee)
    ];
  }

  function isTableGameScene(): boolean {
    return Boolean(locator.gameScene());
  }

  function collectAllMarqueeUis(): UnknownRecord[] {
    const inTable = isTableGameScene();
    const fromManager = marqueeManager ? collectMarqueeUis(marqueeManager) : [];
    const fromTree = inTable ? [] : collectMarqueeUisFromDisplayTree(marqueeDisplayLayers());
    const fromBannerScan = !inTable && isOn('block.noticeWindow')
      ? collectDogTuoBannerNodes(globalObject)
      : [];
    return Array.from(new Set([...fromManager, ...fromTree, ...fromBannerScan]));
  }

  let lastSyncMarqueeAt = 0;
  const SYNC_MARQUEE_MIN_INTERVAL_MS = 500;

  function scheduleSyncMarquee(): void {
    if (syncMarqueeScheduled) return;
    syncMarqueeScheduled = true;
    later(() => {
      syncMarqueeScheduled = false;
      syncMarquee();
    }, 0);
  }

  function looksLikeMarqueeManager(caller: UnknownRecord): boolean {
    return typeof caller.ShowMarquee === 'function'
      && typeof caller.HideAllMarquee === 'function';
  }

  function syncMarquee(): void {
    const now = Date.now();
    if (now - lastSyncMarqueeAt < SYNC_MARQUEE_MIN_INTERVAL_MS) return;
    lastSyncMarqueeAt = now;
    const blocked = isOn('block.noticeWindow');
    const inTable = isTableGameScene();
    if (blocked && !inTable && marqueeManager && typeof marqueeManager.HideAllMarquee === 'function') {
      callMethod(marqueeManager, 'HideAllMarquee');
    }
    marqueeBlocker.sync(collectAllMarqueeUis(), blocked);
    if (blocked && !inTable) sweepDogTuoTextOnStage(globalObject, true);
  }

  function listenersOnEvent(events: UnknownRecord | null, eventName: string): unknown[] {
    const bucket = events?.[eventName];
    if (!bucket) return [];
    return Array.isArray(bucket) ? bucket : [bucket];
  }

  function findMarqueeManager(): UnknownRecord | null {
    const events = asRecord(locator.dispatcher()?._events);
    if (events) {
      for (const eventName of Object.keys(events)) {
        if (!/MARQUEE/i.test(eventName) && !/marquee/i.test(eventName)) continue;
        for (const listener of listenersOnEvent(events, eventName)) {
          const caller = asRecord(asRecord(listener)?.caller);
          if (caller && looksLikeMarqueeManager(caller)) return caller;
        }
      }
      for (const eventName of Object.keys(events)) {
        for (const listener of listenersOnEvent(events, eventName)) {
          const caller = asRecord(asRecord(listener)?.caller);
          if (caller && looksLikeMarqueeManager(caller)) return caller;
        }
      }
    }
    return locator.findManagerByPredicate((manager) => looksLikeMarqueeManager(manager));
  }

  function wrapMarqueeDispatchListeners(): void {
    const events = asRecord(locator.dispatcher()?._events);
    if (!events) return;
    for (const eventName of Object.keys(events)) {
      if (!/MARQUEE/i.test(eventName)) continue;
      for (const listener of listenersOnEvent(events, eventName)) {
        const record = asRecord(listener);
        if (!record || wrappedMarqueeListenerRecords.has(record)) continue;
        const caller = asRecord(record.caller);
        const methodName = typeof record.method === 'string' ? record.method : null;
        if (!caller || !methodName || typeof caller[methodName] !== 'function') continue;
        if (patcher.wrap(caller, methodName, (original) => function (this: unknown, ...args: unknown[]) {
          if (isOn('block.noticeWindow')) {
            syncMarquee();
            return undefined;
          }
          return original.apply(this, args);
        })) {
          wrappedMarqueeListenerRecords.add(record);
        }
      }
    }
  }

  function tryInstallGedPersistentMarqueeHook(): void {
    let ged = locator.dispatcher();
    if (!ged || (gedPersistentMarqueeHooked && marqueeGedHookTarget === ged)) return;
    if (marqueeGedHookTarget && marqueeGedHookTarget !== ged) {
      gedPersistentMarqueeHooked = false;
    }
    if (!gedPersistentMarqueeHooked) {
      ged = refreshGameEventDispatcher(globalObject) ?? ged;
    }
    if (!ged) return;
    if (installPersistentMarqueeEventBlock(ged, () => isOn('block.noticeWindow'), () => scheduleSyncMarquee())) {
      marqueeGedHookTarget = ged;
      gedPersistentMarqueeHooked = true;
      dispatcherMarqueeGuardInstalled = true;
      if (isOn('block.noticeWindow')) syncMarquee();
    }
  }

  function ensureMarqueeFrameSweep(): void {
    if (marqueeFrameLoopBound || !isOn('block.noticeWindow')) return;
    marqueeFrameLoopBound = true;
    const sweepTimer = setInterval(() => {
      if (disposed || !isOn('block.noticeWindow')) return;
      syncMarquee();
    }, 500);
    cleanups.push(() => {
      clearInterval(sweepTimer);
      marqueeFrameLoopBound = false;
    });
  }

  function wrapMarqueeManagerInstance(manager: UnknownRecord): void {
    if (wrappedMarqueeManagerInstances.has(manager)) return;
    let wrappedAny = false;
    for (const method of MARQUEE_SHOW_METHODS) {
      if (typeof manager[method] !== 'function') continue;
      const ok = patcher.wrap(manager, method, (original) => function (this: unknown, ...args: unknown[]) {
        const result = original.apply(this, args);
        if (isOn('block.noticeWindow')) {
          syncMarquee();
          return undefined;
        }
        return result;
      });
      if (ok) wrappedAny = true;
    }
    if (wrappedAny) wrappedMarqueeManagerInstances.add(manager);
  }

  /** 与参考脚本 FB 一致：先挂上跑马灯管理器钩子，开关只决定藏不藏。 */
  function ensureNoticeManagerAttached(): void {
    if (disposed || noticeManagerPollActive) return;
    const readyManager = findMarqueeManager();
    if (readyManager && wrappedMarqueeManagerInstances.has(readyManager)) return;
    const generation = noticeManagerHookGeneration;
    noticeManagerPollActive = true;
    void poll(() => findMarqueeManager(), 120, 250).then((manager) => {
      noticeManagerPollActive = false;
      if (disposed || generation !== noticeManagerHookGeneration) return;
      if (!manager) return;
      wrapMarqueeManagerInstance(manager);
      bindMarqueeManager(manager);
      applyNoticeBlockState();
    });
  }

  function wrapMarqueeShowPrototype(prototype: UnknownRecord | null): void {
    if (!prototype || wrappedMarqueePrototypes.has(prototype)) return;
    let wrappedAny = false;
    for (const method of MARQUEE_SHOW_METHODS) {
      if (typeof prototype[method] !== 'function') continue;
      const ok = patcher.wrap(prototype, method, (original) => function (this: unknown, ...args: unknown[]) {
        const result = original.apply(this, args);
        if (isOn('block.noticeWindow')) {
          syncMarquee();
          return undefined;
        }
        return result;
      });
      if (ok) wrappedAny = true;
    }
    if (wrappedAny) wrappedMarqueePrototypes.add(prototype);
  }

  function wrapMarqueeManagersFromList(): void {
    const windowManager = locator.manager('WindowManager');
    const list = windowManager?.managerList;
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const record = asRecord(item);
      if (!record || !looksLikeMarqueeManager(record)) continue;
      wrapMarqueeShowPrototype(asRecord(Object.getPrototypeOf(record)));
      wrapMarqueeManagerInstance(record);
    }
  }

  function installDisplayAddChildGuard(): void {
    if (displayAddChildGuardWrapped) return;
    const classNames = ['Node', 'Sprite', 'Box', 'UIComponent', 'View'];
    let wrapped = false;
    for (const className of classNames) {
      const prototype = locator.classPrototype(className);
      if (!prototype || typeof prototype.addChild !== 'function') continue;
      if (patcher.wrap(prototype, 'addChild', (original) => function (this: unknown, child: unknown, ...rest: unknown[]) {
        const result = original.apply(this, [child, ...rest]);
        if (!isOn('block.noticeWindow') || isTableGameScene()) return result;
        const node = asRecord(child);
        if (node && isDogTuoBannerNode(node)) {
          scheduleSyncMarquee();
        }
        return result;
      })) wrapped = true;
    }
    if (wrapped) displayAddChildGuardWrapped = true;
  }

  function wrapChatSysNewsIngress(): void {
    if (chatSysNewsIngressWrapped) return;
    const manager = locator.manager('ChatSysNewsManager');
    const prototype = locator.classPrototype('ChatSysNewsManager')
      ?? (manager ? asRecord(Object.getPrototypeOf(manager)) : null);
    if (!prototype) return;
    let wrappedAny = false;
    for (const key of Object.getOwnPropertyNames(prototype)) {
      if (key === 'constructor' || typeof prototype[key] !== 'function') continue;
      const isChatIngress = /SSCChatmsg|ChatmsgNtf/i.test(key);
      const isMarqueeShow = MARQUEE_SHOW_METHODS.includes(key);
      if (!isChatIngress && !isMarqueeShow) continue;
      const ok = patcher.wrap(prototype, key, (original) => function (this: unknown, ...args: unknown[]) {
        if (!isOn('block.noticeWindow')) return original.apply(this, args);
        if (isMarqueeShow) {
          syncMarquee();
          return undefined;
        }
        const payload = asRecord(args[0]);
        const className = /decode/i.test(key) ? key : 'decodeSSCChatmsgNtf';
        if (payload && shouldDropNoticeProtocol(className, payload, Boolean(locator.gameScene()))) {
          return undefined;
        }
        return original.apply(this, args);
      });
      if (ok) wrappedAny = true;
    }
    if (wrappedAny) chatSysNewsIngressWrapped = true;
  }

  function installKnownMarqueePrototypes(): void {
    for (const className of MARQUEE_MANAGER_CLASS_NAMES) {
      wrapMarqueeShowPrototype(locator.classPrototype(className));
    }
    wrapMarqueeManagersFromList();
    wrapChatSysNewsIngress();
    const manager = findMarqueeManager();
    if (manager) wrapMarqueeShowPrototype(asRecord(Object.getPrototypeOf(manager)));
  }

  function bindMarqueeManager(manager: UnknownRecord): void {
    wrapMarqueeManagerInstance(manager);
    wrapMarqueeShowPrototype(asRecord(Object.getPrototypeOf(manager)));
    const dispatcher = locator.dispatcher();
    if (marqueeManager && marqueeManager !== manager && dispatcher) {
      MARQUEE_EVENTS.forEach((eventName) => (
        callMethod(dispatcher, 'off', eventName, marqueeManager, syncMarquee)
      ));
    }
    if (marqueeManager === manager && marqueeDispatcherHooksBound) {
      syncMarquee();
      return;
    }
    marqueeManager = manager;
    if (!marqueeDispatcherHooksBound) {
      marqueeDispatcherHooksBound = true;
      cleanups.push(() => {
        if (!dispatcher) return;
        MARQUEE_EVENTS.forEach((eventName) => (
          callMethod(dispatcher, 'off', eventName, manager, syncMarquee)
        ));
        marqueeBlocker.restoreAll();
        marqueeManager = null;
        marqueeDispatcherHooksBound = false;
      });
    }
    if (dispatcher) {
      MARQUEE_EVENTS.forEach((eventName) => callMethod(dispatcher, 'on', eventName, manager, syncMarquee));
    }
    syncMarquee();
  }

  /** 配置已为开、或运行时刚挂上钩子时，主动套用狗托屏蔽，不依赖用户再拨一次开关。 */
  function applyNoticeBlockState(): void {
    if (!isOn('block.noticeWindow')) {
      noticeManagerHookGeneration += 1;
      noticeManagerPollActive = false;
      marqueeBlocker.restoreAll();
      syncMarquee();
      return;
    }
    ensureNoticeManagerAttached();
    tickMarqueeBlock();
    later(() => tickMarqueeBlock(), 0);
    later(() => tickMarqueeBlock(), 400);
    later(() => tickMarqueeBlock(), 1200);
    later(() => tickMarqueeBlock(), 3000);
    ensureMarqueeFrameSweep();
  }

  function refreshMarqueeBlock(): void {
    applyNoticeBlockState();
  }

  function tickMarqueeBlock(): void {
    if (!isBackgroundUiScene(locator, globalObject)) return;
    tryInstallGedPersistentMarqueeHook();
    wrapMarqueeDispatchListeners();
    installDisplayAddChildGuard();
    installKnownMarqueePrototypes();
    const manager = findMarqueeManager();
    if (manager) bindMarqueeManager(manager);
    else syncMarquee();
    if (isOn('block.noticeWindow')) ensureMarqueeFrameSweep();
  }

  function installMarqueeSceneHooks(): void {
    const dispatcher = locator.dispatcher();
    if (!dispatcher) return;
    const onSceneChange = () => {
      later(() => refreshMarqueeBlock(), 0);
      later(() => refreshMarqueeBlock(), 800);
    };
    callMethod(dispatcher, 'on', 'SWITCH_SCENE', marqueeSceneHookOwner, onSceneChange);
    cleanups.push(() => callMethod(dispatcher, 'off', 'SWITCH_SCENE', marqueeSceneHookOwner, onSceneChange));
  }

  function dispatcherEventKeys(dispatcher: UnknownRecord): string[] {
    return typeof dispatcher.event === 'function' ? ['event'] : [];
  }

  let dispatcherMarqueeGuardInstalled = false;

  function tryInstallGameDispatcherMarqueeGuard(): void {
    if (gameDispatcherMarqueeGuardWrapped) return;
    const prototype = locator.classPrototype('GameEventDispatcher');
    if (!prototype || typeof prototype.event !== 'function') return;
    if (patcher.wrap(prototype, 'event', (original) => function (this: unknown, type: unknown, ...rest: unknown[]) {
      if (isOn('block.noticeWindow') && typeof type === 'string' && (
        /MARQUEE/i.test(type) || MARQUEE_EVENTS.includes(type)
      )) {
        scheduleSyncMarquee();
        return undefined;
      }
      return original.call(this, type, ...rest);
    })) {
      gameDispatcherMarqueeGuardWrapped = true;
      dispatcherMarqueeGuardInstalled = true;
    }
  }

  function tryInstallDispatcherMarqueeGuard(): void {
    tryInstallGedPersistentMarqueeHook();
    tryInstallGameDispatcherMarqueeGuard();
    if (gedPersistentMarqueeHooked) return;
    const dispatcher = locator.dispatcher();
    if (!dispatcher) return;
    for (const eventKey of dispatcherEventKeys(dispatcher)) {
      if (patcher.wrap(dispatcher, eventKey, (original) => function (this: unknown, type: unknown, ...rest: unknown[]) {
        if (isOn('block.noticeWindow') && typeof type === 'string' && (
          /MARQUEE/i.test(type) || MARQUEE_EVENTS.includes(type)
        )) {
          scheduleSyncMarquee();
          return undefined;
        }
        return original.call(this, type, ...rest);
      })) {
        dispatcherMarqueeGuardInstalled = true;
      }
    }
  }

  function ensureMarqueeBlockInstalled(): Promise<void> {
    if (!isBackgroundUiScene(locator, globalObject)) return Promise.resolve();
    if (!marqueeBlockInstallPromise) marqueeBlockInstallPromise = installMarqueeBlock();
    return marqueeBlockInstallPromise;
  }

  async function installMarqueeBlock(): Promise<void> {
    await poll(() => locator.dispatcher(), Infinity, 200);
    tryInstallDispatcherMarqueeGuard();
    installMarqueeSceneHooks();
    tickMarqueeBlock();
    await poll(() => findMarqueeManager(), 120, 250);
    tickMarqueeBlock();
    applyNoticeBlockState();
    ensureNoticeManagerAttached();
    const timer = setInterval(() => {
      if (disposed) return;
      const guardMissing = !dispatcherMarqueeGuardInstalled || !gedPersistentMarqueeHooked;
      if (guardMissing) tryInstallDispatcherMarqueeGuard();
      tickMarqueeBlock();
      ensureNoticeManagerAttached();
      if (isOn('block.noticeWindow') && (guardMissing || !marqueeFrameLoopBound)) {
        syncMarquee();
        ensureMarqueeFrameSweep();
      }
    }, 500);
    cleanups.push(() => clearInterval(timer));
  }

  let laoXianBlockInstalled = false;

  function installLaoXianBlock(): void {
    if (laoXianBlockInstalled) return;
    void poll(() => locator.classPrototype('TianShuWindow'), Infinity, 500).then((prototype) => {
      if (!prototype || laoXianBlockInstalled) return;
      laoXianBlockInstalled = patcher.wrap(prototype, 'updateWinUI', (original) => function (this: UnknownRecord, ...args) {
        const type = Number(asRecord(args[0])?.type);
        if (type === 6 && isOn('block.laoXianWindow')) return callMethod(this, 'Close');
        return original.apply(this, args);
      });
    });
  }

  // ---------- 局内/场景特效（原版 K5，每次切换场景重新检查） ----------

  let tableRewardPrototypeWrapped = false;

  function wrapTableRewardPointPrototype(prototype: UnknownRecord | null): void {
    if (!prototype || tableRewardPrototypeWrapped) return;
    if (typeof prototype.showGameRewardPointEffect2 !== 'function') return;
    tableRewardPrototypeWrapped = true;
    for (const [method, kind] of [
      ['showGameRewardPointEffect1', 'block.killEffect'],
      ['showGameRewardPointEffect3', 'block.killEffect'],
      ['showGameRewardPointEffect2', 'block.healEffect'],
      ['showGameRewardPointEffect5', 'block.healEffect']
    ] as const) {
      patcher.wrap(prototype, method, (original) => function (this: unknown, ...args) {
        if (!isOn(kind)) return original.apply(this, args);
        return undefined;
      });
    }
    for (const method of ['PlaySimpleShakeEffect', 'PlaySimpleShakeEffect2', 'PlayRuMoShakeEffect']) {
      patcher.wrap(prototype, method, (original) => function (this: unknown, ...args) {
        if (!isOn('block.shakeEffect') && !isOn('block.skillEffect')) return original.apply(this, args);
        return undefined;
      });
    }
  }

  function installSceneEffectPatches(): void {
    if (!isBackgroundUiScene(locator, globalObject)) return;
    void (async () => {
      const userInfo = await poll(
        () => userInfoManager() ?? locator.managerFromList((manager) => (
          typeof manager.CheckUserAvatarAnimate === 'function'
          && Array.isArray(manager.playedList)
          && Array.isArray(manager.fullAvatarShowUserList)
        )),
        60,
        100
      );
      patcher.wrap(userInfo, 'CheckUserAvatarAnimate', (original) => function (this: UnknownRecord, ...args) {
        const info = asRecord(args[0]);
        const played = this.playedList;
        if (
          !isOn('block.entranceEffect')
          || !info
          || !callMethod(this, 'IsInSeat', info.ClientId)
          || !Array.isArray(played)
          || played.indexOf(info.ClientId) >= 0
        ) {
          return original.apply(this, args);
        }
        played.push(info.ClientId);
        return undefined;
      });

      const legendManager = await poll(
        () => locator.managerFromList((manager) => (
          typeof manager.PlayLegendShow === 'function' && typeof manager.EndFullLegendShow === 'function'
        )),
        60,
        100
      );
      patcher.wrap(legendManager, 'PlayLegendShow', (original) => function (this: unknown, ...args) {
        if (!isOn('block.entranceEffect')) return original.apply(this, args);
        playNextLegendShow();
        return undefined;
      });

      const seatShowPrototype = await poll(() => {
        const seatList = asRecord(locator.scene()?.seatListView)?.seatList;
        const firstSeat = Array.isArray(seatList) ? asRecord(seatList[0]) : null;
        const prototype = asRecord(asRecord(firstSeat?.constructor)?.prototype);
        return typeof prototype?.PlaySeatShowAnimate === 'function' ? prototype : null;
      }, 60, 100);
      patcher.wrap(seatShowPrototype, 'PlaySeatShowAnimate', (original) => function (this: unknown, ...args) {
        if (!isOn('block.entranceEffect')) return original.apply(this, args);
        callMethod(this, 'clearAvatarAnimate');
        playNextLegendShow();
        return undefined;
      });

      wrapTableRewardPointPrototype(await poll(() => {
        const scene = locator.gameScene();
        if (!scene || typeof scene.showGameRewardPointEffect2 !== 'function') return null;
        return asRecord(Object.getPrototypeOf(scene));
      }, 60, 100));

      const seatPrototype = await poll(() => {
        const seat = asRecord(asRecord(locator.gameScene()?.SelfSeatUi)?.seat);
        const prototype = asRecord(asRecord(seat?.constructor)?.prototype);
        return typeof prototype?.ShowSkillAnimation === 'function' ? prototype : null;
      }, 60, 100);
      patcher.wrap(seatPrototype, 'ShowSkillAnimation', (original) => function (this: unknown, ...args) {
        if (!isOn('block.jinnangEffect') || !JINNANG_SKILL_IDS.has(Number(asRecord(args[0])?.ID))) {
          return original.apply(this, args);
        }
        return undefined;
      });

      const selfSeatPrototype = await poll(() => {
        const selfSeatUi = asRecord(locator.gameScene()?.SelfSeatUi);
        const prototype = asRecord(asRecord(selfSeatUi?.constructor)?.prototype);
        return typeof prototype?.ShowEffect === 'function' ? prototype : null;
      }, 60, 100);
      patcher.wrap(selfSeatPrototype, 'ShowEffect', (original) => function (this: unknown, ...args) {
        const [name, , hit] = args;
        if (!isOn('block.jinnangEffect') || (name !== 'nanmanhit' && name !== 'jiaoyin')) {
          return original.apply(this, args);
        }
        triggerHit(asRecord(hit));
        return undefined;
      });

      const effectPlayer = await poll(findEffectPlayer, 60, 100);
      if (effectPlayer) {
        patcher.wrap(effectPlayer, 'ShowEffect', (original) => function (this: unknown, ...args) {
          return isOn('block.jinnangEffect') && JINNANG_EFFECT_NAMES.has(String(args[0]))
            ? null
            : original.apply(this, args);
        });
        for (const method of ['PlayEffect', 'PlayEffectSYS']) {
          patcher.wrap(effectPlayer, method, (original) => function (this: unknown, ...args) {
            if (locator.gameScene()) {
              const data = asRecord(args[0]);
              const kind = data ? classifyPlayback(data.EffectPath, args[1] ?? data.AniName) : '';
              if (kindOn(kind)) {
                triggerHit(asRecord(args[2]));
                return null;
              }
            }
            if (!isOn('block.jinnangEffect') || !JINNANG_SKILL_IDS.has(Number(args[0]))) {
              return original.apply(this, args);
            }
            return undefined;
          });
        }
        for (const method of JINNANG_PLAY_METHODS) {
          patcher.wrap(effectPlayer, method, (original) => function (this: unknown, ...args) {
            if (!isOn('block.jinnangEffect')) return original.apply(this, args);
            return undefined;
          });
        }
      }

      const seatUiPrototype = await poll(() => {
        const selfSeatUi = asRecord(locator.gameScene()?.SelfSeatUi);
        const prototype = asRecord(asRecord(selfSeatUi?.constructor)?.prototype);
        return typeof prototype?.playCardSkillAnimate === 'function' ? prototype : null;
      }, 60, 100);
      patcher.wrap(seatUiPrototype, 'play2DHurtShaEffect', (original) => function (this: unknown, ...args) {
        if (locator.gameScene() && (isOn('block.shaEffect') || isOn('block.shakeEffect'))) return undefined;
        return original.apply(this, args);
      });
      patcher.wrap(seatUiPrototype, 'OnShowAttackedEffect', (original) => function (this: unknown, ...args) {
        if (locator.gameScene() && isOn('block.selectEffect')) return undefined;
        return original.apply(this, args);
      });
      patcher.wrap(seatUiPrototype, 'BaojiHurtStart', (original) => function (this: unknown, ...args) {
        const result = original.apply(this, args);
        if (locator.gameScene() && isOn('block.shakeEffect')) stripBaojiSlots(asRecord(asRecord(args[0])?.[0]));
        return result;
      });
      patcher.wrap(seatUiPrototype, 'playXDJXSkillEffect', (original) => function (this: unknown, ...args) {
        if (locator.gameScene() && isOn('block.skillEffect')) return undefined;
        return original.apply(this, args);
      });
      patcher.wrap(seatUiPrototype, 'playHurtShake', (original) => function (this: unknown, ...args) {
        if (locator.gameScene() && isOn('block.shakeEffect')) return undefined;
        return original.apply(this, args);
      });
      patcher.wrap(seatUiPrototype, 'playCardSkillAnimate', (original) => function (this: UnknownRecord, card: unknown, ...rest) {
        const kind = kindFromCard(asRecord(card) as never);
        if (kindOn(kind)) {
          if (kind === 'shan') callMethod(this, 'SetWanJianFlag', false);
          return undefined;
        }
        return original.call(this, card, ...rest);
      });
      patcher.wrap(seatUiPrototype, 'playGeneralSpEffect', (original) => function (this: UnknownRecord, ...args) {
        if (isOn('block.skillEffect') || skinBlocked(asRecord(this.seat))) return false;
        return original.apply(this, args);
      });
      patcher.wrap(seatUiPrototype, 'onPlayNewSpEffect', (original) => function (this: UnknownRecord, type: unknown, ...rest) {
        const seat = asRecord(this.seat);
        const skillTyped = [2, 4, 5].includes(Number(type)) && isOn('block.skillEffect');
        if (skinBlocked(seat) || skillTyped) return undefined;
        return original.call(this, type, ...rest);
      });
      patcher.wrap(asRecord(asRecord(locator.gameScene()?.SelfSeatUi)?.seat) && Object.getPrototypeOf(asRecord(locator.gameScene()?.SelfSeatUi)?.seat as object), 'DrawCards', (original) => function (this: unknown, ...args) {
        if (locator.gameScene() && isOn('block.jinnangEffect') && asRecord(args[5])?.SpellID === 7) args[6] = null;
        return original.apply(this, args);
      });

      const effectCtrl = asRecord(asRecord(locator.gameScene()?.SelfSeatUi)?.effectCtrl);
      const playbackTargets = [effectPlayer, asRecord(effectPlayer?.effectCtrl), effectCtrl]
        .filter((item, index, list) => item && list.indexOf(item) === index);
      for (const target of playbackTargets) {
        if (target) effectControllers.add(target);
        for (const method of ['ShowEffectByData', 'ShowEffectByDataWithJson', 'ShowMulitEffectByData']) {
          patcher.wrap(target, method, (original) => function (this: unknown, data: unknown, ...rest) {
            if (!locator.gameScene()) return original.call(this, data, ...rest);
            const multi = method === 'ShowMulitEffectByData';
            const animation = rest[multi ? 1 : 0];
            const hit = asRecord(rest[multi ? 2 : 1]);
            const record = asRecord(data);
            const kind = classifyPlayback(record?.EffectPath, animation ?? record?.AniName, () => '', record?.Sound);
            if (!kindOn(kind)) return original.call(this, data, ...rest);
            finishBlockedPlayback(record, hit, kind, method === 'ShowEffectByDataWithJson');
            return null;
          });
        }
      }
      if (effectPlayer) {
        const wrapSkill = (target: UnknownRecord | null) => {
          if (!target) return;
          skillEffects.add(target);
          patcher.wrap(target, 'PlayTriggerEffect', (play) => function (this: unknown, ...playArgs) {
            if (locator.gameScene() && isOn('block.skillEffect')) return undefined;
            return play.apply(this, playArgs);
          });
        };
        patcher.wrap(effectPlayer, 'GetHighQualitySkillEffect', (original) => function (this: unknown, ...args) {
          const created = original.apply(this, args);
          wrapSkill(asRecord(created));
          return created;
        });
        const existing = effectPlayer.highQualitySkillDic;
        if (existing && typeof (existing as { forEach?: unknown }).forEach === 'function') {
          (existing as { forEach: (fn: (value: unknown, key: unknown) => void) => void }).forEach((value) => {
            wrapSkill(asRecord(value));
          });
        }
      }

      installBaseEffectPatches();
      sweepLiveEffects();
    })();
  }

  /** 原版 y4：跳过南蛮/箭雨动画时仍需按原延迟触发受击。 */
  function triggerHit(hit: UnknownRecord | null, delay = Number(hit?.HitDelay) || 0): void {
    const trigger = hit?.HitTrigger;
    if (typeof trigger !== 'function') return;
    const once = globalObject.Laya?.timer?.once;
    if (delay > 0 && typeof once === 'function') once.call(globalObject.Laya?.timer, delay, null, trigger as () => void);
    else (trigger as () => void)();
  }

  function finishBlockedPlayback(
    data: UnknownRecord | null,
    hit: UnknownRecord | null,
    kind: string,
    useDataDelay: boolean
  ): void {
    const delay = Number((useDataDelay ? data?.HitDelay : hit?.HitDelay) || 0);
    triggerHit(hit, delay);
    if (kind !== 'skill' && typeof hit?.EndTrigger === 'function') hit.EndTrigger();
  }

  function stripBaojiSlots(effect: UnknownRecord | null): void {
    const slots = effect?._boneSlotArray;
    if (!Array.isArray(slots) || typeof effect?.replaceSlotSkinByIndex !== 'function') return;
    for (const slot of slots) {
      const record = asRecord(slot);
      const name = String(record?.name ?? '');
      if (/^1shuzi\/1shuzi_(?:00000|1[012])$/.test(name)) continue;
      const displays = asRecord(record?.currSlotData)?.displayArr;
      const count = Array.isArray(displays) ? displays.length : 0;
      for (let index = 0; index < count; index += 1) {
        callMethod(effect, 'replaceSlotSkinByIndex', name, index, -1);
      }
    }
  }

  function findEffectPlayer(): UnknownRecord | null {
    const events = asRecord(locator.dispatcher()?._events);
    if (!events) return null;
    for (const listeners of Object.values(events)) {
      for (const listener of Array.isArray(listeners) ? listeners : [listeners]) {
        const caller = asRecord(asRecord(listener)?.caller);
        if (typeof caller?.PlayNanManEffect === 'function' && typeof caller.GetHighQualitySkillEffect === 'function') {
          return caller;
        }
      }
    }
    return null;
  }

  /** 屏蔽入场等 BaseEffect；大厅中实例可能尚未出现，随场景切换重试。 */
  function installBaseEffectPatches(): void {
    const prototype = locator.baseEffectPrototype();
    if (!prototype) return;
    patcher.wrap(prototype, 'InitEffect', (original) => function (this: unknown, url: unknown, ...rest: unknown[]) {
      return original.call(this, replaceUrl(url), ...rest);
    });
    patcher.wrap(prototype, 'playEffect', (original) => function (this: UnknownRecord, ...args) {
      const effectUrl = this.effectUrl;
      if (isOn('block.entranceEffect') && typeof effectUrl === 'string' && effectUrl.includes('FX_SHT_SLCX')) {
        callMethod(asRecord(this._parent)?.currentBossCityItem, 'ShowBossIcon');
        callMethod(this, 'event', globalObject.Laya?.Event?.STOPPED ?? 'stopped');
        return undefined;
      }
      return original.apply(this, args);
    });
  }

  async function installBossCityEntranceBlock(): Promise<void> {
    const pveManager = await poll(() => locator.manager('RogueLikePveManager'), 40, 500);
    const changeWindowPrototype = await poll(() => locator.classPrototype('RogueComChangeWindow'), 40, 500);
    if (pveManager && changeWindowPrototype) {
      patcher.wrap(changeWindowPrototype, 'SetData', (original) => function (this: unknown, ...args) {
        let data = asRecord(args[0]);
        if (isOn('block.entranceEffect') && data?.onlyCallback && data.closetime == 2.1) {
          const cityView = asRecord(locator.scene()?.cityView);
          const bossItem = cityView?.currentBossCityItem;
          if (cityView?.IsBossShow && bossItem) callMethod(bossItem, 'ShowBossIcon');
          if (!data.notNeedCallBackEvent) callMethod(pveManager, 'event', pveManager.TRIGGER_CURRENT_EVENT);
          data = { ...data, closetime: 0, callback: null, notNeedCallBackEvent: true };
          return original.call(this, data);
        }
        return original.apply(this, args);
      });
    }
    const cityViewPrototype = await poll(() => {
      const cityView = asRecord(locator.scene()?.cityView);
      return asRecord(asRecord(cityView?.constructor)?.prototype);
    }, 40, 500);
    patcher.wrap(cityViewPrototype, 'ShowBossEffect', (original) => function (this: UnknownRecord, ...args) {
      if (!isOn('block.entranceEffect')) return original.apply(this, args);
      callMethod(this.bossEffect, 'stop');
      callMethod(this.bossEffect, 'destroy');
      this.bossEffect = null;
      callMethod(this.currentBossCityItem, 'ShowBossIcon');
      return undefined;
    });
  }

  // ---------- 场景切换 ----------

  async function installSceneSwitchHook(): Promise<void> {
    const sceneManager = await poll(findSceneManager);
    patcher.wrap(sceneManager, 'executeSwitchScene', (original) => function (this: unknown, ...args) {
      if (isBackgroundUiScene(locator, globalObject)) installSceneEffectPatches();
      const result = original.apply(this, args);
      const sceneName = asRecord(args[0])?.SceneName;
      if (sceneName) {
        later(() => {
          if (!isBackgroundUiScene(locator, globalObject)) return;
          if (sceneName === 'TableScene') installRecordViewTracker();
          installSceneEffectPatches();
          refreshMarqueeBlock();
        });
      }
      return result;
    });
  }

  function findSceneManager(): UnknownRecord | null {
    const listeners = asRecord(locator.dispatcher()?._events)?.SWITCH_SCENE;
    for (const listener of Array.isArray(listeners) ? listeners : [listeners]) {
      const caller = asRecord(asRecord(listener)?.caller);
      if (caller && 'CurrentScene' in caller) return caller;
    }
    return null;
  }

  /** 开关打开时清掉已经在播的选中、受击和武将动画，避免要等下一次才消失。 */
  function sweepLiveEffects(restoreSelect = false): void {
    const scene = locator.gameScene();
    const seats = asRecord(scene?.seatContainer)?.seatUIs ?? scene?.seatUIs;
    if (Array.isArray(seats)) {
      for (const item of seats) {
        const seatUi = asRecord(item);
        if (!seatUi) continue;
        const seat = asRecord(seatUi.seat);
        const seatEffect = asRecord(seatUi.effectCtrl);
        if (seatEffect) effectControllers.add(seatEffect);
        if (isOn('block.selectEffect')) {
          callMethod(seatUi.allowAttackEffect, 'destroy');
          seatUi.allowAttackEffect = null;
        } else if (restoreSelect && seat?.Selected) {
          callMethod(seatUi, 'OnShowAttackedEffect');
        }
        if (isOn('block.skillEffect') || skinBlocked(seat)) {
          callMethod(seatUi, 'clearOutAvatarAni');
          callMethod(seatUi, 'clearSkinSkillEffect');
        }
        const playingType = Number(seatUi.playingNewSpType);
        const skillTyped = [2, 4, 5].includes(playingType) && isOn('block.skillEffect');
        if (skinBlocked(seat) || skillTyped) {
          const playing = asRecord(seatUi.playingNewSpEffect);
          if (playing) {
            callMethod(seatUi, 'aniNewcallBack');
            callMethod(playing, 'destroy');
          }
          callMethod(seatUi, 'clearNewFullScreenEffect');
        }
        if (isOn('block.shakeEffect') && seatUi.hurtShakeTween) {
          callMethod(seatUi.hurtShakeTween, 'clear');
          seatUi.hurtShakeTween = null;
          callMethod(seatUi, 'setSeatPos', seatUi.seatX, seatUi.seatY, false);
        }
      }
    }
    if (isOn('block.skillEffect')) {
      const timer = asRecord(globalObject.Laya?.timer);
      const clearAll = timer?.clearAll;
      if (typeof clearAll === 'function') {
        for (const skill of skillEffects) clearAll.call(timer, skill);
      }
    }
    for (const player of effectControllers) {
      const parent = asRecord(player.parent);
      if (!parent || parent.destroyed) {
        effectControllers.delete(player);
        continue;
      }
      hideBlockedPlayingEffects(player);
    }
    if (scene && (isOn('block.shakeEffect') || isOn('block.skillEffect'))) {
      const killEffect = asRecord(scene.killEffect);
      const targets = killEffect?.shakeTargets;
      if (targets && typeof (targets as { forEach?: unknown }).forEach === 'function') {
        (targets as { forEach: (fn: (value: unknown, key: unknown) => void) => void }).forEach((_value, key) => {
          callMethod(key, 'clearAll');
        });
      }
      callMethod(scene, 'OnShakeEffectComplete');
    }
  }

  function hideBlockedPlayingEffects(player: UnknownRecord | null): void {
    if (!player) return;
    for (const bag of [player.effectDic, player.jsonEffectDic]) {
      if (!bag || typeof (bag as { forEach?: unknown }).forEach !== 'function') continue;
      const matched: Array<[unknown, UnknownRecord[]]> = [];
      (bag as { forEach: (fn: (value: unknown, key: unknown) => void) => void }).forEach((value, key) => {
        const list = Array.isArray(value) ? value : [];
        const blocked = list.some((item) => {
          const record = asRecord(item);
          const kind = classifyPlayback(asRecord(record?.EffectData)?.EffectPath, record?.effectName);
          return kindOn(kind);
        });
        if (blocked) matched.push([key, list.map((item) => asRecord(item) ?? {})]);
      });
      for (const [key, list] of matched) {
        const endings: Array<() => void> = [];
        for (const item of list) {
          const kind = classifyPlayback(asRecord(item.EffectData)?.EffectPath, item.effectName);
          if (kind !== 'skill' && typeof item.endTrigger === 'function') endings.push(item.endTrigger as () => void);
          item.endTrigger = null;
        }
        callMethod(player, 'HideEffect', key);
        endings.forEach((ending) => ending());
      }
    }
  }

  function installRecordViewTracker(): void {
    const scene = locator.scene();
    patcher.wrap(scene ? Object.getPrototypeOf(scene) : null, 'showRecordWindow', (original) => function (this: unknown, ...args) {
      manualRecordView = Boolean(args[0]);
      return original.apply(this, args);
    });
  }

  // ---------- 击杀、红点、资源 ----------

  let killEffectInstallStarted = false;

  function installKillEffectBlock(): void {
    if (killEffectInstallStarted || disposed) return;
    killEffectInstallStarted = true;
    void poll(findDetonationOwner, Infinity, 500).then((owner) => {
      if (!owner || disposed) return;
      const descriptor = Object.getOwnPropertyDescriptor(owner, 'ShowGameDetonationEffects');
      if (descriptor?.get) {
        patcher.wrapGetter(owner, 'ShowGameDetonationEffects', (originalGet) => () => (
          !isOn('block.killEffect') && originalGet()
        ));
        return;
      }
      if (!descriptor || !('value' in descriptor)) return;
      let stored = descriptor.value;
      const getter = () => (isOn('block.killEffect') ? false : stored);
      const setter = (value: unknown) => {
        stored = value;
      };
      try {
        Object.defineProperty(owner, 'ShowGameDetonationEffects', {
          configurable: true,
          enumerable: descriptor.enumerable,
          get: getter,
          set: setter
        });
        cleanups.push(() => {
          try {
            Object.defineProperty(owner, 'ShowGameDetonationEffects', descriptor);
          } catch {
            // 游戏随后又改过这个字段时，保留当前包装。
          }
        });
      } catch {
        // 字段不可改时，场景上的播报方法仍然会拦住。
      }
    });
  }

  function findDetonationOwner(): UnknownRecord | null {
    const browserWindow = asRecord(globalObject.Laya?.Browser?.window);
    const candidates = [
      globalObject.GameContext,
      browserWindow?.GameContext,
      locator.gameContext(),
      locator.managerFromList((item) => asRecord(item.constructor)?.name === 'GameContext')
    ];
    for (const candidate of candidates) {
      const owner = detonationPropertyOwner(candidate);
      if (owner) return owner;
    }
    return null;
  }

  function detonationPropertyOwner(candidate: unknown): UnknownRecord | null {
    const record = asRecord(candidate);
    if (!record) return null;
    const roots = [
      typeof candidate === 'function' ? record : null,
      asRecord(record.constructor),
      record,
      asRecord(Object.getPrototypeOf(record))
    ];
    const seen = new Set<UnknownRecord>();
    for (const root of roots) {
      let current = root;
      while (current && current !== Object.prototype && !seen.has(current)) {
        seen.add(current);
        if (Object.prototype.hasOwnProperty.call(current, 'ShowGameDetonationEffects')) return current;
        current = asRecord(Object.getPrototypeOf(current));
      }
    }
    return null;
  }

  function taskRedDotManager(): UnknownRecord | null {
    const fromEvent = locator.manager('TaskRedDotManager');
    const fromList = locator.managerFromList((item) => (
      typeof item.setNodeState === 'function' && Boolean(asRecord(item.tree)?.root)
    ));
    const candidates = [fromEvent, fromList].filter((item): item is UnknownRecord => Boolean(item));
    return candidates.find((item) => (
      typeof item.setNodeState === 'function' && Boolean(asRecord(asRecord(item.tree)?.root)?.state)
    )) ?? candidates.find((item) => typeof item.setNodeState === 'function') ?? null;
  }

  async function installRedDotBlock(): Promise<void> {
    const redDotManager = await poll(() => taskRedDotManager(), 40, 500);
    patcher.wrap(redDotManager, 'setNodeState', (original) => function (this: UnknownRecord, node: unknown, state: unknown) {
      if (node === Infinity) {
        activeLeafNodes(asRecord(this.tree)?.root).forEach((leaf) => original.call(this, leaf, 0));
        return undefined;
      }
      return original.call(this, node, isOn('block.taskRedDot') ? 0 : state);
    });
    if (isOn('block.taskRedDot')) clearAllRedDots();
  }

  function clearAllRedDots(): void {
    const manager = taskRedDotManager();
    if (!manager || typeof manager.setNodeState !== 'function') return;
    for (const leaf of activeLeafNodes(asRecord(manager.tree)?.root)) {
      callMethod(manager, 'setNodeState', leaf, 0);
    }
  }

  function installResourceRequestFilter(): void {
    const xhrPrototype = (globalObject as unknown as { XMLHttpRequest?: { prototype?: unknown } }).XMLHttpRequest?.prototype;
    patcher.wrap(xhrPrototype, 'open', (original) => function (this: unknown, method: unknown, url: unknown, ...rest: unknown[]) {
      return original.call(this, method, replaceUrl(url), ...rest);
    });
    const fetchFn = globalObject.fetch?.bind(globalObject);
    if (fetchFn) {
      const wrappedFetch = (input: unknown, init?: unknown) => fetchFn(rewriteFetchInput(input), init);
      globalObject.fetch = wrappedFetch as typeof globalObject.fetch;
      cleanups.push(() => {
        if (globalObject.fetch === wrappedFetch) globalObject.fetch = fetchFn as typeof globalObject.fetch;
      });
    }
    // 浏览器端骨骼多走 Laya.URL，不经过上面的 XHR 包装。
    void poll(() => asRecord(asRecord(globalObject.Laya)?.URL), Infinity, 500).then((urlApi) => {
      if (!urlApi || disposed) return;
      const previous = urlApi.customFormat;
      urlApi.customFormat = (url: unknown) => {
        const formatted = typeof previous === 'function' ? previous(url) : url;
        if (typeof formatted !== 'string') return formatted;
        return replaceUrl(formatted);
      };
      cleanups.push(() => {
        urlApi.customFormat = previous;
      });
    });
  }

  function rewriteFetchInput(input: unknown): unknown {
    if (typeof input === 'string') return replaceUrl(input);
    const request = globalObject.Request;
    if (typeof request === 'function' && input instanceof request) {
      const next = String(replaceUrl(input.url));
      return next === input.url ? input : new request(next, input);
    }
    return input;
  }

  // ---------- 协议 ----------

  function isOwnGeneral(generalId: number): boolean {
    if (!Number.isFinite(generalId)) return false;
    const seat = asRecord(asRecord(locator.gameScene()?.SelfSeatUi)?.seat);
    for (const key of SELF_GENERAL_KEYS) {
      const ids = seat?.[key];
      if (Array.isArray(ids)) return ids.some((id) => Number(id) === generalId);
    }
    return false;
  }

  function filterMessage(payload: UnknownRecord, className: string): void {
    applyBlockMessageFilters(payload, className, {
      killEffect: isOn('block.killEffect'),
      otherSkinState: isOn('block.otherSkinState'),
      factionSlogan: isOn('block.factionSlogan'),
      noticeWindow: isOn('block.noticeWindow'),
      inTableGame: Boolean(locator.gameScene()),
      isOwnGeneral
    });
  }

  unsubscribes.push(
    configStore.subscribe('block.adWindow', ({ value }) => {
      if (!value) return;
      closeBySwitch('block.adWindow', 6, 500);
      hideLobbyAd(3);
    }),
    configStore.subscribe('block.noticeWindow', () => {
      void ensureMarqueeBlockInstalled().then(() => applyNoticeBlockState());
    }),
    configStore.subscribe('block.taskRedDot', ({ value }) => {
      if (value) clearAllRedDots();
    }),
    ...([
      'block.shaEffect',
      'block.shanEffect',
      'block.healEffect',
      'block.jinnangEffect',
      'block.equipEffect',
      'block.shakeEffect',
      'block.skillEffect',
      'block.selectEffect',
      'block.selfSkinEffect',
      'block.otherSkinState',
      'block.killEffect'
    ] as const).map((key) => configStore.subscribe(key, () => {
      sweepLiveEffects(true);
    }))
  );

  // 工程入口早于游戏登录，管理器就绪后才安装其余补丁。
  void poll(() => {
    if (!isBackgroundUiScene(locator, globalObject)) return null;
    return locator.dispatcher() && locator.manager('WindowManager');
  }, Infinity, 1000).then((ready) => {
    if (!ready) return;
    installResourceRequestFilter();
    void ensureMarqueeBlockInstalled().then(() => {
      if (isOn('block.noticeWindow')) applyNoticeBlockState();
      installLaoXianBlock();
      const installers = [
        installWindowBlocks,
        installLobbyAdBlock,
        installSceneSwitchHook,
        installBossCityEntranceBlock,
        installKillEffectBlock,
        installRedDotBlock
      ];
      installers.forEach((install) => {
        void Promise.resolve(install()).catch((error: unknown) => console.warn('[屏蔽设置] 安装失败:', error));
      });
      installSceneEffectPatches();
      if (isOn('block.noticeWindow')) applyNoticeBlockState();
    });
  });

  const onConfigAccountOrNotice = (event: Event) => {
    const detail = (event as CustomEvent<{ key?: string }>).detail;
    if (detail?.key && detail.key !== 'block.noticeWindow' && !isOn('block.noticeWindow')) return;
    if (isOn('block.noticeWindow')) {
      void ensureMarqueeBlockInstalled().then(() => applyNoticeBlockState());
    }
  };
  globalObject.addEventListener?.(CONFIG_CHANGE_EVENT, onConfigAccountOrNotice);
  cleanups.push(() => globalObject.removeEventListener?.(CONFIG_CHANGE_EVENT, onConfigAccountOrNotice));

  void ensureMarqueeBlockInstalled().then(() => applyNoticeBlockState());

  function armNoticeBlock(): void {
    void ensureMarqueeBlockInstalled().then(() => applyNoticeBlockState());
  }

  function armAdBlock(): void {
    if (!isOn('block.adWindow')) return;
    closeBySwitch('block.adWindow', 8, 500);
    hideLobbyAd(3);
  }

  return {
    filterMessage,
    armNoticeBlock,
    armAdBlock,
    clearRedDots() {
      const manager = taskRedDotManager();
      if (typeof manager?.setNodeState !== 'function') return { found: false, count: 0 };
      const leaves = activeLeafNodes(asRecord(manager.tree)?.root);
      for (const leaf of leaves) callMethod(manager, 'setNodeState', leaf, 0);
      return { found: true, count: leaves.length };
    },
    dispose() {
      disposed = true;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
      cleanups.splice(0).forEach((cleanup) => cleanup());
      patcher.restoreAll();
    }
  };
}

/** 原版红点清理：广度遍历找出所有仍亮着的叶子。子节点只要有 filter 就走，不要求是普通数组。 */
function activeLeafNodes(root: unknown): unknown[] {
  const rootRecord = asRecord(root);
  if (!rootRecord?.state) return [];
  const leaves: unknown[] = [];
  const queue: UnknownRecord[] = [rootRecord];
  while (queue.length) {
    const node = queue.shift()!;
    const children = activeChildren(node);
    if (children.length) queue.push(...children);
    else leaves.push(node);
  }
  return leaves;
}

function activeChildren(node: UnknownRecord): UnknownRecord[] {
  const children = node.children as { filter?: (predicate: (child: unknown) => unknown) => unknown[] } | undefined;
  if (typeof children?.filter !== 'function') return [];
  return children.filter((child) => Boolean(asRecord(child)?.state))
    .map(asRecord)
    .filter((child): child is UnknownRecord => Boolean(child));
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

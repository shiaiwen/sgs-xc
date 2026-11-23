/**
 * 屏蔽特效/弹窗总控：按配置关闭广告、MVP、特效资源与协议字段改写。
 */

import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher, type MethodPatcher } from '../../runtime/method-patch.ts';
import { everyInterval } from '../../runtime/shared-ticker.ts';
import { MARQUEE_SWEEP_MS } from '../../const/poll-intervals.ts';
import { OPEN_WINDOW_EVENT } from '../../const/game-window-events.ts';
import { SKILL_SWITCH_SKIN_PLAY_TYPES } from '../../const/skin-play-type.ts';
import {
  EFFECT_CONTROLLER_ARGS,
  EFFECT_PLAYER_ARGS,
  MULTI_EFFECT_EXTRA_ARGS,
  type EffectPlaybackArgLayout
} from '../../const/effect-playback-args.ts';
import {
  isBackgroundUiScene,
  isOtherPlayerSkinMessage,
  isXiaochaoGameplayUiReady
} from '../skin-background/skin-runtime.ts';
import type { BlockSettingKey } from './block-effect-settings.ts';
import { applyBlockMessageFilters } from './block-message-filters.ts';
import { refreshGameEventDispatcher } from '../seat-display/game-scene-locator.ts';
import {
  collectManagedMarqueeNodes,
  createMarqueeVisibilityBlocker,
  findMarqueeManagerFromEvents,
  findMarqueeManagerFromPromptLayer,
  isMarqueeManager,
  MARQUEE_MANAGER_SYNC_METHODS
} from './marquee-visibility.ts';
import {
  hasAnyEffectResourceBlock,
  replaceBlockedEffectUrl,
  type EffectResourceFlags
} from './effect-resource-filter.ts';
import { classifyPlayback, kindFromCard, WUZHONG_SKILL_ID, type PlaybackKind } from './effect-playback.ts';
import { createProbWindowBlock } from './prob-window-block.ts';
import {
  PROB_WINDOW_INSTALL_INTERVAL_MS,
  PROB_WINDOW_INSTALL_RETRIES
} from '../../const/prob-window-block.ts';
import {
  isLobbyAdPushWindowName,
  LOBBY_AD_PUSH_WINDOW_NAMES,
  looksLikeAdPushCarouselWindow
} from '../../const/block-ad-window.ts';
import {
  HALL_TOOLBAR_WAIT_INTERVAL_MS,
  HALL_TOOLBAR_WAIT_RETRIES
} from '../../const/hall-toolbar-red-dot.ts';
import { isMvpBlockWindowName, MVP_BLOCK_WINDOW_NAMES } from '../../const/block-mvp-window.ts';
import {
  createMvpWindowBlock,
  scheduleMvpPrototypePatchInstall
} from './mvp-window-block.ts';

type UnknownRecord = Record<string, unknown>;

/** 锦囊技能动画与特效 ID（原版 y0/y1/y2）。 */
const JINNANG_SKILL_IDS = new Set([4, 5, 6, 8, 9, 10, 12, 13, 14, 15, 83, 84, 85]);
const JINNANG_EFFECT_NAMES = new Set(['tiesuo', 'huogong', 'wuxie']);
const JINNANG_PLAY_METHODS = [
  'PlayTiesuoEffect',
  'PlayHuoGongEffect',
  'PlayWuxieEffect',
  'PlayShunshouEffect',
  'PlayJuedouEffect',
  'PlayTaoyuanEffect'
];
const EFFECT_PLAYBACK_METHODS = ['ShowEffectByData', 'ShowEffectByDataWithJson', 'ShowMulitEffectByData'];
const LOBBY_AD_BUTTON_TYPE = 0x27cb;
/** 显示后需要处理的窗口及其对应开关；未开启时不轮询窗口。 */
const SHOWN_WINDOW_SWITCHES: Record<string, BlockSettingKey> = {
  AdPushWindow: 'block.adWindow',
  VersionNoticeWindow: 'block.adWindow',
  GameMvpWindow: 'block.mvpWindow',
  GeneralOpenResultWindow: 'block.packageWindow',
  SkinOpenResultWindowNew: 'block.packageWindow',
  OldbackOneClickDrawAwdWin: 'block.packageWindow',
  SelectSkinWindow: 'block.packageWindow'
};

for (const mvpWindowName of MVP_BLOCK_WINDOW_NAMES) {
  SHOWN_WINDOW_SWITCHES[mvpWindowName] = 'block.mvpWindow';
}

for (const adWindowName of LOBBY_AD_PUSH_WINDOW_NAMES) {
  SHOWN_WINDOW_SWITCHES[adWindowName] = 'block.adWindow';
}

const CLOSE_BY_SWITCH: Partial<Record<BlockSettingKey, string>> = {
  'block.adWindow': 'AdPushWindow'
};

export interface BlockEffectsController {
  /** 协议分发前调用，按开关改写击杀、皮肤状态与势力口号消息。 */
  filterMessage(payload: UnknownRecord, className: string): void;
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
  // 座位补丁挂在当前牌局的每个座位上，换局或离开牌局时整批撤掉，不攥着上一局的座位。
  const seatPatcher = createMethodPatcher();
  const seatEffectControllers = new Set<UnknownRecord>();
  const seatNamePatcher = createMethodPatcher();
  // 技能特效补丁挂在每局新创建的特效实例上，换局时整批撤掉，不攥着上一局的特效实例。
  const skillEffectPatcher = createMethodPatcher();
  let seatPatchScene: UnknownRecord | null = null;
  let manualRecordView = false;
  let disposed = false;
  let hallToolbarWaitToken = 0;

  const mvpWindowBlock = createMvpWindowBlock({
    locator,
    patcher,
    globalObject,
    enabled: () => isOn('block.mvpWindow'),
    isDisposed: () => disposed,
    later,
    poll,
    consumeManualRecordView: () => {
      if (!manualRecordView) return false;
      manualRecordView = false;
      return true;
    },
    onOpenWindow: (windowName) => mvpWindowBlock.dismissSettlementWindow(windowName)
  });
  cleanups.push(() => mvpWindowBlock.dispose());

  if (options.gameEvents) {
    unsubscribes.push(options.gameEvents.subscribe((event) => {
      if (event.type === 'game-ended') {
        skillEffectPatcher.restoreAll();
        skillEffects.clear();
        if (isOn('block.mvpWindow')) {
          for (const name of MVP_BLOCK_WINDOW_NAMES) {
            mvpWindowBlock.dismissSettlementWindow(name);
          }
        }
      }
      if (isOn('block.noticeWindow') && (event.type === 'game-started' || event.type === 'game-reconnected')) {
        applyNoticeBlockState();
      }
    }));
  }

  const isOn = (key: BlockSettingKey) => configStore.get(key) === true;
  const probWindowBlock = createProbWindowBlock({
    locator,
    patcher,
    globalObject,
    enabled: () => isOn('block.probWindow')
  });
  const resourceFlags = (): EffectResourceFlags => ({
    sha: isOn('block.shaEffect'),
    shan: isOn('block.shanEffect'),
    heal: isOn('block.healEffect')
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
  const skinPlayBlocked = (seat: UnknownRecord | null, type: unknown) => skinBlocked(seat)
    || (SKILL_SWITCH_SKIN_PLAY_TYPES.has(Number(type)) && isOn('block.skillEffect'));
  const replaceUrl = (url: unknown) => {
    if (typeof url !== 'string' || url.length === 0) return url;
    const flags = resourceFlags();
    return hasAnyEffectResourceBlock(flags) ? replaceBlockedEffectUrl(url, flags) : url;
  };

  /** 大厅或牌局已就绪。登录后直接进的模式大厅不算背景页，也要装屏蔽。 */
  function isBlockUiReady(): boolean {
    return isBackgroundUiScene(locator, globalObject) || isXiaochaoGameplayUiReady(locator, globalObject);
  }

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

  function resolveOpenWindowName(event: unknown): string {
    if (typeof event === 'string') return event;
    const record = asRecord(event);
    if (typeof record?.WindowName === 'string') return record.WindowName;
    if (typeof record?.windowName === 'string') return record.windowName;
    return '';
  }

  async function handleShownWindow(name: string): Promise<void> {
    const key = SHOWN_WINDOW_SWITCHES[name];
    if (!key || !isOn(key)) return;
    const win = await poll(() => locator.window(name) ?? locator.findWindows(name)[0]);
    if (!win) return;
    await poll(() => !win.isShowWait);
    if (win.destroyed || disposed) return;
    if (isLobbyAdPushWindowName(name)) {
      closeBySwitch('block.adWindow');
      return;
    }
    switch (name) {
      case 'VersionNoticeWindow':
        callMethod(win, 'Close');
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
    scheduleMvpPrototypePatchInstall(mvpWindowBlock, poll, later, () => disposed);
    mvpWindowBlock.ensureOpenWindowListener();
    mvpWindowBlock.ensureShowWindowHook();

    void poll(() => probWindowBlock.install() === 0, PROB_WINDOW_INSTALL_RETRIES, PROB_WINDOW_INSTALL_INTERVAL_MS);

    const dispatcher = await poll(() => locator.dispatcher());
    if (disposed || typeof dispatcher?.on !== 'function') return;

    const onOpenWindow = (event: unknown) => {
      const windowName = resolveOpenWindowName(event);
      if (!windowName) return;
      if (probWindowBlock.isProbWindow(windowName)) probWindowBlock.install();
      if (isOn('block.adWindow') && isLobbyAdPushWindowName(windowName)) {
        later(() => closeBySwitch('block.adWindow'));
      }
      if (isMvpBlockWindowName(windowName)) return;
      if (SHOWN_WINDOW_SWITCHES[windowName]) later(() => void handleShownWindow(windowName));
    };
    try {
      (dispatcher.on as (...args: unknown[]) => void).call(dispatcher, OPEN_WINDOW_EVENT, null, onOpenWindow);
      cleanups.push(() => {
        try {
          (dispatcher.off as (...args: unknown[]) => void).call(dispatcher, OPEN_WINDOW_EVENT, null, onOpenWindow);
        } catch {
          // 分发器已销毁时忽略。
        }
      });
    } catch {
      // 分发器不支持监听时不屏蔽开窗类弹窗。
    }
  }

  async function installLobbyAdBlock(): Promise<void> {
    patcher.wrap(locator.classPrototype('ModeScene'), 'showAdView', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      const result = original.apply(this, args);
      if (isOn('block.adWindow')) {
        hideLobbyAd(0);
        hideHomeBanner(this);
      }
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
    syncHomeBanner();
  }

  /** 首页轮播横幅：开关打开时藏掉 ModeScene 的 adBanner，关掉时恢复显示。 */
  function syncHomeBanner(): void {
    const scenes = [locator.scene(), ...locator.findInLayer('SceneLayer', 'ModeScene')];
    for (const item of scenes) {
      const banner = asRecord(asRecord(item)?.adBanner);
      if (!banner || banner.destroyed) continue;
      banner.visible = !isOn('block.adWindow');
    }
  }

  function hideHomeBanner(scene?: UnknownRecord | null): void {
    if (!isOn('block.adWindow')) return;
    const items = scene ? [scene] : [locator.scene(), ...locator.findInLayer('SceneLayer', 'ModeScene')];
    for (const item of items) {
      const banner = asRecord(asRecord(item)?.adBanner);
      if (!banner || banner.destroyed) continue;
      banner.visible = false;
    }
  }

  // ---------- 狗托（顶部跑马灯） ----------

  let stopMarqueeSweep: (() => void) | undefined;
  const hookedMarqueeManagers = new WeakSet<UnknownRecord>();
  cleanups.push(() => {
    stopMarqueeSweep?.();
    marqueeBlocker.restoreAll();
  });

  function resolveMarqueeManager(): UnknownRecord | null {
    const dispatcher = locator.dispatcher() ?? refreshGameEventDispatcher(globalObject);
    return findMarqueeManagerFromEvents(dispatcher)
      ?? locator.findManagerByPredicate(isMarqueeManager)
      ?? findMarqueeManagerFromPromptLayer(locator.layer('PromptLayer'));
  }

  function syncManagedMarquee(): void {
    const manager = resolveMarqueeManager();
    if (manager && !hookedMarqueeManagers.has(manager)) {
      hookedMarqueeManagers.add(manager);
      // 保留原方法的队列与计时器，在它创建展示节点后立即同步显隐。
      for (const key of MARQUEE_MANAGER_SYNC_METHODS) {
        if (typeof manager[key] !== 'function') continue;
        patcher.wrap(manager, key, (original) => function (this: UnknownRecord, ...args: unknown[]) {
          const result = original.apply(this, args);
          if (isOn('block.noticeWindow')) {
            marqueeBlocker.sync(collectManagedMarqueeNodes(this));
          }
          return result;
        });
      }
    }
    if (isOn('block.noticeWindow')) {
      marqueeBlocker.sync(collectManagedMarqueeNodes(manager));
    }
  }

  function applyNoticeBlockState(): void {
    if (disposed) return;
    if (!isOn('block.noticeWindow')) {
      stopMarqueeSweep?.();
      stopMarqueeSweep = undefined;
      marqueeBlocker.restoreAll();
      return;
    }
    stopMarqueeSweep ??= everyInterval(
      '顶部跑马灯',
      MARQUEE_SWEEP_MS,
      syncManagedMarquee,
      { visualOnly: true },
      globalObject
    );
    syncManagedMarquee();
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
    if (!isBlockUiReady()) return;
    void poll(() => locator.gameScene()?.SelfSeatUi, 60, 100).then(() => {
      patchSceneSeats(locator.gameScene());
    });
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
              const kind = data ? classifyPlayback(data.EffectPath, args[1] ?? data.AniName, () => '', data.Sound) : '';
              if (kindOn(kind)) {
                triggerHit(asRecord(args[2]));
                return null;
              }
            }
            if (!isOn('block.jinnangEffect') || Number(args[0]) === WUZHONG_SKILL_ID
              || !JINNANG_SKILL_IDS.has(Number(args[0]))) {
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

      wrapPlaybackMethods(patcher, effectPlayer, EFFECT_PLAYER_ARGS);
      const playerEffectCtrl = asRecord(effectPlayer?.effectCtrl);
      wrapPlaybackMethods(patcher, playerEffectCtrl, EFFECT_CONTROLLER_ARGS);
      if (playerEffectCtrl) effectControllers.add(playerEffectCtrl);
      if (effectPlayer) {
        const wrapSkill = (target: UnknownRecord | null) => {
          if (!target) return;
          skillEffects.add(target);
          skillEffectPatcher.wrap(target, 'PlayTriggerEffect', (play) => function (this: unknown, ...playArgs) {
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

  /** 其他人的座位和自己的座位不是同一个类，补丁要挂在每个座位实例上才对所有人生效。 */
  function patchSceneSeats(scene: UnknownRecord | null): void {
    if (disposed) return;
    if (scene !== seatPatchScene) {
      seatPatcher.restoreAll();
      seatEffectControllers.clear();
      seatPatchScene = scene;
      // 同一个牌局场景里重开一局、断线重连会重建座位，建完再补挂。
      seatPatcher.wrap(scene, 'initSeatUis', (original) => function (this: unknown, ...args) {
        const result = original.apply(this, args);
        try {
          patchSeatUis(asRecord(this));
        } catch (error) {
          console.warn('[屏蔽设置] 座位补丁安装失败:', error);
        }
        return result;
      });
    }
    patchSeatUis(scene);
  }

  function patchSeatUis(scene: UnknownRecord | null): void {
    if (!scene || scene !== seatPatchScene) return;
    for (const seatUi of sceneSeatUis(scene)) patchSeatUi(seatUi);
  }

  function sceneSeatUis(scene: UnknownRecord): UnknownRecord[] {
    const seatUis = asRecord(scene.seatContainer)?.seatUIs ?? scene.seatUIs;
    const found: UnknownRecord[] = [];
    for (const candidate of [scene.SelfSeatUi, ...(Array.isArray(seatUis) ? seatUis : [])]) {
      const seatUi = asRecord(candidate);
      if (seatUi && !found.includes(seatUi)) found.push(seatUi);
    }
    return found;
  }

  function patchSeatUi(seatUi: UnknownRecord): void {
    seatPatcher.wrap(seatUi, 'ShowEffect', (original) => function (this: unknown, ...args) {
      const [name, , options] = args;
      if (!isOn('block.jinnangEffect') || (name !== 'nanmanhit' && name !== 'jiaoyin')) {
        return original.apply(this, args);
      }
      triggerHit(asRecord(options));
      return undefined;
    });
    seatPatcher.wrap(seatUi, 'play2DHurtShaEffect', (original) => function (this: unknown, ...args) {
      if (locator.gameScene() && (isOn('block.shaEffect') || isOn('block.shakeEffect'))) return undefined;
      return original.apply(this, args);
    });
    seatPatcher.wrap(seatUi, 'OnShowAttackedEffect', (original) => function (this: unknown, ...args) {
      if (locator.gameScene() && isOn('block.selectEffect')) return undefined;
      return original.apply(this, args);
    });
    seatPatcher.wrap(seatUi, 'BaojiHurtStart', (original) => function (this: unknown, ...args) {
      const result = original.apply(this, args);
      if (locator.gameScene() && isOn('block.shakeEffect')) stripBaojiSlots(asRecord(asRecord(args[0])?.[0]));
      return result;
    });
    seatPatcher.wrap(seatUi, 'playXDJXSkillEffect', (original) => function (this: unknown, ...args) {
      if (locator.gameScene() && isOn('block.skillEffect')) return undefined;
      return original.apply(this, args);
    });
    seatPatcher.wrap(seatUi, 'playHurtShake', (original) => function (this: unknown, ...args) {
      if (locator.gameScene() && isOn('block.shakeEffect')) return undefined;
      return original.apply(this, args);
    });
    seatPatcher.wrap(seatUi, 'playCardSkillAnimate', (original) => function (this: UnknownRecord, card: unknown, ...rest) {
      const kind = kindFromCard(asRecord(card) as never);
      if (kindOn(kind)) {
        if (kind === 'shan') callMethod(this, 'SetWanJianFlag', false);
        return undefined;
      }
      return original.call(this, card, ...rest);
    });
    seatPatcher.wrap(seatUi, 'playGeneralSpEffect', (original) => function (this: UnknownRecord, ...args) {
      if (isOn('block.skillEffect') || skinBlocked(asRecord(this.seat))) return false;
      return original.apply(this, args);
    });
    seatPatcher.wrap(seatUi, 'onPlayNewSpEffect', (original) => function (this: UnknownRecord, type: unknown, ...rest) {
      if (skinPlayBlocked(asRecord(this.seat), type)) return undefined;
      return original.call(this, type, ...rest);
    });
    patchSeatEmotion(seatUi);
    const effectCtrl = seatEffectController(seatUi);
    if (!effectCtrl) return;
    seatEffectControllers.add(effectCtrl);
    wrapPlaybackMethods(seatPatcher, effectCtrl, EFFECT_CONTROLLER_ARGS);
  }

  /** 动画表情屏蔽：别人座位不播放大表情。 */
  function patchSeatEmotion(seatUi: UnknownRecord): void {
    const emotionProto = prototypeOwningMethod(seatUi, 'ShowBigFace');
    seatNamePatcher.wrap(emotionProto, 'ShowBigFace', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      if (isOn('block.chatEmotion') && asRecord(this.seat)?.IsSelf !== true) return undefined;
      return original.apply(this, args);
    });
  }

  /**
   * 座位的特效控制器在第一次用到时才建，建的时候记下座位的特效层。
   * 特效层还没建好就提前取，这个座位之后的特效都画不出来。
   */
  function seatEffectController(seatUi: UnknownRecord): UnknownRecord | null {
    const existing = asRecord(seatUi.effectCtrl);
    if (existing) return existing;
    if (!seatUi.stateEffectSprite || !seatUi.effectSprite) return null;
    return asRecord(seatUi.EffectCtrl);
  }

  function wrapPlaybackMethods(
    methodPatcher: MethodPatcher,
    target: UnknownRecord | null,
    layout: EffectPlaybackArgLayout
  ): void {
    for (const method of EFFECT_PLAYBACK_METHODS) {
      const shift = method === 'ShowMulitEffectByData' ? MULTI_EFFECT_EXTRA_ARGS : 0;
      methodPatcher.wrap(target, method, (original) => function (this: unknown, ...args) {
        if (!locator.gameScene()) return original.apply(this, args);
        const data = asRecord(args[0]);
        const name = layout.nameIndex === null ? '' : args[layout.nameIndex + shift];
        const kind = classifyPlayback(data?.EffectPath, name || data?.AniName, () => '', data?.Sound);
        if (!kindOn(kind)) return original.apply(this, args);
        const options = asRecord(args[layout.optionsIndex + shift]);
        finishBlockedPlayback(data, options, kind, method === 'ShowEffectByDataWithJson');
        return null;
      });
    }
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
    const delay = Number((useDataDelay ? data?.HitDelay : hit?.HitDelay || data?.HitDelay) || 0);
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

  function installRecordViewTracker(): void {
    const scene = locator.scene();
    patcher.wrap(scene ? Object.getPrototypeOf(scene) : null, 'showRecordWindow', (original) => function (this: unknown, ...args) {
      manualRecordView = Boolean(args[0]);
      return original.apply(this, args);
    });
  }

  // ---------- 场景切换 ----------

  async function installSceneSwitchHook(): Promise<void> {
    const sceneManager = await poll(findSceneManager);
    patcher.wrap(sceneManager, 'executeSwitchScene', (original) => function (this: unknown, ...args) {
      if (isBlockUiReady()) installSceneEffectPatches();
      const result = original.apply(this, args);
      const sceneName = asRecord(args[0])?.SceneName;
      if (sceneName) {
        later(() => {
          patchSceneSeats(locator.gameScene());
          armHallToolbarRedDots();
          if (!isBlockUiReady()) return;
          if (sceneName === 'TableScene') installRecordViewTracker();
          installSceneEffectPatches();
          applyNoticeBlockState();
          mvpWindowBlock.ensureOpenWindowListener();
          mvpWindowBlock.ensureShowWindowHook();
          mvpWindowBlock.installPrototypePatches();
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
    patchSceneSeats(scene);
    for (const seatUi of scene ? sceneSeatUis(scene) : []) {
      const seat = asRecord(seatUi.seat);
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
      if (skinPlayBlocked(seat, seatUi.playingNewSpType)) {
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
    if (isOn('block.skillEffect')) {
      const timer = asRecord(globalObject.Laya?.timer);
      const clearAll = timer?.clearAll;
      if (typeof clearAll === 'function') {
        for (const skill of skillEffects) clearAll.call(timer, skill);
      }
    }
    for (const players of [effectControllers, seatEffectControllers]) {
      for (const player of players) {
        const parent = asRecord(player.parent);
        if (!parent || parent.destroyed) {
          players.delete(player);
          continue;
        }
        hideBlockedPlayingEffects(player);
      }
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
      typeof item.setNodeState === 'function' && Boolean(asRecord(item.tree)?.Root)
    ));
    const candidates = [fromEvent, fromList].filter((item): item is UnknownRecord => Boolean(item));
    return candidates.find((item) => (
      typeof item.setNodeState === 'function' && Boolean(asRecord(asRecord(item.tree)?.Root)?.state)
    )) ?? candidates.find((item) => typeof item.setNodeState === 'function') ?? null;
  }

  async function installRedDotBlock(): Promise<void> {
    const redDotManager = await poll(() => taskRedDotManager(), 40, 500);
    // 参考脚本拦的是 tree.SetNodeState（大写 S），不是 manager.setNodeState。
    const tree = asRecord(redDotManager?.tree);
    patcher.wrap(tree, 'SetNodeState', (original) => function (this: UnknownRecord, node: unknown, state: unknown) {
      return original.call(this, node, isOn('block.taskRedDot') ? 0 : state);
    });
    installHallRedDotBlock();
    if (isOn('block.taskRedDot')) clearAllRedDots();
  }

  /** 大厅右上角图标（活动日历/公告/任务/官阶）上的小红点。 */
  function installHallRedDotBlock(): void {
    const calendar = locator.managerFromList((manager) => typeof manager?.GetSpecialActivityCalendar === 'function');
    const notice = locator.managerFromList((manager) => typeof manager?.getActiveNotice === 'function');
    const tasks = locator.managerFromList((manager) => manager !== null && 'ShowNewAdNoticeRed' in manager);
    const power = locator.managerFromList((manager) => typeof manager?.ShowPowerEntryWin === 'function');

    // 方法级：屏蔽时返回假，让图标不亮红点。
    for (const [target, method] of [[calendar, 'IsReddot'], [power, 'HasRedDot']] as const) {
      if (!target) continue;
      patcher.wrap(target, method, (original) => function (this: UnknownRecord, ...args: unknown[]) {
        return !isOn('block.taskRedDot') && original.apply(this, args);
      });
    }
    // getter 级：NoticeRed / ShowNewAdNoticeRed 挂在原型上，在实例上覆盖回去。
    for (const [target, key] of [[notice, 'NoticeRed'], [tasks, 'ShowNewAdNoticeRed']] as const) {
      if (target) blockPrototypeGetter(target, key);
    }
    armHallToolbarRedDots();
  }

  /**
   * 工具栏随大厅场景新建，登录后和每次回大厅都比屏蔽模块安装得晚；
   * 一直等到它出现再挂上，建的时候已经亮过一次红点，挂上后马上重算。
   */
  function armHallToolbarRedDots(): void {
    const token = ++hallToolbarWaitToken;
    void poll(() => {
      if (token !== hallToolbarWaitToken) return true;
      const toolbar = hallToolbar();
      if (typeof toolbar?.checkMoreRed !== 'function') return false;
      if (!patcher.isWrapped(toolbar, 'checkMoreRed')) {
        installMoreMenuRedDotBlock(toolbar);
        if (isOn('block.taskRedDot')) callMethod(toolbar, 'moreUpdate');
      }
      return true;
    }, HALL_TOOLBAR_WAIT_RETRIES, HALL_TOOLBAR_WAIT_INTERVAL_MS);
  }

  function blockPrototypeGetter(instance: UnknownRecord, key: string): void {
    if (Object.prototype.hasOwnProperty.call(instance, key)) return;
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(instance), key);
    if (!descriptor?.get) return;
    const originalGet = descriptor.get;
    try {
      Object.defineProperty(instance, key, {
        ...descriptor,
        get(this: unknown) {
          return !isOn('block.taskRedDot') && (originalGet as () => unknown).call(this);
        }
      });
      cleanups.push(() => {
        try {
          delete instance[key];
        } catch {
          // 实例已销毁时忽略。
        }
      });
    } catch {
      // 覆盖不了就跳过这个图标。
    }
  }

  function hallToolbar(): UnknownRecord | null {
    const scene = asRecord(locator.scene());
    return asRecord(scene?.hallToolbar) ?? asRecord(scene?.toolBar);
  }

  /** 大厅右下角「更多」按钮的红点，以及展开菜单里各入口的红点和数字角标。 */
  function installMoreMenuRedDotBlock(toolbar: UnknownRecord | null): void {
    patcher.wrap(toolbar, 'checkMoreRed', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      const moreView = asRecord(this.moreView);
      if (moreView) installMoreViewRedDotBlock(moreView);
      const hasRed = original.apply(this, args);
      return !isOn('block.taskRedDot') && hasRed;
    });
  }

  /** 菜单是第一次点「更多」时才建的，建好后游戏紧接着会重算一次红点，在那时挂上。 */
  function installMoreViewRedDotBlock(moreView: UnknownRecord): void {
    patcher.wrap(moreView, 'UpdateRedPoint', (original) => function (this: unknown, funcId: unknown, show: unknown) {
      return original.call(this, funcId, isOn('block.taskRedDot') ? false : show);
    });
    patcher.wrap(moreView, 'UpdateNumRedPoint', (original) => function (this: unknown, funcId: unknown, count: unknown) {
      return original.call(this, funcId, isOn('block.taskRedDot') ? 0 : count);
    });
  }

  /** 重新算一遍大厅图标红点，屏蔽开关切换后让右上角立即更新。 */
  function refreshHallRedDots(): void {
    const toolbar = hallToolbar();
    installMoreMenuRedDotBlock(toolbar);
    callMethod(toolbar, 'moreUpdate');
  }

  function clearAllRedDots(): void {
    const manager = taskRedDotManager();
    if (!manager || typeof manager.setNodeState !== 'function') return;
    for (const node of activeRedDotNodes(asRecord(manager.tree)?.Root)) {
      callMethod(manager, 'setNodeState', node, 0);
    }
    refreshHallRedDots();
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

  function filterMessage(payload: UnknownRecord, className: string): void {
    applyBlockMessageFilters(payload, className, {
      killEffect: isOn('block.killEffect'),
      otherSkinState: isOn('block.otherSkinState'),
      factionSlogan: isOn('block.factionSlogan'),
      chatEmotion: isOn('block.chatEmotion'),
      isOtherPlayerSkinMessage: (message) => isOtherPlayerSkinMessage(locator, message),
      isOtherPlayerBigFaceMessage: (message) => isOtherPlayerBigFaceMessage(message)
    });
  }

  /** 聊天消息是不是别的玩家发的大表情。认不准时返回 false，不改。 */
  function isOtherPlayerBigFaceMessage(message: UnknownRecord): boolean {
    const chatManager = gameClass('ChatManager');
    const userData = gameClass('UserData');
    const spoker = message.SpokerMan ?? message.spokerMan;
    if (typeof userData?.IsSelf === 'function' && userData.IsSelf(spoker)) return false;
    if (typeof chatManager?.IsBigFaceMsg !== 'function') return false;
    const chatMsg = message.chatMsg ?? message.ChatMsg ?? '';
    try {
      return chatManager.IsBigFaceMsg({ ...message, chatMsg }) === true;
    } catch {
      return false;
    }
  }

  function gameClass(className: string): UnknownRecord | null {
    const classUtils = asRecord(globalObject.Laya?.ClassUtils);
    const getClass = classUtils?.getClass;
    return typeof getClass === 'function' ? asRecord(getClass.call(classUtils, className)) : null;
  }

  unsubscribes.push(
    configStore.subscribe('block.adWindow', ({ value }) => {
      if (!value) {
        syncHomeBanner();
        return;
      }
      closeBySwitch('block.adWindow', 6, 500);
      hideLobbyAd(3);
      hideHomeBanner();
    }),
    configStore.subscribe('block.noticeWindow', applyNoticeBlockState),
    configStore.subscribe('block.taskRedDot', ({ value }) => {
      if (value) clearAllRedDots();
      else refreshHallRedDots();
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
    if (!isBlockUiReady()) return null;
    return locator.dispatcher() && locator.manager('WindowManager');
  }, Infinity, 1000).then((ready) => {
    if (!ready) return;
    installResourceRequestFilter();
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
  });

  applyNoticeBlockState();

  function armAdBlock(): void {
    if (!isOn('block.adWindow')) return;
    closeBySwitch('block.adWindow', 8, 500);
    hideLobbyAd(3);
  }

  return {
    filterMessage,
    armNoticeBlock: applyNoticeBlockState,
    armAdBlock,
    dispose() {
      disposed = true;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
      cleanups.splice(0).forEach((cleanup) => cleanup());
      seatPatcher.restoreAll();
      seatEffectControllers.clear();
      seatPatchScene = null;
      seatNamePatcher.restoreAll();
      skillEffectPatcher.restoreAll();
      skillEffects.clear();
      effectControllers.clear();
      patcher.restoreAll();
    }
  };
}

/** 原版红点清理：广度遍历红点树，找出所有 state 非 0 的节点（含中间节点，不只看叶子）。 */
function activeRedDotNodes(root: unknown): UnknownRecord[] {
  const nodes: UnknownRecord[] = [];
  const stack: UnknownRecord[] = [];
  const rootRecord = asRecord(root);
  if (rootRecord) stack.push(rootRecord);
  while (stack.length) {
    const node = stack.pop()!;
    if (node.state) nodes.push(node);
    const children = node.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        const record = asRecord(child);
        if (record) stack.push(record);
      }
    }
  }
  return nodes;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

/** 在原型链上找真正拥有该方法的那一层，用于包装原型上的共享方法。 */
function prototypeOwningMethod(target: unknown, method: string): UnknownRecord | null {
  let proto = target !== null && typeof target === 'object' ? Object.getPrototypeOf(target) : null;
  while (proto && !Object.prototype.hasOwnProperty.call(proto, method)) {
    proto = Object.getPrototypeOf(proto);
  }
  return proto && typeof (proto as UnknownRecord)[method] === 'function' ? proto as UnknownRecord : null;
}

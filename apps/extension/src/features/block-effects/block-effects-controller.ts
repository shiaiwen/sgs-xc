/**
 * 屏蔽特效/弹窗总控：按配置关闭广告、MVP、特效资源与协议字段改写。
 */

import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher, type PatchableFunction } from '../../runtime/method-patch.ts';
import type { BlockSettingKey } from './block-effect-settings.ts';
import { applyBlockMessageFilters } from './block-message-filters.ts';
import { collectMarqueeUis, createMarqueeVisibilityBlocker } from './marquee-visibility.ts';
import {
  hasAnyEffectResourceBlock,
  replaceBlockedEffectUrl,
  type EffectResourceFlags
} from './effect-resource-filter.ts';
import { classifyPlayback, kindFromCard, type PlaybackKind } from './effect-playback.ts';

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
const BLOCKED_INTERACT_ANIMATIONS = ['fx_uihd_caoxie', 'Ol_DaoJu_jidan'];
const LOBBY_AD_BUTTON_TYPE = 0x27cb;
const MARQUEE_EVENTS = ['CHAT_MARQUEE_ADD', 'CHAT_MARQUEE2023_ADD', 'CHAT_MARQUEE2023_ACT_ADD'];
const MARQUEE_SHOW_METHODS = ['ShowMarquee', 'intActDataMarquee', 'ShowNextActMarquee'];
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

const CLOSE_BY_SWITCH: Partial<Record<BlockSettingKey, string>> = {
  'block.adWindow': 'AdPushWindow'
};

export interface BlockEffectsController {
  /** 协议分发前调用，按开关改写击杀、皮肤状态与势力口号消息。 */
  filterMessage(payload: UnknownRecord, className: string): void;
  /** 清掉红点树上仍亮着的叶子。 */
  clearRedDots(): { found: boolean; count: number };
  dispose(): void;
}

export interface BlockEffectsOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
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
  let disposed = false;
  let manualRecordView = false;

  const isOn = (key: BlockSettingKey) => configStore.get(key) === true;
  const resourceFlags = (): EffectResourceFlags => ({
    sha: isOn('block.shaEffect'),
    shan: isOn('block.shanEffect'),
    heal: isOn('block.healEffect'),
    shake: isOn('block.shakeEffect'),
    interact: isOn('block.interactEffect')
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
    const flags = resourceFlags();
    return hasAnyEffectResourceBlock(flags) ? replaceBlockedEffectUrl(String(url || ''), flags) : url;
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
    const name = CLOSE_BY_SWITCH[key];
    if (!name) return false;
    if (key === 'block.adWindow') {
      new Set([locator.window(name), ...locator.findWindows(name)].filter(Boolean)).forEach((win) => {
        if (!win || win.destroyed) return;
        const views = win.curViewList;
        if (!Array.isArray(views)) return;
        views.forEach((view) => {
          try {
            callMethod(view, 'closeClicker');
          } catch (error) {
            console.warn('[屏蔽设置] 广告视图关闭失败:', error);
          }
        });
      });
    }
    const closed = closeWindowByName(name);
    if (!closed && retries > 0) later(() => closeBySwitch(key, retries - 1, interval), interval);
    return closed;
  }

  /** 隐藏大厅右侧广告位。 */
  function hideLobbyAd(retries = 0): boolean {
    if (!isOn('block.adWindow')) return false;
    let hidden = false;
    const scenes = new Set([locator.scene(), ...locator.findInLayer('SceneLayer', 'ModeScene')].filter(Boolean));
    scenes.forEach((scene) => {
      if (typeof scene?.hideAdView !== 'function') return;
      try {
        scene.hideAdView();
        hidden = true;
      } catch (error) {
        console.warn('[屏蔽设置] 隐藏大厅广告失败:', error);
      }
    });
    if (retries > 0) later(() => hideLobbyAd(retries - 1), 500);
    return hidden;
  }

  async function handleShownWindow(name: string): Promise<void> {
    const key = SHOWN_WINDOW_SWITCHES[name];
    if (!key || !isOn(key)) return;
    const win = await poll(() => locator.window(name));
    if (!win) return;
    await poll(() => !win.isShowWait);
    if (win.destroyed || disposed) return;
    switch (name) {
      case 'GetPropSpecialWindow':
        callMethod(win, 'Hide');
        callMethod(win, 'Close');
        break;
      case 'AdPushWindow':
        closeBySwitch('block.adWindow');
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
        callMethod(win, 'laterClose');
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
    const showWindowName = dispatcher
      ? locator.obfuscatedMethodName(dispatcher, 'GameEventDispatcher', 'ShowWindow')
      : null;
    if (dispatcher && showWindowName) {
      patcher.wrap(dispatcher, showWindowName, (original) => function (this: unknown, windowName: unknown, ...rest: unknown[]) {
        if (windowName === 'AdPushWindow' && isOn('block.adWindow')) return undefined;
        const result = original.call(this, windowName, ...rest);
        if (typeof windowName === 'string' && SHOWN_WINDOW_SWITCHES[windowName]) {
          later(() => void handleShownWindow(windowName));
        }
        return result;
      });
    }
    closeBySwitch('block.adWindow', 20, 500);
  }

  async function installLobbyAdBlock(): Promise<void> {
    patcher.wrap(locator.classPrototype('ModeScene'), 'showAdView', (original) => function (this: unknown, ...args) {
      if (!isOn('block.adWindow')) return original.apply(this, args);
      hideLobbyAd(3);
      return undefined;
    });
    hideLobbyAd(3);
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

  function syncMarquee(): void {
    marqueeBlocker.sync(marqueeManager ? collectMarqueeUis(marqueeManager) : [], isOn('block.noticeWindow'));
  }

  function findMarqueeManager(): UnknownRecord | null {
    const events = asRecord(locator.dispatcher()?._events);
    for (const eventName of MARQUEE_EVENTS) {
      const listeners = events?.[eventName];
      for (const listener of Array.isArray(listeners) ? listeners : [listeners]) {
        const caller = asRecord(asRecord(listener)?.caller);
        if (typeof caller?.ShowMarquee === 'function' && typeof caller.HideAllMarquee === 'function') return caller;
      }
    }
    return null;
  }

  async function installMarqueeBlock(): Promise<void> {
    const manager = await poll(findMarqueeManager, 120, 250);
    if (!manager) return;
    marqueeManager = manager;
    for (const method of MARQUEE_SHOW_METHODS) {
      patcher.wrap(manager, method, (original) => function (this: unknown, ...args) {
        const result = original.apply(this, args);
        syncMarquee();
        return result;
      });
    }
    const dispatcher = locator.dispatcher();
    MARQUEE_EVENTS.forEach((eventName) => callMethod(dispatcher, 'on', eventName, manager, syncMarquee));
    cleanups.push(() => {
      MARQUEE_EVENTS.forEach((eventName) => callMethod(dispatcher, 'off', eventName, manager, syncMarquee));
      marqueeBlocker.restoreAll();
      marqueeManager = null;
    });
    syncMarquee();
  }

  function installLaoXianBlock(): void {
    patcher.wrap(locator.classPrototype('TianShuWindow'), 'updateWinUI', (original) => function (this: UnknownRecord, ...args) {
      if (asRecord(args[0])?.type == 6 && isOn('block.laoXianWindow')) return callMethod(this, 'Close');
      return original.apply(this, args);
    });
  }

  // ---------- 局内/场景特效（原版 K5，每次切换场景重新检查） ----------

  function installSceneEffectPatches(): void {
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

      const rewardScene = await poll(() => (
        typeof locator.gameScene()?.showGameRewardPointEffect2 === 'function' ? locator.gameScene() : null
      ), 60, 100);
      for (const [method, kind] of [
        ['showGameRewardPointEffect1', 'block.killEffect'],
        ['showGameRewardPointEffect3', 'block.killEffect'],
        ['showGameRewardPointEffect2', 'block.healEffect'],
        ['showGameRewardPointEffect5', 'block.healEffect']
      ] as const) {
        patcher.wrap(rewardScene, method, (original) => function (this: unknown, ...args) {
          if (!isOn(kind)) return original.apply(this, args);
          return undefined;
        });
      }
      for (const method of ['PlaySimpleShakeEffect', 'PlaySimpleShakeEffect2']) {
        patcher.wrap(rewardScene, method, (original) => function (this: unknown, ...args) {
          if (!isOn('block.shakeEffect') && !isOn('block.skillEffect')) return original.apply(this, args);
          return undefined;
        });
      }

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

      const seatContainer = await poll(() => {
        const container = asRecord(locator.gameScene()?.seatContainer);
        return typeof container?.ReadyInteractProp === 'function' ? container : null;
      }, 60, 100);
      patcher.wrap(seatContainer, 'ReadyInteractProp', createReadyInteractPropWrapper);

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
        if (locator.gameScene() && isOn('block.shakeEffect')) return undefined;
        return original.apply(this, args);
      });
      patcher.wrap(seatUiPrototype, 'ShowEquipTrailEffect', (original) => function (this: unknown, ...args) {
        if (locator.gameScene() && isOn('block.equipEffect')) return undefined;
        return original.apply(this, args);
      });
      patcher.wrap(seatUiPrototype, 'playXDJXSkillEffect', (original) => function (this: unknown, ...args) {
        if (locator.gameScene() && isOn('block.skillEffect')) return undefined;
        return original.apply(this, args);
      });
      patcher.wrap(seatUiPrototype, 'playHurtShake', (original) => function (this: unknown, ...args) {
        if (locator.gameScene() && isOn('block.shakeEffect')) return undefined;
        return original.apply(this, args);
      });
      patcher.wrap(seatUiPrototype, 'playCardSkillAnimate', (original) => function (this: unknown, card: unknown, ...rest) {
        const kind = kindFromCard(asRecord(card) as never);
        if (kindOn(kind)) return undefined;
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
      const playbackTargets = [effectPlayer, effectCtrl].filter((item, index, list) => item && list.indexOf(item) === index);
      for (const target of playbackTargets) {
        patcher.wrap(target, 'ShowMulitEffectByData', (original) => function (this: unknown, data: unknown, ...rest) {
          if (!locator.gameScene()) return original.call(this, data, ...rest);
          const kind = classifyPlayback(asRecord(data)?.EffectPath, rest[1]);
          if (!kindOn(kind)) return original.call(this, data, ...rest);
          triggerHit(asRecord(rest[2]));
          return null;
        });
      }
      if (effectPlayer) {
        patcher.wrap(effectPlayer, 'GetHighQualitySkillEffect', (original) => function (this: unknown, ...args) {
          const created = original.apply(this, args);
          const target = asRecord(created);
          patcher.wrap(target, 'PlayTriggerEffect', (play) => function (this: unknown, ...playArgs) {
            if (locator.gameScene() && isOn('block.skillEffect')) return undefined;
            return play.apply(this, playArgs);
          });
          return created;
        });
      }

      installBaseEffectPatches();
      sweepLiveEffects();
    })();
  }

  /** 原版 y4：跳过南蛮/箭雨动画时仍需按原延迟触发受击。 */
  function triggerHit(hit: UnknownRecord | null): void {
    const trigger = hit?.HitTrigger;
    if (typeof trigger !== 'function') return;
    const delay = Number(hit?.HitDelay) || 0;
    const once = globalObject.Laya?.timer?.once;
    if (delay > 0 && typeof once === 'function') once.call(globalObject.Laya?.timer, delay, null, trigger as () => void);
    else (trigger as () => void)();
  }

  function findEffectPlayer(): UnknownRecord | null {
    const events = asRecord(locator.dispatcher()?._events);
    if (!events) return null;
    for (const listeners of Object.values(events)) {
      for (const listener of Array.isArray(listeners) ? listeners : [listeners]) {
        const caller = asRecord(asRecord(listener)?.caller);
        if (typeof caller?.PlayNanManEffect === 'function' && typeof caller.PlayEffectSYS === 'function') {
          return caller;
        }
      }
    }
    return null;
  }

  function createReadyInteractPropWrapper(original: PatchableFunction): PatchableFunction {
    return function (this: UnknownRecord, ...args: unknown[]) {
      if (!isOn('block.interactEffect')) return original.apply(this, args);
      const [goodsId, , , isEffect = false] = args;
      const propManager = locator.managerFromList((manager) => (
        typeof manager.GetPropByGoodsID === 'function'
        && typeof manager.GetPropEffByGoodsId === 'function'
        && typeof manager.GetPropByID === 'function'
      ));
      let prop = asRecord(callMethod(propManager, 'GetPropByGoodsID', goodsId));
      if (isEffect) {
        const effect = asRecord(callMethod(propManager, 'GetPropEffByGoodsId', goodsId));
        if (effect?.WinEffect) {
          prop = asRecord(callMethod(propManager, 'GetPropByID', Number(effect.WinEffect))) ?? prop;
        }
      }
      if (!BLOCKED_INTERACT_ANIMATIONS.includes(String(prop?.aniname))) return original.apply(this, args);
      const windowManager = locator.manager('WindowManager');
      const constants = asRecord(windowManager?.constructor);
      callMethod(
        windowManager,
        'event',
        constants?.TABLEGAME_INTERACT_PROP_PLAY_DONE ?? windowManager?.TABLEGAME_INTERACT_PROP_PLAY_DONE
      );
      if (isEffect) {
        callMethod(
          windowManager,
          'event',
          constants?.TABLEGAME_INTERACT_PROP_PLAY_EFF_DONE ?? windowManager?.TABLEGAME_INTERACT_PROP_PLAY_EFF_DONE
        );
      }
      this.PlayingInterProp = null;
      this.PlayingPropNum = 0;
      return undefined;
    };
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
      installSceneEffectPatches();
      const result = original.apply(this, args);
      const sceneName = asRecord(args[0])?.SceneName;
      if (sceneName) {
        later(() => {
          if (sceneName === 'TableScene') installRecordViewTracker();
          installSceneEffectPatches();
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
  function sweepLiveEffects(): void {
    const scene = locator.gameScene();
    const seats = asRecord(scene?.seatContainer)?.seatUIs ?? scene?.seatUIs;
    if (!Array.isArray(seats)) return;
    for (const item of seats) {
      const seatUi = asRecord(item);
      if (!seatUi) continue;
      const seat = asRecord(seatUi.seat);
      if (isOn('block.selectEffect')) seatUi.allowAttackEffect = null;
      if (isOn('block.skillEffect') || skinBlocked(seat)) {
        callMethod(seatUi, 'clearOutAvatarAni');
        callMethod(seatUi, 'clearNewFullScreenEffect');
      }
      if (isOn('block.shakeEffect')) {
        callMethod(seatUi.hurtShakeTween, 'clearAll');
        seatUi.hurtShakeTween = null;
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
      urlApi.customFormat = (url: unknown) => replaceUrl(typeof previous === 'function' ? previous(url) : url);
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
      isOwnGeneral
    });
  }

  unsubscribes.push(
    configStore.subscribe('block.adWindow', ({ value }) => {
      if (!value) return;
      closeBySwitch('block.adWindow', 6, 500);
      hideLobbyAd(3);
    }),
    configStore.subscribe('block.noticeWindow', () => syncMarquee()),
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
    ] as const).map((key) => configStore.subscribe(key, ({ value }) => {
      if (value) sweepLiveEffects();
    }))
  );

  installResourceRequestFilter();
  // 工程入口早于游戏登录，管理器就绪后才安装其余补丁。
  void poll(() => locator.dispatcher() && locator.manager('WindowManager'), Infinity, 1000).then((ready) => {
    if (!ready) return;
    installLaoXianBlock();
    const installers = [
      installWindowBlocks,
      installLobbyAdBlock,
      installMarqueeBlock,
      installSceneSwitchHook,
      installBossCityEntranceBlock,
      installKillEffectBlock,
      installRedDotBlock
    ];
    installers.forEach((install) => {
      install().catch((error: unknown) => console.warn('[屏蔽设置] 安装失败:', error));
    });
    installSceneEffectPatches();
  });

  return {
    filterMessage,
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

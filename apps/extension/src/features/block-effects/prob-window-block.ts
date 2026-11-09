/**
 * 出货动画屏蔽：祈愿台翻翻乐、获得新武将、获得新皮肤、获得限定道具四种窗口。
 * 窗口一打开就设成透明、点不到，跳过翻奖和大特效，再关掉。
 * 跳过的「收集点亮」会手动补做，奖励状态不会少记。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import type { MethodPatcher, PatchableFunction } from '../../runtime/method-patch.ts';
import {
  PROB_LIMITED_PROP_WINDOW,
  PROB_NEW_GENERAL_PREVIEW_ARG_INDEX,
  PROB_NEW_GENERAL_WINDOW,
  PROB_NEW_SKIN_PREVIEW_ARG_INDEX,
  PROB_NEW_SKIN_WINDOW,
  PROB_SPECIAL_WINDOW,
  PROB_WINDOW_NAMES,
  PROB_WINDOW_OFFICER_READY_ARG_INDEX,
  PROB_WINDOW_PREVIEW_ARG_VALUE
} from '../../const/prob-window-block.ts';

type UnknownRecord = Record<string, unknown>;

interface BlockedWindowState {
  officerReady: boolean;
  generalReady: boolean;
  generalIds: unknown[];
  closing: boolean;
}

export interface ProbWindowBlockOptions {
  locator: LayaObjectLocator;
  patcher: MethodPatcher;
  globalObject: LayaRuntimeWindow;
  enabled(): boolean;
}

export interface ProbWindowBlock {
  /** 给已经加载的出货窗口类装上屏蔽；返回还没加载到的窗口数。 */
  install(): number;
  isProbWindow(name: string): boolean;
}

const SUPPRESSED_METHODS: Record<string, readonly string[]> = {
  [PROB_NEW_GENERAL_WINDOW]: ['showBigEffect', 'playRanDomSound'],
  [PROB_NEW_SKIN_WINDOW]: ['onShowBigSkin', 'onShowNameBg', 'onShowCollect']
};

export function createProbWindowBlock(options: ProbWindowBlockOptions): ProbWindowBlock {
  const { locator, patcher, globalObject, enabled } = options;
  const states = new WeakMap<object, BlockedWindowState>();
  const installed = new Set<string>();

  function call(target: UnknownRecord, name: string, ...args: unknown[]): unknown {
    const method = target[name];
    return typeof method === 'function' ? method.apply(target, args) : undefined;
  }

  function runTimerNow(target: UnknownRecord, method: unknown): void {
    const timer = globalObject.Laya?.timer as UnknownRecord | undefined;
    if (timer && typeof method === 'function') call(timer, 'runTimer', target, method);
  }

  function hide(win: UnknownRecord): void {
    win.alpha = 0;
    win.mouseEnabled = false;
    win.modal = false;
    win.modalAlpha = 0;
    win.needInAnimate = false;
    win.needOutAnimat = false;
    const modalBg = win.modalBg as UnknownRecord | undefined;
    if (modalBg) modalBg.visible = false;
  }

  function closeSoon(win: UnknownRecord): void {
    const state = states.get(win);
    if (!state || state.closing || win.destroyed) return;
    state.closing = true;
    queueMicrotask(() => {
      state.closing = false;
      if (!win.destroyed) call(win, 'Close');
    });
  }

  function finishNewGeneral(win: UnknownRecord): void {
    const state = states.get(win);
    if (!state?.generalReady || !state.officerReady || win.destroyed) return;
    runTimerNow(win, win.showLampCollect);
    closeSoon(win);
  }

  function isPreview(name: string, args: unknown[]): boolean {
    if (name === PROB_NEW_GENERAL_WINDOW) return args[PROB_NEW_GENERAL_PREVIEW_ARG_INDEX] === PROB_WINDOW_PREVIEW_ARG_VALUE;
    if (name === PROB_NEW_SKIN_WINDOW) return args[PROB_NEW_SKIN_PREVIEW_ARG_INDEX] === PROB_WINDOW_PREVIEW_ARG_VALUE;
    return false;
  }

  function installClass(name: string, prototype: UnknownRecord): void {
    const wrap = (method: string, body: (original: PatchableFunction, win: UnknownRecord, args: unknown[]) => unknown) => {
      patcher.wrap(prototype, method, (original) => function (this: UnknownRecord, ...args: unknown[]) {
        return body(original, this, args);
      });
    };

    wrap('showHandler', (original, win, args) => {
      if (states.has(win)) hide(win);
      return original.apply(win, args);
    });
    wrap('createModalBg', (original, win, args) => {
      if (!states.has(win)) return original.apply(win, args);
      return undefined;
    });
    wrap('enterWindow', (original, win, args) => {
      if (!isPreview(name, args) && enabled()) {
        states.set(win, {
          officerReady: Boolean(args[PROB_WINDOW_OFFICER_READY_ARG_INDEX]),
          generalReady: false,
          generalIds: [],
          closing: false
        });
        hide(win);
      }
      const result = original.apply(win, args);
      if (states.has(win) && !win.destroyed) {
        hide(win);
        if (name === PROB_NEW_SKIN_WINDOW || name === PROB_LIMITED_PROP_WINDOW) closeSoon(win);
      }
      return result;
    });

    if (name === PROB_SPECIAL_WINDOW) {
      wrap('onShowOfficerPoint', (original, win, args) => {
        states.get(win)?.generalIds.push(args[0]);
        return original.apply(win, args);
      });
      wrap('delayShowSecondWindow', (original, win, args) => {
        const result = original.apply(win, args);
        if (states.has(win)) {
          queueMicrotask(() => {
            if (!win.destroyed) runTimerNow(win, win.onShowSpeWin);
          });
        }
        return result;
      });
      // 直接跳到翻完的状态：补做收集点亮，不能再手动关，然后关窗。
      wrap('startBackground', (original, win, args) => {
        const state = states.get(win);
        if (!state) return original.apply(win, args);
        if (win.destroyed || call(win, 'isAboveWindowShowing')) return undefined;
        win.backgroundStarted = true;
        call(win, 'creatItems', true);
        const timer = globalObject.Laya?.timer as UnknownRecord | undefined;
        if (timer) call(timer, 'clearAll', win);
        for (const generalId of state.generalIds.splice(0)) call(win, 'showLampCollect', generalId);
        win.cantClose = true;
        closeSoon(win);
        return undefined;
      });
      wrap('showFinalResult', (original, win, args) => {
        if (!states.has(win)) return original.apply(win, args);
        win.isFinalResultShown = true;
        win.isSkippingItems = false;
        return undefined;
      });
    }

    if (name === PROB_NEW_GENERAL_WINDOW) {
      wrap('delayFunc', (original, win, args) => {
        const result = original.apply(win, args);
        const state = states.get(win);
        if (state) {
          state.generalReady = true;
          finishNewGeneral(win);
        }
        return result;
      });
      wrap('onShowOfficerPoint', (original, win, args) => {
        const result = original.apply(win, args);
        const state = states.get(win);
        if (state) {
          state.officerReady = true;
          finishNewGeneral(win);
        }
        return result;
      });
    }

    for (const method of SUPPRESSED_METHODS[name] ?? []) {
      wrap(method, (original, win, args) => {
        if (!states.has(win)) return original.apply(win, args);
        return undefined;
      });
    }
  }

  return {
    install() {
      let missing = 0;
      for (const name of PROB_WINDOW_NAMES) {
        if (installed.has(name)) continue;
        const prototype = locator.classPrototype(name) as UnknownRecord | null | undefined;
        if (!prototype) {
          missing += 1;
          continue;
        }
        installClass(name, prototype);
        installed.add(name);
      }
      return missing;
    },
    isProbWindow(name) {
      return PROB_WINDOW_NAMES.includes(name);
    }
  };
}

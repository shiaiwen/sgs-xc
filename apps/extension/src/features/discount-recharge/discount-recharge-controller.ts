/**
 * 充值窗「立即充值」左边挂官服九五折按钮。
 * 只处理充值窗自己的立即充值按钮，不扫描整个画面，也不新建游戏按钮。
 */

import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { createTaskScope } from '../skin-background/skin-runtime.ts';
import {
  buildOfficialDiscountRechargeUrl,
  layoutDiscountRechargeButton,
  OFFICIAL_DISCOUNT_RECHARGE_LABEL
} from './discount-recharge.ts';

type UnknownRecord = Record<string, any>;

export interface DiscountRechargeControllerOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  openExternal: (url: string) => Promise<void>;
  pollIntervalMs?: number;
}

const WINDOW_NAME = 'RechargeWindow';
const ENTRY_NAME = 'xiaochao-discount-recharge-entry';
const STATE_KEY = '__xcDiscountRecharge';
const FILL = '#8C2F1F';
const STROKE = '#D4B06A';
const TEXT_COLOR = '#F3D9A0';

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readText(value: unknown, seen = new Set<unknown>()): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (!value || seen.has(value)) return '';
  seen.add(value);
  const record = asRecord(value);
  if (!record) return '';
  return readText(record.text ?? record.YokaAcc ?? record.account ?? record.Account, seen);
}

function readYokaAccount(globalObject: LayaRuntimeWindow): string {
  try {
    const ctor = globalObject.Laya?.ClassUtils?.getClass?.('LoginManager') as UnknownRecord | undefined;
    return readText(ctor?.YokaAcc) || readText(ctor?.account);
  } catch {
    return '';
  }
}

function createFallbackButton(laya: UnknownRecord, width: number, height: number): UnknownRecord | null {
  const Sprite = laya.Sprite;
  const Text = laya.Text ?? laya.Label;
  if (typeof Sprite !== 'function' || typeof Text !== 'function') return null;
  const host = new Sprite();
  host.size?.(width, height);
  host.graphics?.clear?.();
  if (typeof host.graphics?.drawRoundRect === 'function') {
    host.graphics.drawRoundRect(0, 0, width, height, 6, FILL, STROKE, 1);
  } else {
    host.graphics?.drawRect?.(0, 0, width, height, FILL, STROKE, 1);
  }
  const label = new Text();
  label.text = OFFICIAL_DISCOUNT_RECHARGE_LABEL;
  label.font = 'Microsoft YaHei';
  label.fontSize = 18;
  label.bold = true;
  label.color = TEXT_COLOR;
  label.align = 'center';
  label.valign = 'middle';
  label.size?.(width, height);
  label.mouseEnabled = false;
  host.addChild?.(label);
  return host;
}

function createDiscountButton(
  globalObject: LayaRuntimeWindow,
  okBtn: UnknownRecord
): UnknownRecord | null {
  const laya = asRecord(globalObject.Laya);
  if (!laya) return null;
  const width = Math.max(finite(okBtn.width, 140), 80);
  const height = Math.max(finite(okBtn.height, 36), 24);
  const entry = createFallbackButton(laya, width, height);
  if (!entry) return null;
  entry.name = ENTRY_NAME;
  entry.mouseEnabled = true;
  entry.mouseThrough = false;
  entry.zOrder = finite(okBtn.zOrder) + 1;
  return entry;
}

function bindClick(
  entry: UnknownRecord,
  globalObject: LayaRuntimeWindow,
  win: UnknownRecord,
  openExternal: (url: string) => Promise<void>
): void {
  const laya = asRecord(globalObject.Laya);
  const clickEvent = String(laya?.Event?.CLICK ?? 'click');
  const overEvent = String(laya?.Event?.MOUSE_OVER ?? 'mouseover');
  const outEvent = String(laya?.Event?.MOUSE_OUT ?? 'mouseout');
  entry.on?.(clickEvent, win, () => {
    const account = readYokaAccount(globalObject);
    void openExternal(account
      ? buildOfficialDiscountRechargeUrl(account)
      : 'https://95chong.cn/');
  });
  entry.on?.(overEvent, entry, () => {
    if (laya?.Mouse) laya.Mouse.cursor = 'pointer';
  });
  const resetCursor = () => {
    if (laya?.Mouse) laya.Mouse.cursor = 'default';
  };
  entry.on?.(outEvent, entry, resetCursor);
  entry.on?.(String(laya?.Event?.UNDISPLAY ?? 'undisplay'), entry, resetCursor);
}

function placeEntry(okBtn: UnknownRecord, entry: UnknownRecord): void {
  if (okBtn.visible === false || okBtn.destroyed) {
    entry.visible = false;
    return;
  }
  const box = layoutDiscountRechargeButton({
    x: finite(okBtn.x),
    y: finite(okBtn.y),
    width: Math.max(finite(okBtn.width, 140), 80),
    height: Math.max(finite(okBtn.height, 36), 24)
  });
  entry.size?.(box.width, box.height);
  const label = asRecord(entry._children?.[0]);
  if (label?.size) label.size(box.width, box.height);
  entry.pos?.(box.x, box.y);
  entry.zOrder = Math.max(finite(okBtn.zOrder) + 1, 1000);
  entry.visible = true;
}

function syncPayButton(
  okBtn: UnknownRecord,
  win: UnknownRecord,
  globalObject: LayaRuntimeWindow,
  openExternal: (url: string) => Promise<void>
): void {
  const host = asRecord(okBtn.parent) ?? asRecord(win.contentSprite) ?? win;
  if (!host) return;
  const stateOwner = okBtn;
  let entry = asRecord(asRecord(stateOwner[STATE_KEY])?.entry);
  if (!entry || entry.destroyed) {
    entry = createDiscountButton(globalObject, okBtn);
    if (!entry) return;
    host.addChild?.(entry);
    bindClick(entry, globalObject, win, openExternal);
    stateOwner[STATE_KEY] = { entry };
    win[STATE_KEY] = { entry };
  }
  placeEntry(okBtn, entry);
}

function destroyEntry(entry: UnknownRecord | null | undefined): void {
  if (!entry || entry.destroyed) return;
  try {
    entry.destroy?.(true);
  } catch {
    entry.removeSelf?.();
  }
}

function syncWindow(
  win: UnknownRecord,
  globalObject: LayaRuntimeWindow,
  openExternal: (url: string) => Promise<void>
): void {
  const okBtn = asRecord(win.okBtn);
  if (!okBtn || okBtn.destroyed) return;
  syncPayButton(okBtn, win, globalObject, openExternal);
}

/** 给充值窗挂官服九五折按钮，返回卸载函数。 */
export function installDiscountRechargeController(
  options: DiscountRechargeControllerOptions
): () => void {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const patcher = createMethodPatcher();
  const tasks = createTaskScope();
  let disposed = false;

  const installPatches = () => {
    if (disposed) return;
    const prototype = locator.classPrototype(WINDOW_NAME);
    if (prototype && typeof prototype.enterWindow === 'function' && !patcher.isWrapped(prototype, 'enterWindow')) {
      patcher.wrap(prototype, 'enterWindow', (original) => function (this: UnknownRecord, ...args: unknown[]) {
        const result = original.apply(this, args);
        syncWindow(this, globalObject, options.openExternal);
        return result;
      });
    }
    if (prototype && typeof prototype.destroy === 'function' && !patcher.isWrapped(prototype, 'destroy')) {
      patcher.wrap(prototype, 'destroy', (original) => function (this: UnknownRecord, ...args: unknown[]) {
        const state = asRecord(this[STATE_KEY]);
        destroyEntry(state?.entry);
        delete this[STATE_KEY];
        return original.apply(this, args);
      });
    }
    const current = locator.window(WINDOW_NAME);
    if (current && current.destroyed !== true) {
      syncWindow(current, globalObject, options.openExternal);
    }
    for (const extra of locator.findWindows(WINDOW_NAME)) {
      if (extra.destroyed !== true) syncWindow(extra, globalObject, options.openExternal);
    }
  };

  installPatches();
  const timer = globalObject.setInterval?.(installPatches, (options.pollIntervalMs ?? 800) * 2);

  return () => {
    disposed = true;
    tasks.dispose();
    if (timer != null) globalObject.clearInterval?.(timer);
    const current = locator.window(WINDOW_NAME);
    const state = asRecord(current?.[STATE_KEY]);
    destroyEntry(state?.entry);
    if (current) delete current[STATE_KEY];
    patcher.restoreAll();
  };
}

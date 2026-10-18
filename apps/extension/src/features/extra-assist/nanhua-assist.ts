/**
 * 南华辅助：在相关技能触发 UI 上展示效果说明。
 */

import type { LayaObjectLocator } from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher, type MethodPatcher } from '../../runtime/method-patch.ts';

type UnknownRecord = Record<string, unknown>;

export interface NanHuaEffectLine {
  type: number;
  text: string;
}

export interface NanHuaAssistConfig {
  /** triggerID → triggerType（第几类）。 */
  trigger: Readonly<Record<number, number>>;
  /** 天书效果原文，展示时再拼成色条。 */
  effects: readonly NanHuaEffectLine[];
}

export interface NanHuaAssistOptions {
  isEnabled: () => boolean;
  /** 天书提示文案开关，默认开启。 */
  isTipVisible?: () => boolean;
  getConfig: () => NanHuaAssistConfig | null;
  locator: LayaObjectLocator;
  patcher?: MethodPatcher;
  globalObject?: {
    Laya?: {
      Event?: { CLICK?: string };
      Sprite?: new () => UnknownRecord;
      HTMLDivElement?: new () => UnknownRecord;
    };
  };
}

/**
 * TianShuWindow.updateWinUI 的南华分支：
 * type=1 时按 triggerType 排序选项、显示问号钮与效果说明。
 */
export function installNanHuaAssist(options: NanHuaAssistOptions): () => void {
  const patcher = options.patcher ?? createMethodPatcher();
  const globalObject = options.globalObject ?? (typeof window !== 'undefined' ? window : {});
  const prototype = options.locator.classPrototype('TianShuWindow');
  let tipVisible = true;
  if (!prototype) return () => undefined;

  patcher.wrap(prototype, 'updateWinUI', (original) => function (this: UnknownRecord, ...args: unknown[]) {
    const data = asRecord(args[0]);
    const type = Number(data?.type);
    const enabled = options.isEnabled();
    const config = enabled ? options.getConfig() : null;

    if (type === 1 && enabled && config?.trigger && Array.isArray(data?.ids)) {
      const ids = data.ids as number[];
      ids.sort((left, right) => (
        Number(config.trigger[left] ?? 0) - Number(config.trigger[right] ?? 0)
      ));
    }

    const result = original.apply(this, args);

    if (type === 1 && enabled) {
      ensureWenhao(this, globalObject, options, () => {
        tipVisible = !tipVisible;
      });
      if (config && tipVisible && (options.isTipVisible?.() ?? true)) {
        renderEffectHtml(this, data, config, globalObject);
      } else {
        hideEffectHtml(this);
      }
    } else if (type === 2) {
      hideWenhao(this);
      clearSecondTianShu(this, data);
    } else {
      hideWenhao(this);
      if (type !== 1) hideEffectHtml(this);
    }

    return result;
  });

  return () => {
    const windowInstance = options.locator.window('TianShuWindow');
    if (windowInstance) {
      hideWenhao(windowInstance);
      hideEffectHtml(windowInstance);
    }
    if (!options.patcher) patcher.restoreAll();
  };
}

function ensureWenhao(
  win: UnknownRecord,
  globalObject: NanHuaAssistOptions['globalObject'],
  options: NanHuaAssistOptions,
  toggleTip: () => void
): void {
  let wenhao = asRecord(win.wenhao);
  if (wenhao) {
    wenhao.visible = true;
    return;
  }
  const created = options.locator.createInstance('SgsSpriteFilterBtn');
  if (!created) return;
  wenhao = created;
  win.wenhao = wenhao;
  const addChild = win.addChild;
  if (typeof addChild === 'function') addChild.call(win, wenhao);
  callMethod(wenhao, 'InitSkin',
    'hall_user_wenhao_up',
    'hall_user_wenhao_over',
    'hall_user_wenhao_down',
    'hall_user_wenhao_disabled'
  );
  wenhao.pos?.(670, 270);
  wenhao.zOrder = 100;
  wenhao.mouseEnabled = true;
  const click = globalObject?.Laya?.Event?.CLICK ?? 'click';
  callMethod(wenhao, 'on', click, win, function (this: UnknownRecord) {
    const html = asRecord(this.html);
    if (!html) return;
    toggleTip();
    html.visible = !html.visible;
  });
}

function hideWenhao(win: UnknownRecord): void {
  const wenhao = asRecord(win.wenhao);
  if (wenhao) wenhao.visible = false;
}

function hideEffectHtml(win: UnknownRecord): void {
  const html = asRecord(win.html);
  if (html) html.visible = false;
}

const TIP_WIDTH = 507;
const TIP_X = 150;
const TYPE_COLORS = ['', '0,83,255', '83,255,0', '255,100,0'];
const HIDDEN_MARK = '<span style="color: rgba(0,0,0,0);stroke:none;">';
const SECOND_TIANSHU_MARKS = [11, 12, 29];

/** 最低类型决定整块说明的纵坐标。 */
export function nanHuaTipOffset(minType: number): number {
  if (minType <= 1) return -70;
  if (minType >= 3) return 116;
  return 8;
}

/**
 * 选时机时提前列出效果。按类型做成色条，下标就是类型号。
 * 同一类里不足 16 字的并进上一条，并标黄「第N类型」。
 * 第 1 类蓝，第 2 类绿，第 3 类橙。
 */
export function buildNanHuaEffectBlocks(effects: readonly NanHuaEffectLine[]): string[] {
  const sorted = effects.map((effect) => ({
    type: effect.type,
    desc: String(effect.text || '').replace(/^你可以?(.*?)。?$/, '$1')
  })).filter((effect) => effect.type > 0 && effect.desc)
    .sort((left, right) => left.type - right.type || left.desc.length - right.desc.length);

  const rows: Array<{ type: number; desc: string }> = [];
  for (const current of sorted) {
    const previous = rows[rows.length - 1];
    if (!previous || previous.type !== current.type) {
      current.desc += `${hiddenPad(13 - current.desc.length)}<span style="color: rgba(255,255,0,1);">第${current.type}类型</span>`;
    }
    const canMerge = current.desc.length < 16
      && previous
      && (previous.desc.endsWith('</span>') || previous.desc.length < 16);
    if (canMerge && previous) {
      const gap = previous.desc.length > 16 ? 4 : 20 - previous.desc.length;
      previous.desc += hiddenPad(gap) + current.desc;
      continue;
    }
    rows.push(current);
  }

  const blocks: string[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const previous = rows[index - 1];
    if (row.type !== previous?.type) blocks[row.type] = '<div style="height: 3px;"></div>';
    const color = TYPE_COLORS[row.type] ?? '';
    blocks[row.type] += `<div style="width:${TIP_WIDTH}px; height:auto; background-color: rgba(${color},0.7);">${row.desc}</div>`;
  }
  return blocks;
}

/** 从当前三个时机里最低的类型开始，更高的类型一并显示。 */
export function nanHuaTipHtml(blocks: readonly string[], minType: number): string {
  return `<div style="width:${TIP_WIDTH}px;">${blocks.slice(Math.max(0, minType)).join('')}</div> `;
}

function hiddenPad(count: number): string {
  return `${HIDDEN_MARK}${'～'.repeat(Math.max(0, count))}</span>`;
}

function renderEffectHtml(
  win: UnknownRecord,
  data: UnknownRecord | null,
  config: NanHuaAssistConfig,
  globalObject: NanHuaAssistOptions['globalObject']
): void {
  const ids = Array.isArray(data?.ids) ? data.ids as number[] : [];
  const effects = config.effects ?? [];
  if (!ids.length || !effects.length) {
    hideEffectHtml(win);
    return;
  }
  const selectItems = Array.isArray(win.selectItems) ? win.selectItems as UnknownRecord[] : [];
  selectItems.forEach((item, index) => {
    const triggerType = Number(config.trigger[Number(ids[index])] ?? 0);
    if (triggerType) item.UseCnt = `第${triggerType}类型`;
    if (triggerType === 3) item.SelectBgVisible = true;
  });

  const minType = Math.min(...ids.map((id) => Number(config.trigger[Number(id)] ?? 99)));
  const blocks = buildNanHuaEffectBlocks(effects);
  if (!blocks.slice(Math.max(0, minType)).some(Boolean)) {
    hideEffectHtml(win);
    return;
  }
  const html = ensureTipHtml(win, globalObject);
  if (!html) return;
  const style = asRecord(html.style) ?? (html.style = {});
  Object.assign(style, {
    width: TIP_WIDTH,
    color: 'white',
    fontSize: 15,
    fontFamily: 'FZLBGBK',
    stroke: 1,
    strokeColor: '#000000'
  });
  html.innerHTML = nanHuaTipHtml(blocks, minType);
  html.visible = true;
  html.pos?.(TIP_X, nanHuaTipOffset(minType));
}

function clearSecondTianShu(win: UnknownRecord, data: UnknownRecord | null): void {
  const html = asRecord(win.html);
  if (html) {
    callMethod(html, 'removeSelf');
    delete win.html;
  }
  const ids = Array.isArray(data?.ids) ? data.ids as number[] : [];
  const selectItems = Array.isArray(win.selectItems) ? win.selectItems as UnknownRecord[] : [];
  selectItems.forEach((item, index) => {
    const emptyBg = asRecord(item.emptyBg);
    callMethod(emptyBg, 'invalidateUpdate');
    if (SECOND_TIANSHU_MARKS.includes(Number(ids[index]))) item.SelectBgVisible = true;
  });
}

function ensureTipHtml(
  win: UnknownRecord,
  globalObject: NanHuaAssistOptions['globalObject']
): UnknownRecord | null {
  const existing = asRecord(win.html);
  if (existing && existing.name === 'dxcTianshuTip') return existing;
  if (existing) {
    callMethod(existing, 'removeSelf');
    delete win.html;
  }
  const HtmlDiv = globalObject?.Laya?.HTMLDivElement;
  if (!HtmlDiv) return null;
  const html = new HtmlDiv();
  html.name = 'dxcTianshuTip';
  html.mouseEnabled = false;
  html.mouseThrough = true;
  win.html = html;
  const addChild = win.addChild;
  if (typeof addChild === 'function') addChild.call(win, html);
  return html;
}

function callMethod(target: UnknownRecord | null, name: string, ...args: unknown[]): unknown {
  if (!target) return undefined;
  const method = target[name];
  if (typeof method !== 'function') return undefined;
  try {
    return method.apply(target, args);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

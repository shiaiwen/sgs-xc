/**
 * 南华辅助：在相关技能触发 UI 上展示效果说明。
 */

import type { LayaObjectLocator } from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher, type MethodPatcher } from '../../runtime/method-patch.ts';

type UnknownRecord = Record<string, unknown>;

export interface NanHuaEffectLine {
  id?: number;
  type: number;
  text: string;
}

export interface NanHuaAssistConfig {
  /** triggerID → triggerType（第几类）。 */
  trigger: Readonly<Record<number, number>>;
  /** triggerID → 时机描述，分组标题用。 */
  triggerText?: Readonly<Record<number, string>>;
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
 * TianShuWindow.updateWinUI 的南华分支。
 * 选时机时按类别排序，选项标成「第N类型」，并把这一档及更高档的效果说明铺在上面。
 * 点进某一册之后收掉说明，11、12、29 号效果把选项底亮出来。
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
    const ids = Array.isArray(data?.ids) ? data.ids as number[] : [];

    if (type === 1 && enabled && config && ids.length) {
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
        labelTimingTypes(this, ids, config);
        renderEffectHtml(this, ids, config, globalObject);
      } else {
        hideEffectHtml(this);
      }
    } else if (type === 2) {
      hideWenhao(this);
      clearSecondTianShu(this, data);
    } else {
      hideWenhao(this);
      hideEffectHtml(this);
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
const SECOND_TIANSHU_MARKS = [11, 12, 29];
const TYPE_COLORS = ['', '0,83,255', '83,255,0', '255,100,0'];
const HIDDEN_MARK = '<span style="color: rgba(0,0,0,0);stroke:none;">';

/** 最低类别决定说明条的纵向位置。 */
export function nanHuaTipOffset(minType: number): number {
  if (minType <= 1) return -70;
  if (minType >= 3) return 116;
  return 8;
}

/**
 * 按类别拼效果说明。下标就是类别号，同一类里不足 16 字的并进上一条，并标黄「第N类型」。
 * 第 1 类蓝，第 2 类绿，第 3 类橙。
 */
export function buildNanHuaEffectBlocks(effects: readonly NanHuaEffectLine[]): string[] {
  const sorted = effects.map((effect) => ({
    type: effect.type,
    desc: String(effect.text || '').replace(/^你可以?(.*?)。?$/, '$1')
  })).filter((effect) => effect.type > 0 && effect.desc)
    .sort((left, right) => left.type - right.type || left.desc.length - right.desc.length);

  const rows: Array<{ type: number; desc: string }> = [];
  sorted.forEach((effect, index) => {
    const previous = sorted[index - 1];
    let desc = effect.desc;
    if (!previous || effect.type !== previous.type) {
      const pad = Math.max(0, 13 - desc.length);
      desc += `${HIDDEN_MARK}${'～'.repeat(pad)}</span><span style="color: rgba(255,255,0,1);">第${effect.type}类型</span>`;
    }
    const previousRow = rows[rows.length - 1];
    if (
      desc.length < 16
      && previousRow
      && (previousRow.desc.endsWith('</span>') || previousRow.desc.length < 16)
    ) {
      const gap = previousRow.desc.length > 16 ? 4 : Math.max(0, 20 - previousRow.desc.length);
      previousRow.desc += `${HIDDEN_MARK}${'～'.repeat(gap)}</span>${desc}`;
      return;
    }
    rows.push({ type: effect.type, desc });
  });

  const blocks: string[] = [];
  rows.forEach((row, index) => {
    if (row.type !== rows[index - 1]?.type) blocks[row.type] = '<div style="height: 3px;"></div>';
    const color = TYPE_COLORS[row.type] || TYPE_COLORS[1];
    blocks[row.type] += `<div style="width:${TIP_WIDTH}px; height:auto; background-color: rgba(${color},0.7);">${row.desc}</div>`;
  });
  return blocks;
}

/** 从这次给出的时机里取最低类别，铺出该类别及更高类别的效果说明。 */
export function timingEffectHtml(
  offeredTriggers: readonly number[],
  config: NanHuaAssistConfig
): { html: string; offsetY: number } | null {
  const types = offeredTriggers
    .map((triggerId) => Number(config.trigger[triggerId]))
    .filter((triggerType) => triggerType > 0);
  if (!types.length || !config.effects.length) return null;
  const minType = Math.min(...types);
  const blocks = buildNanHuaEffectBlocks(config.effects);
  const body = blocks.slice(minType).join('');
  if (!body) return null;
  return {
    html: `<div style="width:${TIP_WIDTH}px;">${body}</div> `,
    offsetY: nanHuaTipOffset(minType)
  };
}

function labelTimingTypes(
  win: UnknownRecord,
  ids: readonly number[],
  config: NanHuaAssistConfig
): void {
  const selectItems = Array.isArray(win.selectItems) ? win.selectItems as UnknownRecord[] : [];
  selectItems.forEach((item, index) => {
    const triggerType = Number(config.trigger[Number(ids[index])] ?? 0);
    if (!(triggerType > 0)) return;
    item.UseCnt = `第${triggerType}类型`;
    if (triggerType === 3) item.SelectBgVisible = true;
  });
}

function renderEffectHtml(
  win: UnknownRecord,
  ids: readonly number[],
  config: NanHuaAssistConfig,
  globalObject: NanHuaAssistOptions['globalObject']
): void {
  const built = timingEffectHtml(ids, config);
  if (!built) {
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
  html.innerHTML = built.html;
  html.visible = true;
  html.pos?.(TIP_X, built.offsetY);
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

/**
 * 皮肤详情「保存 / 设为背景 / 收藏」：对齐参考包 myFuncBtn 方案，并兼容新版原生按钮。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import type { MethodPatcher } from '../../runtime/method-patch.ts';
import {
  LAYA_TOP_UI_LAYER_ORDER,
  LAYA_WINDOW_LAYER_ORDER,
  SKIN_DETAIL_BUTTON_ABOVE_FRAME_GAP,
  SKIN_DETAIL_BUTTON_HEIGHT,
  SKIN_DETAIL_LAYER_SCAN_DEPTH,
  SKIN_DETAIL_LAYER_SCAN_MAX_NODES,
  SKIN_DETAIL_WINDOW_BLOCK_NAME_ALLOW_PATTERN,
  SKIN_DETAIL_WINDOW_BLOCK_NAME_PATTERN,
  SKIN_DETAIL_WINDOW_NAMES
} from '../../const/skin-detail-window.ts';
import { asRecord, callMethod, type UnknownRecord } from './skin-runtime.ts';

export interface NativeSkinDetailSlots {
  save: boolean;
  background: boolean;
  favorite: boolean;
}

export interface DetailButtonLayout {
  left: number;
  top: number;
  totalWidth: number;
}

export interface SkinDetailMount {
  /** 挂按钮条的容器，与立绘框同一坐标系。 */
  mountParent: UnknownRecord;
  frame: UnknownRecord;
}

export interface SkinDetailResolveProbe {
  dictKeys: string[];
  layerHits: number;
  picked: string;
}

const SKIN_DETAIL_WINDOW_HOOK = '__xcSkinDetailButtonsHooked';

function buttonLabel(node: UnknownRecord): string {
  const direct = String(node.label ?? node.text ?? '');
  if (direct) return direct;
  const field = asRecord(node.textField);
  return String(field?.text ?? field?.label ?? '');
}

function walkUiNodes(
  root: UnknownRecord,
  depth: number,
  maxDepth: number,
  visit: (node: UnknownRecord) => void
): void {
  if (depth > maxDepth) return;
  visit(root);
  const children = root._children;
  if (!Array.isArray(children)) return;
  for (const child of children) {
    const record = asRecord(child);
    if (record) walkUiNodes(record, depth + 1, maxDepth, visit);
  }
}

function skinPreviewUrl(node: UnknownRecord): string {
  const skinImg = asRecord(node.skinImg);
  return String(skinImg?.skin ?? skinImg?.source ?? skinImg?.url ?? '').trim();
}

function windowClassName(node: UnknownRecord): string {
  return String(node.name ?? node.sceneName ?? asRecord(node.constructor)?.name ?? '');
}

function isBlockedNonDetailWindow(className: string): boolean {
  if (!SKIN_DETAIL_WINDOW_BLOCK_NAME_PATTERN.test(className)) return false;
  return !SKIN_DETAIL_WINDOW_BLOCK_NAME_ALLOW_PATTERN.test(className);
}

function isNamedSkinDetailWindow(win: UnknownRecord): boolean {
  const className = windowClassName(win);
  if (isBlockedNonDetailWindow(className)) return false;
  for (const name of SKIN_DETAIL_WINDOW_NAMES) {
    if (className === name) return true;
  }
  return /SkinInfo|SkinManage|SkinDetail|SkinPreview|GeneralSkin/i.test(className)
    && /Window$|Pop$/i.test(className);
}

/** 皮肤册点进去的大图详情：有制作 / 分解与 skinData。 */
export function isSkinDetailCraftFingerprint(win: UnknownRecord): boolean {
  if (!findUiLabelNode(win, /^制作$/)) return false;
  if (!findUiLabelNode(win, /^分解$/)) return false;
  const hasData = Boolean(asRecord(win.skinData));
  const hasImg = Boolean(asRecord(win.skinImg)) || Boolean(skinPreviewUrl(win));
  return hasData && hasImg;
}

/** 是否皮肤详情弹窗，排除皮肤册 / 列表页。 */
export function isSkinDetailWindowCandidate(win: UnknownRecord | null): win is UnknownRecord {
  if (!win || win.destroyed || win.visible === false) return false;
  if (isSkinDetailCraftFingerprint(win)) return true;
  const className = windowClassName(win);
  if (isBlockedNonDetailWindow(className)) return false;
  const hasData = Boolean(asRecord(win.skinData));
  const hasImg = Boolean(skinPreviewUrl(win)) || Boolean(asRecord(win.skinImg));
  const hasContent = Boolean(asRecord(win.contentSprite));
  const hasFrame = Boolean(asRecord(win.skinFrame));
  const hasBigSprites = Boolean(asRecord(win.skinBigSps));
  const hasShowRightInfo = typeof win.showRightInfo === 'function';
  if (isNamedSkinDetailWindow(win)) return hasData || hasImg || hasBigSprites;
  if (hasShowRightInfo && hasContent && hasData && hasImg) return true;
  if (hasBigSprites && hasContent && hasData && hasImg && hasFrame) return true;
  return false;
}

function rankSkinDetailWindow(win: UnknownRecord): number {
  if (isNamedSkinDetailWindow(win)) return 100;
  if (isSkinDetailCraftFingerprint(win)) return 90;
  if (typeof win.showRightInfo === 'function') return 70;
  if (asRecord(win.skinBigSps)) return 50;
  return 10;
}

/** 撤掉误挂在非详情窗上的小抄按钮。 */
export function hideInjectedDetailButtons(win: UnknownRecord): void {
  for (let index = 0; index < 3; index += 1) {
    const button = asRecord(win[`myFuncBtn${index}`]);
    const hit = asRecord(win[`myFuncBtnHit${index}`]);
    if (button) {
      Object.assign(button, { visible: false, enabled: false, mouseEnabled: false });
      const parent = asRecord(button.parent);
      if (parent) callMethod(parent, 'removeChild', button);
    }
    if (hit) {
      Object.assign(hit, { visible: false, mouseEnabled: false });
      const parent = asRecord(hit.parent);
      if (parent) callMethod(parent, 'removeChild', hit);
    }
    win[`myFuncBtn${index}`] = undefined;
    win[`myFuncBtnHit${index}`] = undefined;
  }
}

function collectHostsWithInjectedButtons(globalObject: LayaRuntimeWindow): UnknownRecord[] {
  const hosts: UnknownRecord[] = [];
  const seen = new Set<UnknownRecord>();
  for (const layerOrder of [LAYA_WINDOW_LAYER_ORDER, LAYA_TOP_UI_LAYER_ORDER]) {
    for (const layer of collectLayerRoots(globalObject, layerOrder)) {
      walkUiNodes(layer, 0, SKIN_DETAIL_LAYER_SCAN_DEPTH, (node) => {
        if (!node.myFuncBtn0 && !node.myFuncBtn1 && !node.myFuncBtn2) return;
        if (seen.has(node)) return;
        seen.add(node);
        hosts.push(node);
      });
    }
  }
  return hosts;
}

export function cleanupMisplacedDetailButtons(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow = globalThis as LayaRuntimeWindow
): void {
  const hosts = new Set<UnknownRecord>();
  for (const win of collectWindowManagerInstances(locator)) hosts.add(win);
  for (const host of collectHostsWithInjectedButtons(globalObject)) hosts.add(host);
  for (const win of hosts) {
    const hasInjected = Boolean(win.myFuncBtn0 || win.myFuncBtn1 || win.myFuncBtn2);
    if (!hasInjected || isSkinDetailWindowCandidate(win)) continue;
    hideInjectedDetailButtons(win);
  }
}

function collectLayerRoots(globalObject: LayaRuntimeWindow, layerOrder: number): UnknownRecord[] {
  const stage = asRecord(globalObject.Laya?.stage);
  if (!stage || !Array.isArray(stage._children)) return [];
  const layers: UnknownRecord[] = [];
  for (const child of stage._children) {
    const record = asRecord(child);
    if (record && record.layerOrder === layerOrder) layers.push(record);
  }
  return layers;
}

function collectWindowLayerNodes(globalObject: LayaRuntimeWindow): UnknownRecord[] {
  const roots = [
    ...collectLayerRoots(globalObject, LAYA_WINDOW_LAYER_ORDER),
    ...collectLayerRoots(globalObject, LAYA_TOP_UI_LAYER_ORDER)
  ];
  const found: UnknownRecord[] = [];
  const seen = new Set<UnknownRecord>();
  const queue: Array<{ node: UnknownRecord; depth: number }> = [];
  for (const layer of roots) queue.push({ node: layer, depth: 0 });
  while (queue.length && found.length < SKIN_DETAIL_LAYER_SCAN_MAX_NODES) {
    const entry = queue.shift();
    if (!entry) continue;
    const { node, depth } = entry;
    const className = windowClassName(node);
    if (
      isSkinDetailWindowCandidate(node)
      && (/Window$/i.test(className) || isSkinDetailCraftFingerprint(node))
      && !seen.has(node)
    ) {
      seen.add(node);
      found.push(node);
    }
    if (depth >= SKIN_DETAIL_LAYER_SCAN_DEPTH || !Array.isArray(node._children)) continue;
    for (const child of node._children) {
      const record = asRecord(child);
      if (record) queue.push({ node: record, depth: depth + 1 });
    }
  }
  return found;
}

function collectWindowManagerInstances(locator: LayaObjectLocator): UnknownRecord[] {
  if (typeof locator.manager !== 'function') return [];
  const dict = asRecord(locator.manager('WindowManager')?.WindowInstanceDict);
  if (!dict) return [];
  const found: UnknownRecord[] = [];
  const push = (value: unknown) => {
    const record = asRecord(value);
    if (record && !record.destroyed && record.visible !== false) found.push(record);
  };
  if (typeof dict.forEach === 'function') {
    dict.forEach((value: unknown) => push(value));
    return found;
  }
  if (typeof dict.values === 'function') {
    for (const value of dict.values() as Iterable<unknown>) push(value);
    return found;
  }
  for (const value of Object.values(dict)) push(value);
  return found;
}

function nodeIsDescendant(ancestor: UnknownRecord, node: UnknownRecord): boolean {
  let current: UnknownRecord | null = node;
  while (current) {
    if (current === ancestor) return true;
    current = asRecord(current.parent);
  }
  return false;
}

function pickContentContainer(win: UnknownRecord): UnknownRecord {
  return asRecord(win.contentSprite)
    ?? asRecord(win.contentView)
    ?? asRecord(win.viewPanel)
    ?? asRecord(win.mView)
    ?? win;
}

function isInjectedDetailButtonNode(win: UnknownRecord, node: UnknownRecord): boolean {
  const nodeName = String(node.name ?? '');
  if (nodeName.includes('xcSkinInfo')) return true;
  for (let index = 0; index < 3; index += 1) {
    if (win[`myFuncBtn${index}`] === node) return true;
  }
  return false;
}

const PAPER_BACKGROUND_PANEL_KEYS = ['paperBgView', 'gameBgPanel', 'bgSetPanel', 'paperBgPanel'] as const;

/** 右侧「牌局背景」面板。 */
export function resolvePaperBackgroundPanel(win: UnknownRecord): UnknownRecord | null {
  for (const key of PAPER_BACKGROUND_PANEL_KEYS) {
    const direct = asRecord(win[key]);
    if (direct && direct.visible !== false) return direct;
  }
  let panel: UnknownRecord | null = null;
  walkUiNodes(win, 0, 14, (node) => {
    if (panel) return;
    for (const key of PAPER_BACKGROUND_PANEL_KEYS) {
      const nested = asRecord(node[key]);
      if (nested && nested.visible !== false) {
        panel = nested;
        return;
      }
    }
  });
  return panel;
}

/** 游戏自带的「设置背景」按钮，排除小抄自己挂的条。 */
export function findNativeSetBackgroundButton(win: UnknownRecord): UnknownRecord | null {
  let exact: UnknownRecord | null = null;
  let fuzzy: UnknownRecord | null = null;
  walkUiNodes(win, 0, 14, (node) => {
    if (isInjectedDetailButtonNode(win, node)) return;
    const label = buttonLabel(node);
    if (!label || /预览|动态效果/.test(label)) return;
    if (label === '设置背景') exact = node;
    else if (!fuzzy && /^设.*背景$/.test(label)) fuzzy = node;
  });
  return exact ?? fuzzy;
}

/** 按按钮文案在详情窗里找节点。 */
export function findUiLabelNode(win: UnknownRecord, labelPattern: RegExp): UnknownRecord | null {
  let found: UnknownRecord | null = null;
  walkUiNodes(win, 0, 14, (node) => {
    if (found || isInjectedDetailButtonNode(win, node)) return;
    const label = buttonLabel(node);
    if (label && labelPattern.test(label)) found = node;
  });
  return found;
}

function pickSkinDetailWindow(candidates: UnknownRecord[]): UnknownRecord | null {
  let best: UnknownRecord | null = null;
  let bestScore = -1;
  let bestZOrder = -Infinity;
  for (const win of candidates) {
    if (!isSkinDetailWindowCandidate(win)) continue;
    const score = rankSkinDetailWindow(win);
    const zOrder = Number(win.zOrder) || 0;
    if (score > bestScore || (score === bestScore && zOrder >= bestZOrder)) {
      best = win;
      bestScore = score;
      bestZOrder = zOrder;
    }
  }
  return best;
}

function findSkinFrameNode(win: UnknownRecord): UnknownRecord | null {
  const direct = asRecord(win.skinFrame);
  if (direct) return direct;
  let found: UnknownRecord | null = null;
  walkUiNodes(win, 0, 10, (node) => {
    if (found) return;
    if (asRecord(node.skinFrame)) return;
    const nodeName = String(node.name ?? '');
    if (nodeName === 'skinFrame' || nodeName === 'skinImg') found = node;
  });
  return found;
}

/** 详情窗上挂按钮的容器与立绘框。 */
export function resolveSkinDetailMount(win: UnknownRecord): SkinDetailMount | null {
  let skinImg = asRecord(win.skinImg);
  if (!skinImg) {
    walkUiNodes(win, 0, SKIN_DETAIL_LAYER_SCAN_DEPTH, (node) => {
      if (skinImg) return;
      const preview = skinPreviewUrl(node);
      if (preview) skinImg = asRecord(node.skinImg) ?? node;
    });
  }
  const skinFrame = findSkinFrameNode(win);
  const frame = skinFrame ?? skinImg;
  if (!frame) return null;
  const content = pickContentContainer(win);
  const frameParent = asRecord(frame.parent);
  const mountParent = frameParent && nodeIsDescendant(content, frameParent) ? frameParent : content;
  if (!mountParent) return null;
  return { mountParent, frame };
}

/** 把节点坐标换算到 content 本地坐标系。 */
export function nodeLocalInContent(content: UnknownRecord, node: UnknownRecord): { x: number; y: number } {
  if (node === content) return { x: Number(node.x) || 0, y: Number(node.y) || 0 };
  if (nodeIsDescendant(content, node)) {
    try {
      if (typeof node.localToGlobal === 'function' && typeof content.globalToLocal === 'function') {
        const point = { x: 0, y: 0 };
        callMethod(node, 'localToGlobal', point);
        callMethod(content, 'globalToLocal', point);
        return { x: Number(point.x) || 0, y: Number(point.y) || 0 };
      }
    } catch {
      // 回退到父链累加。
    }
  }
  let x = Number(node.x) || 0;
  let y = Number(node.y) || 0;
  let parent = asRecord(node.parent);
  while (parent && parent !== content) {
    x += Number(parent.x) || 0;
    y += Number(parent.y) || 0;
    parent = asRecord(parent.parent);
  }
  if (parent !== content) {
    return { x: Number(node.x) || 0, y: Number(node.y) || 0 };
  }
  return { x, y };
}

/** 当前打开的皮肤详情窗。 */
export function resolveSkinDetailWindow(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow = globalThis as LayaRuntimeWindow,
  probe?: SkinDetailResolveProbe
): UnknownRecord | null {
  const dictKeys: string[] = [];
  const candidates: UnknownRecord[] = [];
  const addCandidate = (win: UnknownRecord | null | undefined) => {
    if (!win || win.destroyed || win.visible === false) return;
    if (candidates.includes(win)) return;
    candidates.push(win);
  };
  for (const name of SKIN_DETAIL_WINDOW_NAMES) {
    dictKeys.push(name);
    addCandidate(locator.window(name));
    for (const win of locator.findWindows(name)) addCandidate(win);
  }
  for (const win of collectWindowManagerInstances(locator)) addCandidate(win);
  for (const win of collectWindowLayerNodes(globalObject)) addCandidate(win);
  const picked = pickSkinDetailWindow(candidates);
  if (probe) {
    probe.dictKeys = dictKeys;
    probe.layerHits = candidates.length;
    probe.picked = picked ? windowClassName(picked) : '';
  }
  return picked ?? null;
}

/** 是否竖版详情：优先读 skinData，并用立绘宽高兜底。 */
export function isPortraitSkinDetail(win: UnknownRecord, frame: UnknownRecord | null = null): boolean {
  const data = asRecord(win.skinData);
  const base = asRecord(data?.skinBaseVo);
  const is169 = win.is169 ?? win.Is169 ?? data?.Is169 ?? base?.Is169;
  const isHorizontal = win.isHor ?? win.isHorizontal ?? win.IsHor
    ?? data?.IsBanner ?? data?.IsHor ?? base?.IsBanner ?? base?.IsHor;
  if (is169 === true || is169 === 1 || isHorizontal === true || isHorizontal === 1) return false;
  const layoutFrame = frame ?? asRecord(win.skinFrame) ?? asRecord(win.skinImg);
  if (layoutFrame) {
    const width = Number(layoutFrame.width) || 0;
    const height = Number(layoutFrame.height) || 0;
    if (width > height) return false;
  }
  return !is169 && !isHorizontal;
}

/** 三个操作条贴在立绘框上方居中，坐标相对 mountParent。 */
export function computeDetailButtonLayout(
  win: UnknownRecord,
  frame: UnknownRecord,
  mountParent: UnknownRecord
): DetailButtonLayout {
  const frameWidth = Number(frame.width) || 360;
  const totalWidth = Math.min(360, frameWidth);
  const frameLocal = nodeLocalInContent(mountParent, frame);
  return {
    left: frameLocal.x + frameWidth / 2 - totalWidth / 2,
    top: frameLocal.y - SKIN_DETAIL_BUTTON_HEIGHT - SKIN_DETAIL_BUTTON_ABOVE_FRAME_GAP,
    totalWidth
  };
}

function bindNativeClick(
  patcher: MethodPatcher,
  target: UnknownRecord,
  marker: string,
  onClick: () => void
): boolean {
  if (target[marker]) return true;
  const eventName = String(asRecord(asRecord(target.constructor)?.prototype)?.CLICK ?? 'click');
  if (typeof target.onClick === 'function' && !patcher.isWrapped(target, 'onClick')) {
    patcher.wrap(target, 'onClick', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      const result = original.apply(this, args);
      void onClick();
      return result;
    });
    target[marker] = true;
    return true;
  }
  if (typeof target.on === 'function') {
    callMethod(target, 'on', eventName, target, (clickEvent: unknown) => {
      callMethod(clickEvent, 'stopPropagation');
      void onClick();
    });
    target[marker] = true;
    return true;
  }
  return false;
}

/**
 * 绑定游戏自带的「设为背景 / 保存 / 收藏」按钮，避免与 myFuncBtn 重复一排。
 */
export function wireNativeSkinDetailButtons(
  win: UnknownRecord,
  patcher: MethodPatcher,
  handlers: {
    save: () => void | Promise<void>;
    background: () => void | Promise<void>;
    favorite: () => void | Promise<void>;
  }
): NativeSkinDetailSlots {
  const slots: NativeSkinDetailSlots = { save: false, background: false, favorite: false };
  walkUiNodes(win, 0, 12, (node) => {
    if (isInjectedDetailButtonNode(win, node)) return;
    const label = buttonLabel(node);
    if (!label || /预览|动态效果|配音/.test(label)) return;
    if (!slots.background && (label === '设置背景' || /^设.*背景$/.test(label))) {
      slots.background = bindNativeClick(patcher, node, '__xcPaperNativeBackground', () => { void handlers.background(); });
    }
    if (!slots.save && /保存|下载/.test(label)) {
      slots.save = bindNativeClick(patcher, node, '__xcPaperNativeSave', () => { void handlers.save(); });
    }
    if (!slots.favorite && /收藏/.test(label)) {
      slots.favorite = bindNativeClick(patcher, node, '__xcPaperNativeFavorite', () => { void handlers.favorite(); });
    }
  });
  return slots;
}

/** 详情窗打开后再补挂按钮，不包装 showRightInfo 等预览热路径。 */
export function hookSkinDetailWindowRefresh(
  win: UnknownRecord,
  patcher: MethodPatcher,
  onRefresh: () => void
): void {
  if (win[SKIN_DETAIL_WINDOW_HOOK]) return;
  win[SKIN_DETAIL_WINDOW_HOOK] = true;
  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    const timer = asRecord(globalThis)?.setTimeout as ((fn: () => void, ms: number) => number) | undefined;
    const run = () => {
      pending = false;
      try {
        onRefresh();
      } catch {
        // 补挂失败时不打断原窗口逻辑。
      }
    };
    if (typeof timer === 'function') timer(run, 200);
    else run();
  };
  if (typeof win.onShow === 'function' && !patcher.isWrapped(win, 'onShow')) {
    patcher.wrap(win, 'onShow', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      const result = original.apply(this, args);
      schedule();
      return result;
    });
  }
}

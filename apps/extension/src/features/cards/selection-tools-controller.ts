/**
 * 选牌窗工具条：在 SelectCardWindow 叠加全选、反选、快速选择。
 */

import { createLayaObjectLocator, type LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';

type Node = Record<string, any>;
const ROOT_KEY = '__xcSelectionTools';

/** SelectCardWindow 的轻量增强：全选、反选、按合法数量快速选择。 */
export function installSelectionToolsController(runtime: LayaRuntimeWindow = window as LayaRuntimeWindow): () => void {
  const locator = createLayaObjectLocator(runtime);
  const states = new Set<Node>();
  let stopped = false;

  /** 轮询：为打开的选牌窗挂工具条，清理已销毁窗口状态。 */
  function sync(): void {
    if (stopped) return;
    const windows = [...locator.findWindows('SelectCardWindow')];
    const current = new Set(windows);
    for (const state of states) {
      if (!current.has(state) || state.destroyed) destroy(state);
    }
    for (const win of windows) attach(win);
  }

  /** 在选牌窗确认按钮旁创建全选/反选/快速选择按钮。 */
  function attach(win: Node): void {
    if (win[ROOT_KEY] || !readCards(win).length) return;
    const laya = runtime.Laya as Node | undefined;
    const Text = laya?.Text;
    if (typeof Text !== 'function') return;
    const root = new Text() as Node;
    root.name = 'xcSelectionTools';
    root.size?.(230, 28);
    root.mouseEnabled = true;
    root.zOrder = 1000;
    const reference = win.btnOK ?? win.sureBtn ?? win.btnSure;
    const baseX = Number(reference?.x ?? 0);
    const baseY = Number(reference?.y ?? Number(win.height ?? 600) - 42);
    root.pos?.(baseX - 230, baseY);
    (win.content ?? win.box ?? win).addChild?.(root);
    const actions: Array<[string, () => void]> = [
      ['全选', () => apply(win, 'all')],
      ['反选', () => apply(win, 'invert')],
      ['快速选择', () => apply(win, 'quick')]
    ];
    actions.forEach(([label, action], index) => {
      const button = new Text() as Node;
      button.text = label;
      button.size?.(70, 26);
      button.pos?.(index * 74, 0);
      button.fontSize = 14;
      button.align = 'center';
      button.valign = 'middle';
      button.color = '#f2de9c';
      button.bgColor = '#342f28';
      button.mouseEnabled = true;
      button.on?.(String(laya?.Event?.CLICK ?? 'click'), root, action);
      root.addChild?.(button);
    });
    win[ROOT_KEY] = root;
    states.add(win);
  }

  /** 移除工具条 DOM 并清除窗口上的状态键。 */
  function destroy(win: Node): void {
    const root = win[ROOT_KEY] as Node | undefined;
    root?.removeSelf?.();
    root?.destroy?.(true);
    delete win[ROOT_KEY];
    states.delete(win);
  }

  const timer = runtime.setInterval(sync, 250);
  sync();
  return () => {
    stopped = true;
    runtime.clearInterval(timer);
    [...states].forEach(destroy);
  };
}

/** 读取选牌窗内可选卡牌 UI 列表。 */
function readCards(win: Node): Node[] {
  const container = win.cardContainer ?? win;
  const lists = [
    container.handCardUis,
    container.cardUis,
    container.equipCardUis,
    container.equipCardUIs,
    container.activatedCardtems,
    container.activatedCardItems,
    container.selectCardUis,
    win.selectCardUis,
    win.cardUis,
    win.cardUIs,
    win.itemUis,
    win.itemList
  ];
  const cards = lists.flatMap((list) => Array.isArray(list) ? list : []);
  return [...new Set(cards)];
}

function cardId(card: Node): number {
  const inner = card.Card ?? card.theCard ?? card;
  const raw = inner.CardID ?? inner.cardId ?? inner.ID ?? card.CardID ?? card.cardId;
  const id = Number(raw);
  return Number.isFinite(id) ? id : 0;
}

function selected(win: Node, card: Node): boolean {
  const container = win.cardContainer ?? win;
  const chosen = new Set([
    ...(Array.isArray(container.selectCardUis) ? container.selectCardUis : []),
    ...(Array.isArray(container.selectedCardUis) ? container.selectedCardUis : []),
    ...(Array.isArray(win.selectCardUis) ? win.selectCardUis : [])
  ]);
  if (chosen.has(card)) return true;
  const inner = card.Card ?? card.theCard;
  const flags = [card.selected, card.Selected, card.isSelected, inner?.Selected, inner?.selected];
  if (flags.some((flag) => flag === true)) return true;
  const context = container.SelectContext ?? container.selectCardContext ?? win.SelectContext ?? win.selectCardContext;
  const ids = new Set((Array.isArray(context?.SelectedCardIds) ? context.SelectedCardIds : []).map(Number));
  const id = cardId(card);
  return id > 0 && ids.has(id);
}

function selectable(card: Node): boolean {
  return card.disabled !== true && card.gray !== true && card.visible !== false;
}

function limits(win: Node, count: number): { min: number; max: number } {
  const container = win.cardContainer ?? win;
  const context = container.SelectContext ?? container.selectCardContext ?? win.SelectContext ?? win.selectCardContext ?? {};
  const min = Math.max(0, Number(context.SelectCountMin ?? win.SelectCountMin ?? win.selectCountMin ?? win.TargetCountMin) || 0);
  const rawMax = Number(context.SelectCountMax ?? context.TargetCountMax ?? win.TargetCountMax ?? win.SelectCountMax ?? win.selectCountMax);
  const max = rawMax > 0 ? rawMax : count;
  return { min, max: Math.max(min, Math.min(count, max)) };
}

function toggleCard(win: Node, card: Node): void {
  if (typeof card.CardUI_Click === 'function') {
    card.CardUI_Click(null);
    return;
  }
  for (const method of ['onSelectedClicked', 'onTouchCard']) {
    if (typeof win[method] === 'function') {
      win[method](card);
      return;
    }
  }
  for (const method of ['setSelected', 'SetSelected']) {
    if (typeof card[method] === 'function') {
      card[method](!selected(win, card));
      return;
    }
  }
}

/** 按动作改写选中态：全选、反选、或选满合法数量。 */
function apply(win: Node, action: 'all' | 'invert' | 'quick'): void {
  const cards = readCards(win).filter(selectable);
  const { min, max } = limits(win, cards.length);
  const selectedCards = cards.filter((card) => selected(win, card));
  const target = action === 'all'
    ? cards.slice(0, max)
    : action === 'invert'
      ? cards.filter((card) => !selected(win, card)).slice(0, max)
      : cards.slice(0, Math.max(min, Math.min(max, selectedCards.length || max)));
  const wanted = new Set(target);
  for (const card of cards) {
    if (selected(win, card) && !wanted.has(card)) toggleCard(win, card);
  }
  for (const card of cards) {
    if (!selected(win, card) && wanted.has(card)) toggleCard(win, card);
  }
  for (const method of ['UpdateSelectCards', 'updateSelectCards', 'UpdateButtonState', 'updateButtonState']) {
    if (typeof win[method] === 'function') {
      win[method]();
      break;
    }
  }
}

/**
 * 背景面板里三个官方列表（主题、静态皮肤、动态皮肤）共用同一种勾，
 * 这里负责按本地选择的背景编号统一画勾。
 */

import {
  WALLPAPER_CHOICE_LIST_KEYS,
  WALLPAPER_SELECTED_MARK_Z_ORDER
} from '../../const/wallpaper-menu.ts';
import { asRecord, callMethod, type UnknownRecord } from './skin-runtime.ts';

/** 背景格子的编号。主题格子是 id，皮肤和动态皮肤格子是 data.ID。 */
export function wallpaperItemId(item: UnknownRecord): number {
  return Number(item.ID ?? item.Id ?? item.id ?? asRecord(item.data)?.ID ?? 0);
}

/**
 * 把勾放到格子的最上层。
 * 游戏的 setChildIndex 只收 0 到 子节点数减一，传子节点数会抛错，
 * 抛错会打断整个列表刷新，让别的格子的旧勾留着不清。
 */
export function raiseWallpaperSelectedMark(item: UnknownRecord, mark: UnknownRecord): void {
  const lastIndex = (Number(item.numChildren) || 0) - 1;
  if (lastIndex < 0) return;
  try {
    callMethod(item, 'setChildIndex', mark, lastIndex);
  } catch {
    // 勾不是这个格子的直接子节点时保持原层级，不能因此中断列表刷新。
  }
}

/** 显示或隐藏单个格子的勾，显示时放到最上层。 */
export function showWallpaperSelectedMark(item: UnknownRecord, selected: boolean): void {
  const mark = asRecord(item.selectedImg);
  if (!mark) return;
  mark.visible = selected;
  mark.zOrder = WALLPAPER_SELECTED_MARK_Z_ORDER;
  if (selected) raiseWallpaperSelectedMark(item, mark);
}

/** 背景面板上三个官方列表里还没销毁的格子。 */
export function wallpaperChoiceItems(menu: UnknownRecord): UnknownRecord[] {
  const items: UnknownRecord[] = [];
  for (const key of WALLPAPER_CHOICE_LIST_KEYS) {
    const list = menu[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const item = asRecord(entry);
      if (item && item.destroyed !== true) items.push(item);
    }
  }
  return items;
}

/** 三个列表里只有编号等于 chosenId 的格子有勾；chosenId 不是正数时全部清掉。 */
export function paintWallpaperSelectionMarks(menu: UnknownRecord, chosenId: number): void {
  for (const item of wallpaperChoiceItems(menu)) {
    showWallpaperSelectedMark(item, chosenId > 0 && wallpaperItemId(item) === chosenId);
  }
}

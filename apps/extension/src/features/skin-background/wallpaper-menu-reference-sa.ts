/**
 * 背景菜单页签就绪后的挂载顺序。
 * 皮肤做背景开着时先准备官方列表，否则只准备官方面板，然后再挂小抄页签。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { mayMutateSkinBackground } from './skin-background-session.ts';
import type { UnknownRecord } from './skin-runtime.ts';

export interface WallPaperMenuSaBranchHooks {
  /** 皮肤做背景开着，才挂小抄页签。 */
  skinPaperExtensionEnabled(): boolean;
  officialBackgroundEnabled(): boolean;
  /** 准备官方列表：拉数据、刷新、去锁。 */
  runSjPrepare(menu: UnknownRecord): void;
  /** 不准备官方列表时，只保证官方面板能显示。 */
  runSsPrepare(menu: UnknownRecord): void;
  /** 挂上小抄页签，并接管页签点击。 */
  runSeAttach(menu: UnknownRecord, topMenu: UnknownRecord | null): void;
  /** 仅官方背景开、小抄关：刷新解锁态并摘扩展。 */
  runOfficialWithoutExtension(menu: UnknownRecord): void;
}

/** 皮肤做背景开着，且当前场景允许改背景时，才走官方列表准备。 */
export function shouldRunWallPaperMenuSjPath(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow,
  skinPaperEnabled: () => boolean
): boolean {
  if (!skinPaperEnabled()) return false;
  return mayMutateSkinBackground(locator, globalObject, skinPaperEnabled);
}

/** 页签就绪后：先准备官方列表或官方面板，再挂小抄页签。 */
export function runWallPaperMenuReferenceSa(
  menu: UnknownRecord,
  topMenu: UnknownRecord | null,
  sjPath: boolean,
  hooks: WallPaperMenuSaBranchHooks
): void {
  if (sjPath) hooks.runSjPrepare(menu);
  else hooks.runSsPrepare(menu);

  if (hooks.skinPaperExtensionEnabled()) {
    hooks.runSeAttach(menu, topMenu);
    return;
  }
  if (hooks.officialBackgroundEnabled()) {
    hooks.runOfficialWithoutExtension(menu);
  }
}

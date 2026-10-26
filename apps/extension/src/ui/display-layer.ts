/**
 * 小抄 DOM 浮层与游戏 Laya 层的边界：挂载点、z-index、DOM 扫描豁免。
 * Laya 扩展节点 zOrder 上限见 runtime/game-tip-layer.ts 的 EXTENSION_Z_BELOW_GAME_TIP。
 * 游戏原生弹窗保护见 runtime/game-native-dialog.ts。
 */

export const XIAOCHAO_APP_ROOT_ID = 'xiaochao-app';
export const XIAOCHAO_DIALOG_HOST_ID = 'xiaochao-dialog-host';
export const XIAOCHAO_PANEL_ID = 'createIframe';

/** 与 panel-shell-styles、BaseDialog、TooltipLayer 一致。 */
export const DOM_OVERLAY_Z = {
  panel: 2147483600,
  dialogBackdrop: 2147483601,
  dialog: 2147483602,
  tooltip: 2147483647,
  toast: 2147483647,
} as const;

const XIAOCHAO_DOM_SELECTOR = `#${XIAOCHAO_APP_ROOT_ID}, #${XIAOCHAO_DIALOG_HOST_ID}, #${XIAOCHAO_PANEL_ID}`;

/** 狗托 DOM 兜底扫描、其它按文案隐藏 DOM 时须跳过小抄面板与弹窗。 */
export function isXiaochaoOverlayElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const id = element.id;
  if (id === XIAOCHAO_APP_ROOT_ID || id === XIAOCHAO_DIALOG_HOST_ID || id === XIAOCHAO_PANEL_ID) {
    return true;
  }
  return Boolean(element.closest(XIAOCHAO_DOM_SELECTOR));
}

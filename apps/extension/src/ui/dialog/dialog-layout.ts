/** 小抄面板内对话框尺寸与居中点，保证不超出面板与视口。 */

export const DIALOG_PANEL_INSET = 12;
export const DIALOG_DEFAULT_MAX_WIDTH = 320;
export const DIALOG_MIN_WIDTH = 168;

export interface DialogLayout {
  width: number;
  centerX: number;
  centerY: number;
  maxHeight: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export function layoutDialogInPanel(
  rect: DOMRect,
  viewport: ViewportSize,
  maxWidth = DIALOG_DEFAULT_MAX_WIDTH
): DialogLayout {
  const inset = DIALOG_PANEL_INSET;
  const availableW = Math.max(DIALOG_MIN_WIDTH, rect.width - inset * 2);
  const width = Math.min(maxWidth, availableW, Math.max(DIALOG_MIN_WIDTH, viewport.width - inset * 2));
  const maxHeight = Math.max(
    120,
    Math.min(rect.height - inset * 2, viewport.height - inset * 2)
  );

  const halfW = width / 2;
  let centerX = rect.left + rect.width / 2;
  let centerY = rect.top + rect.height / 2;

  centerX = clampCenter(centerX, rect.left + inset + halfW, rect.right - inset - halfW);
  centerX = clampCenter(centerX, inset + halfW, viewport.width - inset - halfW);

  const halfH = maxHeight / 2;
  centerY = clampCenter(centerY, rect.top + inset + halfH, rect.bottom - inset - halfH);
  centerY = clampCenter(centerY, inset + halfH, viewport.height - inset - halfH);

  return { width, centerX, centerY, maxHeight };
}

function clampCenter(value: number, min: number, max: number): number {
  if (min > max) return value;
  return Math.min(Math.max(value, min), max);
}

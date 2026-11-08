/** 停靠后折叠成右上角小条时，游戏让出的宽度。 */
export const DOCK_COLLAPSED_PANEL_WIDTH = 96;

/** 贴边展开的侧栏至少这么宽，才拿来让出游戏区域。更窄的是折叠过渡帧。 */
export const DOCK_EXPANDED_RESERVE_MIN_WIDTH = 160;

/** 展开宽度都读不到时，按默认侧栏宽度让出。 */
export const DOCK_RESERVE_FALLBACK_WIDTH = 340;

/** 停靠且已折叠时让出折叠宽度。展开宽度只在贴边展开时使用。 */
export function resolveDockedReserveWidth(input: {
  collapsed: boolean;
  ownedWidth: number;
  expandedWidth: number;
  rectWidth: number;
}): number {
  if (input.collapsed) return DOCK_COLLAPSED_PANEL_WIDTH;
  const solid = [input.ownedWidth, input.expandedWidth].filter(
    (width) => Number.isFinite(width) && width >= DOCK_EXPANDED_RESERVE_MIN_WIDTH
  );
  if (solid.length) return Math.round(Math.max(...solid));
  if (Number.isFinite(input.rectWidth) && input.rectWidth >= DOCK_EXPANDED_RESERVE_MIN_WIDTH) {
    return Math.round(input.rectWidth);
  }
  return Math.round(Math.max(
    input.ownedWidth || 0,
    input.expandedWidth || 0,
    input.rectWidth || 0,
    DOCK_RESERVE_FALLBACK_WIDTH
  ));
}

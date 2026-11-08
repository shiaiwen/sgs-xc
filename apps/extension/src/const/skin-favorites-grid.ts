/** 收藏背景列表网格：起始偏移、列宽、行高、每行列数。 */
export const SKIN_FAVORITES_GRID_ORIGIN_X = 5;
export const SKIN_FAVORITES_GRID_ORIGIN_Y = 1;
export const SKIN_FAVORITES_GRID_COLUMN_STEP = 101;
export const SKIN_FAVORITES_GRID_ROW_STEP = 65;
export const SKIN_FAVORITES_GRID_COLUMNS = 3;

/** 收藏格透明点击热区宽高，略小于网格步长以免误触邻格。 */
export const SKIN_FAVORITES_ITEM_HIT_WIDTH = SKIN_FAVORITES_GRID_COLUMN_STEP - 6;
export const SKIN_FAVORITES_ITEM_HIT_HEIGHT = SKIN_FAVORITES_GRID_ROW_STEP - 4;

/** 收藏格左上角绿勾的边长。 */
export const SKIN_FAVORITES_SELECTED_MARK_SIZE = 16;

/** 收藏格右上角删除热区边长。正在使用的那张不画。 */
export const SKIN_FAVORITES_DELETE_SIZE = 18;

/** 按下和松开都会进来，这段时间里只删一张。 */
export const SKIN_FAVORITES_DELETE_GESTURE_MS = 500;

export function skinFavoritesDeleteZoneContains(localX: number, localY: number): boolean {
  const left = SKIN_FAVORITES_ITEM_HIT_WIDTH - SKIN_FAVORITES_DELETE_SIZE;
  return localX >= left
    && localX <= SKIN_FAVORITES_ITEM_HIT_WIDTH
    && localY >= 0
    && localY <= SKIN_FAVORITES_DELETE_SIZE;
}

export function skinFavoritesGridPosition(index: number): { offsetX: number; offsetY: number } {
  const column = index % SKIN_FAVORITES_GRID_COLUMNS;
  const row = Math.floor(index / SKIN_FAVORITES_GRID_COLUMNS);
  return {
    offsetX: SKIN_FAVORITES_GRID_ORIGIN_X + SKIN_FAVORITES_GRID_COLUMN_STEP * column,
    offsetY: SKIN_FAVORITES_GRID_ORIGIN_Y + SKIN_FAVORITES_GRID_ROW_STEP * row
  };
}

/** 面板本地坐标落在第几个收藏格；越界或空白格返回 -1。 */
export function skinFavoritesIndexAtLocalPoint(
  localX: number,
  localY: number,
  itemCount: number
): number {
  const offsetX = localX - SKIN_FAVORITES_GRID_ORIGIN_X;
  const offsetY = localY - SKIN_FAVORITES_GRID_ORIGIN_Y;
  if (offsetX < 0 || offsetY < 0 || itemCount <= 0) return -1;
  const column = Math.floor(offsetX / SKIN_FAVORITES_GRID_COLUMN_STEP);
  const row = Math.floor(offsetY / SKIN_FAVORITES_GRID_ROW_STEP);
  if (column < 0 || column >= SKIN_FAVORITES_GRID_COLUMNS) return -1;
  const index = row * SKIN_FAVORITES_GRID_COLUMNS + column;
  if (index < 0 || index >= itemCount) return -1;
  return index;
}

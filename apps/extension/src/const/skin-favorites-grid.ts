/** 收藏背景列表网格：起始偏移、列宽、行高、每行列数。 */
export const SKIN_FAVORITES_GRID_ORIGIN_X = 5;
export const SKIN_FAVORITES_GRID_ORIGIN_Y = 1;
export const SKIN_FAVORITES_GRID_COLUMN_STEP = 101;
export const SKIN_FAVORITES_GRID_ROW_STEP = 65;
export const SKIN_FAVORITES_GRID_COLUMNS = 3;

export function skinFavoritesGridPosition(index: number): { offsetX: number; offsetY: number } {
  const column = index % SKIN_FAVORITES_GRID_COLUMNS;
  const row = Math.floor(index / SKIN_FAVORITES_GRID_COLUMNS);
  return {
    offsetX: SKIN_FAVORITES_GRID_ORIGIN_X + SKIN_FAVORITES_GRID_COLUMN_STEP * column,
    offsetY: SKIN_FAVORITES_GRID_ORIGIN_Y + SKIN_FAVORITES_GRID_ROW_STEP * row
  };
}

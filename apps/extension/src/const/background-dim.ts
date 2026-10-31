/** 背景压暗系数，避免抢牌局前景。颜色矩阵里其余位置保持原通道。 */

export const BACKGROUND_DIM_CHANNEL = 0.8;

export const BACKGROUND_DIM_MATRIX = [
  BACKGROUND_DIM_CHANNEL, 0, 0, 0, 0,
  0, BACKGROUND_DIM_CHANNEL, 0, 0, 0,
  0, 0, BACKGROUND_DIM_CHANNEL, 0, 0,
  0, 0, 0, 1, 0
];

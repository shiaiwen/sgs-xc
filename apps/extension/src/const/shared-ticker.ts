/** 共用定时器的对齐刻度，单位毫秒。任务的到点时间都落在这个刻度上，同一刻到点的一起跑。 */
export const SHARED_TICKER_GRID_MS = 50;

/** 到点时间相差不超过这么多毫秒的任务算同一刻，一起跑。 */
export const SHARED_TICKER_DUE_TOLERANCE_MS = 4;

/** 一批任务连着跑超过这么多毫秒，剩下的放到紧接着的下一轮，中间让游戏有机会画一帧。 */
export const SHARED_TICKER_BATCH_BUDGET_MS = 8;

/** 开启「屏蔽 MVP」时要跳过的牌局结算类窗口名。 */
export const MVP_BLOCK_WINDOW_NAMES = [
  'GameResultWindow',
  'GameMvpWindow',
  'GameZhanJiWindow',
  'RogueLike1v1ZhanJiWindow'
] as const;

/** 旧版在窗口就绪后等待动画初始化，再推进一次游戏结算流程。 */
export const MVP_CLOSE_DELAY_MS = 400;

/** 轮询等待窗口实例出现在 WindowManager 中。 */
export const MVP_WINDOW_POLL_RETRIES = 80;

export const MVP_WINDOW_POLL_INTERVAL_MS = 100;

/** 轮询等待窗口结束 isShowWait 加载态。 */
export const MVP_SHOW_WAIT_POLL_RETRIES = 120;

export const MVP_SHOW_WAIT_POLL_INTERVAL_MS = 50;

export function isMvpBlockWindowName(name: unknown): name is (typeof MVP_BLOCK_WINDOW_NAMES)[number] {
  return typeof name === 'string'
    && (MVP_BLOCK_WINDOW_NAMES as readonly string[]).includes(name);
}

export function isMvpSettlementWindowName(name: string): boolean {
  return name === 'GameResultWindow' || name === 'GameMvpWindow' || name === 'GameZhanJiWindow';
}

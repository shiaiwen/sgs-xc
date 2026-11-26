/** 房间就绪等场景的短时重试。 */
export const CHOOSE_FIGURE_APPLY_BURST_MS = [0, 100, 300, 800, 2000] as const;

/** 新一局开局后座位 Figure 常被游戏稍后清零，拉长时间窗补写。 */
export const CHOOSE_FIGURE_APPLY_FRESH_BURST_MS = [
  100, 300, 800, 2000, 4000, 8000, 12000, 20000, 30000
] as const;

/** 本机座位技能变化时补写身份，对照游戏 figureOut 时机。 */
export const CHOOSE_FIGURE_SKILL_CHANGE_EVENT = 'SKILL_CHANGE';

/** 房间座位表更新时触发一次身份写入尝试。 */
export const CHOOSE_FIGURE_READY_PROTOCOL_NAMES = ['GsCReadyResp', 'ClientEnterTableRep'] as const;
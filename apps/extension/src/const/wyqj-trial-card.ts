/** 大厅「我要强将」每日体验卡：TaskManager 标记与列表就绪前的重试间隔。 */
export const WYQJ_TRIAL_CARD_RETRY_DELAY_MS = 6000;

/** 单次自动领取流程内最多补试次数。 */
export const WYQJ_TRIAL_CARD_RETRY_MAX = 5;

/** 拉取 WyqjSmallView 配置时依次尝试的强将档位。 */
export const WYQJ_TRIAL_CARD_NEED_LEVELS = [0, 1, 2, 3, 4] as const;

/** 同步 TaskManager 后再读体验列表的等待毫秒数。 */
export const WYQJ_TRIAL_CARD_AFTER_SYNC_MS = 500;

/** 从 WindowLayer 显示树里查找 Wyqj 相关视图时的节点上限。 */
export const WYQJ_VIEW_DISPLAY_SCAN_MAX = 250;

/** 体验武将界面在游戏里的视图类名。 */
export const WYQJ_TRIAL_VIEW_CLASS_NAMES = ['WyqjSmallView', 'WyqjBigView'] as const;

/** 每个 Wyqj 视图内遍历显示树找 generalId 的节点上限。 */
export const WYQJ_VIEW_CELL_SCAN_MAX = 400;

/** 用 ShowWindow 临时打开体验弹窗后等待渲染的毫秒数。 */
export const WYQJ_TRIAL_CARD_OPEN_WINDOW_MS = 800;

/** 读不到任务主配置表时，体验卡单次请求里武将 id 个数上限的兜底值。 */
export const WYQJ_TRIAL_CARD_DEFAULT_SEND_LIMIT = 50;

/** 游戏内任务主配置单例的文件名，用于在运行时定位 Qwt。 */
export const TASK_MAIN_CONFIG_FILE_NAME = 'sys_h5_task_main';
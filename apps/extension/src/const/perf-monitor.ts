/** 页面卡住超过这么久算一次卡顿，要记下来，单位毫秒。 */
export const STALL_REPORT_MS = 500;

/** 小抄耗时按这么长一格累计，卡顿时把卡住那段时间的格子加起来，单位毫秒。 */
export const PERF_COST_BUCKET_MS = 100;

/** 留多少格耗时。格数乘格长就是能回看的时长，要比最长的卡顿还长。 */
export const PERF_COST_BUCKET_COUNT = 600;

/** 最多留多少条卡顿记录。 */
export const STALL_HISTORY_SIZE = 20;

/** 一条卡顿记录里最多列几个功能。 */
export const STALL_REPORT_TOP_FEATURES = 5;

/** 一条卡顿记录里最多列几个最耗时的脚本。 */
export const STALL_REPORT_TOP_SCRIPTS = 3;

/** 脚本文件名最多显示几个字，带版本参数的长网址截掉后面。 */
export const STALL_SCRIPT_NAME_MAX_LENGTH = 80;

/** 小抄耗时占卡顿时长不到这个比例时，判定卡顿主要不是小抄造成的。 */
export const STALL_XIAOCHAO_SHARE_THRESHOLD = 0.2;

/** 累计耗时取整的倍数：乘上它取整再除回去，毫秒数保留一位小数。 */
export const PERF_TOTAL_ROUNDING = 10;

/** 小抄解析游戏协议这一段的名字。 */
export const PROTOCOL_PARSE_LABEL = '协议解析';

/** 游戏事件分发计时名字的前缀，后面接事件名。 */
export const GAME_EVENT_LABEL_PREFIX = '事件 ';

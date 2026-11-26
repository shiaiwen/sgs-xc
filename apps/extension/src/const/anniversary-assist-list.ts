/** 单方向列表核验最多翻页次数，防止异常游标空转。 */
export const ANNIVERSARY_LIST_VERIFY_MAX_PAGES = 40;

/** 绑定结果核验时间窗：任务开始前。 */
export const ANNIVERSARY_BIND_VERIFY_BEFORE_MS = 60_000;

/** 绑定结果核验时间窗：任务结束后。 */
export const ANNIVERSARY_BIND_VERIFY_AFTER_MS = 5 * 60_000;
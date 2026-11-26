/** 本届周年庆每日互绑活动编号，换届时改这里和活动时间。 */
export const ANNIVERSARY_ASSIST_ACT_ID = 1;

/** 北京时间。 */
export const ANNIVERSARY_ASSIST_WINDOW_START_MS = Date.parse('2026-11-24T10:00:00+08:00');
export const ANNIVERSARY_ASSIST_WINDOW_END_MS = Date.parse('2026-12-13T23:59:59+08:00');

export const ANNIVERSARY_ASSIST_DAILY_BIND_LIMIT = 3;
export const ANNIVERSARY_ASSIST_DAILY_RECEIVE_LIMIT = 3;

export const ANNIVERSARY_ASSIST_INVITE_CODE_PATTERN = /^[A-Za-z0-9]{8}$/;

export const ANNIVERSARY_ASSIST_CREDIT_ACCOUNT_PATTERN = /^[0-9]{0,32}$/;

export const ANNIVERSARY_BIND_WAIT_MS = 16_000;
export const ANNIVERSARY_BIND_POLL_MS = 200;
export const ANNIVERSARY_LIST_VERIFY_DIRECTIONS = [2, 1] as const;

export const ANNIVERSARY_ASSIST_REFRESH_EVENT = 'xc:anniversary-binding-refresh';
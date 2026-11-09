/** 祈愿台、翻翻乐等出货窗口。 */
export const PROB_SPECIAL_WINDOW = 'GetPropSpecialWindow';
/** 获得新武将窗口。 */
export const PROB_NEW_GENERAL_WINDOW = 'GetNewGeneralWindow';
/** 获得新皮肤窗口。 */
export const PROB_NEW_SKIN_WINDOW = 'SkinNewGetWin';
/** 获得限定道具窗口。 */
export const PROB_LIMITED_PROP_WINDOW = 'GetPropXianDingWindow';

export const PROB_WINDOW_NAMES: readonly string[] = [
  PROB_SPECIAL_WINDOW,
  PROB_NEW_GENERAL_WINDOW,
  PROB_NEW_SKIN_WINDOW,
  PROB_LIMITED_PROP_WINDOW
];

/** 打开窗口时第几个参数等于这个值，表示是从图鉴等地方查看，不是抽到的。 */
export const PROB_WINDOW_PREVIEW_ARG_VALUE = -1;
/** 获得新武将窗口：表示查看模式的参数位置。 */
export const PROB_NEW_GENERAL_PREVIEW_ARG_INDEX = 6;
/** 获得新皮肤窗口：表示查看模式的参数位置。 */
export const PROB_NEW_SKIN_PREVIEW_ARG_INDEX = 2;
/** 启动后找出货窗口类的重试次数和间隔；找不到的等第一次打开时再补装。 */
export const PROB_WINDOW_INSTALL_RETRIES = 40;
export const PROB_WINDOW_INSTALL_INTERVAL_MS = 1500;
/** 打开窗口时官阶点数是否已经到了的参数位置。 */
export const PROB_WINDOW_OFFICER_READY_ARG_INDEX = 5;

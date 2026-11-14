/** 视频背景等第一帧可播放的最长时间。 */
export const BACKGROUND_VIDEO_CAN_PLAY_WAIT_MS = 500;

/**
 * 帧循环里两次往显卡传视频画面的最小间隔，约每秒三十次。
 * 比 1000/30 略小：60 赫兹屏幕两帧之间有抖动，留一点余量才能稳定地隔一帧传一次。
 */
export const BACKGROUND_VIDEO_MIN_FRAME_INTERVAL_MS = 32;

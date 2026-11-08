/** 静态皮肤底图 loadImage 后等待可显示的最长轮询次数与间隔。 */
export const SKIN_BACKGROUND_MOUNT_POLL_MS = 100;
export const SKIN_BACKGROUND_MOUNT_MAX_ATTEMPTS = 150;

/** 收藏设背景时，背景层还没接住就隔这么久再放一次。 */
export const FAVORITE_BACKGROUND_PLACE_INTERVAL_MS = 200;

/** 同一次点击里最多再放这么多次，避免第一次失败还要点第二次。 */
export const FAVORITE_BACKGROUND_PLACE_ATTEMPTS = 8;

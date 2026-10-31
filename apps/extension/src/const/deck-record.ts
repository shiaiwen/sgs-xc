/** 牌堆主人。公共牌堆不属于某个座位。 */
export const DRAW_PILE_OWNER_ID = 0xff;

/** 移牌区域。1 是牌堆，2 是弃牌堆。 */
export const DRAW_PILE_ZONE = 1;
export const DISCARD_ZONE = 2;

/** 牌在牌堆里的位置。顶、底、协议里未写明。 */
export const DRAW_PILE_TOP_POSITION = 0xff00;
export const DRAW_PILE_BOTTOM_POSITION = 0;
export const UNSPECIFIED_POSITION = 0xff02;

/** 记牌最多留下的移动条数和弃牌张数。 */
export const MAX_MOVEMENT_HISTORY = 120;
export const MAX_DISCARD_HISTORY = 160;

/** 刷新后继续用的记牌缓存。键名、保留 3 小时、写入停顿。 */
export const PERSISTED_SNAPSHOT_KEY = 'XC::vueDeckRecordSnapshot';
const SNAPSHOT_KEEP_HOURS = 3;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;
export const PERSISTED_SNAPSHOT_MAX_AGE = SNAPSHOT_KEEP_HOURS * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
export const PERSIST_DEBOUNCE_MS = 1500;

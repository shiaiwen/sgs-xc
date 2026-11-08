/** 明牌/可能牌会话缓存键前缀，实际键为 `XC::knownHands::<登录账号>`。 */
export const KNOWN_HAND_STORAGE_KEY_BASE = 'XC::knownHands';

/** 刷新后恢复已知手牌的最长保留时间。 */
export const KNOWN_HAND_MAX_AGE_MS = 3 * 60 * 60 * 1000;

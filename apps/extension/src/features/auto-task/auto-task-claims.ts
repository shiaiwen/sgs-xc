/**
 * 自动任务领奖逻辑：识别可领任务并触发领取请求。
 */

const DAILY_RECORD_SUFFIX = '::XC_DAILY_AUTO_CLAIM_RECORD';
const DAILY_ATTEMPT_SUFFIX = '::XC_DAILY_AUTO_CLAIM_ATTEMPTS';
/** 同一领奖键每天最多发送的次数；服务器拒绝时不再无限重发，否则游戏会反复弹「未知错误」。 */
export const CLAIM_DAILY_ATTEMPT_LIMIT = 3;
/** 只拉数据、不领奖的请求键，可以反复发送。 */
const SYNC_KEY_PATTERN = /:sync(?::|$)/;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 同一个请求键 15 秒内不重复发送。 */
export const CLAIM_THROTTLE_MS = 15_000;

type ClaimStorage = Pick<Storage, 'getItem' | 'setItem'>;

interface DailyRecord {
  day: string;
  keys: string[];
}

/** 北京时间日期串，服务器按北京时间跨天。 */
export function beijingDate(now: number): string {
  return new Date(now + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

/** 北京时间的天序号，用于判断跨天。 */
export function beijingDayIndex(now: number): number {
  return Math.floor((now + BEIJING_OFFSET_MS) / DAY_MS);
}

export interface AutoTaskClaims {
  /** 每日一次：今天没领过才执行；返回 false 表示没发请求，不记为已领。 */
  onceToday(key: string, action: () => unknown): boolean;
  claimedToday(key: string): boolean;
  markClaimedToday(key: string): void;
  /** 节流：默认 15 秒内同键只执行一次，可传入更短的毫秒数。 */
  throttled(key: string, action: () => unknown, throttleMs?: number): boolean;
  /** 仅占用节流窗口，不执行动作。 */
  acquire(key: string, throttleMs?: number): boolean;
}

/** 记录领取尝试，避免同一任务短时间重复请求。 */
export function createAutoTaskClaims(
  storage: ClaimStorage | undefined,
  account: () => string,
  now: () => number = Date.now,
  warn: (message: string, ...details: unknown[]) => void = console.warn
): AutoTaskClaims {
  const lastAttempt = new Map<string, number>();

  function storageKey(): string {
    return `${account()}${DAILY_RECORD_SUFFIX}`;
  }

  function readRecord(): DailyRecord {
    const day = beijingDate(now());
    try {
      const parsed = JSON.parse(storage?.getItem(storageKey()) || 'null') as Partial<DailyRecord> | null;
      if (parsed?.day === day && Array.isArray(parsed.keys)) return { day, keys: parsed.keys.map(String) };
    } catch {
      // 记录损坏时视为今天还没领过。
    }
    return { day, keys: [] };
  }

  function claimedToday(key: string): boolean {
    return Boolean(key) && readRecord().keys.includes(key);
  }

  function markClaimedToday(key: string): void {
    if (!key) return;
    const record = readRecord();
    if (record.keys.includes(key)) return;
    record.keys.push(key);
    try {
      storage?.setItem(storageKey(), JSON.stringify(record));
    } catch {
      // 存储不可用时本次运行内仍靠节流防重复。
    }
  }

  function attemptKey(): string {
    return `${account()}${DAILY_ATTEMPT_SUFFIX}`;
  }

  function readAttempts(): { day: string; counts: Record<string, number> } {
    const day = beijingDate(now());
    try {
      const parsed = JSON.parse(storage?.getItem(attemptKey()) || 'null') as
        { day?: string; counts?: Record<string, number> } | null;
      if (parsed?.day === day && parsed.counts && typeof parsed.counts === 'object') {
        return { day, counts: parsed.counts };
      }
    } catch {
      // 记录损坏时从零计数。
    }
    return { day, counts: {} };
  }

  /** 记一次发送；当天已到上限时返回 false。 */
  function consumeDailyAttempt(key: string): boolean {
    if (SYNC_KEY_PATTERN.test(key)) return true;
    const record = readAttempts();
    const used = Number(record.counts[key]) || 0;
    if (used >= CLAIM_DAILY_ATTEMPT_LIMIT) return false;
    record.counts[key] = used + 1;
    try {
      storage?.setItem(attemptKey(), JSON.stringify(record));
    } catch {
      // 存储不可用时本次运行内仍靠节流防重复。
    }
    return true;
  }

  function acquire(key: string, throttleMs = CLAIM_THROTTLE_MS): boolean {
    const time = now();
    const windowMs = Number.isFinite(throttleMs) && throttleMs > 0 ? throttleMs : CLAIM_THROTTLE_MS;
    if (time - (lastAttempt.get(key) ?? -Infinity) < windowMs) return false;
    if (!consumeDailyAttempt(key)) return false;
    lastAttempt.set(key, time);
    return true;
  }

  function run(key: string, action: () => unknown, label: string): unknown {
    try {
      return action();
    } catch (error) {
      warn(`[自动领取] ${label}失败:`, key, error);
      return false;
    }
  }

  return {
    claimedToday,
    markClaimedToday,
    acquire,
    onceToday(key, action) {
      if (!key || claimedToday(key)) return false;
      const result = run(key, action, '每日领取');
      if (result === false) return false;
      markClaimedToday(key);
      return true;
    },
    throttled(key, action, throttleMs) {
      if (!key || !acquire(key, throttleMs)) return false;
      return run(key, action, '领取') !== false;
    }
  };
}

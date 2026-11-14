/**
 * 共用定时器：小抄各功能的常驻轮询都挂在同一个计时器上，同一刻到点的任务一起跑。
 * 每个任务按名字计时，卡顿记录靠它分清是哪个功能在占时间。
 */
import {
  SHARED_TICKER_BATCH_BUDGET_MS,
  SHARED_TICKER_DUE_TOLERANCE_MS,
  SHARED_TICKER_GRID_MS
} from '../const/shared-ticker.ts';
import { measureXiaochao } from './perf-monitor.ts';

export interface RepeatingTaskOptions {
  /** 只改画面的任务：网页切到后台时不跑，切回前台马上补跑一次。 */
  visualOnly?: boolean;
}

/** 能挂共用定时器的全局对象，平时就是 window。 */
export interface TickerHost {
  setTimeout(handler: () => void, timeout?: number): number;
  clearTimeout(id: number | undefined): void;
  document?: Document;
}

interface RepeatingTask {
  label: string;
  intervalMs: number;
  run: () => void;
  visualOnly: boolean;
  dueAt: number;
  /** 网页在后台时停下的只改画面的任务，切回前台时补跑。 */
  parked: boolean;
  stopped: boolean;
}

interface SharedTicker {
  add(label: string, intervalMs: number, run: () => void, options: RepeatingTaskOptions): () => void;
}

const tickers = new WeakMap<object, SharedTicker>();

/**
 * 每隔 intervalMs 跑一次 run，返回停止函数。
 * 和 setInterval 一样，第一次在大约 intervalMs 之后跑；某次抛错只报出来，不影响后面继续跑。
 */
export function everyInterval(
  label: string,
  intervalMs: number,
  run: () => void,
  options: RepeatingTaskOptions = {},
  host: TickerHost = window
): () => void {
  let ticker = tickers.get(host);
  if (!ticker) {
    ticker = createSharedTicker(host);
    tickers.set(host, ticker);
  }
  return ticker.add(label, intervalMs, run, options);
}

function clock(): number {
  return performance.now();
}

/** 间隔不短于刻度的任务把到点时间对齐到刻度上，好和别的任务一起跑。 */
function dueTimeAfter(time: number, intervalMs: number): number {
  const dueAt = time + intervalMs;
  if (intervalMs < SHARED_TICKER_GRID_MS) return dueAt;
  return Math.ceil(dueAt / SHARED_TICKER_GRID_MS) * SHARED_TICKER_GRID_MS;
}

/** 和定时器回调里没接住的错误一样报出来。 */
function reportUncaught(error: unknown): void {
  const report = (globalThis as { reportError?: (error: unknown) => void }).reportError;
  if (typeof report === 'function') report.call(globalThis, error);
  else console.error(error);
}

function createSharedTicker(host: TickerHost): SharedTicker {
  const tasks: RepeatingTask[] = [];
  let timerId: number | undefined;
  let timerDueAt = Number.POSITIVE_INFINITY;
  let ticking = false;
  let visibilityWatched = false;

  const pageHidden = (): boolean => host.document?.visibilityState === 'hidden';

  function schedule(): void {
    if (ticking) return;
    let nextDueAt = Number.POSITIVE_INFINITY;
    for (const task of tasks) if (task.dueAt < nextDueAt) nextDueAt = task.dueAt;
    if (timerId !== undefined && timerDueAt <= nextDueAt && nextDueAt !== Number.POSITIVE_INFINITY) return;
    if (timerId !== undefined) host.clearTimeout(timerId);
    timerId = undefined;
    timerDueAt = nextDueAt;
    if (nextDueAt === Number.POSITIVE_INFINITY) return;
    timerId = host.setTimeout(tick, Math.max(0, nextDueAt - clock()));
  }

  function runTask(task: RepeatingTask): void {
    try {
      measureXiaochao(task.label, task.run);
    } catch (error) {
      reportUncaught(error);
    }
  }

  function tick(): void {
    timerId = undefined;
    timerDueAt = Number.POSITIVE_INFINITY;
    ticking = true;
    try {
      const now = clock();
      const hidden = pageHidden();
      let ranAny = false;
      for (const task of tasks.slice()) {
        if (task.stopped || task.dueAt > now + SHARED_TICKER_DUE_TOLERANCE_MS) continue;
        if (hidden && task.visualOnly) {
          task.parked = true;
          task.dueAt = Number.POSITIVE_INFINITY;
          continue;
        }
        // 没跑的任务到点时间没动，结束时排下一轮会立刻接着跑。
        if (ranAny && clock() - now > SHARED_TICKER_BATCH_BUDGET_MS) break;
        ranAny = true;
        const nextDueAt = task.dueAt + task.intervalMs;
        // 被卡住错过了好几轮时只补跑一次，和 setInterval 一样不连发。
        task.dueAt = nextDueAt > now ? nextDueAt : dueTimeAfter(now, task.intervalMs);
        runTask(task);
      }
    } finally {
      ticking = false;
      schedule();
    }
  }

  function watchVisibility(): void {
    const documentObject = host.document;
    if (visibilityWatched || !documentObject) return;
    visibilityWatched = true;
    documentObject.addEventListener('visibilitychange', () => {
      if (pageHidden()) return;
      const now = clock();
      let resumed = false;
      for (const task of tasks) {
        if (!task.parked) continue;
        task.parked = false;
        task.dueAt = now;
        resumed = true;
      }
      if (resumed) schedule();
    });
  }

  return {
    add(label, intervalMs, run, options) {
      const interval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : SHARED_TICKER_GRID_MS;
      const task: RepeatingTask = {
        label,
        intervalMs: interval,
        run,
        visualOnly: options.visualOnly === true,
        dueAt: dueTimeAfter(clock(), interval),
        parked: false,
        stopped: false
      };
      tasks.push(task);
      if (task.visualOnly) watchVisibility();
      schedule();
      return () => {
        if (task.stopped) return;
        task.stopped = true;
        const index = tasks.indexOf(task);
        if (index >= 0) tasks.splice(index, 1);
        schedule();
      };
    }
  };
}

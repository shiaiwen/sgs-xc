/**
 * 卡顿记录：页面卡住时，算出这段时间里小抄各功能各跑了多久。
 *
 * 只给小抄自己的代码计时：共用定时器里的任务、带名字的延时任务、游戏事件分发、协议解析。
 * 游戏方法的拦截不计时，拦截里跑的大多是游戏自己的代码，算进来会冤枉小抄。
 * 结果打到控制台；最近的卡顿和各功能累计耗时挂在 window.__XIAOCHAO_PERF__ 上。
 */
import {
  PERF_COST_BUCKET_COUNT,
  PERF_COST_BUCKET_MS,
  PERF_TOTAL_ROUNDING,
  STALL_HISTORY_SIZE,
  STALL_REPORT_MS,
  STALL_REPORT_TOP_FEATURES,
  STALL_REPORT_TOP_SCRIPTS,
  STALL_SCRIPT_NAME_MAX_LENGTH,
  STALL_XIAOCHAO_SHARE_THRESHOLD
} from '../const/perf-monitor.ts';

interface OpenSection {
  start: number;
  childMs: number;
}

/** 一格时间里各功能自己用掉的毫秒数。 */
interface CostBucket {
  /** 这一格是第几格，按页面打开以来的时间算；格子循环使用，对不上说明已经过期。 */
  slot: number;
  costs: Map<string, number>;
}

interface FeatureTotal {
  runs: number;
  totalMs: number;
  maxMs: number;
}

export interface StallReport {
  at: string;
  stallMs: number;
  xiaochaoMs: number;
  features: Array<{ label: string; ms: number }>;
  slowScripts: Array<{ source: string; ms: number }>;
}

export interface FeatureCost {
  label: string;
  runs: number;
  totalMs: number;
  maxMs: number;
  averageMs: number;
}

const buckets: CostBucket[] = Array.from({ length: PERF_COST_BUCKET_COUNT }, () => ({ slot: -1, costs: new Map() }));
const openSections: OpenSection[] = [];
const featureTotals = new Map<string, FeatureTotal>();
const stalls: StallReport[] = [];
/** 浏览器能报卡顿时由它判断；报不了时，单段小抄代码超过阈值就直接记。 */
let browserReportsStalls = false;

function clock(): number {
  return performance.now();
}

/** 给一段小抄代码计时并原样返回结果；里面抛的错照常往外抛。 */
export function measureXiaochao<T>(label: string, run: () => T): T {
  const open: OpenSection = { start: clock(), childMs: 0 };
  openSections.push(open);
  try {
    return run();
  } finally {
    const end = clock();
    openSections.pop();
    const totalMs = end - open.start;
    const parent = openSections[openSections.length - 1];
    if (parent) parent.childMs += totalMs;
    rememberSection(label, open.start, end, Math.max(0, totalMs - open.childMs));
  }
}

function slotOf(time: number): number {
  return Math.floor(time / PERF_COST_BUCKET_MS);
}

function rememberSection(label: string, start: number, end: number, selfMs: number): void {
  const slot = slotOf(end);
  const bucket = buckets[slot % PERF_COST_BUCKET_COUNT];
  if (bucket.slot !== slot) {
    bucket.slot = slot;
    bucket.costs.clear();
  }
  bucket.costs.set(label, (bucket.costs.get(label) ?? 0) + selfMs);
  const total = featureTotals.get(label);
  if (total) {
    total.runs += 1;
    total.totalMs += selfMs;
    if (selfMs > total.maxMs) total.maxMs = selfMs;
  } else {
    featureTotals.set(label, { runs: 1, totalMs: selfMs, maxMs: selfMs });
  }
  if (!browserReportsStalls && selfMs >= STALL_REPORT_MS) reportStall(start, end - start);
}

function roundMs(value: number): number {
  return Math.round(value * PERF_TOTAL_ROUNDING) / PERF_TOTAL_ROUNDING;
}

/** 浏览器给出的卡顿那一帧里单个脚本的耗时；只有较新的内核会给。 */
interface FrameScriptTiming {
  sourceURL?: string;
  sourceFunctionName?: string;
  invoker?: string;
  duration?: number;
}

function describeScript(script: FrameScriptTiming): string {
  const file = String(script.sourceURL ?? '').split('#')[0].split('/').pop()?.slice(0, STALL_SCRIPT_NAME_MAX_LENGTH)
    || '未知脚本';
  const functionName = script.sourceFunctionName || script.invoker || '';
  return functionName ? `${file} ${functionName}` : file;
}

function slowScriptsOf(entry: PerformanceEntry): Array<{ source: string; ms: number }> {
  const scripts = (entry as PerformanceEntry & { scripts?: FrameScriptTiming[] }).scripts;
  if (!Array.isArray(scripts)) return [];
  return scripts
    .map((script) => ({ source: describeScript(script), ms: Math.round(Number(script.duration) || 0) }))
    .sort((left, right) => right.ms - left.ms)
    .slice(0, STALL_REPORT_TOP_SCRIPTS);
}

function reportStall(start: number, stallMs: number, slowScripts: Array<{ source: string; ms: number }> = []): void {
  const firstSlot = slotOf(start);
  const lastSlot = slotOf(start + stallMs);
  const costByLabel = new Map<string, number>();
  let xiaochaoMs = 0;
  for (let slot = Math.max(firstSlot, lastSlot - PERF_COST_BUCKET_COUNT + 1); slot <= lastSlot; slot += 1) {
    const bucket = buckets[slot % PERF_COST_BUCKET_COUNT];
    if (bucket.slot !== slot) continue;
    for (const [label, ms] of bucket.costs) {
      xiaochaoMs += ms;
      costByLabel.set(label, (costByLabel.get(label) ?? 0) + ms);
    }
  }
  const features = [...costByLabel.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, STALL_REPORT_TOP_FEATURES)
    .map(([label, ms]) => ({ label, ms: Math.round(ms) }));
  const report: StallReport = {
    at: new Date().toLocaleTimeString(),
    stallMs: Math.round(stallMs),
    xiaochaoMs: Math.round(xiaochaoMs),
    features,
    slowScripts
  };
  stalls.push(report);
  if (stalls.length > STALL_HISTORY_SIZE) stalls.shift();
  const scriptDetail = slowScripts.length
    ? `。最耗时的脚本：${slowScripts.map(({ source, ms }) => `${source} ${ms} 毫秒`).join('，')}`
    : '';
  if (xiaochaoMs >= stallMs * STALL_XIAOCHAO_SHARE_THRESHOLD) {
    const detail = features.map(({ label, ms }) => `${label} ${ms} 毫秒`).join('，');
    console.warn(`[小抄卡顿] 页面卡了 ${report.stallMs} 毫秒，其中小抄占 ${report.xiaochaoMs} 毫秒：${detail}${scriptDetail}`);
    return;
  }
  console.info(`[小抄卡顿] 页面卡了 ${report.stallMs} 毫秒，小抄只占 ${report.xiaochaoMs} 毫秒，卡顿主要不是小抄造成的${scriptDetail}`);
}

/** 各功能从页面打开到现在的累计耗时，按总耗时从高到低排。 */
export function featureCosts(): FeatureCost[] {
  return [...featureTotals.entries()]
    .map(([label, total]) => ({
      label,
      runs: total.runs,
      totalMs: roundMs(total.totalMs),
      maxMs: roundMs(total.maxMs),
      averageMs: roundMs(total.totalMs / total.runs)
    }))
    .sort((left, right) => right.totalMs - left.totalMs);
}

type PerfWindow = Window & {
  PerformanceObserver?: typeof PerformanceObserver;
  __XIAOCHAO_PERF__?: unknown;
};

const LONG_FRAME_ENTRY_TYPE = 'long-animation-frame';
const LONG_TASK_ENTRY_TYPE = 'longtask';

/**
 * 开始记录卡顿。返回停止函数。
 * 内核能按帧报卡顿时用帧，帧里带着每个脚本的耗时；不能时退回按任务报。
 */
export function installStallMonitor(globalObject: Window = window): () => void {
  const host = globalObject as PerfWindow;
  host.__XIAOCHAO_PERF__ = { stalls, features: featureCosts };
  const Observer = host.PerformanceObserver;
  const supported = Observer?.supportedEntryTypes ?? [];
  const entryType = supported.includes(LONG_FRAME_ENTRY_TYPE)
    ? LONG_FRAME_ENTRY_TYPE
    : supported.includes(LONG_TASK_ENTRY_TYPE) ? LONG_TASK_ENTRY_TYPE : '';
  if (!entryType) return () => undefined;
  let observer: PerformanceObserver | null = null;
  try {
    observer = new Observer((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= STALL_REPORT_MS) reportStall(entry.startTime, entry.duration, slowScriptsOf(entry));
      }
    });
    observer.observe({ type: entryType });
    browserReportsStalls = true;
  } catch {
    observer = null;
  }
  return () => {
    observer?.disconnect();
    browserReportsStalls = false;
  };
}

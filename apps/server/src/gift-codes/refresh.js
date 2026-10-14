import { fetchUpstreamGiftCodes, giftCodeUpstreamUrl } from './upstream.js';
import { writeUpstreamGiftCodes } from './store.js';

/** 每小时刷一次；测试时用 GIFT_CODE_REFRESH_MS 调小。 */
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

function resolveIntervalMs(options = {}) {
  const fromOptions = Number(options.intervalMs);
  if (Number.isFinite(fromOptions) && fromOptions > 0) return fromOptions;
  const fromEnv = Number(process.env.GIFT_CODE_REFRESH_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return DEFAULT_INTERVAL_MS;
}

/**
 * 定时把上游的礼包码刷进缓存，接口读的就是这份缓存。
 * 拉取失败保留上一份，等下一次；启动时先刷一次，重启即是最新。
 */
export function startGiftCodeRefresh(options = {}) {
  const intervalMs = resolveIntervalMs(options);
  const url = options.url || giftCodeUpstreamUrl();
  let running = false;

  async function refreshOnce() {
    if (running) return null;
    running = true;
    try {
      const codes = await fetchUpstreamGiftCodes({ ...options, url });
      const document = writeUpstreamGiftCodes(codes, { source: url });
      console.log(`[gift-codes] 上游刷新成功：${document.count} 个码，来源 ${url}`);
      return document;
    } catch (error) {
      console.warn(`[gift-codes] 上游刷新失败，保留上一份：${error.message || error}`);
      return null;
    } finally {
      running = false;
    }
  }

  refreshOnce();
  const timer = setInterval(refreshOnce, intervalMs);
  console.log(`[gift-codes] 已启动定时刷新，间隔 ${Math.round(intervalMs / 1000)} 秒`);

  return {
    intervalMs,
    refreshOnce,
    stop() {
      clearInterval(timer);
    }
  };
}

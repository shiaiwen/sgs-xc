import { createHash } from 'node:crypto';

/** 旧版小抄就是打这个地址取礼包码，服务端每小时跟着刷一次。 */
const DEFAULT_UPSTREAM_URL = 'https://xiaochao.org/api/game-gift-codes';
const FETCH_TIMEOUT_MS = 15000;

/** 上游地址；换地址时设 GIFT_CODE_UPSTREAM_URL。 */
export function giftCodeUpstreamUrl() {
  return String(process.env.GIFT_CODE_UPSTREAM_URL || '').trim() || DEFAULT_UPSTREAM_URL;
}

/** 由码内容生成稳定的展示用 id，重复刷新不会变。 */
export function upstreamCodeId(code) {
  const hash = createHash('sha1').update(String(code), 'utf8').digest('hex');
  return `up-${hash.slice(0, 12)}`;
}

/**
 * 收上游返回的礼包码：兼容 ["码"]、[{ code }]、{ codes: [...] } 三种形状，
 * 去空白、去重、丢掉空值。
 */
export function normalizeUpstreamCodes(raw) {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.codes)
      ? raw.codes
      : [];
  const codes = [];
  const seen = new Set();
  for (const item of list) {
    const code = String(typeof item === 'string' ? item : item?.code || '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

/**
 * GET 上游礼包码。失败就抛错，调用方保留上一份缓存。
 * 上游 ok=false、状态码非 2xx、超时都算失败。
 */
export async function fetchUpstreamGiftCodes(options = {}) {
  const url = options.url || giftCodeUpstreamUrl();
  const fetcher = options.fetcher || globalThis.fetch;
  if (typeof fetcher !== 'function') throw new Error('当前 Node 没有 fetch，需要 18 以上');
  const response = await fetcher(url, {
    method: 'GET',
    headers: { accept: 'application/json', 'user-agent': 'sgs-xc-server' },
    cache: 'no-store',
    redirect: 'follow',
    signal: AbortSignal.timeout(Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : FETCH_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`上游返回 ${response.status}`);
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`上游返回的不是 JSON：${error.message}`);
  }
  if (payload && payload.ok === false) {
    throw new Error(String(payload.error || payload.message || '上游返回 ok=false'));
  }
  const codes = normalizeUpstreamCodes(payload);
  if (!codes.length) throw new Error('上游没有返回可用的礼包码');
  return codes;
}

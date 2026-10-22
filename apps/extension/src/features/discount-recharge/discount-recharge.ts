/** 官服九五折充值入口：资格判断、账号链接、贴在立即充值左边的位置。 */

export const OFFICIAL_DISCOUNT_RECHARGE_ORIGIN = 'https://95chong.cn/';
export const OFFICIAL_DISCOUNT_RECHARGE_LABEL = '官服95折';
export const OFFICIAL_SERVER_ID = 1100;
export const ALLOWED_CHANNEL_IDS = [1000, 209488, 1074, 110074] as const;
export const DISCOUNT_RECHARGE_GAP = 12;

export interface DiscountRechargeEnv {
  isOfficialWindow: boolean;
  platformName: string;
  isDebug: boolean;
  isExperience: boolean;
  isTestSpServer: boolean;
  channelId: unknown;
  locationSearch: string;
  yokaAccount: string;
  decodeBase64?: (value: string) => string;
}

export interface ButtonBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function asFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/** 渠道号可能是数字、字符串或数组，取能转成数字的第一个。 */
export function readChannelId(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = asFiniteNumber(item);
      if (parsed != null) return parsed;
    }
    return null;
  }
  return asFiniteNumber(value);
}

function decodeKeyServerId(key: string, decodeBase64: (value: string) => string): number | null {
  try {
    const decoded = decodeBase64(key);
    const first = decoded.split(',')[0];
    return asFiniteNumber(first);
  } catch {
    return null;
  }
}

/** 从地址栏读官服区号：优先 key 里第一段，有 cmFlag 时按官服 1100，否则读 server。 */
export function parseOfficialServerId(
  search: string,
  decodeBase64: (value: string) => string = decodeUriBase64
): number | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const key = params.get('key');
  if (key && key !== '-1') return decodeKeyServerId(key, decodeBase64);
  if (params.get('cmFlag')) return OFFICIAL_SERVER_ID;
  return asFiniteNumber(params.get('server'));
}

function decodeUriBase64(value: string): string {
  return globalThis.atob(value);
}

export function isOfficialDiscountRechargeAllowed(env: DiscountRechargeEnv): boolean {
  if (env.isOfficialWindow === false) return false;
  if (env.platformName && env.platformName !== 'CHANNEL_YOKA') return false;
  if (env.isExperience || env.isTestSpServer) return false;
  const channelId = readChannelId(env.channelId);
  if (channelId != null && !ALLOWED_CHANNEL_IDS.includes(channelId as typeof ALLOWED_CHANNEL_IDS[number])) {
    return false;
  }
  const serverId = parseOfficialServerId(env.locationSearch, env.decodeBase64 ?? decodeUriBase64);
  return serverId == null || serverId === OFFICIAL_SERVER_ID;
}

export function buildOfficialDiscountRechargeUrl(account: string): string {
  return `${OFFICIAL_DISCOUNT_RECHARGE_ORIGIN}#account=${encodeURIComponent(account.trim())}`;
}

/** 贴在立即充值左边；左边放不下时改到按钮正上方，避免被窗口裁掉。 */
export function layoutDiscountRechargeButton(
  okBtn: ButtonBox,
  gap: number = DISCOUNT_RECHARGE_GAP
): ButtonBox {
  const width = okBtn.width;
  const height = okBtn.height;
  const left = okBtn.x - width - gap;
  if (left >= 8) {
    return { x: left, y: okBtn.y, width, height };
  }
  return {
    x: okBtn.x,
    y: Math.max(8, okBtn.y - height - gap),
    width,
    height
  };
}

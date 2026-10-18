/** 版本清单由 95chong.cn 接口返回。游戏页直接 GET 这份 JSON。 */
export const XIAOCHAO_UPDATE_MANIFEST_URL = 'https://95chong.cn/api/xiaochao-version';
export const XIAOCHAO_UPDATE_PAGE_URL = 'https://xc.95chong.cn/downloads';

export interface XiaochaoUpdateManifest {
  version: string;
  notes: string;
  pageUrl: string;
}

/** 版本比较：按点分段的整数，缺段当 0。 */
export function compareVersions(left: string, right: string): number {
  const leftParts = String(left || '0').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right || '0').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    if ((leftParts[index] || 0) > (rightParts[index] || 0)) return 1;
    if ((leftParts[index] || 0) < (rightParts[index] || 0)) return -1;
  }
  return 0;
}

/** 远程版本是否比本地版本新。 */
export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

/** 取较新的版本。空字符串不参与比较。 */
export function newerVersion(left: string, right: string): string {
  const first = String(left || '').trim();
  const second = String(right || '').trim();
  if (!first) return second;
  if (!second) return first;
  return compareVersions(first, second) >= 0 ? first : second;
}

/** 油猴管理器报告的已安装脚本版本。没有或格式不对时返回空字符串。 */
export function readUserscriptManagerVersion(): string {
  const info = (globalThis as { GM_info?: { script?: { version?: unknown } } }).GM_info;
  const version = String(info?.script?.version ?? '').trim();
  return /^\d+(?:\.\d+)*$/.test(version) ? version : '';
}

/** 同一远程号已点过「稍后」则不再弹窗，角标仍由是否有更新决定。 */
export function shouldPromptUpdateDialog(latestVersion: string, dismissedVersion: string): boolean {
  if (!latestVersion) return false;
  return compareVersions(latestVersion, dismissedVersion || '0') > 0;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 解析远程 JSON 为版本/说明/下载页；非法 URL 回退默认下载页。 */
export function parseUpdateManifest(raw: unknown, fallbackPageUrl = XIAOCHAO_UPDATE_PAGE_URL): XiaochaoUpdateManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const version = String(data.version ?? data.scriptVersion ?? '').trim();
  if (!version) return null;
  const notes = String(data.notes ?? data.changelog ?? '').trim();
  const pageUrlRaw = String(data.pageUrl ?? data.url ?? fallbackPageUrl).trim();
  const pageUrl = isHttpUrl(pageUrlRaw) ? pageUrlRaw : fallbackPageUrl;
  return { version, notes, pageUrl };
}

/** 构建时写进脚本的版本。缺失时回退 0.0.0。 */
export function getXiaochaoVersion(): string {
  const injected = typeof __XIAOCHAO_VERSION__ === 'string' ? __XIAOCHAO_VERSION__.trim() : '';
  return injected || '0.0.0';
}

export const AUTHOR_TIP_PORTAL_ABOUT_PATH = '/about';

export const AUTHOR_TIP_PORTAL_ORIGIN_REMOTE = 'https://xc.95chong.cn';
export const AUTHOR_TIP_PORTAL_ORIGIN_LOCAL = 'http://localhost:3000';

export const AUTHOR_TIP_QUERY_OPEN = 'tip';
export const AUTHOR_TIP_QUERY_OPEN_VALUE = '1';
export const AUTHOR_TIP_QUERY_FROM_MICRO = 'micro';

export function buildAuthorTipPortalAboutUrl(origin: string): string {
  const url = new URL(AUTHOR_TIP_PORTAL_ABOUT_PATH, origin.endsWith('/') ? origin : `${origin}/`);
  url.searchParams.set(AUTHOR_TIP_QUERY_OPEN, AUTHOR_TIP_QUERY_OPEN_VALUE);
  url.searchParams.set('from', AUTHOR_TIP_QUERY_FROM_MICRO);
  return url.toString();
}

function resolveAuthorTipPortalOrigin(): string {
  const injected =
    typeof __XIAOCHAO_PORTAL_ORIGIN__ === 'string' ? __XIAOCHAO_PORTAL_ORIGIN__.trim() : '';
  if (injected) return injected;
  const accountConfigUrl =
    typeof __XIAOCHAO_ACCOUNT_CONFIG_URL__ === 'string' ? __XIAOCHAO_ACCOUNT_CONFIG_URL__.trim() : '';
  if (accountConfigUrl.startsWith('http://127.0.0.1') || accountConfigUrl.startsWith('http://localhost')) {
    return AUTHOR_TIP_PORTAL_ORIGIN_LOCAL;
  }
  return AUTHOR_TIP_PORTAL_ORIGIN_REMOTE;
}

/** 微端「赞赏作者」在系统浏览器打开的门户关于页，并自动弹出赞赏框。 */
export function authorTipPortalUrl(): string {
  return buildAuthorTipPortalAboutUrl(resolveAuthorTipPortalOrigin());
}
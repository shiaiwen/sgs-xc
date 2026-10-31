/** 游戏页 HTTPS 下普通 fetch 访问本机 dev 服务会失败，优先用油猴 GM 请求。 */

type GmXmlHttpRequest = (details: {
  method: string;
  url: string;
  nocache?: boolean;
  timeout?: number;
  onload?: (response: { status: number; responseText: string }) => void;
  onerror?: () => void;
  ontimeout?: () => void;
}) => void;

export function fetchUserscriptDevText(url: string): Promise<string> {
  const trimmed = String(url ?? '').trim();
  if (!trimmed) return Promise.resolve('');

  const gm = (globalThis as { GM_xmlhttpRequest?: GmXmlHttpRequest }).GM_xmlhttpRequest;
  if (typeof gm === 'function') {
    return new Promise((resolve) => {
      gm({
        method: 'GET',
        url: trimmed,
        nocache: true,
        timeout: 5000,
        onload: (response) => {
          resolve(response.status === 200 ? String(response.responseText ?? '').trim() : '');
        },
        onerror: () => resolve(''),
        ontimeout: () => resolve('')
      });
    });
  }

  return fetch(trimmed, { cache: 'no-store', mode: 'cors' })
    .then((response) => (response.ok ? response.text() : ''))
    .then((text) => String(text ?? '').trim())
    .catch(() => '');
}

export const ANNIVERSARY_ASSIST_API_PATH = '/api/anniversary-assist';

export const ANNIVERSARY_ASSIST_REMOTE_ORIGIN = 'https://95chong.cn';
export const ANNIVERSARY_ASSIST_LOCAL_ORIGIN = 'http://127.0.0.1:8787';

export function anniversaryAssistApiBaseUrl(): string {
  const injected =
    typeof __XIAOCHAO_ACCOUNT_CONFIG_URL__ === 'string'
      ? __XIAOCHAO_ACCOUNT_CONFIG_URL__.trim()
      : '';
  if (injected.startsWith('http://127.0.0.1') || injected.startsWith('http://localhost')) {
    return `${ANNIVERSARY_ASSIST_LOCAL_ORIGIN}${ANNIVERSARY_ASSIST_API_PATH}`;
  }
  return `${ANNIVERSARY_ASSIST_REMOTE_ORIGIN}${ANNIVERSARY_ASSIST_API_PATH}`;
}
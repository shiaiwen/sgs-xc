/**
 * 小抄服务器上按游戏账号存的数据：开关和背景、皮肤选择、重置。
 * 写的时候正文按纯文本发，浏览器不用先问一次能不能跨域，页面关掉时也能带着发出去。
 */

import { ACCOUNT_CONFIG_REMOTE_URL } from '../const/account-config-endpoint.ts';
import { KEEPALIVE_BODY_MAX_BYTES } from '../const/account-sync.ts';

const REQUEST_INIT: RequestInit = {
  mode: 'cors',
  credentials: 'omit',
  cache: 'no-store',
  referrerPolicy: 'no-referrer'
};

/** 打包时注入的服务地址，没注入时用正式服务器。 */
export function accountApiUrl(path: string): string {
  const injected = typeof __XIAOCHAO_ACCOUNT_CONFIG_URL__ === 'string'
    ? __XIAOCHAO_ACCOUNT_CONFIG_URL__.trim()
    : '';
  return new URL(path, injected || ACCOUNT_CONFIG_REMOTE_URL).toString();
}

/** 没登录或账号编号还没读到时返回空。 */
export function usableAccount(accountId: string): string {
  const account = String(accountId || '').trim();
  return account && account !== 'default' && account !== '0' ? account : '';
}

export async function readAccountApi<Body>(path: string, account: string): Promise<Body> {
  const response = await fetch(`${accountApiUrl(path)}?account=${encodeURIComponent(account)}`, {
    ...REQUEST_INIT,
    method: 'GET'
  });
  if (!response.ok) throw new Error(`服务器返回 ${response.status}`);
  return await response.json() as Body;
}

/** pageClosing 为 true 时页面关掉也会发完，正文太大时只能按普通请求发。 */
export async function writeAccountApi<Body>(path: string, payload: unknown, pageClosing = false): Promise<Body> {
  const body = JSON.stringify(payload);
  const keepalive = pageClosing && new TextEncoder().encode(body).length <= KEEPALIVE_BODY_MAX_BYTES;
  const response = await fetch(accountApiUrl(path), {
    ...REQUEST_INIT,
    method: 'POST',
    keepalive,
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body
  });
  if (!response.ok) throw new Error(`服务器返回 ${response.status}`);
  return await response.json() as Body;
}

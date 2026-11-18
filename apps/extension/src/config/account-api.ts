/**
 * 小抄服务器上按登录账号存的数据：开关和背景、皮肤选择、重置。
 * 写的时候正文按纯文本发，浏览器不用先问一次能不能跨域，页面关掉时也能带着发出去。
 */

import { ACCOUNT_CONFIG_REMOTE_URL } from '../const/account-config-endpoint.ts';
import { KEEPALIVE_BODY_MAX_BYTES } from '../const/account-sync.ts';
import { gameLoginAccountOf } from '../runtime/game-account-session.ts';

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

/** 没登录或游戏用户编号还没读到时返回空。 */
export function usableAccount(accountId: string): string {
  const account = String(accountId || '').trim();
  return account && account !== 'default' && account !== '0' ? account : '';
}

/**
 * 服务器按登录账号存，同时带上游戏用户编号，服务器把以前按编号存的那份并过来。
 * 游戏里找不到登录账号时只按编号发，服务器先存在旧表里，以后读到登录账号再并过去。
 */
function accountFields(userId: string): Record<string, string> {
  const loginAccount = gameLoginAccountOf(userId);
  return loginAccount ? { account: loginAccount, userId } : { account: userId };
}

export async function readAccountApi<Body>(path: string, userId: string): Promise<Body> {
  const query = new URLSearchParams(accountFields(userId));
  const response = await fetch(`${accountApiUrl(path)}?${query}`, {
    ...REQUEST_INIT,
    method: 'GET'
  });
  if (!response.ok) throw new Error(`服务器返回 ${response.status}`);
  return await response.json() as Body;
}

/** pageClosing 为 true 时页面关掉也会发完，正文太大时只能按普通请求发。 */
export async function writeAccountApi<Body>(
  path: string,
  userId: string,
  payload: Record<string, unknown>,
  pageClosing = false
): Promise<Body> {
  const body = JSON.stringify({ ...payload, ...accountFields(userId) });
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

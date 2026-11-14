/** 游戏账号编号的最大长度，超过的当成非法请求。 */
const MAX_ACCOUNT_LENGTH = 128;

/** 请求里的游戏账号。没登录时客户端会用 default，这种不存。 */
export function accountFrom(value) {
  const account = String(value || '').trim();
  if (!account || account === 'default' || account.length > MAX_ACCOUNT_LENGTH) return '';
  return account;
}

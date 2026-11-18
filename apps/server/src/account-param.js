/** 账号和游戏用户编号的最大长度，超过的当成非法请求。 */
const MAX_ACCOUNT_LENGTH = 128;

/** 请求里的一个账号字段。没登录时客户端会用 default，这种不存。 */
export function accountFrom(value) {
  const account = String(value || '').trim();
  if (!account || account === 'default' || account.length > MAX_ACCOUNT_LENGTH) return '';
  return account;
}

/**
 * 新版小抄发登录账号，同时带上游戏用户编号，库里按登录账号存。
 * 旧版小抄只发用户编号，放在 account 里，这时 userId 是空的。
 */
export function accountKeyFrom(account, userId) {
  const key = accountFrom(account);
  return key ? { account: key, userId: accountFrom(userId) } : null;
}

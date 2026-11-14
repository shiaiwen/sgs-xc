import { Hono } from 'hono';
import { accountFrom } from '../account-param.js';
import { readJsonBody } from '../json-body.js';
import { resetAccountConfig } from '../background-config/store.js';
import { resetAccountSkins } from '../account-skins/store.js';

/**
 * 小抄里点「重置小抄」时清掉这个账号的开关、背景和皮肤选择。
 * 重置时间用小抄那台设备的时钟，和它记改动时间用的是同一个钟。
 */
export function createAccountResetRoutes() {
  const routes = new Hono();

  routes.post('/api/account-reset', async (context) => {
    const body = await readJsonBody(context);
    if (!body) return context.json({ error: '内容不是 JSON' }, 400);
    const account = accountFrom(body.account);
    if (!account) return context.json({ error: '缺少账号' }, 400);
    const requested = Number(body.resetAt);
    const resetAt = Number.isFinite(requested) && requested > 0 ? requested : Date.now();
    try {
      const configResetAt = await resetAccountConfig(account, resetAt);
      const skinsResetAt = await resetAccountSkins(account, resetAt);
      return context.json({ account, resetAt: Math.max(configResetAt, skinsResetAt) });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : '重置失败' }, 400);
    }
  });

  return routes;
}

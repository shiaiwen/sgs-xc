import { Hono } from 'hono';
import { accountFrom } from '../account-param.js';
import { readJsonBody } from '../json-body.js';
import { mergeAccountSkins, readAccountSkins } from './store.js';

/** 皮肤解锁里选好的皮肤，按游戏账号存。库里没有时返回空记录。 */
export function createAccountSkinRoutes() {
  const routes = new Hono();

  routes.get('/api/account-skins', async (context) => {
    const account = accountFrom(context.req.query('account'));
    if (!account) return context.json({ error: '缺少账号' }, 400);
    return context.json(await readAccountSkins(account));
  });

  routes.post('/api/account-skins', async (context) => {
    const body = await readJsonBody(context);
    if (!body) return context.json({ error: '内容不是 JSON' }, 400);
    const account = accountFrom(body.account);
    const skins = body.skins;
    if (!account) return context.json({ error: '缺少账号' }, 400);
    if (!skins || typeof skins !== 'object' || Array.isArray(skins)) {
      return context.json({ error: '缺少皮肤记录' }, 400);
    }
    try {
      return context.json(await mergeAccountSkins(account, skins));
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : '写入失败' }, 400);
    }
  });

  return routes;
}

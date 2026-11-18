import { Hono } from 'hono';
import { accountKeyFrom } from '../account-param.js';
import { readJsonBody } from '../json-body.js';
import { mergeAccountSkins, readAccountSkins } from './store.js';

/** 皮肤解锁里选好的皮肤，按账号存。库里没有时返回空记录。 */
export function createAccountSkinRoutes() {
  const routes = new Hono();

  routes.get('/api/account-skins', async (context) => {
    const key = accountKeyFrom(context.req.query('account'), context.req.query('userId'));
    if (!key) return context.json({ error: '缺少账号' }, 400);
    return context.json(await readAccountSkins(key));
  });

  routes.post('/api/account-skins', async (context) => {
    const body = await readJsonBody(context);
    if (!body) return context.json({ error: '内容不是 JSON' }, 400);
    const key = accountKeyFrom(body.account, body.userId);
    const skins = body.skins;
    if (!key) return context.json({ error: '缺少账号' }, 400);
    if (!skins || typeof skins !== 'object' || Array.isArray(skins)) {
      return context.json({ error: '缺少皮肤记录' }, 400);
    }
    try {
      return context.json(await mergeAccountSkins(key, skins));
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : '写入失败' }, 400);
    }
  });

  return routes;
}

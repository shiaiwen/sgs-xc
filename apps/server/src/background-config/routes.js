import { Hono } from 'hono';
import { accountKeyFrom } from '../account-param.js';
import { readJsonBody } from '../json-body.js';
import { mergeAccountConfig, readAccountConfig } from './store.js';

/** 按账号读写开关和小抄背景。每一项带改动时间，写的时候逐项合并。库里没有时返回空文档。 */
export function createBackgroundConfigRoutes() {
  const routes = new Hono();

  routes.get('/api/account-config', async (context) => {
    const key = accountKeyFrom(context.req.query('account'), context.req.query('userId'));
    if (!key) return context.json({ error: '缺少账号' }, 400);
    return context.json(await readAccountConfig(key));
  });

  routes.post('/api/account-config', async (context) => {
    const body = await readJsonBody(context);
    if (!body) return context.json({ error: '内容不是 JSON' }, 400);
    const key = accountKeyFrom(body.account, body.userId);
    const document = body.document;
    if (!key) return context.json({ error: '缺少账号' }, 400);
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      return context.json({ error: '缺少配置' }, 400);
    }
    try {
      return context.json(await mergeAccountConfig(key, document));
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : '写入失败' }, 400);
    }
  });

  return routes;
}

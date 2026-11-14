import { Hono } from 'hono';
import { accountFrom } from '../account-param.js';
import { readJsonBody } from '../json-body.js';
import { mergeAccountConfig, readAccountConfig } from './store.js';

/** 按账号读写开关和小抄背景。每一项带改动时间，写的时候逐项合并。库里没有时返回空文档。 */
export function createBackgroundConfigRoutes() {
  const routes = new Hono();

  routes.get('/api/account-config', async (context) => {
    const account = accountFrom(context.req.query('account'));
    if (!account) return context.json({ error: '缺少账号' }, 400);
    return context.json(await readAccountConfig(account));
  });

  routes.post('/api/account-config', async (context) => {
    const body = await readJsonBody(context);
    if (!body) return context.json({ error: '内容不是 JSON' }, 400);
    const account = accountFrom(body.account);
    const document = body.document;
    if (!account) return context.json({ error: '缺少账号' }, 400);
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      return context.json({ error: '缺少配置' }, 400);
    }
    try {
      return context.json(await mergeAccountConfig(account, document));
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : '写入失败' }, 400);
    }
  });

  return routes;
}

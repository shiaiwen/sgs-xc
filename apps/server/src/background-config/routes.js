import { Hono } from 'hono';
import { readBackgroundConfig, writeBackgroundConfig } from './store.js';

function accountFrom(value) {
  const account = String(value || '').trim();
  if (!account || account === 'default' || account.length > 128) return '';
  return account;
}

/** 按账号读写整份配置。库里没有时返回空文档。 */
export function createBackgroundConfigRoutes() {
  const routes = new Hono();

  routes.get('/api/account-config', async (context) => {
    const account = accountFrom(context.req.query('account'));
    if (!account) return context.json({ error: '缺少账号' }, 400);
    const found = await readBackgroundConfig(account);
    if (!found) return context.json({ account, document: null, updatedAt: 0 });
    return context.json(found);
  });

  routes.post('/api/account-config', async (context) => {
    let body;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: '内容不是 JSON' }, 400);
    }
    const account = accountFrom(body?.account);
    const document = body?.document;
    if (!account) return context.json({ error: '缺少账号' }, 400);
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      return context.json({ error: '缺少配置' }, 400);
    }
    try {
      return context.json(await writeBackgroundConfig(account, document));
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : '写入失败' }, 400);
    }
  });

  return routes;
}

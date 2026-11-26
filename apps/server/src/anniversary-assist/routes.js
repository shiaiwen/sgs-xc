import { Hono } from 'hono';
import { accountKeyFrom } from '../account-param.js';
import { readJsonBody } from '../json-body.js';
import { runAnniversaryAssistAction } from './store.js';

/** 周年庆互助账本与撮合，请求体自带 scopeKey + action。 */
export function createAnniversaryAssistRoutes() {
  const routes = new Hono();

  routes.post('/api/anniversary-assist', async (context) => {
    const body = await readJsonBody(context);
    if (!body) return context.json({ error: '内容不是 JSON' }, 400);
    const key = accountKeyFrom(body.account, body.userId);
    if (!key) return context.json({ error: '缺少账号' }, 400);
    if (key.account !== String(body.account || '').trim().toLowerCase()) {
      return context.json({ error: '账号不匹配' }, 403);
    }
    const scopeKey = String(body.scopeKey || '');
    if (!scopeKey.includes(String(body.userId || ''))) {
      return context.json({ error: '作用域不匹配' }, 403);
    }
    return context.json(await runAnniversaryAssistAction(body));
  });

  return routes;
}
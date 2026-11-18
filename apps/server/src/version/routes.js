import { Hono } from 'hono';
import { readUserscriptPayload, readVersionManifest } from './store.js';

/** 小抄版本清单和油猴新版代码。内容来自 data/xiaochao-manifest.json 和 data/xiaochao-userscript.js。 */
export function createVersionRoutes() {
  const routes = new Hono();

  routes.get('/api/xiaochao-version', (context) => {
    try {
      return context.json(readVersionManifest());
    } catch {
      return context.json({ ok: false }, 404);
    }
  });

  // 浏览器里的小抄在游戏页后台下载，靠全站的跨域设置才读得到。
  routes.get('/api/xiaochao-userscript', (context) => {
    let body;
    try {
      body = readUserscriptPayload();
    } catch {
      body = null;
    }
    if (!body) return context.text('', 404);
    return context.body(body, 200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
  });

  return routes;
}

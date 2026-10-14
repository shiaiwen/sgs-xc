import { Hono } from 'hono';
import { readVersionManifest } from './store.js';

/** 小抄版本清单。内容来自 data/xiaochao-manifest.json。 */
export function createVersionRoutes() {
  const routes = new Hono();

  routes.get('/api/xiaochao-version', (context) => {
    try {
      return context.json(readVersionManifest());
    } catch {
      return context.json({ ok: false }, 404);
    }
  });

  return routes;
}

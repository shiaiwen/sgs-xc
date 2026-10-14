import { Hono } from 'hono';
import { readGiftCodeDocument } from './store.js';

/** 礼包码列表。内容来自 data/gift-codes.json。 */
export function createGiftCodeRoutes() {
  const routes = new Hono();

  routes.get('/api/game-gift-codes', (context) => {
    return context.json(readGiftCodeDocument());
  });

  return routes;
}

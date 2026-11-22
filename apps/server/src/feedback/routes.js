import { Hono } from 'hono';
import {
  createFeedbackTicket,
  findFeedbackTicket,
  listFeedbackTickets,
  toAdminTicket,
  toPublicTicket,
  updateFeedbackTicket
} from './store.js';

const VALID_TYPES = new Set(['bug', 'feature', 'other']);
const VALID_STATUSES = new Set(['received', 'processing', 'fixed', 'rejected']);
const VALID_PLATFORMS = new Set(['electron', 'userscript', 'unknown', '']);

const rateBuckets = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 8;

function publicOrigin() {
  return String(process.env.FEEDBACK_PUBLIC_ORIGIN || 'https://xc.95chong.cn').replace(/\/$/, '');
}

function viewUrl(token) {
  return `${publicOrigin()}/feedback/view?token=${encodeURIComponent(token)}`;
}

function clientIp(context) {
  const forwarded = context.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return context.req.header('x-real-ip') || 'unknown';
}

function allowCreate(context) {
  const ip = clientIp(context);
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || [];
  const fresh = bucket.filter((time) => now - time < RATE_LIMIT_WINDOW_MS);
  if (fresh.length >= RATE_LIMIT_MAX) return false;
  fresh.push(now);
  rateBuckets.set(ip, fresh);
  return true;
}

function readAdminToken(context) {
  const header = context.req.header('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function assertAdmin(context) {
  const expected = String(process.env.FEEDBACK_ADMIN_TOKEN || '').trim();
  if (!expected || readAdminToken(context) !== expected) {
    return context.json({ error: 'unauthorized' }, 401);
  }
  return null;
}

function normalizeContact(body) {
  const contactType = String(body?.contactType || '').trim();
  const contact = String(body?.contact || '').trim();
  if (contactType === 'qq' && /^\d{5,12}$/.test(contact)) {
    return { contactType, contact };
  }
  if (contactType === 'email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
    return { contactType, contact };
  }
  return null;
}

/** 用户反馈：创建工单、按 token 查询；管理端需 FEEDBACK_ADMIN_TOKEN。 */
export function createFeedbackRoutes() {
  const routes = new Hono();

  routes.post('/api/feedback', async (context) => {
    if (!allowCreate(context)) {
      return context.json({ error: 'rate_limited' }, 429);
    }
    const body = await context.req.json().catch(() => null);
    if (String(body?.website || '').trim()) {
      return context.json({ ok: true, viewUrl: viewUrl('invalid') });
    }
    const type = String(body?.type || '').trim();
    const text = String(body?.body || '').trim();
    const clientVersion = String(body?.clientVersion || '').trim().slice(0, 32);
    const platform = String(body?.platform || 'unknown').trim();
    const contact = normalizeContact(body);
    if (!VALID_TYPES.has(type) || text.length < 8 || text.length > 2000 || !contact) {
      return context.json({ error: 'invalid_payload' }, 400);
    }
    if (!VALID_PLATFORMS.has(platform)) {
      return context.json({ error: 'invalid_payload' }, 400);
    }
    const ticket = createFeedbackTicket({
      type,
      body: text,
      clientVersion,
      platform,
      contactType: contact.contactType,
      contact: contact.contact,
      notifyEmail: body?.notifyEmail === true
    });
    return context.json({
      token: ticket.token,
      viewUrl: viewUrl(ticket.token),
      status: ticket.status,
      statusLabel: '已收到'
    });
  });

  routes.get('/api/feedback/:token', (context) => {
    const ticket = findFeedbackTicket(context.req.param('token'));
    if (!ticket) return context.json({ error: 'not_found' }, 404);
    return context.json(toPublicTicket(ticket));
  });

  routes.get('/admin/feedback', (context) => {
    const denied = assertAdmin(context);
    if (denied) return denied;
    const tickets = listFeedbackTickets().map((item) => toAdminTicket(item));
    return context.json({ tickets });
  });

  routes.patch('/admin/feedback/:token', async (context) => {
    const denied = assertAdmin(context);
    if (denied) return denied;
    const existing = findFeedbackTicket(context.req.param('token'));
    if (!existing) return context.json({ error: 'not_found' }, 404);
    const body = await context.req.json().catch(() => null);
    const patch = {};
    if (body?.status !== undefined) {
      const status = String(body.status).trim();
      if (!VALID_STATUSES.has(status)) return context.json({ error: 'invalid_status' }, 400);
      patch.status = status;
    }
    if (body?.publicNote !== undefined) patch.publicNote = String(body.publicNote || '').slice(0, 2000);
    if (body?.internalNote !== undefined) patch.internalNote = String(body.internalNote || '').slice(0, 4000);
    if (body?.fixedVersion !== undefined) {
      patch.fixedVersion = String(body.fixedVersion || '').slice(0, 32);
      if (patch.fixedVersion && body?.changelogUrl === undefined) {
        patch.changelogUrl = `https://log.95chong.cn/#${patch.fixedVersion}`;
      }
    }
    if (body?.changelogUrl !== undefined) patch.changelogUrl = String(body.changelogUrl || '').slice(0, 512);
    if (body?.hidden === true) patch.hidden = true;
    const updated = updateFeedbackTicket(existing.token, patch);
    return context.json(toAdminTicket(updated));
  });

  return routes;
}
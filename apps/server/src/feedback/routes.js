import { Hono } from 'hono';
import {
  attachmentLimits,
  readTicketAttachmentFile,
  saveTicketAttachment,
  toPublicAttachments
} from './attachments.js';
import {
  adminLoginEnabled,
  isFeedbackAdminAuthorized,
  loginFeedbackAdmin
} from './admin-auth.js';
import {
  appendFeedbackAttachment,
  cleanupFeedbackAttachments,
  createFeedbackTicket,
  deleteFeedbackTicket,
  findFeedbackTicket,
  findFeedbackTicketRecord,
  listFeedbackTickets,
  toAdminTicket,
  toPublicTicket,
  updateFeedbackTicket
} from './store.js';

const VALID_TYPES = new Set(['bug', 'feature', 'other']);
const VALID_STATUSES = new Set(['received', 'processing', 'fixed', 'rejected']);
const VALID_PLATFORMS = new Set(['electron', 'userscript', '']);

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
  const bearer = readAdminToken(context);
  if (!isFeedbackAdminAuthorized(bearer)) {
    return context.json({ error: 'unauthorized' }, 401);
  }
  return null;
}

function normalizeContact(body) {
  const contactType = String(body?.contactType || 'qq').trim();
  const contact = String(body?.contact || '').trim();
  // 联系方式选填；留空则工单只依赖进度页链接。
  if (!contact) {
    return { contactType: '', contact: '' };
  }
  if (contactType === 'qq' && /^\d{5,12}$/.test(contact)) {
    return { contactType: 'qq', contact };
  }
  if (contactType === 'email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
    return { contactType: 'email', contact };
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
    const platform = String(body?.platform ?? '').trim();
    const contact = normalizeContact(body);
    if (!VALID_TYPES.has(type) || !text || !contact) {
      return context.json({ error: 'invalid_payload' }, 400);
    }
    if (!VALID_PLATFORMS.has(platform)) {
      return context.json({ error: 'invalid_payload' }, 400);
    }
    // Bug 必须写明微端或浏览器；需求可不选使用方式。
    if (type === 'bug' && !platform) {
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

  /** 工单已创建后上传附件；一次可带多个文件字段 files。 */
  routes.post('/api/feedback/:token/attachments', async (context) => {
    const token = context.req.param('token');
    const ticket = findFeedbackTicket(token);
    if (!ticket) return context.json({ error: 'not_found' }, 404);
    if (!allowCreate(context)) {
      return context.json({ error: 'rate_limited' }, 429);
    }
    const body = await context.req.parseBody({ all: true }).catch(() => null);
    if (!body) return context.json({ error: 'invalid_payload' }, 400);
    const rawFiles = body.files ?? body.file;
    let files = [];
    if (Array.isArray(rawFiles)) {
      files = rawFiles;
    } else if (rawFiles) {
      files = [rawFiles];
    }
    if (!files.length) return context.json({ error: 'missing_files' }, 400);

    const existingCount = Array.isArray(ticket.attachments) ? ticket.attachments.length : 0;
    if (existingCount + files.length > attachmentLimits().maxCount) {
      return context.json({ error: 'too_many', limits: attachmentLimits() }, 400);
    }

    const limits = attachmentLimits();
    const saved = [];
    let working = ticket;
    for (const file of files) {
      if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function') {
        return context.json({ error: 'invalid_payload' }, 400);
      }
      const countNow = Array.isArray(working.attachments) ? working.attachments.length : 0;
      const result = await saveTicketAttachment(token, file, countNow);
      if (result.error) {
        return context.json({ error: result.error, limits }, result.status);
      }
      working = appendFeedbackAttachment(token, result.attachment) || working;
      saved.push(result.attachment);
    }
    return context.json({
      attachments: toPublicAttachments(token, working.attachments, working),
      saved: toPublicAttachments(token, saved, working),
      limits
    });
  });

  routes.get('/api/feedback/:token/attachments/:attachmentId', (context) => {
    const token = context.req.param('token');
    const attachmentId = context.req.param('attachmentId');
    const ticket = findFeedbackTicket(token);
    if (!ticket) return context.json({ error: 'not_found' }, 404);
    const attachment = (Array.isArray(ticket.attachments) ? ticket.attachments : [])
      .find((item) => item.id === attachmentId);
    if (!attachment) return context.json({ error: 'not_found' }, 404);
    if (attachment.deletedAt) return context.json({ error: 'attachment_expired' }, 410);
    const file = readTicketAttachmentFile(token, attachment);
    if (!file) return context.json({ error: 'not_found' }, 404);
    const inline = String(file.contentType).startsWith('image/') || file.contentType === 'application/pdf';
    return new Response(file.buffer, {
      headers: {
        'Content-Type': file.contentType,
        'Content-Length': String(file.buffer.length),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'Cache-Control': 'private, max-age=3600'
      }
    });
  });

  /** 管理端账号密码登录，返回 Bearer 会话令牌。 */
  routes.post('/admin/feedback/login', async (context) => {
    if (!adminLoginEnabled()) {
      return context.json({ error: 'login_disabled' }, 503);
    }
    const body = await context.req.json().catch(() => null);
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');
    if (!username || !password) {
      return context.json({ error: 'invalid_payload' }, 400);
    }
    const session = loginFeedbackAdmin(username, password);
    if (!session) {
      return context.json({ error: 'invalid_credentials' }, 401);
    }
    return context.json({
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt
    });
  });

  // 手动清理也在服务进程内执行，与状态更新串行，避免独立脚本覆盖同时写入的 JSON。
  routes.post('/admin/feedback-attachments/cleanup', (context) => {
    const denied = assertAdmin(context);
    if (denied) return denied;
    return context.json(cleanupFeedbackAttachments());
  });

  routes.get('/admin/feedback', (context) => {
    const denied = assertAdmin(context);
    if (denied) return denied;
    const tickets = listFeedbackTickets().map((item) => toAdminTicket(item));
    return context.json({ tickets });
  });

  routes.delete('/admin/feedback/:token', (context) => {
    const denied = assertAdmin(context);
    if (denied) return denied;
    const token = String(context.req.param('token') || '').trim();
    const existing = findFeedbackTicketRecord(token);
    if (!existing) return context.json({ error: 'not_found' }, 404);
    deleteFeedbackTicket(token);
    return context.json({ ok: true });
  });

  routes.patch('/admin/feedback/:token', async (context) => {
    const denied = assertAdmin(context);
    if (denied) return denied;
    const existing = findFeedbackTicket(context.req.param('token'));
    if (!existing) return context.json({ error: 'not_found' }, 404);
    const body = await context.req.json().catch(() => null);
    const patch = {};
    // 只有管理端能保留重要资料；用户上传或查询不能自行关闭过期清理。
    if (body?.retainAttachments !== undefined) {
      if (typeof body.retainAttachments !== 'boolean') return context.json({ error: 'invalid_retention' }, 400);
      patch.retainAttachments = body.retainAttachments;
    }
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

import crypto from 'node:crypto';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessions = new Map();

function readAdminUsername() {
  return String(process.env.FEEDBACK_ADMIN_USERNAME || '').trim();
}

function readAdminPassword() {
  return String(process.env.FEEDBACK_ADMIN_PASSWORD || '').trim();
}

function readLegacyAdminToken() {
  return String(process.env.FEEDBACK_ADMIN_TOKEN || '').trim();
}

function safeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left), 'utf8');
  const rightBuffer = Buffer.from(String(right), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function pruneExpiredSessions(now = Date.now()) {
  for (const [token, session] of sessions.entries()) {
    if (!session || session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
}

/** 网页管理端是否已配置账号密码。 */
export function adminLoginEnabled() {
  return Boolean(readAdminUsername() && readAdminPassword());
}

/**
 * 校验账号密码，成功则签发短期会话令牌供 Bearer 使用。
 * 返回 null 表示账号、密码不匹配或未配置。
 */
export function loginFeedbackAdmin(username, password) {
  if (!adminLoginEnabled()) return null;
  const name = String(username || '').trim();
  const secret = String(password || '').trim();
  if (!name || !secret) return null;
  if (!safeEqualString(name, readAdminUsername()) || !safeEqualString(secret, readAdminPassword())) {
    return null;
  }
  const now = Date.now();
  pruneExpiredSessions(now);
  const sessionToken = crypto.randomBytes(24).toString('base64url');
  sessions.set(sessionToken, {
    username: name,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS
  });
  return {
    sessionToken,
    expiresAt: now + SESSION_TTL_MS
  };
}

/** 管理接口：接受登录会话或旧的 FEEDBACK_ADMIN_TOKEN。 */
export function isFeedbackAdminAuthorized(bearerToken) {
  const token = String(bearerToken || '').trim();
  if (!token) return false;
  const legacy = readLegacyAdminToken();
  if (legacy && safeEqualString(token, legacy)) return true;
  const now = Date.now();
  pruneExpiredSessions(now);
  const session = sessions.get(token);
  if (!session || session.expiresAt <= now) {
    if (session) sessions.delete(token);
    return false;
  }
  return true;
}
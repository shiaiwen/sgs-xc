import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { deleteTicketAttachmentFile, normalizeAttachmentList, toPublicAttachments } from './attachments.js';
import { feedbackAttachmentExpiresAt, feedbackCompletedAt, isFeedbackCompleted } from './retention.js';

const filePath = path.join(process.cwd(), 'data', 'feedback-tickets.json');

const STATUS_LABELS = {
  received: '已收到',
  processing: '处理中',
  fixed: '已修复',
  rejected: '不采纳'
};

const TYPE_LABELS = {
  bug: 'Bug',
  feature: '需求',
  other: '其他'
};

function readJsonFile() {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonFile(value) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function normalizeDocument(raw) {
  const tickets = Array.isArray(raw?.tickets) ? raw.tickets : [];
  return {
    version: Number(raw?.version) || 1,
    tickets
  };
}

export function readFeedbackDocument() {
  return normalizeDocument(readJsonFile());
}

function saveTickets(tickets) {
  writeJsonFile({ version: 1, tickets });
}

export function createFeedbackTicket(input) {
  const token = crypto.randomBytes(18).toString('base64url');
  const now = Date.now();
  const ticket = {
    token,
    createdAt: now,
    updatedAt: now,
    type: input.type,
    body: input.body,
    clientVersion: input.clientVersion || '',
    platform: input.platform || '',
    contactType: input.contactType,
    contact: input.contact,
    status: 'received',
    completedAt: null,
    retainAttachments: false,
    publicNote: '',
    fixedVersion: '',
    changelogUrl: '',
    internalNote: '',
    hidden: false,
    notifyEmail: input.notifyEmail === true && input.contactType === 'email',
    attachments: []
  };
  const document = readFeedbackDocument();
  document.tickets.push(ticket);
  saveTickets(document.tickets);
  return ticket;
}

export function findFeedbackTicket(token) {
  const normalized = String(token || '').trim();
  if (!normalized) return null;
  return readFeedbackDocument().tickets.find((item) => item.token === normalized && item.hidden !== true) || null;
}

/** 管理端按 token 查找工单，包含已软隐藏的条目，供删除等运维操作使用。 */
export function findFeedbackTicketRecord(token) {
  const normalized = String(token || '').trim();
  if (!normalized) return null;
  return readFeedbackDocument().tickets.find((item) => item.token === normalized) || null;
}

/**
 * 物理删除工单：从 JSON 移除记录并尝试删掉磁盘附件。
 * 用户进度页将 404；附件删失败仍移除工单，避免列表里残留幽灵条目。
 */
export function deleteFeedbackTicket(token) {
  const normalized = String(token || '').trim();
  if (!normalized) return false;
  const document = readFeedbackDocument();
  const index = document.tickets.findIndex((item) => item.token === normalized);
  if (index < 0) return false;
  const ticket = document.tickets[index];
  for (const attachment of normalizeAttachmentList(ticket.attachments)) {
    if (attachment.deletedAt) continue;
    try {
      deleteTicketAttachmentFile(ticket.token, attachment);
    } catch {
      // 文件可能已被清理任务删掉，继续移除工单主记录。
    }
  }
  document.tickets.splice(index, 1);
  saveTickets(document.tickets);
  return true;
}

/** 管理端更新说明或状态；完成时间只随状态流转变化，不能被说明编辑重置。 */
export function updateFeedbackTicket(token, patch) {
  const document = readFeedbackDocument();
  const index = document.tickets.findIndex((item) => item.token === token);
  if (index < 0) return null;
  const current = document.tickets[index];
  const next = { ...current, ...patch, updatedAt: Date.now() };
  next.completedAt = feedbackCompletedAt(current, next, next.updatedAt);
  document.tickets[index] = next;
  saveTickets(document.tickets);
  return next;
}

export function listFeedbackTickets() {
  return readFeedbackDocument().tickets
    .filter((item) => item.hidden !== true)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function toPublicTicket(ticket) {
  if (!ticket || ticket.hidden) return null;
  const changelogUrl = ticket.changelogUrl
    || (ticket.fixedVersion ? `https://log.95chong.cn/#${ticket.fixedVersion}` : '');
  return {
    token: ticket.token,
    type: ticket.type,
    typeLabel: TYPE_LABELS[ticket.type] || ticket.type,
    body: ticket.body,
    clientVersion: ticket.clientVersion,
    platform: ticket.platform,
    status: ticket.status,
    statusLabel: STATUS_LABELS[ticket.status] || ticket.status,
    publicNote: ticket.publicNote || '',
    fixedVersion: ticket.fixedVersion || '',
    changelogUrl,
    attachments: toPublicAttachments(ticket.token, ticket.attachments, ticket),
    submittedAt: ticket.createdAt,
    updatedAt: ticket.updatedAt
  };
}

export function appendFeedbackAttachment(token, attachment) {
  const document = readFeedbackDocument();
  const index = document.tickets.findIndex((item) => item.token === token);
  if (index < 0) return null;
  const current = document.tickets[index];
  const attachments = normalizeAttachmentList(current.attachments);
  attachments.push(attachment);
  const next = { ...current, attachments, updatedAt: Date.now() };
  document.tickets[index] = next;
  saveTickets(document.tickets);
  return next;
}

/**
 * 从当前工单快照同步清理过期文件；不跨 await，避免状态更新与清理交错。
 * 文件删成功才标记，失败留待重试；已不存在的文件也会补记清理状态。
 */
export function cleanupFeedbackAttachments({ now = Date.now(), dryRun = false } = {}) {
  const document = readFeedbackDocument();
  const result = { deleted: 0, reclaimedBytes: 0, initialized: 0, errors: [] };
  let changed = false;
  for (const ticket of document.tickets) {
    if (!isFeedbackCompleted(ticket)) continue;
    // 旧工单缺少完成时间时从首次检查开始计时，不能用旧更新时间立即删除资料。
    if (!Number.isFinite(ticket.completedAt) || ticket.completedAt <= 0) {
      ticket.completedAt = now;
      result.initialized += 1;
      changed = true;
    }
    for (const attachment of normalizeAttachmentList(ticket.attachments)) {
      const expiresAt = feedbackAttachmentExpiresAt(ticket, attachment);
      if (expiresAt === null || expiresAt > now) continue;
      try {
        if (!dryRun) {
          deleteTicketAttachmentFile(ticket.token, attachment);
          attachment.deletedAt = now;
          changed = true;
        }
        result.deleted += 1;
        result.reclaimedBytes += Number(attachment.size) || 0;
      } catch (error) {
        result.errors.push({ token: ticket.token, attachmentId: attachment.id, error: error.message });
      }
    }
  }
  // 清理不会改写 updatedAt，用户看到的最后更新仍表示工单的处理进展。
  if (changed && !dryRun) saveTickets(document.tickets);
  return result;
}

export function toAdminTicket(ticket) {
  if (!ticket) return null;
  return {
    ...toPublicTicket(ticket),
    contactType: ticket.contactType,
    contact: ticket.contact,
    internalNote: ticket.internalNote || '',
    notifyEmail: ticket.notifyEmail === true,
    completedAt: ticket.completedAt || null,
    retainAttachments: ticket.retainAttachments === true,
  // 与公开工单一致，带上下载路径，管理端才能预览图片。
    attachments: toPublicAttachments(ticket.token, ticket.attachments, ticket)
  };
}

export { STATUS_LABELS, TYPE_LABELS };

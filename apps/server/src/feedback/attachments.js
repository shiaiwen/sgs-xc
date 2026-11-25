/**
 * 反馈附件：工单建好后按 token 落盘，公开接口只读元数据与文件内容。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ATTACHMENTS_ROOT = path.join(process.cwd(), 'data', 'feedback-attachments');
const MAX_ATTACHMENTS_PER_TICKET = 5;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain'
]);

function ticketDir(token) {
  return path.join(ATTACHMENTS_ROOT, token);
}

function safeFileName(name) {
  const base = path.basename(String(name || 'file')).replace(/[^\w.\u4e00-\u9fff-]+/g, '_');
  return base.slice(0, 120) || 'file';
}

function ensureTicketDir(token) {
  const dir = ticketDir(token);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function attachmentLimits() {
  return {
    maxCount: MAX_ATTACHMENTS_PER_TICKET,
    maxBytes: MAX_ATTACHMENT_BYTES,
    allowedContentTypes: [...ALLOWED_CONTENT_TYPES]
  };
}

export function isAllowedContentType(contentType) {
  return ALLOWED_CONTENT_TYPES.has(String(contentType || '').split(';')[0].trim().toLowerCase());
}

function contentTypeFromName(name) {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.txt')) return 'text/plain';
  return '';
}

export function normalizeAttachmentList(list) {
  return Array.isArray(list) ? list.filter((item) => item && item.id && item.storedName) : [];
}

/** 把浏览器上传的 File/Blob 写到工单目录，返回可写入工单的元数据。 */
export async function saveTicketAttachment(token, file, existingCount) {
  if (existingCount >= MAX_ATTACHMENTS_PER_TICKET) {
    return { error: 'too_many', status: 400 };
  }
  const reportedType = String(file?.type || '').split(';')[0].trim().toLowerCase();
  const contentType = isAllowedContentType(reportedType)
    ? reportedType
    : contentTypeFromName(file?.name);
  if (!isAllowedContentType(contentType)) {
    return { error: 'unsupported_type', status: 400 };
  }
  const size = Number(file?.size || 0);
  if (!(size > 0) || size > MAX_ATTACHMENT_BYTES) {
    return { error: 'invalid_size', status: 400 };
  }
  const id = crypto.randomBytes(10).toString('base64url');
  const originalName = safeFileName(file.name);
  const storedName = `${id}-${originalName}`;
  const dir = ensureTicketDir(token);
  const absolutePath = path.join(dir, storedName);
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    return { error: 'invalid_size', status: 400 };
  }
  fs.writeFileSync(absolutePath, buffer);
  return {
    attachment: {
      id,
      name: originalName,
      storedName,
      contentType,
      size: buffer.length,
      createdAt: Date.now()
    }
  };
}

export function readTicketAttachmentFile(token, attachment) {
  if (!attachment?.storedName) return null;
  const absolutePath = path.join(ticketDir(token), attachment.storedName);
  if (!fs.existsSync(absolutePath)) return null;
  return {
    buffer: fs.readFileSync(absolutePath),
    contentType: attachment.contentType || 'application/octet-stream',
    name: attachment.name || attachment.storedName
  };
}

export function toPublicAttachments(token, list) {
  return normalizeAttachmentList(list).map((item) => ({
    id: item.id,
    name: item.name,
    contentType: item.contentType,
    size: item.size,
    url: `/api/feedback/${encodeURIComponent(token)}/attachments/${encodeURIComponent(item.id)}`
  }));
}

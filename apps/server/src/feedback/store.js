import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeAttachmentList, toPublicAttachments } from './attachments.js';

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

export function updateFeedbackTicket(token, patch) {
  const document = readFeedbackDocument();
  const index = document.tickets.findIndex((item) => item.token === token);
  if (index < 0) return null;
  const current = document.tickets[index];
  const next = { ...current, ...patch, updatedAt: Date.now() };
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
    attachments: toPublicAttachments(ticket.token, ticket.attachments),
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

export function toAdminTicket(ticket) {
  if (!ticket) return null;
  return {
    ...toPublicTicket(ticket),
    contactType: ticket.contactType,
    contact: ticket.contact,
    internalNote: ticket.internalNote || '',
    notifyEmail: ticket.notifyEmail === true,
    attachments: normalizeAttachmentList(ticket.attachments)
  };
}

export { STATUS_LABELS, TYPE_LABELS };
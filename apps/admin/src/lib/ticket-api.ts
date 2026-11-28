export type FeedbackAdminStatus = "received" | "processing" | "fixed" | "rejected";

export type AdminAttachment = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  url: string;
  deletedAt?: number | null;
};

export type AdminTicket = {
  token: string;
  type: string;
  typeLabel: string;
  body: string;
  platform: string;
  clientVersion: string;
  status: FeedbackAdminStatus;
  statusLabel: string;
  publicNote: string;
  contactType: string;
  contact: string;
  internalNote: string;
  attachments: AdminAttachment[];
  submittedAt: number;
  updatedAt: number;
};

const SESSION_KEY = "sgs-xc-feedback-admin-token";

function apiBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_FEEDBACK_API_BASE?.replace(/\/$/, "");
  return fromEnv || "";
}

function portalBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_PORTAL_ORIGIN?.replace(/\/$/, "");
  return fromEnv || "http://localhost:3000";
}

function authHeaders(sessionToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${sessionToken}`,
    "Content-Type": "application/json",
  };
}

export function readSessionToken(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(SESSION_KEY)?.trim() || "";
}

export function saveSessionToken(token: string): void {
  const normalized = token.trim();
  if (!normalized) {
    sessionStorage.removeItem(SESSION_KEY);
    return;
  }
  sessionStorage.setItem(SESSION_KEY, normalized);
}

export function clearSessionToken(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export function userTicketViewUrl(ticketToken: string): string {
  return `${portalBase()}/feedback/view?token=${encodeURIComponent(ticketToken)}`;
}

export async function loginAdmin(username: string, password: string): Promise<string> {
  const response = await fetch(`${apiBase()}/admin/feedback/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username.trim(), password }),
  });
  if (response.status === 503) throw new Error("服务端尚未配置管理账号");
  if (response.status === 401) throw new Error("账号或密码不正确");
  if (!response.ok) throw new Error("登录失败");
  const payload = (await response.json()) as { sessionToken?: string };
  if (!payload.sessionToken) throw new Error("登录失败");
  return payload.sessionToken;
}

export async function fetchAdminTickets(sessionToken: string): Promise<AdminTicket[]> {
  const response = await fetch(`${apiBase()}/admin/feedback`, {
    headers: authHeaders(sessionToken),
  });
  if (response.status === 401) throw new Error("登录已失效");
  if (!response.ok) throw new Error("工单列表加载失败");
  const payload = (await response.json()) as { tickets?: AdminTicket[] };
  const list = Array.isArray(payload.tickets) ? payload.tickets : [];
  return list.map((item) => ({
    ...item,
    attachments: Array.isArray(item.attachments) ? item.attachments : [],
  }));
}

/** 永久删除工单；成功后列表与进度页均不可再访问。 */
export async function deleteAdminTicket(sessionToken: string, ticketToken: string): Promise<void> {
  const response = await fetch(`${apiBase()}/admin/feedback/${encodeURIComponent(ticketToken)}`, {
    method: "DELETE",
    headers: authHeaders(sessionToken),
  });
  if (response.status === 401) throw new Error("登录已失效");
  if (response.status === 404) throw new Error("找不到这条工单");
  if (!response.ok) throw new Error("删除失败");
}

export async function patchAdminTicket(
  sessionToken: string,
  ticketToken: string,
  patch: {
    status?: FeedbackAdminStatus;
    publicNote?: string;
    fixedVersion?: string;
    internalNote?: string;
  },
): Promise<AdminTicket> {
  const response = await fetch(`${apiBase()}/admin/feedback/${encodeURIComponent(ticketToken)}`, {
    method: "PATCH",
    headers: authHeaders(sessionToken),
    body: JSON.stringify(patch),
  });
  if (response.status === 401) throw new Error("登录已失效");
  if (response.status === 404) throw new Error("找不到这条工单");
  if (!response.ok) throw new Error("保存失败");
  return response.json() as Promise<AdminTicket>;
}

export const STATUS_OPTIONS: Array<{ value: FeedbackAdminStatus; label: string }> = [
  { value: "received", label: "已收到" },
  { value: "processing", label: "处理中" },
  { value: "fixed", label: "已修复" },
  { value: "rejected", label: "不采纳" },
];

export function formatTime(value: number): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export function platformLabel(platform: string): string {
  if (platform === "electron") return "微端";
  if (platform === "userscript") return "浏览器";
  return "未指定";
}

export function contactLabel(ticket: Pick<AdminTicket, "contactType" | "contact">): string {
  if (!ticket.contact) return "未填写";
  if (ticket.contactType === "qq") return `QQ ${ticket.contact}`;
  if (ticket.contactType === "email") return ticket.contact;
  return ticket.contact;
}

export function resolveAttachmentUrl(ticketToken: string, attachmentId: string): string {
  const path = `/api/feedback/${encodeURIComponent(ticketToken)}/attachments/${encodeURIComponent(attachmentId)}`;
  const base = apiBase();
  return base ? `${base}${path}` : path;
}

export function formatFileSize(bytes: number): string {
  if (!(bytes > 0)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageAttachment(contentType: string, name: string): boolean {
  const mime = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (mime.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif)$/i.test(name);
}

export function attachmentIsImage(item: AdminAttachment): boolean {
  return isImageAttachment(item.contentType, item.name);
}
export type FeedbackType = "bug" | "feature" | "other";
export type FeedbackPlatform = "electron" | "userscript";

export type FeedbackAttachment = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  url: string;
};

export type FeedbackTicket = {
  token: string;
  type: FeedbackType;
  typeLabel: string;
  body: string;
  clientVersion: string;
  platform: string;
  status: "received" | "processing" | "fixed" | "rejected";
  statusLabel: string;
  publicNote: string;
  fixedVersion: string;
  changelogUrl: string;
  attachments: FeedbackAttachment[];
  submittedAt: number;
  updatedAt: number;
};

export type CreateFeedbackResponse = {
  token: string;
  viewUrl: string;
  status: string;
  statusLabel: string;
};

export const FEEDBACK_MAX_ATTACHMENTS = 5;
export const FEEDBACK_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const FEEDBACK_ALLOWED_ATTACHMENT_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain";

function apiBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_FEEDBACK_API_BASE?.replace(/\/$/, "");
  return fromEnv || "";
}

export function resolveFeedbackAttachmentUrl(path: string): string {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  const base = apiBase();
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function createFeedbackTicket(payload: {
  type: FeedbackType;
  body: string;
  clientVersion: string;
  platform: FeedbackPlatform;
  contactType: "qq" | "email";
  contact: string;
  notifyEmail?: boolean;
  website?: string;
}): Promise<CreateFeedbackResponse> {
  const response = await fetch(`${apiBase()}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(response.status === 429 ? "提交太频繁，请稍后再试" : "提交失败，请稍后重试");
  }
  return response.json();
}

/** 工单创建成功后再传附件，不要和建单请求混在一起。同名字段 files 可带多个文件。 */
export async function uploadFeedbackAttachments(token: string, files: File[]): Promise<{
  savedCount: number;
}> {
  if (!files.length) return { savedCount: 0 };
  const form = new FormData();
  for (const file of files) {
    form.append("files", file, file.name);
  }
  const response = await fetch(`${apiBase()}/api/feedback/${encodeURIComponent(token)}/attachments`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error("附件上传太频繁，请稍后再试");
    throw new Error("工单已创建，但附件上传失败，可打开进度页后联系我们补传");
  }
  const payload = (await response.json().catch(() => null)) as { saved?: unknown[] } | null;
  const savedCount = Array.isArray(payload?.saved) ? payload.saved.length : files.length;
  return { savedCount };
}

export async function fetchFeedbackTicket(token: string): Promise<FeedbackTicket> {
  const response = await fetch(`${apiBase()}/api/feedback/${encodeURIComponent(token)}`);
  if (!response.ok) throw new Error("找不到这条反馈，请检查链接是否完整");
  const ticket = await response.json();
  return {
    ...ticket,
    attachments: Array.isArray(ticket.attachments) ? ticket.attachments : [],
  };
}

export function formatFeedbackTime(value: number): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export function formatAttachmentSize(bytes: number): string {
  if (!(bytes > 0)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

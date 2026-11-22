export type FeedbackType = "bug" | "feature" | "other";
export type FeedbackPlatform = "electron" | "userscript" | "unknown";

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
  submittedAt: number;
  updatedAt: number;
};

export type CreateFeedbackResponse = {
  token: string;
  viewUrl: string;
  status: string;
  statusLabel: string;
};

function apiBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_FEEDBACK_API_BASE?.replace(/\/$/, "");
  return fromEnv || "";
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

export async function fetchFeedbackTicket(token: string): Promise<FeedbackTicket> {
  const response = await fetch(`${apiBase()}/api/feedback/${encodeURIComponent(token)}`);
  if (!response.ok) throw new Error("找不到这条反馈，请检查链接是否完整");
  return response.json();
}

export function formatFeedbackTime(value: number): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}
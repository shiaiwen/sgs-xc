export type AnniversaryAssistReadyReport = {
  code: string;
  resetAt: number;
  used: number;
  canBind: boolean;
  canReceive: boolean;
};

export type AnniversaryAssistReceipt = {
  id: string;
  otherAccountId: string;
  bindTime: number;
  missing?: boolean;
};

export type AnniversaryAssistVerifyItem = {
  id: string;
  otherAccountId: string;
  direction: number;
  since: number;
  until: number;
  checkMissing?: boolean;
};

export type AnniversaryAssistBindAttempt = {
  jobId: string;
  partnerUserId: string;
  attemptedAt: number;
  result: number | null;
};

export type AnniversaryAssistJob = {
  id: string;
  code?: string;
  actId: number;
  expiresAt: number;
  partnerUserId?: string;
};

export type AnniversaryAssistTotals = {
  given: number;
  received: number;
  pending: number;
};

export type AnniversaryTransferredRow = {
  accountId: string;
  given: number;
};

export type AnniversaryAssistSyncResponse = {
  ok: boolean;
  job?: AnniversaryAssistJob | null;
  verify?: AnniversaryAssistVerifyItem[];
  totals?: AnniversaryAssistTotals;
  creditAccountId?: string;
  creditVersion?: number;
  selfTransferred?: number;
  transferredContributions?: AnniversaryTransferredRow[];
  error?: string;
};

export type AnniversaryAssistStatusResponse = {
  ok: boolean;
  totals?: AnniversaryAssistTotals;
  selfTransferred?: number;
  creditAccountId?: string;
  creditVersion?: number;
  transferredContributions?: AnniversaryTransferredRow[];
  active?: boolean;
  error?: string;
};

export type AnniversaryAssistUiStatus = {
  phase: 'idle' | 'syncing' | 'binding' | 'verifying' | 'error';
  message: string;
  totals: AnniversaryAssistTotals;
  selfTransferred: number;
  creditAccountId: string;
  transferredContributions: AnniversaryTransferredRow[];
  todayUsed: string;
  activityOpen: boolean;
  enabled: boolean;
};
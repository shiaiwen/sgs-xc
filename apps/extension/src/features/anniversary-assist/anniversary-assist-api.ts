import { anniversaryAssistApiBaseUrl } from '../../const/anniversary-assist-endpoint.ts';
import type { AnniversaryLedgerScope } from './anniversary-assist-scope.ts';
import type {
  AnniversaryAssistBindAttempt,
  AnniversaryAssistReadyReport,
  AnniversaryAssistReceipt,
  AnniversaryAssistStatusResponse,
  AnniversaryAssistSyncResponse,
} from './anniversary-assist-types.ts';

type AnniversaryAssistRequestBody = Record<string, unknown> & {
  account: string;
  userId: string;
  scopeKey: string;
  actId: number;
  action: string;
};

async function postAnniversaryAssist(
  scope: AnniversaryLedgerScope,
  body: Omit<AnniversaryAssistRequestBody, 'account' | 'userId' | 'scopeKey' | 'actId'>
): Promise<Record<string, unknown>> {
  const payload: AnniversaryAssistRequestBody = {
    account: scope.loginAccount,
    userId: scope.gameUserId,
    scopeKey: scope.scopeKey,
    actId: scope.actId,
    ...body,
  };
  const response = await fetch(anniversaryAssistApiBaseUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return { ok: false, error: String(json.error ?? `HTTP ${response.status}`) };
  }
  return json;
}

export async function fetchAnniversaryAssistStatus(
  scope: AnniversaryLedgerScope
): Promise<AnniversaryAssistStatusResponse> {
  const json = await postAnniversaryAssist(scope, { action: 'status' });
  return json as AnniversaryAssistStatusResponse;
}

export async function syncAnniversaryAssist(
  scope: AnniversaryLedgerScope,
  input: {
    ready?: AnniversaryAssistReadyReport;
    receipts?: AnniversaryAssistReceipt[];
    bindAttempts?: AnniversaryAssistBindAttempt[];
    creditAccountId?: string;
    creditVersion?: number;
    claimBeforeBind?: boolean;
  }
): Promise<AnniversaryAssistSyncResponse> {
  const json = await postAnniversaryAssist(scope, {
    action: 'sync',
    claimBeforeBind: input.claimBeforeBind ?? true,
    ready: input.ready,
    receipts: input.receipts ?? [],
    bindAttempts: input.bindAttempts ?? [],
    creditAccountId: input.creditAccountId,
    creditVersion: input.creditVersion,
  });
  return json as AnniversaryAssistSyncResponse;
}

export async function claimAnniversaryAssistJob(
  scope: AnniversaryLedgerScope,
  jobId: string
): Promise<{ ok: boolean; code?: string; error?: string }> {
  const json = await postAnniversaryAssist(scope, { action: 'claim', id: jobId });
  return json as { ok: boolean; code?: string; error?: string };
}

export async function rejectAnniversaryAssistJob(
  scope: AnniversaryLedgerScope,
  jobId: string,
  result: unknown
): Promise<{ ok: boolean; error?: string }> {
  const json = await postAnniversaryAssist(scope, { action: 'reject', id: jobId, result });
  return json as { ok: boolean; error?: string };
}

export async function setAnniversaryCreditAccount(
  scope: AnniversaryLedgerScope,
  creditAccountId: string,
  options?: { onlyIfUnset?: boolean }
): Promise<{ ok: boolean; creditAccountId?: string; creditVersion?: number; error?: string }> {
  const json = await postAnniversaryAssist(scope, {
    action: 'setCreditAccount',
    creditAccountId,
    onlyIfUnset: options?.onlyIfUnset ?? false,
  });
  return json as { ok: boolean; creditAccountId?: string; creditVersion?: number; error?: string };
}

export async function leaveAnniversaryAssist(scope: AnniversaryLedgerScope): Promise<{ ok: boolean }> {
  const json = await postAnniversaryAssist(scope, { action: 'leave' });
  return json as { ok: boolean };
}
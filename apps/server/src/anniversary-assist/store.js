import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { inTransaction } from '../db.js';

const DATA_FILE = path.join(process.cwd(), 'data', 'anniversary-assist.json');
const JOB_TTL_MS = 10 * 60 * 1000;
const VERIFY_DIRECTION_GIVE = 2;
const SNAPSHOT_ID = 'global';

let memoryState = null;
let snapshotTableReady;

function emptyTotals() {
  return { given: 0, received: 0, pending: 0 };
}

function emptyState() {
  return { scopes: {}, jobs: {}, receipts: {}, verifies: {} };
}

function normalizeState(raw) {
  const state = raw && typeof raw === 'object' ? raw : emptyState();
  state.scopes ??= {};
  state.jobs ??= {};
  state.receipts ??= {};
  state.verifies ??= {};
  return state;
}

function loadFileState() {
  if (!fs.existsSync(DATA_FILE)) return emptyState();
  return normalizeState(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
}

function saveFileState(state) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  memoryState = state;
}

async function ensureSnapshotTable(client) {
  if (snapshotTableReady) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS anniversary_assist_snapshot (
      id TEXT PRIMARY KEY,
      document JSONB NOT NULL,
      updated_at BIGINT NOT NULL DEFAULT 0
    )
  `);
  snapshotTableReady = true;
}

async function loadState(client) {
  if (client) {
    await ensureSnapshotTable(client);
    const { rows } = await client.query(
      'SELECT document FROM anniversary_assist_snapshot WHERE id = $1',
      [SNAPSHOT_ID]
    );
    if (rows[0]?.document) {
      const state = normalizeState(rows[0].document);
      memoryState = state;
      saveFileState(state);
      return state;
    }
  }
  const state = memoryState ?? loadFileState();
  memoryState = state;
  return state;
}

async function persistState(client, state) {
  saveFileState(state);
  if (!client) return;
  await ensureSnapshotTable(client);
  await client.query(
    `INSERT INTO anniversary_assist_snapshot (id, document, updated_at)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (id) DO UPDATE
     SET document = EXCLUDED.document, updated_at = EXCLUDED.updated_at`,
    [SNAPSHOT_ID, JSON.stringify(state), Date.now()]
  );
}

function ensureScope(state, scopeKey, body) {
  const now = Date.now();
  const row = state.scopes[scopeKey] ?? {
    scope_key: scopeKey,
    login_account: body.account,
    game_user_id: body.userId,
    act_id: Number(body.actId || 1),
    credit_account_id: '',
    credit_version: 0,
    active: false,
    transferred_given: 0,
    ready: null,
    updated_at: now,
    ...emptyTotals(),
  };
  return row;
}

function scopePriority(row) {
  return Number(row.given || 0) - Number(row.received || 0);
}

function newJobId() {
  return randomBytes(12).toString('hex');
}

function findScopeByGameUserId(state, userId) {
  const target = String(userId || '').trim();
  if (!target) return null;
  return Object.values(state.scopes).find((row) => row.game_user_id === target) ?? null;
}

function transferredContributionsFor(state, gameUserId) {
  const target = String(gameUserId || '').trim();
  if (!target) return [];
  return Object.values(state.scopes)
    .filter((row) => String(row.credit_account_id || '') === target)
    .map((row) => ({
      accountId: row.game_user_id,
      given: Number(row.transferred_given || 0),
    }))
    .filter((item) => item.given > 0);
}

function applyCreditFromSync(row, body) {
  if (typeof body.creditAccountId !== 'string') return;
  const incomingVersion = Number(body.creditVersion);
  if (Number.isFinite(incomingVersion) && incomingVersion > 0 && incomingVersion !== row.credit_version) {
    return;
  }
  if (body.creditAccountId.length > 0) {
    row.credit_account_id = body.creditAccountId.trim();
  }
}

function applyReceipts(state, scopeKey, receipts) {
  const row = state.scopes[scopeKey];
  if (!row) return [];
  const confirmed = [];
  for (const receipt of Array.isArray(receipts) ? receipts : []) {
    const receiptId = String(receipt.id || '');
    if (!receiptId || state.receipts[receiptId]) continue;
    state.receipts[receiptId] = { scopeKey, ...receipt };
    if (receipt.missing) {
      const verify = state.verifies[receiptId];
      if (verify) delete state.verifies[receiptId];
      if (row.pending > 0) row.pending -= 1;
      confirmed.push(receiptId);
      continue;
    }
    const otherUserId = String(receipt.otherAccountId || '').trim();
    const partner = findScopeByGameUserId(state, otherUserId);
    const creditTarget = String(row.credit_account_id || '').trim();
    if (creditTarget && creditTarget !== row.game_user_id) {
      row.transferred_given = Number(row.transferred_given || 0) + 1;
      const creditScope = findScopeByGameUserId(state, creditTarget);
      if (creditScope) creditScope.given += 1;
    } else {
      row.given += 1;
    }
    if (partner) partner.received += 1;
    if (row.pending > 0) row.pending -= 1;
    const verify = state.verifies[receiptId];
    if (verify) delete state.verifies[receiptId];
    confirmed.push(receiptId);
  }
  row.updated_at = Date.now();
  return confirmed;
}

function registerBindAttempts(state, scopeKey, attempts) {
  const pendingVerify = [];
  const now = Date.now();
  for (const attempt of Array.isArray(attempts) ? attempts : []) {
    const jobId = String(attempt.jobId || '');
    const partnerUserId = String(attempt.partnerUserId || '').trim();
    if (!jobId || !partnerUserId) continue;
    const verifyId = `${jobId}:${scopeKey}`;
    if (state.verifies[verifyId]) continue;
    const attemptedAt = Number(attempt.attemptedAt || now);
    const item = {
      id: verifyId,
      otherAccountId: partnerUserId,
      direction: VERIFY_DIRECTION_GIVE,
      since: attemptedAt - 60_000,
      until: attemptedAt + 5 * 60_000,
      checkMissing: true,
    };
    state.verifies[verifyId] = { scopeKey, ...item };
    pendingVerify.push(item);
    const job = state.jobs[jobId];
    if (job && job.assignee_scope === scopeKey) delete state.jobs[jobId];
  }
  return pendingVerify;
}

function pickPartner(assignee, state) {
  const candidates = Object.values(state.scopes).filter((row) => {
    if (row.scope_key === assignee.scope_key) return false;
    if (row.game_user_id === assignee.game_user_id) return false;
    if (!row.active) return false;
    const ready = row.ready;
    if (!ready?.code) return false;
    if (!ready.canReceive) return false;
    return true;
  });
  candidates.sort(
    (left, right) => scopePriority(right) - scopePriority(left) || left.scope_key.localeCompare(right.scope_key)
  );
  return candidates[0] ?? null;
}

function collectOpenVerify(scopeKey, state) {
  return Object.values(state.verifies)
    .filter((item) => item.scopeKey === scopeKey)
    .map((item) => ({
      id: item.id,
      otherAccountId: item.otherAccountId,
      direction: item.direction,
      since: item.since,
      until: item.until,
      checkMissing: item.checkMissing,
    }));
}

function handleSyncBody(scopeKey, body, state) {
  const now = Date.now();
  const row = ensureScope(state, scopeKey, body);
  row.active = true;
  row.updated_at = now;
  applyCreditFromSync(row, body);
  if (body.ready) row.ready = body.ready;
  state.scopes[scopeKey] = row;

  applyReceipts(state, scopeKey, body.receipts);
  const attemptVerify = registerBindAttempts(state, scopeKey, body.bindAttempts);

  let job = null;
  const existingJob = Object.values(state.jobs).find((item) => item.assignee_scope === scopeKey && item.expires_at > now);
  if (existingJob) {
    job = existingJob;
  } else if (body.ready?.canBind) {
    const partner = pickPartner(row, state);
    const partnerCode = partner?.ready?.code;
    if (partner && partnerCode) {
      const jobId = newJobId();
      job = {
        id: jobId,
        actId: Number(body.actId || 1),
        code: body.claimBeforeBind ? undefined : partnerCode,
        partner_user_id: partner.game_user_id,
        assignee_scope: scopeKey,
        partner_scope: partner.scope_key,
        partner_code: partnerCode,
        expires_at: now + JOB_TTL_MS,
        claimed: false,
      };
      state.jobs[jobId] = job;
      row.pending += 1;
    }
  }

  const verify = [...collectOpenVerify(scopeKey, state), ...attemptVerify];
  const uniqueVerify = [];
  const seen = new Set();
  for (const item of verify) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    uniqueVerify.push(item);
  }

  return {
    ok: true,
    totals: { given: row.given, received: row.received, pending: row.pending },
    selfTransferred: Number(row.transferred_given || 0),
    creditAccountId: row.credit_account_id,
    creditVersion: row.credit_version,
    transferredContributions: transferredContributionsFor(state, row.game_user_id),
    job: job
      ? {
          id: job.id,
          actId: job.actId,
          expiresAt: job.expires_at,
          partnerUserId: job.partner_user_id,
          code: job.code,
        }
      : null,
    verify: uniqueVerify,
  };
}

function handleClaim(scopeKey, body, state) {
  const job = state.jobs[String(body.id || '')];
  if (!job || job.assignee_scope !== scopeKey) return { ok: false, error: '任务不存在' };
  if (job.expires_at < Date.now()) return { ok: false, error: '任务已过期' };
  job.claimed = true;
  return { ok: true, code: job.partner_code, partnerUserId: job.partner_user_id };
}

function handleReject(scopeKey, body, state) {
  const job = state.jobs[String(body.id || '')];
  if (!job || job.assignee_scope !== scopeKey) return { ok: true };
  delete state.jobs[job.id];
  const row = state.scopes[scopeKey];
  if (row && row.pending > 0) row.pending -= 1;
  return { ok: true };
}

function handleSetCredit(scopeKey, body, state) {
  const row = state.scopes[scopeKey] ?? ensureScope(state, scopeKey, body);
  if (body.onlyIfUnset && row.credit_account_id) {
    return { ok: true, creditAccountId: row.credit_account_id, creditVersion: row.credit_version };
  }
  const next = typeof body.creditAccountId === 'string' ? body.creditAccountId.trim() : '';
  if (next && next === row.game_user_id) return { ok: false, error: '不能归集到自己' };
  if (next && !/^[0-9]{1,32}$/.test(next)) {
    return { ok: false, error: '目标大号格式不对' };
  }
  row.credit_account_id = next;
  row.credit_version += 1;
  row.updated_at = Date.now();
  state.scopes[scopeKey] = row;
  return { ok: true, creditAccountId: row.credit_account_id, creditVersion: row.credit_version };
}

function clearScopeVerifies(state, scopeKey) {
  for (const verifyId of Object.keys(state.verifies)) {
    if (state.verifies[verifyId].scopeKey === scopeKey) {
      delete state.verifies[verifyId];
    }
  }
}

function handleLeave(scopeKey, state) {
  const row = state.scopes[scopeKey];
  if (!row) return { ok: true };
  row.active = false;
  row.updated_at = Date.now();
  Object.keys(state.jobs).forEach((jobId) => {
    if (state.jobs[jobId].assignee_scope === scopeKey) {
      if (row.pending > 0) row.pending -= 1;
      delete state.jobs[jobId];
    }
  });
  clearScopeVerifies(state, scopeKey);
  return { ok: true };
}

function handleStatus(scopeKey, state) {
  const row = state.scopes[scopeKey];
  if (!row) {
    return { ok: true, active: false, totals: emptyTotals(), selfTransferred: 0, creditAccountId: '', transferredContributions: [] };
  }
  return {
    ok: true,
    active: row.active,
    totals: { given: row.given, received: row.received, pending: row.pending },
    selfTransferred: Number(row.transferred_given || 0),
    creditAccountId: row.credit_account_id,
    creditVersion: row.credit_version,
    transferredContributions: transferredContributionsFor(state, row.game_user_id),
  };
}

function dispatchState(action, body, state) {
  const scopeKey = String(body.scopeKey || '');
  if (action === 'status') return { result: handleStatus(scopeKey, state), shouldPersist: false };
  if (action === 'leave') return { result: handleLeave(scopeKey, state), shouldPersist: true };
  if (action === 'setCreditAccount') return { result: handleSetCredit(scopeKey, body, state), shouldPersist: true };
  if (action === 'claim') return { result: handleClaim(scopeKey, body, state), shouldPersist: true };
  if (action === 'reject') return { result: handleReject(scopeKey, body, state), shouldPersist: true };
  if (action === 'sync') return { result: handleSyncBody(scopeKey, body, state), shouldPersist: true };
  return { result: { ok: false, error: '未知动作' }, shouldPersist: false };
}

async function runPersisted(action, body, client) {
  const state = await loadState(client);
  const { result, shouldPersist } = dispatchState(action, body, state);
  if (shouldPersist) await persistState(client, state);
  return result;
}

export async function runAnniversaryAssistAction(body) {
  const scopeKey = String(body.scopeKey || '');
  const action = String(body.action || '');
  if (!scopeKey || !body.account || !body.userId) {
    return { ok: false, error: '缺少身份' };
  }

  try {
    return await inTransaction((client) => runPersisted(action, body, client));
  } catch {
    return runPersisted(action, body, null);
  }
}

export const __anniversaryAssistInternals = {
  scopePriority,
};
import { getPool } from '../db.js';

/** 一份账号配置最大体积，避免把整张图塞进库。 */
const MAX_DOCUMENT_BYTES = 512 * 1024;
/** 每一类最多存这么多项，比小抄现有的开关多出不少。 */
const MAX_ENTRIES_PER_SECTION = 1000;
/** 文档格式版本，和小抄里的同一个数。别的版本当作空文档。 */
const DOCUMENT_VERSION = 2;
/** 开关一类，小抄背景一类。每一项是 { value, savedAt }。 */
const SECTIONS = ['settings', 'background'];

let schemaReady;

function ensureSchema() {
  schemaReady ??= (async () => {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS account_config (
        account TEXT PRIMARY KEY,
        document JSONB NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
    await getPool().query('ALTER TABLE account_config ADD COLUMN IF NOT EXISTS reset_at BIGINT NOT NULL DEFAULT 0');
  })().catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}

function savedAtOf(value) {
  const savedAt = Number(value);
  return Number.isFinite(savedAt) && savedAt > 0 ? savedAt : 0;
}

function emptyDocument() {
  return { version: DOCUMENT_VERSION, settings: {}, background: {} };
}

/** 版本不对的旧文档当作空的。重置那一刻及以前改的项不算数。 */
function normalizeDocument(value, resetAt) {
  const document = emptyDocument();
  if (!value || typeof value !== 'object' || Number(value.version) !== DOCUMENT_VERSION) return document;
  for (const section of SECTIONS) {
    const entries = value[section];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    for (const [name, entry] of Object.entries(entries)) {
      if (!entry || typeof entry !== 'object' || !Object.hasOwn(entry, 'value')) continue;
      const savedAt = savedAtOf(entry.savedAt);
      if (resetAt > 0 && savedAt <= resetAt) continue;
      document[section][name] = { value: entry.value, savedAt };
    }
  }
  return document;
}

/** 同一项两边都有时留改得晚的，时间一样时留库里的。 */
function mergeDocuments(stored, incoming) {
  const merged = emptyDocument();
  for (const section of SECTIONS) {
    merged[section] = { ...stored[section] };
    for (const [name, entry] of Object.entries(incoming[section])) {
      const current = merged[section][name];
      if (!current || entry.savedAt > current.savedAt) merged[section][name] = entry;
    }
    if (Object.keys(merged[section]).length > MAX_ENTRIES_PER_SECTION) throw new Error('配置项太多');
  }
  return merged;
}

async function inTransaction(run) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** 锁住这个账号的那一行，没有就先建一行空的。 */
async function lockRow(client, account) {
  await client.query(
    `INSERT INTO account_config (account, document, updated_at)
     VALUES ($1, $2::jsonb, 0)
     ON CONFLICT (account) DO NOTHING`,
    [account, JSON.stringify(emptyDocument())]
  );
  const result = await client.query(
    'SELECT document, reset_at FROM account_config WHERE account = $1 FOR UPDATE',
    [account]
  );
  return result.rows[0];
}

export async function readAccountConfig(account) {
  await ensureSchema();
  const result = await getPool().query(
    'SELECT document, updated_at, reset_at FROM account_config WHERE account = $1',
    [account]
  );
  const row = result.rows[0];
  const resetAt = savedAtOf(row?.reset_at);
  return {
    account,
    document: normalizeDocument(row?.document, resetAt),
    resetAt,
    updatedAt: Number(row?.updated_at) || 0
  };
}

/** 传上来的项按改动时间并进库里那份，返回合并后的整份。同一账号同时写入时排队，不会互相覆盖。 */
export async function mergeAccountConfig(account, incoming) {
  await ensureSchema();
  return inTransaction(async (client) => {
    const row = await lockRow(client, account);
    const resetAt = savedAtOf(row?.reset_at);
    const document = mergeDocuments(normalizeDocument(row?.document, resetAt), normalizeDocument(incoming, resetAt));
    const raw = JSON.stringify(document);
    if (Buffer.byteLength(raw) > MAX_DOCUMENT_BYTES) throw new Error('账号配置太大');
    const updatedAt = Date.now();
    await client.query(
      'UPDATE account_config SET document = $2::jsonb, updated_at = $3 WHERE account = $1',
      [account, raw, updatedAt]
    );
    return { account, document, resetAt, updatedAt };
  });
}

/** 记下重置时间，那一刻及以前改的项都删掉，以后有设备再传上来也不算。 */
export async function resetAccountConfig(account, resetAt) {
  await ensureSchema();
  return inTransaction(async (client) => {
    const row = await lockRow(client, account);
    const nextResetAt = Math.max(savedAtOf(row?.reset_at), resetAt);
    const document = normalizeDocument(row?.document, nextResetAt);
    await client.query(
      'UPDATE account_config SET document = $2::jsonb, updated_at = $3, reset_at = $4 WHERE account = $1',
      [account, JSON.stringify(document), Date.now(), nextResetAt]
    );
    return nextResetAt;
  });
}

import { ensureAccountTables } from '../account-tables.js';
import { getPool, inTransaction } from '../db.js';

/** 一份账号配置最大体积，避免把整张图塞进库。 */
const MAX_DOCUMENT_BYTES = 512 * 1024;
/** 每一类最多存这么多项，比小抄现有的开关多出不少。 */
const MAX_ENTRIES_PER_SECTION = 1000;
/** 文档格式版本，和小抄里的同一个数。别的版本当作空文档。 */
const DOCUMENT_VERSION = 2;
/** 开关一类，小抄背景一类。每一项是 { value, savedAt }。 */
const SECTIONS = ['settings', 'background'];
/** 按登录账号存。 */
const TABLE = 'account_config';
/** 以前按游戏用户编号存的，旧版小抄还在读写。 */
const LEGACY_TABLE = 'account_config_legacy';
const COLUMNS = 'account TEXT PRIMARY KEY, document JSONB NOT NULL, updated_at BIGINT NOT NULL';

let schemaReady;

function ensureSchema() {
  schemaReady ??= inTransaction((client) => ensureAccountTables(client, TABLE, LEGACY_TABLE, COLUMNS))
    .catch((error) => {
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

/**
 * 版本不对的旧文档当作空的。重置那一刻及以前改的项不算数。
 * 改动时间是 0 的是没改过的默认值，重置以后也是这个值，留着让那一行保持完整。
 */
function normalizeDocument(value, resetAt) {
  const document = emptyDocument();
  if (!value || typeof value !== 'object' || Number(value.version) !== DOCUMENT_VERSION) return document;
  for (const section of SECTIONS) {
    const entries = value[section];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    for (const [name, entry] of Object.entries(entries)) {
      if (!entry || typeof entry !== 'object' || !Object.hasOwn(entry, 'value')) continue;
      const savedAt = savedAtOf(entry.savedAt);
      if (savedAt > 0 && savedAt <= resetAt) continue;
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

/** 锁住表里这一行，没有就先建一行空的。 */
async function lockRow(client, table, account) {
  await client.query(
    `INSERT INTO ${table} (account, document, updated_at)
     VALUES ($1, $2::jsonb, 0)
     ON CONFLICT (account) DO NOTHING`,
    [account, JSON.stringify(emptyDocument())]
  );
  const result = await client.query(
    `SELECT document, reset_at FROM ${table} WHERE account = $1 FOR UPDATE`,
    [account]
  );
  const resetAt = savedAtOf(result.rows[0]?.reset_at);
  return { table, document: normalizeDocument(result.rows[0]?.document, resetAt), resetAt };
}

/**
 * 锁住这个账号的那一行。带着用户编号来的，账号是登录账号，旧表里这个编号的那一行并进来后删掉。
 * 没带用户编号的是旧版小抄，账号就是用户编号，还用旧表。
 */
async function lockAccountRow(client, key) {
  if (!key.userId) return lockRow(client, LEGACY_TABLE, key.account);
  const row = await lockRow(client, TABLE, key.account);
  const legacy = await client.query(
    `DELETE FROM ${LEGACY_TABLE} WHERE account = $1 RETURNING document, reset_at`,
    [key.userId]
  );
  if (!legacy.rows.length) return row;
  const resetAt = Math.max(row.resetAt, savedAtOf(legacy.rows[0].reset_at));
  const document = mergeDocuments(
    normalizeDocument(row.document, resetAt),
    normalizeDocument(legacy.rows[0].document, resetAt)
  );
  return { table: TABLE, document, resetAt };
}

async function hasLegacyRow(userId) {
  const result = await getPool().query(`SELECT 1 FROM ${LEGACY_TABLE} WHERE account = $1`, [userId]);
  return result.rows.length > 0;
}

export async function readAccountConfig(key) {
  await ensureSchema();
  // 旧表里还有这个编号的那一行时，读的时候就并过去，不用等下次有改动。
  if (key.userId && await hasLegacyRow(key.userId)) return mergeAccountConfig(key, null);
  const table = key.userId ? TABLE : LEGACY_TABLE;
  const result = await getPool().query(
    `SELECT document, updated_at, reset_at FROM ${table} WHERE account = $1`,
    [key.account]
  );
  const row = result.rows[0];
  const resetAt = savedAtOf(row?.reset_at);
  return {
    account: key.account,
    document: normalizeDocument(row?.document, resetAt),
    resetAt,
    updatedAt: Number(row?.updated_at) || 0
  };
}

/** 传上来的项按改动时间并进库里那份，返回合并后的整份。同一账号同时写入时排队，不会互相覆盖。 */
export async function mergeAccountConfig(key, incoming) {
  await ensureSchema();
  return inTransaction(async (client) => {
    const row = await lockAccountRow(client, key);
    const document = mergeDocuments(row.document, normalizeDocument(incoming, row.resetAt));
    const raw = JSON.stringify(document);
    if (Buffer.byteLength(raw) > MAX_DOCUMENT_BYTES) throw new Error('账号配置太大');
    const updatedAt = Date.now();
    await client.query(
      `UPDATE ${row.table} SET document = $2::jsonb, updated_at = $3, reset_at = $4 WHERE account = $1`,
      [key.account, raw, updatedAt, row.resetAt]
    );
    return { account: key.account, document, resetAt: row.resetAt, updatedAt };
  });
}

/** 记下重置时间，那一刻及以前改的项都删掉，以后有设备再传上来也不算。 */
export async function resetAccountConfig(key, resetAt) {
  await ensureSchema();
  return inTransaction(async (client) => {
    const row = await lockAccountRow(client, key);
    const nextResetAt = Math.max(row.resetAt, resetAt);
    const document = normalizeDocument(row.document, nextResetAt);
    await client.query(
      `UPDATE ${row.table} SET document = $2::jsonb, updated_at = $3, reset_at = $4 WHERE account = $1`,
      [key.account, JSON.stringify(document), Date.now(), nextResetAt]
    );
    return nextResetAt;
  });
}

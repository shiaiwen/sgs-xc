import { ensureAccountTables } from '../account-tables.js';
import { getPool, inTransaction } from '../db.js';

/** 一个账号最多存这么多个武将的皮肤，比游戏里的武将总数多出不少。 */
const MAX_SKIN_ENTRIES = 5000;
/** 按登录账号存。 */
const TABLE = 'account_skins';
/** 以前按游戏用户编号存的，旧版小抄还在读写。 */
const LEGACY_TABLE = 'account_skins_legacy';
const COLUMNS = 'account TEXT PRIMARY KEY, skins JSONB NOT NULL, updated_at BIGINT NOT NULL';

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

/**
 * 按武将编号存的皮肤选择，只留武将编号和皮肤编号都合法的记录。没有保存时间的当作最早。
 * 重置那一刻及以前存的记录不算数。
 */
function normalizeSkins(value, resetAt = 0) {
  const skins = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return skins;
  for (const [key, raw] of Object.entries(value)) {
    const generalID = Number(key);
    const skinID = Number(raw?.skinID);
    if (!Number.isSafeInteger(generalID) || generalID <= 0) continue;
    if (!Number.isSafeInteger(skinID) || skinID < 0) continue;
    const savedAt = savedAtOf(raw.savedAt);
    if (resetAt > 0 && savedAt <= resetAt) continue;
    skins[String(generalID)] = {
      skinID,
      isDynamic: raw.isDynamic !== false,
      savedAt
    };
  }
  return skins;
}

/** 同一个武将两边都有记录时，留保存得晚的；时间一样时用新传上来的。 */
function mergeSkins(stored, incoming) {
  const merged = { ...stored };
  for (const [generalID, choice] of Object.entries(incoming)) {
    const current = merged[generalID];
    if (!current || choice.savedAt >= current.savedAt) merged[generalID] = choice;
  }
  return merged;
}

/** 锁住表里这一行，没有就先建一行空的。 */
async function lockRow(client, table, account) {
  await client.query(
    `INSERT INTO ${table} (account, skins, updated_at)
     VALUES ($1, '{}'::jsonb, 0)
     ON CONFLICT (account) DO NOTHING`,
    [account]
  );
  const result = await client.query(
    `SELECT skins, reset_at FROM ${table} WHERE account = $1 FOR UPDATE`,
    [account]
  );
  const resetAt = savedAtOf(result.rows[0]?.reset_at);
  return { table, skins: normalizeSkins(result.rows[0]?.skins, resetAt), resetAt };
}

/**
 * 锁住这个账号的那一行。带着用户编号来的，账号是登录账号，旧表里这个编号的那一行并进来后删掉。
 * 没带用户编号的是旧版小抄，账号就是用户编号，还用旧表。
 */
async function lockAccountRow(client, key) {
  if (!key.userId) return lockRow(client, LEGACY_TABLE, key.account);
  const row = await lockRow(client, TABLE, key.account);
  const legacy = await client.query(
    `DELETE FROM ${LEGACY_TABLE} WHERE account = $1 RETURNING skins, reset_at`,
    [key.userId]
  );
  if (!legacy.rows.length) return row;
  const resetAt = Math.max(row.resetAt, savedAtOf(legacy.rows[0].reset_at));
  const skins = mergeSkins(normalizeSkins(row.skins, resetAt), normalizeSkins(legacy.rows[0].skins, resetAt));
  return { table: TABLE, skins, resetAt };
}

async function hasLegacyRow(userId) {
  const result = await getPool().query(`SELECT 1 FROM ${LEGACY_TABLE} WHERE account = $1`, [userId]);
  return result.rows.length > 0;
}

export async function readAccountSkins(key) {
  await ensureSchema();
  // 旧表里还有这个编号的那一行时，读的时候就并过去，不用等下次有改动。
  if (key.userId && await hasLegacyRow(key.userId)) return mergeAccountSkins(key, null);
  const table = key.userId ? TABLE : LEGACY_TABLE;
  const result = await getPool().query(
    `SELECT skins, updated_at, reset_at FROM ${table} WHERE account = $1`,
    [key.account]
  );
  const row = result.rows[0];
  const resetAt = savedAtOf(row?.reset_at);
  return {
    account: key.account,
    skins: normalizeSkins(row?.skins, resetAt),
    resetAt,
    updatedAt: Number(row?.updated_at) || 0
  };
}

/** 传上来的记录并进库里那份，返回合并后的整份。同一账号同时写入时排队，不会互相覆盖。 */
export async function mergeAccountSkins(key, incoming) {
  await ensureSchema();
  return inTransaction(async (client) => {
    const row = await lockAccountRow(client, key);
    const skins = mergeSkins(row.skins, normalizeSkins(incoming, row.resetAt));
    if (Object.keys(skins).length > MAX_SKIN_ENTRIES) throw new Error('皮肤记录太多');
    const updatedAt = Date.now();
    await client.query(
      `UPDATE ${row.table} SET skins = $2::jsonb, updated_at = $3, reset_at = $4 WHERE account = $1`,
      [key.account, JSON.stringify(skins), updatedAt, row.resetAt]
    );
    return { account: key.account, skins, resetAt: row.resetAt, updatedAt };
  });
}

/** 记下重置时间，那一刻及以前存的记录都删掉，以后有设备再传上来也不算。 */
export async function resetAccountSkins(key, resetAt) {
  await ensureSchema();
  return inTransaction(async (client) => {
    const row = await lockAccountRow(client, key);
    const nextResetAt = Math.max(row.resetAt, resetAt);
    await client.query(
      `UPDATE ${row.table} SET skins = $2::jsonb, updated_at = $3, reset_at = $4 WHERE account = $1`,
      [key.account, JSON.stringify(normalizeSkins(row.skins, nextResetAt)), Date.now(), nextResetAt]
    );
    return nextResetAt;
  });
}

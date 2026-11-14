import { getPool } from '../db.js';

/** 一个账号最多存这么多个武将的皮肤，比游戏里的武将总数多出不少。 */
const MAX_SKIN_ENTRIES = 5000;

let schemaReady;

function ensureSchema() {
  schemaReady ??= (async () => {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS account_skins (
        account TEXT PRIMARY KEY,
        skins JSONB NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
    await getPool().query('ALTER TABLE account_skins ADD COLUMN IF NOT EXISTS reset_at BIGINT NOT NULL DEFAULT 0');
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
    `INSERT INTO account_skins (account, skins, updated_at)
     VALUES ($1, '{}'::jsonb, 0)
     ON CONFLICT (account) DO NOTHING`,
    [account]
  );
  const result = await client.query(
    'SELECT skins, reset_at FROM account_skins WHERE account = $1 FOR UPDATE',
    [account]
  );
  return result.rows[0];
}

export async function readAccountSkins(account) {
  await ensureSchema();
  const result = await getPool().query(
    'SELECT skins, updated_at, reset_at FROM account_skins WHERE account = $1',
    [account]
  );
  const row = result.rows[0];
  const resetAt = savedAtOf(row?.reset_at);
  return {
    account,
    skins: normalizeSkins(row?.skins, resetAt),
    resetAt,
    updatedAt: Number(row?.updated_at) || 0
  };
}

/** 传上来的记录并进库里那份，返回合并后的整份。同一账号同时写入时排队，不会互相覆盖。 */
export async function mergeAccountSkins(account, incoming) {
  await ensureSchema();
  return inTransaction(async (client) => {
    const row = await lockRow(client, account);
    const resetAt = savedAtOf(row?.reset_at);
    const skins = mergeSkins(normalizeSkins(row?.skins, resetAt), normalizeSkins(incoming, resetAt));
    if (Object.keys(skins).length > MAX_SKIN_ENTRIES) throw new Error('皮肤记录太多');
    const updatedAt = Date.now();
    await client.query(
      'UPDATE account_skins SET skins = $2::jsonb, updated_at = $3 WHERE account = $1',
      [account, JSON.stringify(skins), updatedAt]
    );
    return { account, skins, resetAt, updatedAt };
  });
}

/** 记下重置时间，那一刻及以前存的记录都删掉，以后有设备再传上来也不算。 */
export async function resetAccountSkins(account, resetAt) {
  await ensureSchema();
  return inTransaction(async (client) => {
    const row = await lockRow(client, account);
    const nextResetAt = Math.max(savedAtOf(row?.reset_at), resetAt);
    await client.query(
      'UPDATE account_skins SET skins = $2::jsonb, updated_at = $3, reset_at = $4 WHERE account = $1',
      [account, JSON.stringify(normalizeSkins(row?.skins, nextResetAt)), Date.now(), nextResetAt]
    );
    return nextResetAt;
  });
}

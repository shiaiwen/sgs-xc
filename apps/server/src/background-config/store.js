import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;

/** 一份账号配置最大体积，避免把整张图塞进库。 */
const MAX_DOCUMENT_BYTES = 512 * 1024;

function loadEnvFile() {
  const envFile = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    if (!process.env[key]) process.env[key] = match[2].trim();
  }
}

loadEnvFile();

let pool;

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('缺少 DATABASE_URL');
  pool = new Pool({ connectionString });
  return pool;
}

async function ensureSchema() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS account_config (
      account TEXT PRIMARY KEY,
      document JSONB NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
}

export async function readBackgroundConfig(account) {
  await ensureSchema();
  const result = await getPool().query(
    'SELECT document, updated_at FROM account_config WHERE account = $1',
    [account]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    account,
    document: row.document,
    updatedAt: Number(row.updated_at) || 0
  };
}

export async function writeBackgroundConfig(account, document) {
  const raw = JSON.stringify(document);
  if (Buffer.byteLength(raw) > MAX_DOCUMENT_BYTES) {
    throw new Error('账号配置太大');
  }
  await ensureSchema();
  const updatedAt = Date.now();
  await getPool().query(
    `INSERT INTO account_config (account, document, updated_at)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (account) DO UPDATE SET
       document = EXCLUDED.document,
       updated_at = EXCLUDED.updated_at`,
    [account, raw, updatedAt]
  );
  return { account, document, updatedAt };
}

export async function deleteBackgroundConfig(account) {
  await ensureSchema();
  await getPool().query('DELETE FROM account_config WHERE account = $1', [account]);
}

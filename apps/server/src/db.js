import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;

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

/** 所有接口共用一个连接池。没配 DATABASE_URL 时只有用到库的接口报错，服务照常启动。 */
export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('缺少 DATABASE_URL');
  pool = new Pool({ connectionString });
  return pool;
}

/** 在一个事务里跑完，出错整个撤回。 */
export async function inTransaction(run) {
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

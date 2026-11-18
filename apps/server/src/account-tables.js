/**
 * 账号表按登录账号存，以前按游戏用户编号存的那张改名成旧表。
 * 旧表在不在就是有没有改过名的记号，第一次启动时改一次，新表从空的开始。
 */
export async function ensureAccountTables(client, table, legacyTable, columns) {
  // 两个进程同时启动时只让一个改名。
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [table]);
  const { rows } = await client.query(
    'SELECT to_regclass($1) AS legacy, to_regclass($2) AS current',
    [legacyTable, table]
  );
  if (!rows[0].legacy && rows[0].current) {
    await client.query(`ALTER TABLE ${table} RENAME TO ${legacyTable}`);
    // 主键索引不跟着表改名，不改的话新表的主键要换个名字。
    await client.query(`ALTER INDEX IF EXISTS ${table}_pkey RENAME TO ${legacyTable}_pkey`);
  }
  for (const name of [table, legacyTable]) {
    await client.query(`CREATE TABLE IF NOT EXISTS ${name} (${columns})`);
    await client.query(`ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS reset_at BIGINT NOT NULL DEFAULT 0`);
  }
}

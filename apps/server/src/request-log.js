const MAX_LOGS = 100;
const MAX_BODY = 4000;
/** 按账号存的开关、背景和皮肤，日志页谁都能打开，这几个接口只记调用结果不记内容。 */
const ACCOUNT_DATA_PATHS = new Set(['/api/account-config', '/api/account-skins', '/api/account-reset']);
const logs = [];

function clip(text) {
  if (text.length <= MAX_BODY) return text;
  return `${text.slice(0, MAX_BODY)}…`;
}

export function listRequestLogs() {
  return logs;
}

/** 记下一次接口调用，并打印到进程输出。 */
export function recordRequestLog(entry) {
  logs.unshift(entry);
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
  console.log(`[api] ${entry.method} ${entry.path} ${entry.status} ${entry.body}`);
}

export async function captureRequestLog(context) {
  const path = context.req.path;
  if (path === '/api/logs' || path === '/api/logs/data') return;
  let body = '';
  if (!ACCOUNT_DATA_PATHS.has(path)) {
    try {
      body = clip(await context.res.clone().text());
    } catch {
      body = '';
    }
  }
  recordRequestLog({
    time: new Date().toISOString(),
    method: context.req.method,
    path,
    status: context.res.status,
    body
  });
}

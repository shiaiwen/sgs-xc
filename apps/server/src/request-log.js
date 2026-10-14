const MAX_LOGS = 100;
const MAX_BODY = 4000;
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
  const response = context.res.clone();
  let body = '';
  try {
    body = clip(await response.text());
  } catch {
    body = '';
  }
  recordRequestLog({
    time: new Date().toISOString(),
    method: context.req.method,
    path,
    status: response.status,
    body
  });
}

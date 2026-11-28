import { cleanupFeedbackAttachments } from '../src/feedback/store.js';

// 离线预览只读磁盘；实际清理必须交回服务进程，避免与接口并发写同一个 JSON 文件。
if (process.argv.slice(2).some((argument) => argument !== '--dry-run')) {
  throw new Error('只支持 --dry-run 参数');
}
const dryRun = process.argv.includes('--dry-run');
let result;
if (dryRun) {
  result = cleanupFeedbackAttachments({ dryRun: true });
} else {
  const token = process.env.FEEDBACK_ADMIN_TOKEN;
  if (!token) throw new Error('执行清理需要设置 FEEDBACK_ADMIN_TOKEN；只预览请加 --dry-run');
  const origin = `http://127.0.0.1:${Number(process.env.PORT) || 8787}`;
  const response = await fetch(`${origin}/admin/feedback-attachments/cleanup`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`服务端清理失败：HTTP ${response.status}`);
  result = await response.json();
}
console.log(JSON.stringify({ dryRun, ...result }, null, 2));
if (result.errors.length) process.exitCode = 1;

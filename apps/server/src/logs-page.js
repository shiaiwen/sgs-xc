import { Hono } from 'hono';
import { listRequestLogs } from './request-log.js';

const page = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>接口日志</title>
  <style>
    body { font-family: sans-serif; margin: 24px; background: #111; color: #eee; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #333; padding: 8px; vertical-align: top; text-align: left; }
    pre { white-space: pre-wrap; word-break: break-all; margin: 0; }
  </style>
</head>
<body>
  <h1>接口日志</h1>
  <table>
    <thead><tr><th>时间</th><th>请求</th><th>状态</th><th>返回</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <script>
    async function refresh() {
      const response = await fetch('/api/logs/data');
      const logs = await response.json();
      document.getElementById('rows').innerHTML = logs.map((item) =>
        '<tr><td>' + item.time + '</td><td>' + item.method + ' ' + item.path +
        '</td><td>' + item.status + '</td><td><pre>' + item.body.replace(/[&<>]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch])) + '</pre></td></tr>'
      ).join('');
    }
    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>`;

export function createLogRoutes() {
  const routes = new Hono();
  routes.get('/api/logs', (context) => context.html(page));
  routes.get('/api/logs/data', (context) => context.json(listRequestLogs()));
  return routes;
}

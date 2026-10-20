/**
 * 油猴本地开发：Vite 直启 + 热更新，与改命令之前的 dev:userscript 一致。
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV_PORT = 5173;

function killListenersOnPort(port) {
  if (process.platform === 'win32') {
    const script = `
$conn = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue
if ($conn) { $conn | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }
`;
    spawnSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
    return;
  }
  spawnSync('bash', ['-lc', `lsof -ti:${port} | xargs -r kill -9 2>/dev/null || true`], { stdio: 'ignore' });
}

killListenersOnPort(DEV_PORT);
killListenersOnPort(5174);

const guideUrl = `http://127.0.0.1:${DEV_PORT}/userscript-dev`;
const installUrl = `http://127.0.0.1:${DEV_PORT}/__vite-plugin-monkey.install.user.js`;
console.log(`\n油猴开发已启动后，Chrome/Edge 打开\n  ${guideUrl}\n`);
console.log(`或安装：${installUrl}\n`);

const child = spawn(
  'npx',
  ['vite', '--config', 'vite.userscript.config.ts'],
  {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, XC_USERSCRIPT_DEV_PORT: String(DEV_PORT) }
  }
);

child.on('exit', (code) => process.exit(code ?? 0));

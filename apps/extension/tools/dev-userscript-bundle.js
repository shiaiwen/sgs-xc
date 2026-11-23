/**
 * 油猴稳装开发：监听打包整份 user.js + HTTPS 静态预览。
 * 油猴从本地 URL 安装一次，改代码保存后等编译完成，手动刷新游戏页加载新版。
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startUserscriptInstallHttpServer } from './serve-userscript-install-http.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV_PORT = 5173;
const INSTALL_HTTP_PORT = 5174;

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
killListenersOnPort(INSTALL_HTTP_PORT);

const bundleEnv = {
  ...process.env,
  XC_USERSCRIPT_DEV: '1',
  XC_USERSCRIPT_BUNDLE_DEV: '1',
  XC_USERSCRIPT_DEV_PORT: String(DEV_PORT),
  XC_USERSCRIPT_INSTALL_HTTP_PORT: String(INSTALL_HTTP_PORT)
};

const guideUrl = `https://127.0.0.1:${DEV_PORT}/userscript-simple`;

console.log('\n【油猴本地开发】');
console.log('1. 油猴 → 实用工具 → 从文件安装 → dist/userscript/xiaochao.user.js（只需装一次）');
console.log('2. 改代码保存，等终端 built 后手动刷新游戏页');
console.log(`3. 可选：打开引导页 ${guideUrl}`);
console.log('开发构建跳过压缩与单行折叠，首轮只 watch 打一次包。\n');

const watch = spawn(
  'npx',
  ['vite', 'build', '--config', 'vite.userscript.config.ts', '--watch'],
  { cwd: root, stdio: 'inherit', shell: true, env: bundleEnv }
);

const preview = spawn(
  'npx',
  ['vite', 'preview', '--config', 'vite.userscript.config.ts', '--host', '127.0.0.1', '--port', String(DEV_PORT), '--strictPort'],
  { cwd: root, stdio: 'inherit', shell: true, env: bundleEnv }
);

let installHttpServer;

void startUserscriptInstallHttpServer({ root, port: INSTALL_HTTP_PORT }).then((server) => {
  installHttpServer = server;
});

function shutdown(code) {
  watch.kill();
  preview.kill();
  void installHttpServer?.close().finally(() => process.exit(code ?? 0));
}

watch.on('exit', (code) => shutdown(code));
preview.on('exit', (code) => shutdown(code));
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
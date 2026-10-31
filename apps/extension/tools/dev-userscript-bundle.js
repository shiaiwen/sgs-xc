/**
 * 油猴稳装开发：监听打包整份 user.js + HTTPS 静态预览。
 * 油猴从本地 URL 安装一次，改代码保存后等编译完成再刷新游戏页。
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startUserscriptInstallHttpServer } from './serve-userscript-install-http.js';
import { watchUserscriptDevTampermonkeyUpdate } from './watch-userscript-dev-tampermonkey-update.js';

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
const installUrlHttp = `http://127.0.0.1:${INSTALL_HTTP_PORT}/xiaochao-dev.user.js`;

console.log('\n【油猴本地开发】');
console.log('1. 油猴 → 实用工具 → 从文件安装 → dist/userscript/xiaochao.user.js（只需装一次）');
console.log('2. 改代码保存，等终端 built；本机会弹出油猴更新页，确认后游戏页会自动刷新');
console.log('3. 若加载卡住：控制台执行 localStorage.xcDevAutoReload="0" 后刷新，可关掉自动刷新');
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
let stopTampermonkeyUpdateWatch = () => {};
void startUserscriptInstallHttpServer({ root, port: INSTALL_HTTP_PORT }).then((server) => {
  installHttpServer = server;
  stopTampermonkeyUpdateWatch = watchUserscriptDevTampermonkeyUpdate({
    root,
    installUrl: installUrlHttp,
    openUrl: (url) => {
      try {
        if (process.platform === 'win32') {
          spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
          return;
        }
        spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
      } catch {
        console.warn('请手动打开油猴更新页:', url);
      }
    }
  });
});

function shutdown(code) {
  stopTampermonkeyUpdateWatch();
  watch.kill();
  preview.kill();
  void installHttpServer?.close().finally(() => process.exit(code ?? 0));
}

watch.on('exit', (code) => shutdown(code));
preview.on('exit', (code) => shutdown(code));
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

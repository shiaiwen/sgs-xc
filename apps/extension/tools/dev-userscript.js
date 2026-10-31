/**
 * 油猴本地开发：监听打包整份 user.js，经 HTTP 提供安装地址。
 * 游戏页 CSP 会拦「安装包再去拉 5173 模块」的 server:dev 模式，因此默认走整包。
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

function openInBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    console.warn('请手动打开:', url);
  }
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

const installUrl = `http://127.0.0.1:${INSTALL_HTTP_PORT}/xiaochao-dev.user.js`;
const guideUrl = `https://127.0.0.1:${DEV_PORT}/userscript-simple`;

console.log('\n【油猴开发 · 整包模式】');
console.log('游戏页会拦外链模块，请装整份脚本，不要用 server:dev 那条。');
console.log(`安装地址：${installUrl}`);
console.log('步骤：删掉油猴里的 server:dev:三国杀小抄 → 从 URL 安装上面地址 → 只保留 dev:三国杀小抄');
console.log(`引导页：${guideUrl}`);
console.log('改代码保存 → 终端 built → 本机会自动打开油猴「更新脚本」页 → 确认后游戏页约 8 秒内自动刷新。');
console.log('首次开发：浏览器打开一次引导页并信任证书，否则 HTTPS 游戏页读不到构建号：');
console.log(`  ${guideUrl}`);
console.log('游戏页控制台应出现「自动刷新已监听构建号」；异常时看 __XIAOCHAO_STARTUP__.devReload');
console.log('若要关掉自动刷新：游戏页 localStorage.xcDevAutoReload="0" 后 F5。\n');

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
  openInBrowser(installUrl);
  stopTampermonkeyUpdateWatch = watchUserscriptDevTampermonkeyUpdate({
    root,
    installUrl,
    openUrl: openInBrowser
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

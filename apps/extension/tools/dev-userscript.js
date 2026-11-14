/**
 * 油猴本地开发：监听打包整份 user.js，油猴里装的本地加载器每次进页面直接读这份文件。
 * 游戏页 CSP 会拦「安装包再去拉 5173 模块」的 server:dev 模式，因此走整包。
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startUserscriptInstallHttpServer } from './serve-userscript-install-http.js';
import { createUserscriptDevLoader } from './userscript-dev-loader.js';
import { planLocalAccountServer } from './local-account-server.js';
import { USERSCRIPT_DEV_LOADER_PATH, USERSCRIPT_DEV_LOADER_NAME } from '../src/const/userscript-meta.ts';

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
  XC_USERSCRIPT_LOCAL_LOADER: '1',
  XC_USERSCRIPT_DEV_PORT: String(DEV_PORT),
  XC_USERSCRIPT_INSTALL_HTTP_PORT: String(INSTALL_HTTP_PORT)
};

const loaderUrl = `http://127.0.0.1:${INSTALL_HTTP_PORT}${USERSCRIPT_DEV_LOADER_PATH}`;
const guideUrl = `https://127.0.0.1:${DEV_PORT}/userscript-simple`;

console.log('\n【油猴开发 · 本地加载】');
console.log('改代码保存后终端出现 built，游戏页会自己刷新，刷新后就是最新代码，不用在油猴里点更新。');
console.log('第一次用时做一遍：');
console.log('  1. 浏览器打开 chrome://extensions，点开油猴的「详细信息」，打开「允许访问文件网址」');
console.log('  2. 油猴里删掉或关掉其它小抄脚本，包括线上的「三国杀小抄」和旧的「dev:三国杀小抄」');
console.log(`  3. 打开 ${loaderUrl} ，在油猴页面点安装，装上「${USERSCRIPT_DEV_LOADER_NAME}」`);
console.log(`  4. 打开 ${guideUrl} ，信任证书，游戏页才读得到构建号`);
console.log('游戏页控制台应出现「自动刷新已监听构建号」；异常时看 __XIAOCHAO_STARTUP__.devReload');
console.log('若要关掉自动刷新：游戏页 localStorage.xcDevAutoReload="0" 后 F5。\n');

const accountServerPlan = await planLocalAccountServer(root);
const accountServer = accountServerPlan
  ? spawn(process.execPath, [accountServerPlan.entry], { cwd: accountServerPlan.cwd, env: accountServerPlan.env, stdio: 'inherit' })
  : null;

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
void startUserscriptInstallHttpServer({
  root,
  port: INSTALL_HTTP_PORT,
  loaderSource: createUserscriptDevLoader(root)
}).then((server) => {
  installHttpServer = server;
});

function shutdown(code) {
  watch.kill();
  preview.kill();
  accountServer?.kill();
  void installHttpServer?.close().finally(() => process.exit(code ?? 0));
}

watch.on('exit', (code) => shutdown(code));
preview.on('exit', (code) => shutdown(code));
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

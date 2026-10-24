/**
 * 油猴本地开发：Vite + 热更新。就绪后直接打开安装脚本 URL。
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startUserscriptInstallHttpServer,
  waitForUrlOk
} from './serve-userscript-install-http.js';

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

const installUrl = `http://127.0.0.1:${INSTALL_HTTP_PORT}/xiaochao-dev.user.js`;
const viteInstallUrl = `https://127.0.0.1:${DEV_PORT}/__vite-plugin-monkey.install.user.js`;

console.log('\n【油猴开发】就绪后会打开安装地址（Tampermonkey 会弹出安装）');
console.log(`  ${installUrl}`);
console.log('装好后打开游戏页；改代码保存即热更新。首次若模块加载失败，浏览器先访问一次 https://127.0.0.1:5173/ 点继续访问。\n');

let installHttpServer;

async function boot() {
  installHttpServer = await startUserscriptInstallHttpServer({
    root,
    port: INSTALL_HTTP_PORT,
    proxyHttpsUrl: viteInstallUrl
  });

  const child = spawn(
    'npx',
    ['vite', '--config', 'vite.userscript.config.ts'],
    {
      cwd: root,
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        XC_USERSCRIPT_DEV_PORT: String(DEV_PORT),
        XC_USERSCRIPT_INSTALL_HTTP_PORT: String(INSTALL_HTTP_PORT),
        XC_USERSCRIPT_DEV: '1'
      }
    }
  );

  child.on('exit', (code) => {
    void installHttpServer?.close().finally(() => process.exit(code ?? 0));
  });

  const ready = await waitForUrlOk(viteInstallUrl, { attempts: 80, intervalMs: 500 });
  openInBrowser(installUrl);
  console.log(ready ? `已打开安装: ${installUrl}` : `Vite 未就绪，仍已尝试打开: ${installUrl}`);
}

void boot().catch((error) => {
  console.error(error);
  process.exit(1);
});
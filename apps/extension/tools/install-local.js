/**
 * 把 release 目录里的正式包装进本机三国杀。
 * 用法：npm run install:local
 * 先用 npm run pack 或 npm run release 打好包，再执行。
 * 安装目录在 Program Files 下，需要管理员权限，执行时会弹出一次系统授权窗口。
 * 换安装位置：设置环境变量 SGSOL_RESOURCES。
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'release');
const resourcesDir = process.env.SGSOL_RESOURCES || 'C:\\Program Files\\SGSOL\\resources';
const GAME_PROCESS_NAME = 'SGSOL.exe';
const SCRIPT_VERSION_PATTERN = /@version\s+(\S+)/;
const TEMP_SCRIPT_NAME = 'install-sgsol.ps1';
const TEMP_LOG_NAME = 'install-sgsol.log';
const INSTALL_OK_MARK = 'INSTALL_OK';

function fail(message) {
  console.error(`[install] ${message}`);
  process.exit(1);
}

function readScriptVersion(file) {
  const head = readFileSync(file, 'utf8').slice(0, 2000);
  const match = head.match(SCRIPT_VERSION_PATTERN);
  return match ? match[1] : '';
}

function isGameRunning() {
  const result = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${GAME_PROCESS_NAME}`, '/NH'], { encoding: 'utf8' });
  return String(result.stdout || '').toLowerCase().includes(GAME_PROCESS_NAME.toLowerCase());
}

function findReleaseZips() {
  const appZip = path.join(releaseDir, 'app.zip');
  const wdZips = readdirSync(releaseDir).filter((name) => /^wd-xc-.+\.zip$/.test(name));
  return { appZip, wdZips };
}

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildInstallScript(appZip, wdZips, logFile) {
  const lines = [
    `$log = ${quote(logFile)}`,
    'Start-Transcript -Path $log -Force | Out-Null',
    'try {',
    "  $ErrorActionPreference = 'Stop'",
    `  $res = ${quote(resourcesDir)}`,
    `  if (Get-Process -Name ${quote(GAME_PROCESS_NAME.replace(/\.exe$/i, ''))} -ErrorAction SilentlyContinue) { throw '三国杀还在运行' }`,
    `  Copy-Item ${quote(appZip)} (Join-Path $res 'app.zip') -Force`
  ];
  for (const name of wdZips) {
    lines.push(`  Copy-Item ${quote(path.join(releaseDir, name))} (Join-Path $res ${quote(name)}) -Force`);
  }
  lines.push(
    "  $appDir = Join-Path $res 'app'",
    '  if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force }',
    "  Expand-Archive -LiteralPath (Join-Path $res 'app.zip') -DestinationPath $res -Force",
    "  if (-not (Test-Path (Join-Path $appDir 'package.json'))) { throw '解压失败' }",
    `  Write-Host ${quote(INSTALL_OK_MARK)}`,
    '} catch { Write-Host ("ERR: " + $_) }',
    'Stop-Transcript | Out-Null'
  );
  return lines.join('\r\n');
}

/**
 * 正式微端只在内置脚本版本不低于用户目录里的脚本时才覆盖。
 * 装的版本比用户目录里的低时，要手动把内置脚本放过去。
 */
function syncUserScript(installedScript) {
  const appData = process.env.APPDATA;
  if (!appData) return false;
  const userScript = path.join(appData, 'SGSOL', 'xiaochao', 'xiaochao.js');
  mkdirSync(path.dirname(userScript), { recursive: true });
  copyFileSync(installedScript, userScript);
  return true;
}

function main() {
  if (process.platform !== 'win32') fail('只支持 Windows');
  const { appZip, wdZips } = findReleaseZips();
  if (!existsSync(appZip)) fail(`没找到 ${appZip}，先执行 npm run pack`);
  if (!existsSync(resourcesDir)) fail(`没找到安装目录 ${resourcesDir}`);
  if (isGameRunning()) fail('三国杀还在运行，先关掉再装');

  const packedScript = path.join(releaseDir, 'xiaochao.js');
  const packedVersion = existsSync(packedScript) ? readScriptVersion(packedScript) : '未知';
  console.log(`[install] 准备安装脚本 v${packedVersion} 到 ${resourcesDir}`);

  const scriptFile = path.join(os.tmpdir(), TEMP_SCRIPT_NAME);
  const logFile = path.join(os.tmpdir(), TEMP_LOG_NAME);
  writeFileSync(scriptFile, `\uFEFF${buildInstallScript(appZip, wdZips, logFile)}`, 'utf8');
  writeFileSync(logFile, '');

  console.log('[install] 请在弹出的授权窗口里点「是」');
  const elevate = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${quote(scriptFile)}`
    ],
    { stdio: 'inherit' }
  );
  if (elevate.status !== 0) fail('没有拿到管理员权限，已取消');

  const log = readFileSync(logFile, 'utf8');
  if (!log.includes(INSTALL_OK_MARK)) {
    const reason = log.split(/\r?\n/).find((line) => line.startsWith('ERR:')) || '没有成功标记，看日志：' + logFile;
    fail(`安装失败：${reason}`);
  }

  const installedScript = path.join(resourcesDir, 'app', 'xiaochao.js');
  const installedVersion = existsSync(installedScript) ? readScriptVersion(installedScript) : '';
  console.log(`[install] 已装入 v${installedVersion}`);
  if (existsSync(installedScript) && syncUserScript(installedScript)) {
    console.log('[install] 用户目录里的脚本已同步为这一版');
  }
  console.log('[install] 完成，启动三国杀即可');
}

main();

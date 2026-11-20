/** 组装发布目录并计算校验。 */
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { USERSCRIPT_PAYLOAD_FILE_NAME, USERSCRIPT_PAYLOAD_URL } from '../src/const/userscript-payload.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitePackageJson = createRequire(path.join(root, 'package.json')).resolve('vite/package.json');
const viteBin = path.join(path.dirname(vitePackageJson), 'bin', 'vite.js');
const assetsDir = path.join(root, 'tools', 'release-assets');
/** 已验证可启动的微端壳（不含 xiaochao.js）；打包时只替换脚本。 */
const shellDir = path.join(root, 'tools', 'release-app-shell');
const repoRoot = path.resolve(root, '..', '..');
const shellRepoPath = 'apps/extension/tools/release-app-shell';
const releaseDir = path.join(root, 'release');
const stagingRoot = path.join(releaseDir, '.staging');
const appDir = path.join(stagingRoot, 'app');
const packDir = path.join(stagingRoot, 'pack');
const builtScript = path.join(root, 'dist', 'electron', 'xiaochao.js');
const builtUserscriptPayload = path.join(root, 'dist', 'userscript', USERSCRIPT_PAYLOAD_FILE_NAME);
/** 上次发版时微端外壳的指纹和外壳版本号。外壳文件一变，正式发版时版本号加 1；这个文件要提交进仓库。 */
const shellVersionRecordPath = path.join(root, 'tools', 'release-shell-version.json');
function releaseZipName(version) {
  return `wd-xc-${version}.zip`;
}

const RELEASE_ASSET_FILES = [
  'install.bat',
  'install.sh',
  'restore.bat',
  'restore.sh',
  '安装说明.txt'
];

function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} 退出码 ${code}`));
    });
  });
}

function readProjectVersion() {
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return String(pkg.version || '0.0.0');
}

/** release 时把版本号末位加 1 并写回，保证每次发布的 @version 不重复。 */
function bumpProjectVersion() {
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const parts = String(pkg.version || '0.0.0').split('.').map((value) => Number(value) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  pkg.version = parts.slice(0, 3).join('.');
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return pkg.version;
}

/** 正式发版前删掉 release 里上一版的 zip、脚本和清单，避免旧包残留在目录里。 */
function clearPreviousReleaseOutput() {
  if (process.env.RELEASE_BUILD !== '1') return;
  if (!existsSync(releaseDir)) {
    mkdirSync(releaseDir, { recursive: true });
    console.log('[pack] 创建 release 目录');
    return;
  }
  for (const name of readdirSync(releaseDir)) {
    rmSync(path.join(releaseDir, name), { recursive: true, force: true });
  }
  console.log('[pack] 已清空 release 目录（删除上一版发布产物）');
}

function resolveVersion() {
  if (process.env.RELEASE_BUILD === '1') {
    if (process.env.RELEASE_NO_BUMP === '1') {
      const current = readProjectVersion();
      console.log(`[pack] 沿用当前版本 v${current}`);
      return current;
    }
    const bumped = bumpProjectVersion();
    console.log(`[pack] release 版本号 +1 → v${bumped}`);
    return bumped;
  }
  const current = readProjectVersion();
  console.log(`[pack] 使用当前版本 v${current}`);
  return current;
}

/** 外壳指纹：发布壳里除小抄脚本和说明文档以外每个文件的路径和内容，和组装 app 时去掉的文件一致。 */
function hashShellDirectory(rootDir = shellDir) {
  const hash = createHash('sha256');
  const walk = (directory) => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      const relativePath = path.relative(rootDir, fullPath).split(path.sep).join('/');
      if (relativePath === 'xiaochao.js' || (directory === rootDir && entry.name.endsWith('.md'))) continue;
      hash.update(relativePath);
      hash.update('\0');
      hash.update(readFileSync(fullPath));
      hash.update('\0');
    }
  };
  walk(rootDir);
  return hash.digest('hex');
}

function readShellVersionRecord() {
  if (!existsSync(shellVersionRecordPath)) return null;
  const record = JSON.parse(readFileSync(shellVersionRecordPath, 'utf8'));
  const shellVersion = Number(record.shellVersion);
  if (!Number.isSafeInteger(shellVersion) || shellVersion < 1 || typeof record.shellHash !== 'string') {
    throw new Error(`外壳版本记录格式不对: ${shellVersionRecordPath}`);
  }
  return { shellVersion, shellHash: record.shellHash };
}

/**
 * 外壳没变就沿用记录里的版本号；变了就加 1，正式发版时写回记录。
 * 微端拿清单里的外壳版本和自己 package.json 里的 xiaochaoShellVersion 比，落后才提示装整包。
 */
function resolveShellVersion(rootDir = shellDir) {
  const shellHash = hashShellDirectory(rootDir);
  const record = readShellVersionRecord();
  if (record && record.shellHash === shellHash) return record.shellVersion;
  const nextVersion = (record ? record.shellVersion : 0) + 1;
  if (process.env.RELEASE_BUILD === '1') {
    writeFileSync(shellVersionRecordPath, `${JSON.stringify({ shellVersion: nextVersion, shellHash }, null, 2)}\n`);
    console.log(`[pack] 微端外壳有改动，外壳版本 → ${nextVersion}（记得提交 tools/release-shell-version.json）`);
  } else {
    console.log(`[pack] 微端外壳有未发布的改动，本次按外壳版本 ${nextVersion} 打包，不写记录`);
  }
  return nextVersion;
}


function isGitRepo() {
  const result = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  return result.status === 0 && String(result.stdout).trim() === 'true';
}

/**
 * 正式发版时把 HEAD 中的发行壳检出到临时目录，不改工作区源文件。
 * 这样未提交的开发态壳改动不会打进发行包，也不会无故升高外壳版本。
 */
function checkoutCommittedShell() {
  const temp = mkdtempSync(path.join(tmpdir(), 'sgs-xc-shell-head-'));
  const dest = path.join(temp, 'shell');
  mkdirSync(dest, { recursive: true });
  const listed = spawnSync('git', ['-C', repoRoot, 'ls-tree', '-r', '--name-only', '-z', 'HEAD', shellRepoPath], {
    encoding: 'buffer'
  });
  if (listed.status !== 0) {
    throw new Error(`列出 HEAD 中的发行壳失败: ${listed.stderr?.toString() || listed.status}`);
  }
  const files = listed.stdout.toString('utf8').split('\0').filter(Boolean);
  if (!files.length) {
    throw new Error('HEAD 中没有发行壳文件');
  }
  for (const repoFile of files) {
    if (!repoFile.startsWith(`${shellRepoPath}/`)) continue;
    const relative = repoFile.slice(shellRepoPath.length + 1);
    const out = path.join(dest, ...relative.split('/'));
    mkdirSync(path.dirname(out), { recursive: true });
    const shown = spawnSync('git', ['-C', repoRoot, 'show', `HEAD:${repoFile}`], { encoding: 'buffer' });
    if (shown.status !== 0) {
      throw new Error(`读取 HEAD:${repoFile} 失败: ${shown.stderr?.toString() || shown.status}`);
    }
    writeFileSync(out, shown.stdout);
  }
  return { dir: dest, cleanup: () => rmSync(temp, { recursive: true, force: true }) };
}

function resolveReleaseShell() {
  if (process.env.RELEASE_BUILD === '1') {
    if (!isGitRepo()) {
      throw new Error('正式发版需要在 git 仓库中检出已提交的发行壳，避免把工作区开发态改动打进包里');
    }
    const snapshot = checkoutCommittedShell();
    console.log('[pack] 正式发版使用 HEAD 中的发行壳，工作区未提交壳改动不进入包内');
    return snapshot;
  }
  return { dir: shellDir, cleanup: () => {} };
}

function writeBundledScript(version) {
  const body = readFileSync(builtScript, 'utf8');
  const banner = [
    '// ==UserScript==',
    '// @name         小抄',
    `// @version      ${version}`,
    '// @author       many people',
    '// @description  三国杀OL辅助插件',
    '// ==/UserScript==',
    ''
  ].join('\n');
  writeFileSync(path.join(appDir, 'xiaochao.js'), banner + body);
}

/** 在 cwd 下把 entries 打成 zipPath（正斜杠路径，跨平台可解压）。 */
async function createZip(zipPath, entries, cwd) {
  if (existsSync(zipPath)) rmSync(zipPath);
  await run('zip', ['-r', '-q', zipPath, ...entries], cwd);
}

async function main() {
  clearPreviousReleaseOutput();

  const requiredShellFiles = [
    'main.js',
    'package.json',
    'micro-client-update.js',
    'micro-client-updater.js'
  ];
  for (const name of requiredShellFiles) {
    if (!existsSync(path.join(shellDir, name))) {
      throw new Error(`缺少发布壳文件 tools/release-app-shell/${name}（更新模块须成对打包）`);
    }
  }

  const bumpedVersion = resolveVersion();
  const releaseShell = resolveReleaseShell();
  const shellVersion = resolveShellVersion(releaseShell.dir);

  console.log('[pack] 构建小抄脚本…');
  await run(process.execPath, [
    viteBin,
    'build',
    '--config',
    path.join(root, 'vite.electron.config.ts')
  ]);
  if (!existsSync(builtScript)) throw new Error(`缺少构建产物: ${builtScript}`);

  console.log('[pack] 构建油猴脚本…');
  await run(process.execPath, [
    viteBin,
    'build',
    '--config',
    path.join(root, 'vite.userscript.config.ts')
  ]);
  const userscript = path.join(root, 'dist', 'userscript', 'xiaochao.user.js');
  if (!existsSync(userscript)) throw new Error(`缺少油猴脚本: ${userscript}`);
  if (!existsSync(builtUserscriptPayload)) throw new Error(`缺少油猴新版代码: ${builtUserscriptPayload}`);

  console.log('[pack] 组装 app 目录（正式微端壳 + 当前脚本）…');
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });
  try {
    cpSync(releaseShell.dir, appDir, { recursive: true });
  } finally {
    releaseShell.cleanup();
  }
  // 壳里不应残留旧脚本或说明文档；始终用本次构建产物覆盖。
  if (existsSync(path.join(appDir, 'xiaochao.js'))) rmSync(path.join(appDir, 'xiaochao.js'));
  for (const name of readdirSync(appDir)) {
    if (name.endsWith('.md')) rmSync(path.join(appDir, name));
  }

  const shellPackage = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  const projectPackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  // 微端壳版本保持壳自身；脚本版本用工程 package.json，写入 @version 头。
  const scriptVersion = String(projectPackage.version || shellPackage.version || '0');
  shellPackage.main = 'main.js';
  shellPackage.IsDebug = false;
  shellPackage.IsTest = false;
  shellPackage.xiaochaoShellVersion = shellVersion;
  writeFileSync(path.join(appDir, 'package.json'), `${JSON.stringify(shellPackage, null, 2)}\n`);
  writeBundledScript(scriptVersion);

  for (const name of requiredShellFiles) {
    if (!existsSync(path.join(appDir, name))) {
      throw new Error(`组装后的 app 缺少 ${name}（micro-client-update 与 updater 须同包）`);
    }
  }

  const appZipPath = path.join(packDir, 'app.zip');
  console.log('[pack] 生成 app.zip…');
  await createZip(appZipPath, ['app'], stagingRoot);

  for (const file of RELEASE_ASSET_FILES) {
    const from = path.join(assetsDir, file);
    if (!existsSync(from)) throw new Error(`缺少发布资源: ${file}`);
    copyFileSync(from, path.join(packDir, file));
  }

  mkdirSync(releaseDir, { recursive: true });
  const releaseZipPath = path.join(releaseDir, releaseZipName(scriptVersion));
  const releaseAppZipPath = path.join(releaseDir, 'app.zip');
  copyFileSync(appZipPath, releaseAppZipPath);
  console.log(`[pack] 生成 ${releaseZipName(scriptVersion)}…`);
  await createZip(releaseZipPath, RELEASE_ASSET_FILES.concat('app.zip'), packDir);

  const stagedScript = path.join(appDir, 'xiaochao.js');
  const releaseScriptPath = path.join(releaseDir, 'xiaochao.js');
  if (!existsSync(stagedScript)) throw new Error('缺少组装后的 xiaochao.js');
  copyFileSync(stagedScript, releaseScriptPath);
  const releasePayloadPath = path.join(releaseDir, USERSCRIPT_PAYLOAD_FILE_NAME);
  copyFileSync(builtUserscriptPayload, releasePayloadPath);

  rmSync(stagingRoot, { recursive: true, force: true });

  const zipSize = statSync(releaseZipPath).size;
  const appSha256 = createHash('sha256').update(readFileSync(releaseAppZipPath)).digest('hex');
  const scriptSha256 = createHash('sha256').update(readFileSync(releaseScriptPath)).digest('hex');
  const userscriptPayloadSha256 = createHash('sha256').update(readFileSync(releasePayloadPath)).digest('hex');
  const manifest = {
    version: scriptVersion,
    notes: '',
    pageUrl: 'https://xc.95chong.cn/downloads',
    appUrl: 'https://xc.95chong.cn/downloads/app.zip',
    appSha256,
    scriptUrl: 'https://xc.95chong.cn/downloads/xiaochao.js',
    scriptSha256,
    shellVersion,
    userscriptPayloadUrl: USERSCRIPT_PAYLOAD_URL,
    userscriptPayloadSha256
  };
  const manifestPath = path.join(releaseDir, 'xiaochao-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const serverManifest = path.resolve(root, '..', 'server', 'data', 'xiaochao-manifest.json');
  if (existsSync(path.dirname(serverManifest))) {
    // 先放新版代码再放清单：清单一换，浏览器就会来下这份代码。
    const serverPayload = path.join(path.dirname(serverManifest), USERSCRIPT_PAYLOAD_FILE_NAME);
    copyFileSync(releasePayloadPath, serverPayload);
    copyFileSync(manifestPath, serverManifest);
    console.log(`[pack] 版本清单和油猴新版代码已同步到 ${path.dirname(serverManifest)}`);
  }
  console.log(`[pack] 完成: ${releaseZipPath}`);
  console.log(`[pack] ${(zipSize / 1024).toFixed(1)} KB（脚本 v${scriptVersion}，微端壳 v${shellPackage.version}，外壳版本 ${shellVersion}）`);
  console.log(`[pack] 清单: ${manifestPath}（copy:portal 会放到门户 /downloads/manifest.json）`);
}

main().catch((error) => {
  console.error('[pack] 失败:', error.message || error);
  process.exitCode = 1;
});

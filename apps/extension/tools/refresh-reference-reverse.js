/**
 * 从官方微端 zip 解出 xiaochao.js，生成 .dev-data/appbak 下的本地逆向镜像。
 * 用法：node tools/refresh-reference-reverse.js [zip路径]
 *
 * 1.6.79 起官方把微端本体与小抄拆分：weiduan zip 只含 app.zip 等安装文件，
 * 不再内嵌 app/xiaochao.js。若 zip 内没有该脚本，则按官网经典版清单
 * （https://xiaochao.org/download/classic/manifest.json）下载并校验后写入 appbak。
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(__dirname, '..');
const defaultZip =
  process.env.XIAOCHAO_REFERENCE_ZIP ||
  path.join(extensionRoot, '.reference', 'xiaochao-weiduan-1.1.94.zip');
const zipPath = path.resolve(process.argv[2] || defaultZip);
const outDir = path.join(extensionRoot, '.dev-data', 'appbak');
const updatesUrl = 'https://log.xiaochao.org/updates.txt';
const classicManifestUrl = 'https://xiaochao.org/download/classic/manifest.json';

let scriptPathInZip = 'app/xiaochao.js';
let scriptSource = 'zip';

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function fetchClassicScript(dest) {
  const tmpManifest = dest + '.manifest.json';
  execSync(`curl -fsSL ${JSON.stringify(classicManifestUrl)} -o ${JSON.stringify(tmpManifest)}`, {
    stdio: 'inherit',
    shell: true,
  });
  const manifest = JSON.parse(fs.readFileSync(tmpManifest, 'utf8'));
  fs.unlinkSync(tmpManifest);
  if (
    !manifest ||
    manifest.format !== 1 ||
    typeof manifest.url !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
    !Number.isSafeInteger(manifest.size)
  ) {
    console.error('经典版清单无效', manifest);
    process.exit(1);
  }
  execSync(`curl -fsSL ${JSON.stringify(manifest.url)} -o ${JSON.stringify(dest)}`, {
    stdio: 'inherit',
    shell: true,
  });
  const buf = fs.readFileSync(dest);
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== manifest.sha256 || buf.length !== manifest.size) {
    console.error('经典版脚本校验失败', {
      sha,
      expected: manifest.sha256,
      bytes: buf.length,
      expectedSize: manifest.size,
    });
    process.exit(1);
  }
  scriptPathInZip = manifest.url;
  scriptSource = 'classic-manifest';
  console.log(`已从官网经典版清单下载脚本 ${manifest.version || ''}，SHA256 校验通过`);
  return dest;
}

function extractXiaochao() {
  if (!fs.existsSync(zipPath)) {
    console.error('找不到参考 zip：', zipPath);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, 'xiaochao.js');
  const tmp = path.join(outDir, '_tmp');
  rmrf(tmp);
  fs.mkdirSync(tmp, { recursive: true });
  const q = (p) => `"${p.replace(/"/g, '\\"')}"`;
  try {
    execSync(`unzip -q -o ${q(zipPath)} app.zip -d ${q(tmp)}`, {
      stdio: 'inherit',
      shell: true,
    });
    const inner = path.join(tmp, 'app.zip');
    execSync(`unzip -q -o ${q(inner)} app/xiaochao.js -d ${q(tmp)}`, {
      stdio: 'inherit',
      shell: true,
    });
    const src = path.join(tmp, 'app', 'xiaochao.js');
    if (!fs.existsSync(src)) throw new Error('zip 内无 app/xiaochao.js');
    fs.copyFileSync(src, dest);
    rmrf(tmp);
    scriptPathInZip = 'app/xiaochao.js';
    scriptSource = 'zip';
    return dest;
  } catch {
    rmrf(tmp);
    console.log('zip 内无 app/xiaochao.js（微端本体已与小抄拆分），改从官网经典版清单下载脚本…');
    return fetchClassicScript(dest);
  }
}

function detectVersion(text) {
  const m =
    text.match(/@version\s+([\d.]+)/) ||
    text.match(/["']version["']\s*:\s*["']([\d.]+)["']/);
  return m ? m[1] : null;
}

function beautify(minPath, prettyPath) {
  const pretty = execSync(`npx --yes js-beautify@1.15.4 ${JSON.stringify(minPath)}`, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    cwd: extensionRoot,
    shell: true,
  });
  fs.writeFileSync(prettyPath, pretty, 'utf8');
}

function fetchUpdates() {
  const dest = path.join(outDir, 'updates.txt');
  try {
    execSync(`curl -fsSL ${JSON.stringify(updatesUrl)} -o ${JSON.stringify(dest)}`, {
      stdio: 'inherit',
      shell: true,
    });
  } catch {
    console.warn('拉取 updates.txt 失败，保留已有文件');
  }
  return fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
}

function parseLatestLogVersion(updatesText) {
  const m = updatesText.match(/(\d+\.\d+\.\d+)\s*→\s*(\d+\.\d+\.\d+)/);
  return m ? m[2] : null;
}

function writeManifest({ scriptVersion, sha256, bytes, logLatest }) {
  const manifest = {
    refreshedAt: new Date().toISOString(),
    zipPath,
    scriptPath: scriptPathInZip,
    scriptSource,
    scriptVersion,
    scriptBytes: bytes,
    scriptSha256: sha256,
    changelogUrl: 'https://log.xiaochao.org/',
    changelogLatestVersion: logLatest,
    prettyPath: 'xiaochao-pretty.js',
    indexDoc: 'tools/reference-reverse-index.md',
  };
  fs.writeFileSync(
    path.join(outDir, 'REFERENCE_MANIFEST.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );
}

const minPath = extractXiaochao();
const buf = fs.readFileSync(minPath);
const sha256 = createHash('sha256').update(buf).digest('hex');
const text = buf.toString('utf8');
const scriptVersion = detectVersion(text);
const prettyPath = path.join(outDir, 'xiaochao-pretty.js');
console.log('美化 xiaochao.js …');
beautify(minPath, prettyPath);
const updatesText = fetchUpdates();
const logLatest = parseLatestLogVersion(updatesText);
writeManifest({
  scriptVersion,
  sha256,
  bytes: buf.length,
  logLatest,
});
console.log(
  `完成：脚本 ${scriptVersion || '未知'}，${buf.length} 字节，日志最新 ${logLatest || '未知'}`,
);
if (scriptVersion && logLatest && scriptVersion !== logLatest) {
  console.log(
    `提示：脚本为 ${scriptVersion}，官网日志已到 ${logLatest}；1.6.31 之后的行为以 updates.txt 为准，并尽快换更新的 zip / 脚本。`,
  );
}

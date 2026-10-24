/**
 * 从官方微端 zip 解出 xiaochao.js，生成 .dev-data/appbak 下的本地逆向镜像。
 * 用法：node tools/refresh-reference-reverse.js [zip路径]
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
  path.join(extensionRoot, '.reference', 'xiaochao-1.6.47-weiduan-1.1.80.zip');
const zipPath = path.resolve(process.argv[2] || defaultZip);
const outDir = path.join(extensionRoot, '.dev-data', 'appbak');
const updatesUrl = 'https://log.xiaochao.org/updates.txt';

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function extractXiaochao() {
  if (!fs.existsSync(zipPath)) {
    console.error('找不到参考 zip：', zipPath);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = path.join(outDir, '_tmp');
  rmrf(tmp);
  fs.mkdirSync(tmp, { recursive: true });
  const q = (p) => `"${p.replace(/"/g, '\\"')}"`;
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
  const dest = path.join(outDir, 'xiaochao.js');
  fs.copyFileSync(src, dest);
  rmrf(tmp);
  return dest;
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
    scriptPath: 'app/xiaochao.js',
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
    `提示：zip 内脚本为 ${scriptVersion}，官网日志已到 ${logLatest}；1.6.31 之后的行为以 updates.txt 为准，并尽快换更新的 zip。`,
  );
}

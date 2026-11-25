/** 发布日志站，历史安装包只增不删；远端索引先合并，冲突立即中止。 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { withSshOpts } = require("../../../tools/deploy-ssh-options.cjs");
const { readIndex, mergeIndexes, sha256 } = require("../scripts/archive-store.js");

const rootDir = path.resolve(__dirname, "..");
const target = process.env.LOG_SSH || process.env.XC_SSH || "admin@123.56.3.130";
const remote = process.env.LOG_REMOTE || "/opt/log";
if (!/^\/[a-zA-Z0-9/_-]+$/.test(remote)) throw new Error("LOG_REMOTE 路径无效");
const distDir = path.join(rootDir, "dist");
const outDir = path.join(rootDir, "out");
const localIndexPath = path.join(rootDir, "content/downloads.json");

function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, { cwd: rootDir, stdio: "inherit", ...options });
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} failed (${result.status})`);
  return result;
}
function ssh(command, capture = false) {
  return run("ssh", withSshOpts([target, command]), capture ? { encoding: "utf8", stdio: "pipe" } : {});
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "xc-log-archive-"));
try {
  ssh(`sudo mkdir -p ${remote}/dist/downloads && sudo chown -R "$(whoami):$(whoami)" ${remote}`);
  // 缺索引只允许首次初始化；SSH/读取失败不能当作没有历史包。
  const remoteRaw = ssh(`if test -f ${remote}/dist/downloads/index.json; then node -p "require('fs').readFileSync('${remote}/dist/downloads/index.json','utf8')"; else printf '[]'; fi`, true).stdout;
  const remoteIndex = JSON.parse(remoteRaw);
  const index = mergeIndexes(remoteIndex, readIndex(localIndexPath));
  const missing = [];
  for (const entry of index) {
    const destination = `${remote}/dist/downloads/${entry.file}`;
    const hash = ssh(`if test -f ${destination}; then sha256sum ${destination}; else printf 'MISSING'; fi`, true).stdout.trim().split(/\s+/)[0];
    if (hash !== "MISSING") {
      if (hash !== entry.sha256) throw new Error(`远端归档冲突：${entry.file}`);
      continue;
    }
    const source = path.join(rootDir, "public/downloads", entry.file);
    if (!fs.existsSync(source) || sha256(fs.readFileSync(source)) !== entry.sha256 || fs.statSync(source).size !== entry.size) {
      throw new Error(`缺少已验证的安装包：${entry.file}`);
    }
    missing.push({ entry, source, destination });
  }
  fs.writeFileSync(localIndexPath, JSON.stringify(index, null, 2) + "\n");
  run("npm run build", [], { shell: true });
  if (!fs.existsSync(outDir)) throw new Error("构建后没有找到 out 目录");
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.cpSync(outDir, distDir, { recursive: true });
  // 包只经下面的校验流程上传；网站静态文件绝不覆盖 downloads。
  fs.rmSync(path.join(distDir, "downloads"), { recursive: true, force: true });
  for (const { entry, source, destination } of missing) {
    const uploaded = `${remote}/dist/downloads/.upload-${entry.sha256}.zip`;
    run("scp", withSshOpts([source, `${target}:${uploaded}`]));
    ssh(`test "$(sha256sum ${uploaded} | cut -d ' ' -f 1)" = '${entry.sha256}' && if test -f ${destination}; then test "$(sha256sum ${destination} | cut -d ' ' -f 1)" = '${entry.sha256}' && rm ${uploaded}; else mv -n ${uploaded} ${destination}; fi`);
  }
  // 不再 rm -rf 远端 dist：历史包、旧静态资源和其它已有内容均保留。
  run("scp", withSshOpts(["-r", "dist", `${target}:${remote}/`]));
  const indexFile = path.join(temporary, "index.json");
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + "\n");
  run("scp", withSshOpts([indexFile, `${target}:${remote}/dist/downloads/index.next.json`]));
  ssh(`mv ${remote}/dist/downloads/index.next.json ${remote}/dist/downloads/index.json`);
  console.log(`已同步到 ${target}:${remote}/dist；归档 ${index.length} 个版本，只增不删`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

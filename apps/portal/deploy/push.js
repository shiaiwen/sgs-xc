/**
 * 本机构建后上传 dist 到服务器。
 * 用法：在本项目目录执行 npm run deploy
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const target = process.env.XC_SSH || "admin@123.56.3.130";
const remote = process.env.XC_REMOTE || "/opt/xc";
const distDir = path.join(rootDir, "dist");
const outDir = path.join(rootDir, "out");

function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    ...options,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npm run build", [], { shell: true });

if (!fs.existsSync(outDir)) {
  console.error("构建后没有找到 out 目录");
  process.exit(1);
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.cpSync(outDir, distDir, { recursive: true });

run("ssh", [
  target,
  `sudo mkdir -p ${remote} && sudo chown -R "$(whoami):$(whoami)" ${remote} && rm -rf ${remote}/dist`,
]);
run("scp", ["-r", "dist", `${target}:${remote}/`]);

console.log(`已同步到 ${target}:${remote}/dist`);

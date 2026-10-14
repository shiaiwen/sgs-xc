/**
 * 只上传 public/downloads，不执行 build。
 * 用法：在本项目目录执行 npm run deploy:downloads
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const target = process.env.XC_SSH || "admin@123.56.3.130";
const remote = process.env.XC_REMOTE || "/opt/xc";
const downloadsDir = path.join(rootDir, "public", "downloads");

function run(command, args = []) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!fs.existsSync(downloadsDir)) {
  console.error("没有找到 public/downloads");
  process.exit(1);
}

run("ssh", [
  target,
  `sudo mkdir -p ${remote}/dist && sudo chown -R "$(whoami):$(whoami)" ${remote}/dist && rm -rf ${remote}/dist/downloads`,
]);
run("scp", ["-r", downloadsDir, `${target}:${remote}/dist/`]);

console.log(`已同步 downloads 到 ${target}:${remote}/dist/downloads`);

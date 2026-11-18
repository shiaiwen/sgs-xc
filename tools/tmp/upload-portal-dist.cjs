const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { withSshOpts } = require("D:\\workspace\\sgs-xc\\tools\\deploy-ssh-options.cjs");

const rootDir = "D:\\workspace\\sgs-xc\\apps\\portal";
const target = process.env.XC_SSH || "admin@123.56.3.130";
const remote = process.env.XC_REMOTE || "/opt/xc";
const distDir = path.join(rootDir, "dist");
const outDir = path.join(rootDir, "out");

function run(command, args = []) {
  console.log("[upload] " + command + " " + args.join(" "));
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

if (!fs.existsSync(outDir)) {
  console.error("没有找到 out 目录");
  process.exit(1);
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.cpSync(outDir, distDir, { recursive: true });
console.log("[upload] 已将 out 拷到 dist");

run("ssh", withSshOpts([
  target,
  `sudo mkdir -p ${remote} && sudo chown -R "$(whoami):$(whoami)" ${remote} && rm -rf ${remote}/dist`,
]));
run("scp", withSshOpts(["-r", "dist", `${target}:${remote}/`]));
console.log(`已同步到 ${target}:${remote}/dist`);

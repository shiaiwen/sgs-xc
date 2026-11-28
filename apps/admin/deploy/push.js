/**
 * 将管理台源码同步到服务器并在远端构建、用 pm2 托管 next start。
 * 用法：在 apps/admin 目录执行 npm run deploy
 *
 * 默认 admin@123.56.3.130:~/xc-admin，进程名 xc-admin，端口 3001。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { withSshOpts } = require("../../../tools/deploy-ssh-options.cjs");

const rootDir = path.resolve(__dirname, "..");
const target = process.env.ADMIN_SSH || process.env.XC_SSH || "admin@123.56.3.130";
const remote = process.env.ADMIN_REMOTE || "/home/admin/xc-admin";
const pm2Name = process.env.ADMIN_PM2_NAME || "xc-admin";
const listenPort = process.env.ADMIN_PORT || "3001";

const apiBase = process.env.NEXT_PUBLIC_FEEDBACK_API_BASE || "https://xc.95chong.cn";
const portalOrigin = process.env.NEXT_PUBLIC_PORTAL_ORIGIN || "https://xc.95chong.cn";

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

const fs = require("node:fs");
const uploadPaths = ["package.json", "next.config.ts", "tsconfig.json", "next-env.d.ts", "src", "public"].filter(
  (entry) => {
    try {
      fs.accessSync(path.join(rootDir, entry));
      return true;
    } catch {
      return false;
    }
  },
);

run("ssh", withSshOpts([target, `mkdir -p ${remote} && rm -rf ${remote}/src ${remote}/.next`]));
run("scp", withSshOpts(["-r", ...uploadPaths, `${target}:${remote}/`]));

const remoteBuild = [
  `cd ${remote}`,
  "npm install --omit=dev",
  `NEXT_PUBLIC_FEEDBACK_API_BASE='${apiBase}' NEXT_PUBLIC_PORTAL_ORIGIN='${portalOrigin}' npm run build`,
  `pm2 delete ${pm2Name} 2>/dev/null || true`,
  `PORT=${listenPort} pm2 start npm --name ${pm2Name} -- start`,
  "pm2 save",
].join(" && ");

run("ssh", withSshOpts([target, remoteBuild]));

console.log(`管理台已部署到 ${target}:${remote}，端口 ${listenPort}，pm2 进程 ${pm2Name}`);
/**
 * 上传源码到 95chong.cn 那台机器并安装依赖。进程由服务器上的 pm2 管理。
 * 用法：在本项目目录执行 npm run deploy
 *
 * 默认 admin@123.56.3.130:/opt/sgs-xc-server，应用监听 8787。
 * 换目标时设置 SGS_XC_SSH、SGS_XC_REMOTE。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.env.SGS_XC_SSH || 'admin@123.56.3.130';
const remote = process.env.SGS_XC_REMOTE || '/opt/sgs-xc-server';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: rootDir, stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('ssh', [target, `sudo mkdir -p ${remote} && sudo chown -R admin:admin ${remote} && rm -rf ${remote}/src ${remote}/keep-alive.sh`]);
run('scp', [
  '-r',
  'package.json',
  'package-lock.json',
  'src',
  'data',
  `${target}:${remote}/`
]);
run('ssh', [target, `cd ${remote} && npm ci --omit=dev`]);
console.log(`已同步到 ${target}:${remote}`);

/**
 * 一条命令发版：打包小抄 → 拷贝到门户 → 上传门户下载文件 → 上传版本服务。
 * 顺序固定，缺一步线上就不一致，不要再分开手敲。
 * 用法：npm run release
 * 只打包不上传：npm run pack
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const steps = [
  { name: '打包小抄', command: 'npm', args: ['run', 'pack', '-w', 'apps/extension'] },
  { name: '拷贝到门户下载目录', command: 'npm', args: ['run', 'copy:portal', '-w', 'apps/extension'] },
  { name: '上传门户下载文件', command: 'npm', args: ['run', 'deploy:downloads', '-w', 'apps/portal'] },
  { name: '上传版本服务', command: 'npm', args: ['run', 'deploy', '-w', 'apps/server'] }
];

for (const step of steps) {
  console.log(`\n[release] === ${step.name} ===`);
  const result = spawnSync(step.command, step.args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.error) {
    console.error(`[release] ${step.name}启动失败: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[release] ${step.name}失败，已中止。后续步骤未执行，线上可能处于中间状态。`);
    process.exit(result.status ?? 1);
  }
}

console.log('\n[release] 全部完成。重开微端即可收到更新提示。');

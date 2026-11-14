/**
 * 开发包的开关、背景和皮肤存在本机后端。端口空着就把 apps/server 拉起来，已经有人在跑就直接用。
 * 本机后端要连本机数据库，地址写在 apps/server/.env 的 DATABASE_URL。
 */
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { ACCOUNT_CONFIG_LOCAL_URL } from '../src/const/account-config-endpoint.ts';

const localServerUrl = new URL(ACCOUNT_CONFIG_LOCAL_URL);

function portInUse(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/** 需要启动时返回入口、工作目录和环境变量；端口已被占用或找不到后端时返回 null。 */
export async function planLocalAccountServer(extensionRoot) {
  const cwd = path.resolve(extensionRoot, '..', 'server');
  const entry = path.join(cwd, 'src', 'index.js');
  if (!existsSync(entry)) return null;
  if (await portInUse(localServerUrl.hostname, Number(localServerUrl.port))) {
    console.log(`[dev] 本机后端已经在 ${localServerUrl.origin} 运行，开发包的开关、背景和皮肤存在那里`);
    return null;
  }
  console.log(`[dev] 启动本机后端 ${localServerUrl.origin}，开发包的开关、背景和皮肤存在这里`);
  return { entry, cwd, env: { ...process.env, PORT: localServerUrl.port } };
}

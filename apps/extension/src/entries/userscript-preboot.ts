import { USERSCRIPT_BOOT_TIMEOUT_MS } from '../const/userscript-boot.ts';

declare const __XIAOCHAO_BUILD_STAMP__: string;

/** 入口最先执行，便于控制台判断脚本是否已开始跑。 */
const globalRecord = globalThis as Record<string, unknown>;
const startup = (globalRecord.__XIAOCHAO_STARTUP__ as Record<string, unknown> | undefined) ?? {};
if (typeof startup.state !== 'string') startup.state = 'booting';
startup.platform = 'userscript';
startup.entry = 'preboot-v2';
startup.buildStamp = typeof __XIAOCHAO_BUILD_STAMP__ === 'string' ? __XIAOCHAO_BUILD_STAMP__ : 'unknown';
globalRecord.__XIAOCHAO_STARTUP__ = startup;

globalThis.setTimeout(() => {
  const status = globalRecord.__XIAOCHAO_STARTUP__ as Record<string, unknown> | undefined;
  if (status?.state !== 'booting' && status?.state !== 'loading-modules') return;
  status.state = 'booting-timeout';
  status.error = '脚本主模块未执行完，请在油猴里更新脚本并查看控制台红色报错';
  console.error('[xiaochao]', status.error);
}, USERSCRIPT_BOOT_TIMEOUT_MS);

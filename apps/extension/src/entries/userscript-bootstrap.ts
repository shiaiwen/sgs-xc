/**
 * 油猴主逻辑：与 preboot 分文件，避免 preboot 已执行但 bootstrap 尚未挂到 window 的状态对象上。
 */
import './electron-polyfills';
import { createUserscriptPlatform } from '../adapters/userscript-platform';
import { bootstrapXiaochao } from '../core/bootstrap';
import { installUserscriptDevAutoReload } from '../runtime/userscript-dev-auto-reload.ts';

declare const __XIAOCHAO_DEV_BUILD_POLL_URL__: string;
declare const __XIAOCHAO_DEV_INSTALL_URL__: string;

const devBuildPollUrl = typeof __XIAOCHAO_DEV_BUILD_POLL_URL__ === 'string'
  ? __XIAOCHAO_DEV_BUILD_POLL_URL__
  : '';
const devInstallUrl = typeof __XIAOCHAO_DEV_INSTALL_URL__ === 'string'
  ? __XIAOCHAO_DEV_INSTALL_URL__
  : '';

export function runUserscriptBootstrap(): void {
  const globalRecord = globalThis as Record<string, unknown>;
  const startup = globalRecord.__XIAOCHAO_STARTUP__ as Record<string, unknown> | undefined;
  if (startup) startup.state = 'loading-modules';

  installUserscriptDevAutoReload(devBuildPollUrl, devInstallUrl);
  bootstrapXiaochao(createUserscriptPlatform());
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    const dispose = (window as unknown as Record<string, unknown>).__xcXiaochaoBootstrapDispose;
    if (typeof dispose === 'function') {
      try { (dispose as () => void)(); } catch { /* ignore */ }
    }
  });
}

/**
 * 油猴 / 浏览器脚本入口。
 * 与微端共用 bootstrapXiaochao；平台差异由 createUserscriptPlatform 注入。
 * 开发构建会注入轮询 URL，用于改代码后自动刷新脚本。
 */
import './electron-polyfills';
import { createUserscriptPlatform } from '../adapters/userscript-platform';
import { bootstrapXiaochao } from '../core/bootstrap';
import { installUserscriptDevAutoReload } from '../runtime/userscript-dev-auto-reload.ts';

/** 构建期替换；生产包为空字符串，install 内部会 no-op。 */
declare const __XIAOCHAO_DEV_BUILD_POLL_URL__: string;

const devBuildPollUrl = typeof __XIAOCHAO_DEV_BUILD_POLL_URL__ === 'string'
  ? __XIAOCHAO_DEV_BUILD_POLL_URL__
  : '';
installUserscriptDevAutoReload(devBuildPollUrl);

bootstrapXiaochao(createUserscriptPlatform());


/** Vite/monkey 热更新：拆掉上一轮 bootstrap，避免钩子套娃 */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    const dispose = (window as unknown as Record<string, unknown>).__xcXiaochaoBootstrapDispose;
    if (typeof dispose === 'function') {
      try { (dispose as () => void)(); } catch { /* ignore */ }
    }
  });
}

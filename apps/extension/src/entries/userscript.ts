/**
 * 油猴 / 浏览器脚本入口。
 * 必须单文件打包；拆 chunk 后油猴在游戏域名拉不到副文件，主逻辑永远进不去。
 */
import './userscript-preboot.ts';
import { runUserscriptBootstrap } from './userscript-bootstrap.ts';

try {
  runUserscriptBootstrap();
} catch (error: unknown) {
  const startup = (globalThis as Record<string, unknown>).__XIAOCHAO_STARTUP__ as
    | Record<string, unknown>
    | undefined;
  if (startup) {
    startup.state = 'failed';
    startup.error = error instanceof Error ? error.message : String(error);
  }
  console.error('[xiaochao] 启动失败', error);
}

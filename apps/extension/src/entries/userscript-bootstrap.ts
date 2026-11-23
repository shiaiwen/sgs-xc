/**
 * 油猴主逻辑：与 preboot 分文件，避免 preboot 已执行但 bootstrap 尚未挂到 window 的状态对象上。
 */
import './electron-polyfills';
import { createUserscriptPlatform } from '../adapters/userscript-platform';
import { bootstrapXiaochao } from '../core/bootstrap';

export function runUserscriptBootstrap(): void {
  const globalRecord = globalThis as Record<string, unknown>;
  const startup = globalRecord.__XIAOCHAO_STARTUP__ as Record<string, unknown> | undefined;
  if (startup) startup.state = 'loading-modules';

  bootstrapXiaochao(createUserscriptPlatform());
}
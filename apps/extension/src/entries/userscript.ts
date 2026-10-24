/**
 * 油猴 / 浏览器脚本入口。
 * 使用 userscript 平台适配器启动与微端共用的 bootstrapXiaochao。
 */
import { createUserscriptPlatform } from '../adapters/userscript-platform';
import { bootstrapXiaochao } from '../core/bootstrap';
import { installUserscriptDevAutoReload } from '../runtime/userscript-dev-auto-reload.ts';

declare const __XIAOCHAO_DEV_BUILD_POLL_URL__: string;

const devBuildPollUrl = typeof __XIAOCHAO_DEV_BUILD_POLL_URL__ === 'string'
  ? __XIAOCHAO_DEV_BUILD_POLL_URL__
  : '';
installUserscriptDevAutoReload(devBuildPollUrl);

bootstrapXiaochao(createUserscriptPlatform());

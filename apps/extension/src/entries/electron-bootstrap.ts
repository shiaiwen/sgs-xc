/**
 * Electron 注入引导（由 electron.ts 在 polyfill 之后 import）。
 * 先挂面板壳 CSS，再创建 Electron 平台适配器并进入共用 bootstrapXiaochao。
 */
import { createElectronPlatform } from '../adapters/electron-platform';
import { bootstrapXiaochao } from '../core/bootstrap';
import { installPanelShellStyles } from '../ui/panel/panel-shell-styles';

// 脚本一注入就装上面板壳样式，避免等 Vue mount；正式微端 Chromium 偏旧时也能尽早生效。
installPanelShellStyles();

// bootstrap 内部会装运行时桥并轮询账号/游戏就绪；此处只负责选 Electron 适配器。
bootstrapXiaochao(createElectronPlatform());

/**
 * Electron 微端注入入口（打包侧指向本文件）。
 * 顺序固定：先 polyfill，再 bootstrap（样式 + 平台适配 + 核心启动）。
 */
import './electron-polyfills';
import './electron-bootstrap';

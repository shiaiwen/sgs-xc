/**
 * Electron 微端平台适配。
 * 外链优先走 preload 的 openExternal，没有时退回浏览器新窗口。
 * 配置读写统一走 browser-settings（共享存储优先，否则页面 localStorage）。
 * 业务层通过 PlatformAdapter 使用，不直接碰 window.electron。
 */
import { readBrowserSetting, removeBrowserSetting, writeBrowserSetting } from './browser-settings.ts';
import type { PlatformAdapter } from './platform';

/** Electron 微端适配器。业务层不直接依赖 preload 暴露的 window.electron。 */
export function createElectronPlatform(): PlatformAdapter {
  return {
    platform: 'electron',
    async openExternal(url) {
      if (typeof window.electron?.openExternal === 'function') {
        await window.electron.openExternal(url);
        return;
      }
      window.open(url, '_blank', 'noopener');
    },
    getSetting: readBrowserSetting,
    setSetting: writeBrowserSetting,
    removeSetting: removeBrowserSetting
  };
}

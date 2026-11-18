/**
 * Electron 微端平台适配。
 * 外链优先走 preload 的 openExternal，没有时退回浏览器新窗口。
 * 配置读写统一走 browser-settings（共享存储优先，否则页面 localStorage）。
 * 新版脚本由微端主进程下载并换好，这里只问主进程换到了哪一版。
 * 业务层通过 PlatformAdapter 使用，不直接碰 window.electron。
 */
import { MICRO_CLIENT_UPDATE_STATUS_CHANNEL } from '../const/micro-client-update.ts';
import { readBrowserSetting, removeBrowserSetting, writeBrowserSetting } from './browser-settings.ts';
import type { PlatformAdapter, StagedUpdateReport, UpdatePackageRequest } from './platform';

const UNSUPPORTED_UPDATE: StagedUpdateReport = {
  supported: false,
  stagedVersion: '',
  failed: false,
  manualRequired: false
};

/** Electron 微端适配器。业务层不直接依赖 preload 暴露的 window.electron。 */
export function createElectronPlatform(): PlatformAdapter {
  /** 每个线上版本只请主进程立刻检查一次，之后只读进度，免得下载失败时反复重下。 */
  const checkRequestedVersions = new Set<string>();
  /** 旧版微端和开发壳没有这条通道，问过一次就不再问，免得主进程每次都报错。 */
  let statusChannelMissing = false;

  async function stageUpdate(request: UpdatePackageRequest): Promise<StagedUpdateReport> {
    const invoke = window.electron?.invoke;
    if (typeof invoke !== 'function' || statusChannelMissing) return UNSUPPORTED_UPDATE;
    const check = !checkRequestedVersions.has(request.version);
    checkRequestedVersions.add(request.version);
    let raw: unknown;
    try {
      raw = await invoke(MICRO_CLIENT_UPDATE_STATUS_CHANNEL, { check });
    } catch {
      statusChannelMissing = true;
      return UNSUPPORTED_UPDATE;
    }
    const status = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    if (status?.supported !== true) return UNSUPPORTED_UPDATE;
    return {
      supported: true,
      stagedVersion: typeof status.scriptVersion === 'string' ? status.scriptVersion : '',
      failed: status.failedVersion === request.version,
      manualRequired: typeof status.shellUpdateVersion === 'string' && status.shellUpdateVersion !== ''
    };
  }

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
    removeSetting: removeBrowserSetting,
    stageUpdate
  };
}

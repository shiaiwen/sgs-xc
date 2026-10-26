/**
 * 平台适配器契约：隔离 Electron 微端与油猴在外链、本地设置上的差异。
 * 业务模块只依赖本接口，不直接碰 window.electron / GM_*。
 */
export type XiaochaoPlatform = 'electron' | 'userscript';

export interface PlatformAdapter {
  readonly platform: XiaochaoPlatform;
  /** 用系统浏览器或新标签打开外链。 */
  openExternal(url: string): Promise<void>;
  /** 读本地设置（微端共享存储或页面 localStorage）。 */
  getSetting(key: string): string | null;
  /** 写本地设置。 */
  setSetting(key: string, value: string): void;
  /** 删除本地设置项。 */
  removeSetting(key: string): void;
}

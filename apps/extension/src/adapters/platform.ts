/**
 * 平台适配器契约：隔离 Electron 微端与油猴在外链、本地设置上的差异。
 * 业务模块只依赖本接口，不直接碰 window.electron / GM_*。
 */
export type XiaochaoPlatform = 'electron' | 'userscript';

/** 版本清单里跟自动更新有关的字段。 */
export interface UpdatePackageRequest {
  version: string;
  /** 浏览器用的新版代码地址和校验值；清单没有时为空字符串。 */
  userscriptPayloadUrl: string;
  userscriptPayloadSha256: string;
}

/** 平台把新版准备到哪一步。 */
export interface StagedUpdateReport {
  /** 这个环境能不能自动换新版。开发版、旧版微端、缺少浏览器接口时为 false。 */
  supported: boolean;
  /** 刷新页面后就会运行的版本；还没准备好时可能是旧版本号或空字符串。 */
  stagedVersion: string;
  /** 清单里这一版下载、校验或运行失败过。 */
  failed: boolean;
  /** 还得玩家手动装一次，例如微端外壳要换。 */
  manualRequired: boolean;
}

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
  /** 后台准备清单里的新版，刷新页面后生效；返回现在准备到哪一步，可以反复调用。 */
  stageUpdate(request: UpdatePackageRequest): Promise<StagedUpdateReport>;
}

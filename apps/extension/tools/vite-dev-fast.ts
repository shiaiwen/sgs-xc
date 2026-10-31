/** 本地 dev 脚本注入 XC_*_DEV 时启用更快的 Vite build / watch。 */

export function isElectronDevBuild(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.XC_ELECTRON_DEV === '1';
}

export function isUserscriptDevBuild(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.XC_USERSCRIPT_DEV === '1';
}

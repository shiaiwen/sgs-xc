/**
 * 开发安装脚本：vite-plugin-monkey 用带下划线的 Trusted Types 策略名会被 Chrome 拒绝，
 * document-start 时 head 可能还不存在。对安装包正文做一次性修补。
 */

const MOUNT_BLOCK =
  /if \(window\.trustedTypes\)[\s\S]*?\(document\.head \|\| document\.documentElement\)\.(?:append|appendChild)\(script\);/;

const MOUNT_FIXED = `window.__XIAOCHAO_STARTUP__ = { state: 'loading-entry', missing: ['vite-entry'] };
\tscript.onerror = () => {
\t\twindow.__XIAOCHAO_STARTUP__ = {
\t\t\tstate: 'failed',
\t\t\terror: '本机入口模块加载失败。游戏页会拦外链，请改用 npm run dev:userscript 整包安装地址，勿用 server:dev。'
\t\t};
\t\tconsole.error('[小抄]', window.__XIAOCHAO_STARTUP__.error);
\t};
\ttry {
\t\tconst policy = window.trustedTypes && window.trustedTypes.createPolicy('xc-monkey', { createScriptURL: (input) => input });
\t\tscript.src = policy ? policy.createScriptURL(entrySrc) : entrySrc;
\t} catch (error) {
\t\tscript.src = entrySrc;
\t}
\tconst mount = () => {
\t\tconst parent = document.head || document.documentElement;
\t\tif (!parent) return false;
\t\tparent.append(script);
\t\treturn true;
\t};
\tif (!mount()) {
\t\tconst observer = new MutationObserver(() => {
\t\t\tif (mount()) observer.disconnect();
\t\t});
\t\tobserver.observe(document, { childList: true, subtree: true });
\t}`;

/**
 * @param {string} source
 * @returns {string}
 */
export function patchUserscriptDevInstallMount(source) {
  if (!source || !source.includes('==UserScript==')) return source;
  if (source.includes("createPolicy('xc-monkey'")) return source;
  if (MOUNT_BLOCK.test(source)) {
    return source.replace(MOUNT_BLOCK, MOUNT_FIXED);
  }
  if (source.includes('trustedTypes') && source.includes('createPolicy')) {
    return source
      .replace(/createPolicy\(\s*key\s*,/g, "createPolicy('xc-monkey',")
      .replace(/createPolicy\(\s*"__monkeyWindow[^"]*"\s*,/g, "createPolicy('xc-monkey',");
  }
  return source;
}

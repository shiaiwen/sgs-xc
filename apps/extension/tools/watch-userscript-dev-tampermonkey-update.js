/**
 * dev 构建号变化时打开油猴安装地址，触发「更新脚本」确认框。
 */
import fs from 'node:fs';
import path from 'node:path';

export function watchUserscriptDevTampermonkeyUpdate(options) {
  const root = options.root;
  const installUrl = String(options.installUrl ?? '').trim();
  const openUrl = typeof options.openUrl === 'function' ? options.openUrl : null;
  if (!root || !installUrl || !openUrl) return () => {};

  const buildIdFile = path.join(root, 'dist/userscript/xiaochao-dev-build-id.txt');
  let lastBuildId = '';
  let debounceTimer = 0;

  try {
    lastBuildId = fs.readFileSync(buildIdFile, 'utf8').trim();
  } catch {
    lastBuildId = '';
  }

  const promptUpdate = () => {
    let next = '';
    try {
      next = fs.readFileSync(buildIdFile, 'utf8').trim();
    } catch {
      return;
    }
    if (!next || next === lastBuildId) return;
    lastBuildId = next;
    const url = `${installUrl}${installUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(next)}`;
    console.log('\n[xiaochao dev] 新构建已完成，正在打开油猴更新页…');
    console.log(url);
    openUrl(url);
  };

  let watcher;
  try {
    watcher = fs.watch(buildIdFile, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(promptUpdate, 400);
    });
  } catch (error) {
    console.warn('[xiaochao dev] 无法监听构建号文件，改代码后请手动打开安装地址更新油猴脚本', error);
    return () => {};
  }

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher?.close();
  };
}

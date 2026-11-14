/**
 * 本地开发加载器：油猴里只装这一个，它用 @require 读本机打好的整份脚本。
 * 油猴每次进页面都会重新读本地文件，改完代码刷新页面就是最新的，不用再点更新。
 * 前提是浏览器扩展页给油猴打开「允许访问文件网址」。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  USERSCRIPT_DEV_LOADER_NAME,
  USERSCRIPT_EXCLUDES,
  USERSCRIPT_MATCHES,
  USERSCRIPT_NAMESPACE
} from '../src/const/userscript-meta.ts';

/** 加载器本身不再变化，版本号固定，油猴不会提示更新。 */
const LOADER_VERSION = '1.0.0';

export function createUserscriptDevLoader(root) {
  const scriptUrl = pathToFileURL(path.join(root, 'dist', 'userscript', 'xiaochao.user.js')).href;
  const lines = [
    '// ==UserScript==',
    `// @name         ${USERSCRIPT_DEV_LOADER_NAME}`,
    `// @namespace    ${USERSCRIPT_NAMESPACE}`,
    `// @version      ${LOADER_VERSION}`,
    '// @description  本地开发：每次进页面读取本机最新打包的小抄',
    ...USERSCRIPT_MATCHES.map((pattern) => `// @match        ${pattern}`),
    ...USERSCRIPT_EXCLUDES.map((pattern) => `// @exclude      ${pattern}`),
    `// @require      ${scriptUrl}`,
    '// @grant        none',
    '// @run-at       document-start',
    '// ==/UserScript==',
    ''
  ];
  return lines.join('\n');
}

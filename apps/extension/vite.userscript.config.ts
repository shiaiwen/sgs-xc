import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import monkey from 'vite-plugin-monkey';
import {
  createUserscriptDevBuildIdPlugin,
  userscriptDevBuildPollUrl,
  userscriptDevReloadEnabled
} from './src/runtime/userscript-dev-build-id-plugin.ts';

const USERSCRIPT_FILE = resolve(import.meta.dirname, 'dist/userscript/xiaochao.user.js');

/**
 * 保留油猴头注释，把后面的程序收成一行。
 * 字符串里的换行是内容，压成 `\n` 转义后保留：压缩器会把 `'\n'` 写成含真实换行的
 * 模板字符串，之前直接丢掉换行，`split('\n')` 就变成了 `split('')`，山河图面板的
 * 奖励文案于是被按字拆成一列竖排。
 */
export function collapseUserscriptBody(source: string): string {
  const headerEnd = source.indexOf('==/UserScript==');
  if (headerEnd < 0) return source;
  const header = source.slice(0, headerEnd + '==/UserScript=='.length);
  const body = source.slice(header.length);
  let out = '';
  let escaped = false;
  let brace = 0;
  /** 行注释只能靠换行结束，这里的换行要留着。 */
  let lineComment = false;
  const stack: Array<'code' | "'" | '"' | '`'> = ['code'];
  const templateBrace: number[] = [];
  const templateTagged: boolean[] = [];
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const mode = stack[stack.length - 1];
    if (char === '\n' || char === '\r') {
      if (mode === '`' || mode === "'" || mode === '"') {
        if (escaped) {
          // 反斜杠加换行是续行，原样保留，否则字符串内容会变。
          out += char;
          escaped = false;
          continue;
        }
        // 带标签的模板要看原始文本，原样留着；普通模板转义后内容等价。
        const tagged = templateTagged[templateTagged.length - 1] === true;
        out += tagged || mode !== '`' ? char : char === '\n' ? '\\n' : '\\r';
      } else if (lineComment) {
        out += '\n';
      }
      lineComment = false;
      continue;
    }
    out += char;
    if (mode === "'" || mode === '"') {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === mode) stack.pop();
      continue;
    }
    if (mode === '`') {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '`') {
        stack.pop();
        templateTagged.pop();
      } else if (char === '$' && body[index + 1] === '{') {
        out += '{';
        index += 1;
        stack.push('code');
        templateBrace.push(brace);
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      // 反引号前紧挨标识符、右括号或右花括号时是带标签模板。
      if (char === '`') templateTagged.push(/[A-Za-z0-9_$)\]}]$/.test(out.slice(0, -1)));
      stack.push(char);
      continue;
    }
    if (char === '/' && body[index + 1] === '/') lineComment = true;
    if (char === '{') brace += 1;
    if (char === '}') {
      brace -= 1;
      if (templateBrace.length > 0 && brace === templateBrace[templateBrace.length - 1]) {
        templateBrace.pop();
        stack.pop();
      }
    }
  }
  return `${header}\n\n${out.trim()}\n`;
}

function collapseUserscriptPlugin(): Plugin {
  return {
    name: 'xiaochao-collapse-userscript',
    apply: 'build',
    writeBundle() {
      writeFileSync(USERSCRIPT_FILE, collapseUserscriptBody(readFileSync(USERSCRIPT_FILE, 'utf8')));
    }
  };
}

/**
 * 网页刚打开时 head 可能还不存在。样式先排队，节点出来再挂上。
 * 这段函数会被原样写进脚本，不能引用外面的变量。
 */
function mountUserscriptStyle(css: string): void {
  const apply = (): boolean => {
    const parent = document.head || document.documentElement;
    if (!parent) return false;
    const style = document.createElement('style');
    style.append(css);
    parent.appendChild(style);
    return true;
  };
  if (apply()) return;
  const timer = setInterval(() => {
    if (apply()) clearInterval(timer);
  }, 30);
}

/**
 * 开发脚本在页面脚本之前执行。原挂载会用带下划线的策略名，
 * 浏览器直接拒绝，整个脚本停在这一行。这里改成合法名字，并等到节点出现再插入。
 */
const DEV_USERSCRIPT_MOUNT_BROKEN =
  /if \(window\.trustedTypes\)[\s\S]*?\(document\.head \|\| document\.documentElement\)\.append\(script\);/;

function patchDevUserscriptMount(): Plugin {
  const fixed = `try {
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
  return {
    name: 'xiaochao-dev-userscript-mount',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        if (path !== '/__vite-plugin-monkey.install.user.js' && path !== '/xiaochao-dev.user.js') {
          next();
          return;
        }
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="xiaochao-dev.user.js"'
        );
        const end = res.end.bind(res);
        res.end = ((chunk?: unknown, encoding?: unknown, callback?: unknown) => {
          const text = Buffer.isBuffer(chunk) || typeof chunk === 'string'
            ? String(chunk).replace(DEV_USERSCRIPT_MOUNT_BROKEN, fixed)
            : chunk;
          return end(text as never, encoding as never, callback as never);
        }) as typeof res.end;
        next();
      });
    }
  };
}

const isDevUserscriptBundle = process.env.XC_USERSCRIPT_DEV === '1';

/** 开发期安装引导页，配合 vite-plugin-monkey 热更新安装脚本。 */
function devUserscriptInstallPage(port: number, useHttps: boolean): Plugin {
  const installPath = '/__vite-plugin-monkey.install.user.js';
  const origin = `${useHttps ? 'https' : 'http'}://127.0.0.1:${port}`;
  const installUrl = `${origin}${installPath}`;
  const installHttpPort = Number(process.env.XC_USERSCRIPT_INSTALL_HTTP_PORT || 0);
  const installUrlForTampermonkey = installHttpPort
    ? `http://127.0.0.1:${installHttpPort}${USERSCRIPT_INSTALL_PATH}`
    : installUrl;
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>小抄油猴开发安装</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
    a.button { display: inline-block; margin: 1rem 0; padding: 0.75rem 1.25rem; background: #c45a2c; color: #fff; text-decoration: none; border-radius: 8px; }
    code { word-break: break-all; background: #f4f4f4; padding: 0.15rem 0.35rem; border-radius: 4px; }
    ol { padding-left: 1.25rem; }
    .ok { color: #1a7f37; }
    .bad { color: #c41e1e; }
  </style>
</head>
<body>
  <h1>小抄本地开发 · 油猴安装</h1>
  <p>地址必须是 <strong>${useHttps ? 'https' : 'http'}</strong>，不要用旧的 http 安装包。</p>
  <p id="entry-status">正在检测开发服务…</p>
  <p>请用已安装 <strong>Tampermonkey</strong> 的 Chrome 或 Edge 打开本页，不要用 Cursor 内置浏览器。</p>
  <p><a class="button" href="${installPath}">安装开发脚本</a></p>
  <p>油猴「从 URL 安装」请粘贴：<code>${installUrlForTampermonkey}</code>${installHttpPort ? ' <span class="ok">（HTTP，油猴可拉取）</span>' : ''}</p>
  <p>浏览器直接装可用：<code>${installUrl}</code></p>
  <p>在 <code>apps/extension</code> 执行 <code>npm run dev:userscript</code>，<strong>终端别关</strong>。改代码后保存，<strong>刷新游戏页</strong>。</p>
  <h2>游戏里又不生效时</h2>
  <ol>
    <li>本页上方检测应是绿色「开发服务正常」；若是红色，先重新跑 <code>npm run dev:userscript</code>。</li>
    <li>浏览器地址栏打开本页时若提示证书，点高级 → 继续访问。</li>
    <li>油猴里<strong>关掉</strong>线上的「三国杀小抄」，只开 <code>server:dev:三国杀小抄</code>。曾装过 http 版请删掉后按上面链接重装。</li>
    <li>游戏页 F12 控制台输入 <code>__XIAOCHAO_STARTUP__</code>，应看到 <code>state: "ready"</code>。若是 Mixed Content 或连不上 5173，把红字发维护的人。</li>
  </ol>
  <h2>没有出现「安装」时</h2>
  <ol>
    <li>点浏览器右上角油猴图标，确认扩展已启用。</li>
    <li>油猴 → 管理面板 → 实用工具 → <strong>从 URL 安装</strong>，粘贴上面的 HTTP 安装地址。用 https 常会提示无法从该 URL 加载脚本。</li>
  </ol>
  <script>
    const el = document.getElementById('entry-status');
    fetch('/__vite-plugin-monkey.entry.js')
      .then((r) => {
        if (r.ok) {
          el.textContent = '开发服务正常，可以安装或刷新游戏页。';
          el.className = 'ok';
        } else {
          el.textContent = '开发入口异常 HTTP ' + r.status;
          el.className = 'bad';
        }
      })
      .catch(() => {
        el.textContent = '连不上本机 5173，请在 apps/extension 执行 npm run dev:userscript';
        el.className = 'bad';
      });
  </script>
</body>
</html>`;
  const attach = (server: { middlewares: { use: (fn: (req: { url?: string }, res: {
    statusCode: number;
    setHeader: (k: string, v: string) => void;
    end: (body?: string) => void;
  }, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      const reqPath = req.url?.split('?')[0] ?? '';
      if (reqPath !== '/userscript-dev') {
        next();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html);
    });
  };
  return {
    name: 'xiaochao-dev-install-page',
    configureServer: attach
  };
}

const USERSCRIPT_INSTALL_PATH = '/xiaochao-dev.user.js';

/** 稳装模式：用油猴「从 URL 安装」拉取整份脚本。 */
function serveUserscriptInstallFile(): Plugin {
  const installPaths = new Set([USERSCRIPT_INSTALL_PATH, '/tampermonkey-install.user.js']);
  const attach = (server: { middlewares: { use: (fn: (req: { url?: string }, res: {
    statusCode: number;
    setHeader: (k: string, v: string) => void;
    end: (body?: string) => void;
  }, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      const reqPath = req.url?.split('?')[0] ?? '';
      if (!installPaths.has(reqPath)) {
        next();
        return;
      }
      try {
        const body = readFileSync(USERSCRIPT_FILE, 'utf8');
        if (!body.includes('==UserScript==')) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('脚本还在打包，请看终端是否出现 built in');
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', 'inline; filename="xiaochao-dev.user.js"');
        res.end(body);
      } catch {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('未找到 dist/userscript/xiaochao.user.js，请先等首轮 build 完成');
      }
    });
  };
  return {
    name: 'xiaochao-serve-userscript-install',
    configurePreviewServer: attach
  };
}

function devUserscriptSimplePage(port: number): Plugin {
  const installHttpPort = Number(process.env.XC_USERSCRIPT_INSTALL_HTTP_PORT || 0);
  const scriptUrlHttp = installHttpPort
    ? `http://127.0.0.1:${installHttpPort}${USERSCRIPT_INSTALL_PATH}`
    : '';
  const scriptUrlHttps = `https://127.0.0.1:${port}${USERSCRIPT_INSTALL_PATH}`;
  const installUrlForTampermonkey = scriptUrlHttp || scriptUrlHttps;
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>小抄油猴稳装开发</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
    a.button { display: inline-block; margin: 1rem 0; padding: 0.75rem 1.25rem; background: #2c6c45; color: #fff; text-decoration: none; border-radius: 8px; }
    code { word-break: break-all; background: #f4f4f4; padding: 0.15rem 0.35rem; border-radius: 4px; }
    ol { padding-left: 1.25rem; }
    .ok { color: #1a7f37; }
    .bad { color: #c41e1e; }
  </style>
</head>
<body>
  <h1>小抄稳装开发</h1>
  <p id="script-status">正在检测脚本…</p>
  <p>点页面上的安装按钮常常没反应，请按下面用油猴<strong>从 URL 安装</strong>。</p>
  <p><strong>安装步骤</strong></p>
  <ol>
    <li>油猴图标 → 管理面板 → 实用工具 → <strong>从 URL 安装</strong></li>
    <li>粘贴：<code id="install-url">${installUrlForTampermonkey}</code> <button type="button" id="copy-url">复制</button></li>
    <li>确认安装 <code>dev:三国杀小抄</code>，关掉线上「三国杀小抄」</li>
  </ol>
  ${scriptUrlHttp ? '<p>油猴拉取 https 自签证书常会失败，请用上面的 <strong>http</strong> 地址安装。</p>' : ''}
  <p>终端跑 <code>npm run dev:userscript:simple</code> 别关。改代码保存，等终端新一轮 build 完成，再<strong>刷新游戏页</strong>。</p>
  <p>仍失败：油猴管理面板 → 实用工具 → <strong>从文件安装</strong>，选 <code>apps/extension/dist/userscript/xiaochao.user.js</code>。</p>
  <script>
    document.getElementById('copy-url')?.addEventListener('click', () => {
      navigator.clipboard.writeText('${installUrlForTampermonkey}');
    });
    const el = document.getElementById('script-status');
    fetch('${USERSCRIPT_INSTALL_PATH}')
      .then((r) => {
        if (r.ok) {
          el.textContent = '脚本已就绪，可安装或刷新游戏。';
          el.className = 'ok';
        } else {
          el.textContent = '脚本未就绪 HTTP ' + r.status;
          el.className = 'bad';
        }
      })
      .catch(() => {
        el.textContent = '连不上本机服务，请确认 dev:userscript:simple 在跑';
        el.className = 'bad';
      });
  </script>
</body>
</html>`;
  const attach = (server: { middlewares: { use: (fn: (req: { url?: string }, res: {
    statusCode: number;
    setHeader: (k: string, v: string) => void;
    end: (body?: string) => void;
  }, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      const reqPath = req.url?.split('?')[0] ?? '';
      if (reqPath !== '/userscript-simple') {
        next();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html);
    });
  };
  return {
    name: 'xiaochao-dev-simple-page',
    configureServer: attach,
    configurePreviewServer: attach
  };
}

const baseXiaochaoVersion = String(
  JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')).version || '0.0.0'
);
const xiaochaoVersion = isDevUserscriptBundle ? `${baseXiaochaoVersion}-dev.${Date.now()}` : baseXiaochaoVersion;

const devPort = Number(process.env.XC_USERSCRIPT_DEV_PORT || 5173);
/** tools/dev-userscript.js 会注入端口，走 Vite 模块热更。 */
const isLocalUserscriptServe = process.env.XC_USERSCRIPT_DEV_PORT !== undefined
  && process.env.XC_USERSCRIPT_BUNDLE_DEV !== '1';
/** tools/dev-userscript-bundle.js：监听打包 + preview 整份 user.js。 */
const isBundleDevServe = process.env.XC_USERSCRIPT_BUNDLE_DEV === '1';
const useLocalHttps = isLocalUserscriptServe || isBundleDevServe;
const devAutoReloadEnabled = userscriptDevReloadEnabled(isLocalUserscriptServe, isBundleDevServe);
const installHttpPort = Number(process.env.XC_USERSCRIPT_INSTALL_HTTP_PORT || 0);
const localUserscriptUrl = installHttpPort
  ? `http://127.0.0.1:${installHttpPort}${USERSCRIPT_INSTALL_PATH}`
  : `https://127.0.0.1:${devPort}${USERSCRIPT_INSTALL_PATH}`;
const remoteUserscriptUrl = 'https://xc.95chong.cn/downloads/sgs-xc.user.js';

export default defineConfig({
  define: {
    __XIAOCHAO_VERSION__: JSON.stringify(xiaochaoVersion),
    __XIAOCHAO_DEV_BUILD_POLL_URL__: JSON.stringify(
      userscriptDevBuildPollUrl(devAutoReloadEnabled, useLocalHttps, devPort)
    )
  },
  server: {
    host: '127.0.0.1',
    port: devPort,
    strictPort: true,
    https: useLocalHttps,
    open: false,
    hmr: useLocalHttps
      ? {
          protocol: 'wss',
          host: '127.0.0.1',
          port: devPort,
          clientPort: devPort
        }
      : undefined
  },
  preview: {
    host: '127.0.0.1',
    port: devPort,
    strictPort: true,
    https: useLocalHttps,
    open: isBundleDevServe ? '/userscript-simple' : false
  },
  plugins: [
    ...(devAutoReloadEnabled ? [createUserscriptDevBuildIdPlugin()] : []),
    ...(useLocalHttps ? [basicSsl()] : []),
    ...(isBundleDevServe ? [serveUserscriptInstallFile(), devUserscriptSimplePage(devPort)] : []),
    vue(),
    ...(isLocalUserscriptServe ? [devUserscriptInstallPage(devPort, useLocalHttps), patchDevUserscriptMount()] : []),
    monkey({
      entry: 'src/entries/userscript.ts',
      server: {
        open: false
      },
      userscript: {
        name: isDevUserscriptBundle ? 'dev:三国杀小抄' : '三国杀小抄',
        namespace: 'https://95chong.cn/',
        version: xiaochaoVersion,
        description: '三国杀OL辅助插件',
        author: 'many people',
        icon: 'https://www.sanguosha.com/favicon.ico',
        match: [
          '*://game.4399iw2.com/yxsgs/*',
          '*://my.4399.com/yxsgs/*',
          '*://*.sanguosha.com/*',
          '*://web.kuaiwan.com/kwsgsn/*',
          '*://wan.baidu.com/microend?gameId=19793595*',
          '*://www.7k7k.com/special/sgs/?*',
          '*://playgame.iqiyi.com/login/iframe_page_web/top?game_id=146'
        ],
        exclude: [
          'https://game.4399iw2.com/yxxsgs/*',
          '*://*.sanguosha.com/10/*',
          '*://*.sanguosha.com/10th/*',
          '*://*.sanguosha.com/220/miniGame/*',
          'https://wan.baidu.com/*gameId=19793616*',
          '*://h5.7k7k.com/web/H5GAMES.html?gid=960982bec2f555de44ea43ca8a7ef418/*',
          '*://qqgame.qq.com/webappframe/?appid=10951',
          '*://s118.app1107877410.qqopenapp.com/pc/qqLobby_index.php*'
        ],
        grant: 'none',
        connect: devAutoReloadEnabled ? ['127.0.0.1'] : undefined,
        'run-at': 'document-start',
        homepageURL: 'https://xc.95chong.cn/',
        downloadURL: isDevUserscriptBundle && isBundleDevServe ? localUserscriptUrl : remoteUserscriptUrl,
        updateURL: isDevUserscriptBundle && isBundleDevServe ? localUserscriptUrl : remoteUserscriptUrl
      },
      build: {
        fileName: 'xiaochao.user.js',
        cssSideEffects: mountUserscriptStyle
      }
    }),
    collapseUserscriptPlugin()
  ],
  build: {
    outDir: 'dist/userscript',
    emptyOutDir: true,
    target: 'chrome100',
    sourcemap: false,
    cssMinify: 'lightningcss',
    minify: 'terser',
    terserOptions: {
      compress: {
        passes: 3,
        ecma: 2020,
        module: false,
        toplevel: true,
        drop_debugger: true,
        pure_getters: true,
        hoist_funs: true,
        unsafe_arrows: true,
        unsafe_comps: true,
        unsafe_math: true,
        unsafe_methods: true
      },
      mangle: {
        toplevel: true
      },
      format: {
        comments: false,
        ecma: 2020
      }
    }
  }
});

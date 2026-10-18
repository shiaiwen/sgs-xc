import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import monkey from 'vite-plugin-monkey';

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
function patchDevUserscriptMount(): Plugin {
  const broken = 'if (window.trustedTypes) script.src = window.trustedTypes.createPolicy(key, { createScriptURL: (input) => input }).createScriptURL(entrySrc);\n\telse script.src = entrySrc;\n\t(document.head || document.documentElement).append(script);';
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
        if (!req.url?.includes('/__vite-plugin-monkey.install.user.js')) {
          next();
          return;
        }
        const end = res.end.bind(res);
        res.end = ((chunk?: unknown, encoding?: unknown, callback?: unknown) => {
          const text = Buffer.isBuffer(chunk) || typeof chunk === 'string'
            ? String(chunk).replace(broken, fixed)
            : chunk;
          return end(text as never, encoding as never, callback as never);
        }) as typeof res.end;
        next();
      });
    }
  };
}

const xiaochaoVersion = String(
  JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')).version || '0.0.0'
);

export default defineConfig({
  define: {
    __XIAOCHAO_VERSION__: JSON.stringify(xiaochaoVersion)
  },
  plugins: [
    vue(),
    patchDevUserscriptMount(),
    monkey({
      entry: 'src/entries/userscript.ts',
      userscript: {
        name: '三国杀小抄',
        namespace: 'https://95chong.cn/',
        version: xiaochaoVersion,
        description: '三国杀OL辅助插件',
        author: 'many people',
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
        'run-at': 'document-start',
        downloadURL: 'https://xc.95chong.cn/downloads/sgs-xc.user.js',
        updateURL: 'https://xc.95chong.cn/downloads/sgs-xc.user.js'
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

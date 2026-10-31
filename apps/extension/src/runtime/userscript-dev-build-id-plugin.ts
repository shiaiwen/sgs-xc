import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { USERSCRIPT_DEV_BUILD_ID_PATH } from '../const/userscript-dev-reload.ts';

const BUILD_ID_FILE_NAME = 'xiaochao-dev-build-id.txt';

export function createUserscriptDevBuildIdPlugin(): Plugin {
  let outDir = 'dist/userscript';
  let buildId = String(Date.now());

  const bump = () => {
    buildId = String(Date.now());
  };

  const writeBuildIdFile = () => {
    try {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, BUILD_ID_FILE_NAME), buildId, 'utf8');
    } catch {
      // 预览进程读不到文件时仍用内存 buildId。
    }
  };

  const readBuildIdForPoll = (): string => {
    try {
      const fromFile = fs.readFileSync(path.join(outDir, BUILD_ID_FILE_NAME), 'utf8').trim();
      if (fromFile) return fromFile;
    } catch {
      // watch 与 preview 分进程时，靠磁盘上的 build 号文件同步。
    }
    return buildId;
  };

  const attach = (server: {
    middlewares: {
      use: (fn: (req: { url?: string }, res: {
        statusCode: number;
        setHeader: (key: string, value: string) => void;
        end: (body: string) => void;
      }, next: () => void) => void) => void;
    };
  }) => {
    server.middlewares.use((req, res, next) => {
      const reqPath = req.url?.split('?')[0] ?? '';
      if (reqPath !== USERSCRIPT_DEV_BUILD_ID_PATH) {
        next();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-store');
      res.end(readBuildIdForPoll());
    });
  };

  return {
    name: 'xiaochao-userscript-dev-build-id',
    configResolved(config) {
      outDir = config.build.outDir ?? outDir;
    },
    buildStart() {
      bump();
      writeBuildIdFile();
    },
    writeBundle() {
      bump();
      writeBuildIdFile();
    },
    closeBundle() {
      const id = readBuildIdForPoll();
      writeBuildIdFile();
      try {
        const scriptPath = path.join(outDir, 'xiaochao.user.js');
        let source = fs.readFileSync(scriptPath, 'utf8');
        if (!source.includes('==UserScript==')) return;
        source = source.replace(/\/\/ @version\s+\S+/g, `// @version      ${id}`);
        fs.writeFileSync(scriptPath, source, 'utf8');
      } catch {
        // 首次构建或路径未就绪时跳过。
      }
    },
    handleHotUpdate() {
      bump();
      writeBuildIdFile();
    },
    configureServer: attach,
    configurePreviewServer: attach
  };
}

/** 仅稳装/bundle 模式用轮询整页刷新；Vite serve 模式走插件自带 HMR。 */
export function userscriptDevReloadEnabled(
  _isLocalUserscriptServe: boolean,
  isBundleDevServe: boolean
): boolean {
  return isBundleDevServe;
}

export function userscriptDevBuildPollUrl(
  enabled: boolean,
  useHttps: boolean,
  port: number,
  installHttpPort = 0
): string {
  if (!enabled) return '';
  // HTTPS 游戏页会拦 http://127.0.0.1 混合内容，构建号改走 preview 的 HTTPS。
  if (useHttps) {
    return `https://127.0.0.1:${port}${USERSCRIPT_DEV_BUILD_ID_PATH}`;
  }
  if (installHttpPort > 0) {
    return `http://127.0.0.1:${installHttpPort}${USERSCRIPT_DEV_BUILD_ID_PATH}`;
  }
  return `http://127.0.0.1:${port}${USERSCRIPT_DEV_BUILD_ID_PATH}`;
}

const DEV_INSTALL_SCRIPT_PATH = '/xiaochao-dev.user.js';

/** 油猴 dev 脚本的 updateURL / 手动更新页。 */
export function userscriptDevInstallUrl(
  enabled: boolean,
  installHttpPort: number,
  devPort: number
): string {
  if (!enabled) return '';
  if (installHttpPort > 0) {
    return `http://127.0.0.1:${installHttpPort}${DEV_INSTALL_SCRIPT_PATH}`;
  }
  return `https://127.0.0.1:${devPort}${DEV_INSTALL_SCRIPT_PATH}`;
}

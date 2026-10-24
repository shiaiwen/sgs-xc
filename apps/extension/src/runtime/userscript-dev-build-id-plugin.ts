import type { Plugin } from 'vite';

const BUILD_ID_PATH = '/xiaochao-dev-build-id';

export function createUserscriptDevBuildIdPlugin(): Plugin {
  let buildId = String(Date.now());
  const bump = () => {
    buildId = String(Date.now());
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
      const path = req.url?.split('?')[0] ?? '';
      if (path !== BUILD_ID_PATH) {
        next();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-store');
      res.end(buildId);
    });
  };
  return {
    name: 'xiaochao-userscript-dev-build-id',
    buildStart: bump,
    writeBundle: bump,
    handleHotUpdate() {
      bump();
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
  port: number
): string {
  if (!enabled) return '';
  const protocol = useHttps ? 'https' : 'http';
  return `${protocol}://127.0.0.1:${port}${BUILD_ID_PATH}`;
}
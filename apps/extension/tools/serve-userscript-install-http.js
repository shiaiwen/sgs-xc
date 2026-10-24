/**
 * 本机 HTTP 提供油猴安装地址（反代 Vite HTTPS 安装脚本，避开自签证书）。
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INSTALL_PATH = '/xiaochao-dev.user.js';

export function fetchTextUrl(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { rejectUnauthorized: false }, (upstream) => {
      let body = '';
      upstream.setEncoding('utf8');
      upstream.on('data', (chunk) => {
        body += chunk;
      });
      upstream.on('end', () => {
        resolve({ status: upstream.statusCode ?? 502, body });
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

export async function waitForUrlOk(url, options = {}) {
  const attempts = options.attempts ?? 60;
  const intervalMs = options.intervalMs ?? 500;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const { status } = await fetchTextUrl(url, { timeoutMs: 2000 });
      if (status >= 200 && status < 500) return true;
    } catch {
      // keep waiting
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function respondUserscript(res, body, waitMessage) {
  if (!body.includes('==UserScript==')) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(waitMessage);
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': 'inline; filename="xiaochao-dev.user.js"'
  });
  res.end(body);
}

export function startUserscriptInstallHttpServer(options) {
  const root = options.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const port = options.port ?? 5174;
  const host = options.host ?? '127.0.0.1';
  const userscriptFile = path.join(root, 'dist/userscript/xiaochao.user.js');
  const proxyHttpsUrl = options.proxyHttpsUrl;
  const installUrl = `http://${host}:${port}${INSTALL_PATH}`;

  const server = http.createServer((req, res) => {
    const reqPath = req.url?.split('?')[0] ?? '';
    if (reqPath === '/' || reqPath === '/index.html') {
      res.writeHead(302, { Location: INSTALL_PATH });
      res.end();
      return;
    }
    if (reqPath !== INSTALL_PATH) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    if (proxyHttpsUrl) {
      void fetchTextUrl(proxyHttpsUrl)
        .then(({ status, body }) => {
          if (status !== 200) {
            res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('waiting for vite');
            return;
          }
          respondUserscript(res, body, 'invalid install script');
        })
        .catch(() => {
          res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('vite not ready');
        });
      return;
    }
    fs.readFile(userscriptFile, 'utf8', (error, body) => {
      if (error) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('waiting for build');
        return;
      }
      respondUserscript(res, body, 'invalid script header');
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve({
        port,
        host,
        url: installUrl,
        guideUrl: installUrl,
        close: () => new Promise((done) => server.close(() => done()))
      });
    });
  });
}
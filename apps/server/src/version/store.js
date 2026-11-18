import fs from 'node:fs';
import path from 'node:path';

const filePath = path.join(process.cwd(), 'data', 'xiaochao-manifest.json');
const payloadPath = path.join(process.cwd(), 'data', 'xiaochao-userscript.js');
const payloadCache = { mtimeMs: -1, size: -1, body: null };

/** 读取打包同步过来的版本清单。 */
export function readVersionManifest() {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const shellVersion = Number(parsed.shellVersion);
  return {
    version: String(parsed.version || ''),
    notes: String(parsed.notes || ''),
    pageUrl: String(parsed.pageUrl || ''),
    appUrl: String(parsed.appUrl || ''),
    appSha256: String(parsed.appSha256 || ''),
    scriptUrl: String(parsed.scriptUrl || ''),
    scriptSha256: String(parsed.scriptSha256 || ''),
    shellVersion: Number.isSafeInteger(shellVersion) && shellVersion > 0 ? shellVersion : 0,
    userscriptPayloadUrl: String(parsed.userscriptPayloadUrl || ''),
    userscriptPayloadSha256: String(parsed.userscriptPayloadSha256 || '')
  };
}

/** 读取打包同步过来的油猴新版代码，原样返回字节，浏览器要按清单里的校验值核对。没有文件时返回 null。 */
export function readUserscriptPayload() {
  let stat;
  try {
    stat = fs.statSync(payloadPath);
  } catch {
    return null;
  }
  if (payloadCache.body && payloadCache.mtimeMs === stat.mtimeMs && payloadCache.size === stat.size) {
    return payloadCache.body;
  }
  const body = fs.readFileSync(payloadPath);
  Object.assign(payloadCache, { mtimeMs: stat.mtimeMs, size: stat.size, body });
  return body;
}

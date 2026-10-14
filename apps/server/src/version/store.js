import fs from 'node:fs';
import path from 'node:path';

const filePath = path.join(process.cwd(), 'data', 'xiaochao-manifest.json');

/** 读取打包同步过来的版本清单。 */
export function readVersionManifest() {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return {
    version: String(parsed.version || ''),
    notes: String(parsed.notes || ''),
    pageUrl: String(parsed.pageUrl || ''),
    appUrl: String(parsed.appUrl || ''),
    appSha256: String(parsed.appSha256 || '')
  };
}

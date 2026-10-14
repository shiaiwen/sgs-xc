import fs from 'node:fs';
import path from 'node:path';
import { giftCodeUpstreamUrl, upstreamCodeId } from './upstream.js';

const filePath = path.join(process.cwd(), 'data', 'gift-codes.json');
/** 上游刷下来的缓存，和手工维护的 gift-codes.json 分开写。 */
const upstreamFilePath = path.join(process.cwd(), 'data', 'gift-codes-upstream.json');

function readJsonFile(target, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return fallback;
  }
}

/** 原子写：先写临时文件再改名，刷新中途挂掉不会留下半个文件。 */
function writeJsonFile(target, value) {
  const tempPath = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, target);
}

/** 手工维护的礼包码：直接改 data/gift-codes.json，下次请求即生效。 */
export function readLocalGiftCodes() {
  const parsed = readJsonFile(filePath, null);
  const codes = Array.isArray(parsed?.codes) ? parsed.codes : [];
  return {
    version: Number(parsed?.version) || 0,
    updatedAt: Number(parsed?.updatedAt) || 0,
    codes
  };
}

/** 上游缓存：每小时刷新一次。文件缺失或坏了就当没有。 */
export function readUpstreamGiftCodes() {
  const parsed = readJsonFile(upstreamFilePath, null);
  const codes = Array.isArray(parsed?.codes)
    ? parsed.codes.map((code) => String(code || '').trim()).filter(Boolean)
    : [];
  return {
    source: String(parsed?.source || ''),
    updatedAt: Number(parsed?.updatedAt) || 0,
    codes
  };
}

/** 把上游拉到的码写进缓存文件。 */
export function writeUpstreamGiftCodes(codes, options = {}) {
  const list = (Array.isArray(codes) ? codes : [])
    .map((code) => String(code || '').trim())
    .filter(Boolean);
  const document = {
    source: options.source || giftCodeUpstreamUrl(),
    updatedAt: Date.now(),
    count: list.length,
    codes: [...new Set(list)]
  };
  writeJsonFile(upstreamFilePath, document);
  return document;
}

/**
 * 接口返回的礼包码：以上游为准排前面，手工加的在后面补，
 * 同一个码只留一条，所以手工抄过的旧码不会重复出现。
 */
export function readGiftCodeDocument() {
  const local = readLocalGiftCodes();
  const upstream = readUpstreamGiftCodes();
  const codes = [];
  const seen = new Set();
  const push = (entry) => {
    const code = String(entry?.code ?? entry ?? '').trim();
    if (!code || seen.has(code)) return;
    seen.add(code);
    codes.push({ id: String(entry?.id || upstreamCodeId(code)), code });
  };
  upstream.codes.forEach((code) => push({ id: upstreamCodeId(code), code }));
  local.codes.forEach(push);
  return {
    ok: true,
    version: local.version,
    updatedAt: Math.max(local.updatedAt, upstream.updatedAt),
    upstreamUpdatedAt: upstream.updatedAt,
    count: codes.length,
    codes
  };
}

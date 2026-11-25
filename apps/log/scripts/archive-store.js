const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { inflateRawSync } = require("node:zlib");

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function parseIndex(value) {
  if (!Array.isArray(value)) throw new Error("归档索引必须是数组");
  return value.map((item) => {
    if (!item || !/^\d+\.\d+\.\d+$/.test(item.version) ||
        item.file !== `wd-xc-${item.version}.zip` ||
        !Number.isSafeInteger(item.size) || item.size <= 0 ||
        !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error("归档索引格式无效");
    return { version: item.version, file: item.file, size: item.size, sha256: item.sha256 };
  });
}

function mergeIndexes(...indexes) {
  const merged = new Map();
  for (const item of indexes.flatMap(parseIndex)) {
    const previous = merged.get(item.version);
    if (previous && (previous.sha256 !== item.sha256 || previous.size !== item.size)) {
      throw new Error(`归档冲突：${item.version} 已有不同的包，禁止覆盖`);
    }
    merged.set(item.version, item);
  }
  return [...merged.values()].sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
}

function readIndex(file) {
  return fs.existsSync(file) ? mergeIndexes(JSON.parse(fs.readFileSync(file, "utf8"))) : [];
}

// 只读取中央目录指定的条目，不解压任何路径到磁盘。正式包使用标准 ZIP（非 ZIP64）。
function zipEntry(zip, name) {
  let end = zip.length - 22;
  while (end >= Math.max(0, zip.length - 65557) && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || zip.readUInt32LE(end) !== 0x06054b50) throw new Error("无效 ZIP");
  let cursor = zip.readUInt32LE(end + 16);
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error("无效 ZIP 中央目录");
    const method = zip.readUInt16LE(cursor + 10);
    const size = zip.readUInt32LE(cursor + 20);
    const nameSize = zip.readUInt16LE(cursor + 28);
    const extraSize = zip.readUInt16LE(cursor + 30);
    const commentSize = zip.readUInt16LE(cursor + 32);
    const fileName = zip.subarray(cursor + 46, cursor + 46 + nameSize).toString("utf8");
    if (fileName === name) {
      const offset = zip.readUInt32LE(cursor + 42);
      if (zip.readUInt32LE(offset) !== 0x04034b50) throw new Error("无效 ZIP 条目");
      const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
      const data = zip.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 });
      throw new Error("不支持的 ZIP 压缩格式");
    }
    cursor += 46 + nameSize + extraSize + commentSize;
  }
  throw new Error(`ZIP 缺少 ${name}`);
}

function verifyPackage(bytes, manifest) {
  if (!manifest || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("清单版本无效");
  const app = zipEntry(bytes, "app.zip");
  const script = zipEntry(app, "app/xiaochao.js");
  const version = /@version\s+([^\s]+)/.exec(script.subarray(0, 4096).toString("utf8"))?.[1];
  if (version !== manifest.version || sha256(app) !== manifest.appSha256 || sha256(script) !== manifest.scriptSha256) {
    throw new Error("安装包版本/哈希与发布清单不符");
  }
  return { version, file: `wd-xc-${version}.zip`, size: bytes.length, sha256: sha256(bytes) };
}

function archivePackage({ bytes, manifest, indexPath, downloadsDir }) {
  const entry = verifyPackage(bytes, manifest);
  const index = mergeIndexes(readIndex(indexPath), [entry]);
  fs.mkdirSync(downloadsDir, { recursive: true });
  const destination = path.join(downloadsDir, entry.file);
  if (fs.existsSync(destination)) {
    if (sha256(fs.readFileSync(destination)) !== entry.sha256) throw new Error(`归档文件冲突：${entry.file}`);
  } else {
    fs.writeFileSync(destination, bytes, { flag: "wx" });
  }
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
  return entry;
}

module.exports = { sha256, parseIndex, mergeIndexes, readIndex, zipEntry, verifyPackage, archivePackage };

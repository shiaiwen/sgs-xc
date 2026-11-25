const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { deflateRawSync } = require("node:zlib");
const { sha256, mergeIndexes, zipEntry, verifyPackage, archivePackage } = require("./archive-store.js");

function zip(name, bytes, compressed = false) {
  const filename = Buffer.from(name);
  const data = compressed ? deflateRawSync(bytes) : bytes;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(compressed ? 8 : 0, 8);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(compressed ? 8 : 0, 10);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12);
  end.writeUInt32LE(local.length + filename.length + data.length, 16);
  return Buffer.concat([local, filename, data, central, filename, end]);
}
function fixture() {
  const script = Buffer.from("// @version 1.0.70\nconsole.log('fixture');");
  const app = zip("app/xiaochao.js", script, true);
  return { bytes: zip("app.zip", app), manifest: { version: "1.0.70", appSha256: sha256(app), scriptSha256: sha256(script) } };
}
test("验证嵌套压缩包、脚本版本及两个发布哈希", () => {
  const f = fixture();
  assert.equal(verifyPackage(f.bytes, f.manifest).version, "1.0.70");
  assert.throws(() => verifyPackage(f.bytes, { ...f.manifest, version: "1.0.71" }), /不符/);
  assert.throws(() => verifyPackage(f.bytes, { ...f.manifest, appSha256: "0".repeat(64) }), /不符/);
  assert.throws(() => verifyPackage(f.bytes, { ...f.manifest, scriptSha256: "0".repeat(64) }), /不符/);
});
test("缺失或损坏的ZIP不能归档", () => {
  assert.throws(() => zipEntry(Buffer.alloc(22), "app.zip"));
  assert.throws(() => zipEntry(zip("other.zip", Buffer.from("x")), "app.zip"), /缺少/);
});
test("重复归档幂等；已有同版本不同包不覆盖", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xc-archive-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const args = { ...fixture(), indexPath: path.join(dir, "index.json"), downloadsDir: path.join(dir, "downloads") };
  const one = archivePackage(args);
  const indexBefore = fs.readFileSync(args.indexPath, "utf8");
  assert.deepEqual(archivePackage(args), one);
  assert.equal(fs.readFileSync(args.indexPath, "utf8"), indexBefore);
  const file = path.join(args.downloadsDir, one.file);
  fs.writeFileSync(file, "existing conflict");
  assert.throws(() => archivePackage(args), /冲突/);
  assert.equal(fs.readFileSync(file, "utf8"), "existing conflict");
});
test("合并保留远端旧版本，冲突立即失败，无包版本不伪造索引", () => {
  const entry = verifyPackage(fixture().bytes, fixture().manifest);
  const old = { ...entry, version: "1.0.69", file: "wd-xc-1.0.69.zip" };
  assert.equal(mergeIndexes([old], [entry], [entry]).length, 2);
  assert.throws(() => mergeIndexes([entry], [{ ...entry, sha256: "0".repeat(64) }]), /冲突/);
  assert.throws(() => mergeIndexes([{ ...entry, file: "../../file.zip" }]), /无效/);
  assert.deepEqual(mergeIndexes([], []), []);
});

const fs = require("node:fs");
const path = require("node:path");
const { archivePackage } = require("./archive-store.js");
const root = path.resolve(__dirname, "..");
const release = path.resolve(root, "../extension/release");
const manifest = JSON.parse(fs.readFileSync(path.join(release, "xiaochao-manifest.json"), "utf8"));
const file = path.join(release, `wd-xc-${manifest.version}.zip`);
const entry = archivePackage({
  bytes: fs.readFileSync(file), manifest,
  indexPath: path.join(root, "content/downloads.json"),
  downloadsDir: path.join(root, "public/downloads")
});
console.log(`[archive] ${entry.version} ${entry.size} bytes sha256=${entry.sha256}`);

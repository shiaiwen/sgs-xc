const fs = require("fs");
const path = require("path");

const root = "D:\\workspace\\sgs-xc";
const roots = [
  path.join(root, "apps", "portal"),
  path.join(root, "apps", "extension"),
];

const keywords = [
  "永久免费",
  "自愿扫码",
  "省了会员费",
  "维护成本",
  "完全没关系",
  "觉得好用就扫个码",
  "继续好好干",
  "扫个码支持",
];

const skipDirNames = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  ".reference",
  "reference",
]);

const exts = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".vue", ".html", ".css", ".scss", ".less",
  ".json", ".md", ".txt", ".yml", ".yaml",
]);

const hits = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (skipDirNames.has(ent.name)) continue;
      walk(full);
      continue;
    }
    const ext = path.extname(ent.name).toLowerCase();
    if (!exts.has(ext) && !ent.name.endsWith(".vue")) continue;
    let text;
    try {
      text = fs.readFileSync(full, "utf8");
    } catch (err) {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matched = keywords.filter((k) => line.includes(k));
      if (matched.length) {
        hits.push({
          file: full,
          line: i + 1,
          matched,
          text: line,
        });
      }
    }
  }
}

for (const r of roots) walk(r);

for (const h of hits) {
  console.log("====");
  console.log(h.file);
  console.log("L" + h.line + " keywords=" + h.matched.join("|"));
  console.log(h.text);
}
console.log("====TOTAL " + hits.length);

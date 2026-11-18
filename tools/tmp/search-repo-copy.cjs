const fs = require("fs");
const path = require("path");
const root = "D:\\workspace\\sgs-xc";
const keywords = ["若它帮你省了会员费", "可以自愿扫码支持一点维护成本", "没有也完全没关系", "自愿扫码", "省了会员费", "维护成本"];
const skipDirNames = new Set(["node_modules", ".git", "dist", "out", ".next", ".reference", "reference"]);
const hits = [];
function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (skipDirNames.has(ent.name)) continue;
      walk(full);
      continue;
    }
    const ext = path.extname(ent.name).toLowerCase();
    if (![".ts",".tsx",".js",".jsx",".mjs",".cjs",".vue",".html",".md",".json",".txt"].includes(ext)) continue;
    // skip built bundles in release/public downloads for now, but still record them separately
    let text;
    try { text = fs.readFileSync(full, "utf8"); } catch { continue; }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const matched = keywords.filter((k) => lines[i].includes(k));
      if (matched.length) {
        hits.push({
          file: full,
          line: i + 1,
          matched,
          text: lines[i].replace(/\s+/g, " ").trim().slice(0, 300),
          built: /[\\/](release|public[\\/]downloads|\.next)[\\/]/.test(full) || /\.(min|user)\.js$/.test(ent.name) && /downloads|release/.test(full)
        });
      }
    }
  }
}
walk(root);
for (const h of hits) {
  console.log((h.built ? "[BUILT] " : "[SRC]  ") + h.file);
  console.log("  L" + h.line + " " + h.matched.join("|"));
  console.log("  " + h.text);
  console.log("");
}
console.log("TOTAL " + hits.length);

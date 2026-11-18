const fs = require("fs");
const path = require("path");
const root = "D:\\workspace\\sgs-xc";
function list(dir, depth, acc) {
  if (depth < 0) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (["node_modules", ".git", ".next", "dist"].includes(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (/pack|release|deploy|log/i.test(ent.name) || depth >= 2) acc.push(full + "\\");
      list(full, depth - 1, acc);
    } else if (/\.(md|js|cjs|mjs|json)$/i.test(ent.name) && /pack|release|deploy|changelog|version/i.test(ent.name)) {
      acc.push(full);
    }
  }
}
const acc = [];
list(root, 3, acc);
for (const p of acc.sort()) console.log(p);

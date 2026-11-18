const fs = require("fs");
const path = require("path");

const newText = "小抄永久免费。觉得好用就扫个码支持一下，我继续好好干。";
const oldText = "小抄永久免费。若它帮你省了会员费，可以自愿扫码支持一点维护成本，没有也完全没关系。";
const files = [
  "D:\\workspace\\sgs-xc\\apps\\portal\\src\\components\\author-tip-entry.tsx",
  "D:\\workspace\\sgs-xc\\apps\\extension\\src\\ui\\settings\\AuthorTipSection.vue",
];
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes("永久免费") || line.includes("扫个码") || line.includes("会员费")) {
      console.log(f + ":" + (i + 1));
      console.log(line.trim());
      console.log("hasNew=" + line.includes(newText) + " hasOld=" + line.includes(oldText));
    }
  });
}

const header = "<!-- 发版前在这里写条目，一行一条，以 - 开头。npm run release 会自动生成与 package.json 同号的 md 并清空本文件。 -->\n\n";
const note = "- 门户和小抄改为「小抄永久免费。觉得好用就扫个码支持一下，我继续好好干。」\n";
const draftPath = "D:\\workspace\\sgs-xc\\apps\\log\\content\\releases\\_draft.md";
fs.writeFileSync(draftPath, header + note, "utf8");
console.log("----- draft -----");
console.log(fs.readFileSync(draftPath, "utf8"));

const shellPkg = JSON.parse(fs.readFileSync("D:\\workspace\\sgs-xc\\apps\\extension\\tools\\release-app-shell\\package.json", "utf8"));
console.log("shell package version=" + shellPkg.version + " xiaochaoShellVersion=" + shellPkg.xiaochaoShellVersion);

// find tests mentioning tip copy
const keywords = ["省了会员费", "自愿扫码", "维护成本", "完全没关系", "觉得好用就扫个码"];
function walk(dir, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (["node_modules", ".git", ".next", "dist", "release", ".reference"].includes(ent.name)) continue;
      walk(full, acc);
      continue;
    }
    if (!/\.(test|spec)\.(js|ts|mjs|cjs|tsx)$/i.test(ent.name) && !/test/i.test(ent.name)) continue;
    let text;
    try { text = fs.readFileSync(full, "utf8"); } catch { continue; }
    const hit = keywords.filter((k) => text.includes(k));
    if (hit.length) acc.push(full + " :: " + hit.join("|"));
  }
}
const acc = [];
walk("D:\\workspace\\sgs-xc", acc);
console.log("----- test hits -----");
console.log(acc.length ? acc.join("\n") : "(none)");

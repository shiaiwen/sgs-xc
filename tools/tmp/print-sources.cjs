const fs = require("fs");
const files = [
  "D:\\workspace\\sgs-xc\\apps\\portal\\src\\components\\author-tip-entry.tsx",
  "D:\\workspace\\sgs-xc\\apps\\extension\\src\\ui\\settings\\AuthorTipSection.vue",
  "D:\\workspace\\sgs-xc\\apps\\extension\\package.json",
];
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  const lines = text.split(/\r?\n/);
  console.log("========== " + f + " (" + lines.length + " lines) ==========");
  lines.forEach((line, i) => {
    console.log(String(i + 1).padStart(4, " ") + "|" + line);
  });
  console.log("");
}

const fs = require("fs");
const oldText = "小抄永久免费。若它帮你省了会员费，可以自愿扫码支持一点维护成本，没有也完全没关系。";
const newText = "小抄永久免费。觉得好用就扫个码支持一下，我继续好好干。";
const files = [
  "D:\\workspace\\sgs-xc\\apps\\portal\\src\\components\\author-tip-entry.tsx",
  "D:\\workspace\\sgs-xc\\apps\\extension\\src\\ui\\settings\\AuthorTipSection.vue",
];
for (const f of files) {
  const before = fs.readFileSync(f, "utf8");
  const count = before.split(oldText).length - 1;
  if (count !== 1) {
    console.error("UNEXPECTED COUNT " + count + " in " + f);
    process.exitCode = 1;
    continue;
  }
  const after = before.replace(oldText, newText);
  fs.writeFileSync(f, after, "utf8");
  const verify = fs.readFileSync(f, "utf8");
  console.log("UPDATED " + f);
  console.log("  oldCountNow=" + (verify.split(oldText).length - 1) + " newCount=" + (verify.split(newText).length - 1));
}

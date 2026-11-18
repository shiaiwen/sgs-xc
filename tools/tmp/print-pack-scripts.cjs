const fs = require("fs");
const files = [
  "D:\\workspace\\sgs-xc\\apps\\extension\\tools\\pack-release.js",
  "D:\\workspace\\sgs-xc\\apps\\extension\\tools\\deploy-release.js",
  "D:\\workspace\\sgs-xc\\apps\\log\\scripts\\ensure-release-changelog.js",
];
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  console.log("========== " + f + " (" + text.split(/\r?\n/).length + " lines) ==========");
  console.log(text);
  console.log("");
}

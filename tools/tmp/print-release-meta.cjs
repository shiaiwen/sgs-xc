const fs = require("fs");
const path = require("path");
const files = [
  "D:\\workspace\\sgs-xc\\apps\\extension\\tools\\release-shell-version.json",
  "D:\\workspace\\sgs-xc\\apps\\log\\scripts\\new-release.js",
  "D:\\workspace\\sgs-xc\\apps\\log\\scripts\\ensure-release-changelog.js",
  "D:\\workspace\\sgs-xc\\tools\\release.js",
];
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  console.log("========== " + f + " ==========");
  console.log(text);
  console.log("");
}
const relDir = "D:\\workspace\\sgs-xc\\apps\\log\\content\\releases";
const names = fs.readdirSync(relDir).sort();
console.log("========== releases dir ==========");
for (const n of names) console.log(n);

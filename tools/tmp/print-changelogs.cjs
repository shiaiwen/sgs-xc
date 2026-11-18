const fs = require("fs");
const path = require("path");
const files = [
  "D:\\workspace\\sgs-xc\\apps\\log\\content\\releases\\1.0.58.md",
  "D:\\workspace\\sgs-xc\\apps\\log\\content\\releases\\1.0.57.md",
  "D:\\workspace\\sgs-xc\\apps\\extension\\package.json",
  "D:\\workspace\\sgs-xc\\package.json",
  "D:\\workspace\\sgs-xc\\apps\\portal\\package.json",
  "D:\\workspace\\sgs-xc\\apps\\log\\package.json",
];
for (const f of files) {
  console.log("========== " + f + " ==========");
  console.log(fs.readFileSync(f, "utf8"));
  console.log("");
}

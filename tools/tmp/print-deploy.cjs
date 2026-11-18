const fs = require("fs");
const files = [
  "D:\\workspace\\sgs-xc\\apps\\portal\\deploy\\push.js",
  "D:\\workspace\\sgs-xc\\apps\\portal\\deploy\\push-downloads.js",
  "D:\\workspace\\sgs-xc\\apps\\log\\deploy\\push.js",
  "D:\\workspace\\sgs-xc\\apps\\extension\\tools\\copy-to-portal.js",
  "D:\\workspace\\sgs-xc\\apps\\log\\content\\releases\\_draft.md",
  "D:\\workspace\\sgs-xc\\tools\\deploy-ssh-options.cjs",
];
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  console.log("========== " + f + " (" + text.split(/\r?\n/).length + " lines) ==========");
  console.log(text);
  console.log("");
}

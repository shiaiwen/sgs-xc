const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const releaseDir = "D:\\workspace\\sgs-xc\\apps\\extension\\release";
const names = fs.readdirSync(releaseDir);
console.log("release files:");
for (const n of names) {
  const p = path.join(releaseDir, n);
  const st = fs.statSync(p);
  if (st.isFile()) {
    const sha = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    console.log(n + " size=" + st.size + " sha256=" + sha);
  } else {
    console.log(n + " [dir]");
  }
}

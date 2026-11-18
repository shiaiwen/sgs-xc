const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
console.log("===== 1.0.59.md =====");
console.log(fs.readFileSync("D:\\workspace\\sgs-xc\\apps\\log\\content\\releases\\1.0.59.md", "utf8"));
console.log("===== _draft.md =====");
console.log(fs.readFileSync("D:\\workspace\\sgs-xc\\apps\\log\\content\\releases\\_draft.md", "utf8"));

const newText = "小抄永久免费。觉得好用就扫个码支持一下，我继续好好干。";
const oldBits = ["若它帮你省了会员费", "可以自愿扫码支持一点维护成本", "没有也完全没关系"];
const downloads = "D:\\workspace\\sgs-xc\\apps\\portal\\public\\downloads";
const manifest = JSON.parse(fs.readFileSync(path.join(downloads, "manifest.json"), "utf8"));
console.log("portal manifest version=" + manifest.version + " shellVersion=" + manifest.shellVersion);
const appSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(downloads, "app.zip"))).digest("hex");
const scriptSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(downloads, "xiaochao.js"))).digest("hex");
console.log("portal app.zip sha match=" + (appSha === manifest.appSha256) + " " + appSha);
console.log("portal xiaochao.js sha match=" + (scriptSha === manifest.scriptSha256) + " " + scriptSha);
for (const name of ["xiaochao.js", "sgs-xc.user.js"]) {
  const text = fs.readFileSync(path.join(downloads, name), "utf8");
  console.log(name + " hasNew=" + text.includes(newText) + " hasOld=" + oldBits.some((b) => text.includes(b)));
}
const zips = fs.readdirSync(downloads).filter((n) => n.endsWith(".zip"));
console.log("portal zips=" + zips.join(", "));

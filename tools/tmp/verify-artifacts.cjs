const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const newText = "小抄永久免费。觉得好用就扫个码支持一下，我继续好好干。";
const oldText = "小抄永久免费。若它帮你省了会员费，可以自愿扫码支持一点维护成本，没有也完全没关系。";
const oldBits = ["若它帮你省了会员费", "可以自愿扫码支持一点维护成本", "没有也完全没关系"];

const pkg = JSON.parse(fs.readFileSync("D:\\workspace\\sgs-xc\\apps\\extension\\package.json", "utf8"));
console.log("package.json version=" + pkg.version);

const manifestPath = "D:\\workspace\\sgs-xc\\apps\\extension\\release\\xiaochao-manifest.json";
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
console.log("manifest=" + JSON.stringify(manifest, null, 2));

const files = {
  zip: "D:\\workspace\\sgs-xc\\apps\\extension\\release\\wd-xc-1.0.59.zip",
  appZip: "D:\\workspace\\sgs-xc\\apps\\extension\\release\\app.zip",
  script: "D:\\workspace\\sgs-xc\\apps\\extension\\release\\xiaochao.js",
  userscriptBuilt: "D:\\workspace\\sgs-xc\\apps\\extension\\dist\\userscript\\xiaochao.user.js",
  payload: "D:\\workspace\\sgs-xc\\apps\\extension\\release\\xiaochao.js",
};

function sha256(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

const appSha = sha256(files.appZip);
const scriptSha = sha256(files.script);
console.log("app.zip sha256    " + appSha);
console.log("manifest.appSha256 " + manifest.appSha256 + " match=" + (appSha === manifest.appSha256));
console.log("xiaochao.js sha256 " + scriptSha);
console.log("manifest.scriptSha " + manifest.scriptSha256 + " match=" + (scriptSha === manifest.scriptSha256));
console.log("manifest.version=" + manifest.version + " shellVersion=" + manifest.shellVersion);

const inspect = [
  "D:\\workspace\\sgs-xc\\apps\\extension\\release\\xiaochao.js",
  "D:\\workspace\\sgs-xc\\apps\\extension\\dist\\electron\\xiaochao.js",
  "D:\\workspace\\sgs-xc\\apps\\extension\\dist\\userscript\\xiaochao.user.js",
];
for (const f of inspect) {
  const text = fs.readFileSync(f, "utf8");
  const hasNew = text.includes(newText);
  const hasOld = text.includes(oldText) || oldBits.some((b) => text.includes(b));
  const ver = (text.match(/@version\s+([0-9.]+)/) || [])[1];
  console.log(path.basename(path.dirname(f)) + "/" + path.basename(f) + " version=" + ver + " hasNew=" + hasNew + " hasOld=" + hasOld + " size=" + fs.statSync(f).size);
}

const zipPath = files.zip;
console.log("zip exists=" + fs.existsSync(zipPath) + " size=" + (fs.existsSync(zipPath) ? fs.statSync(zipPath).size : 0));

const serverManifest = JSON.parse(fs.readFileSync("D:\\workspace\\sgs-xc\\apps\\server\\data\\xiaochao-manifest.json", "utf8"));
console.log("local server data manifest version=" + serverManifest.version + " (will not deploy server)");

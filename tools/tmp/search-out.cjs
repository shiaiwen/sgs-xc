const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const root = "D:\\workspace\\sgs-xc\\apps\\portal\\out";
const newText = "小抄永久免费。觉得好用就扫个码支持一下，我继续好好干。";
const oldText = "小抄永久免费。若它帮你省了会员费，可以自愿扫码支持一点维护成本，没有也完全没关系。";
const oldBits = ["若它帮你省了会员费", "可以自愿扫码支持一点维护成本", "没有也完全没关系"];

function walk(dir, acc) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
}
const files = [];
walk(root, files);
console.log("out file count=" + files.length);
let newHits = 0, oldHits = 0;
for (const f of files) {
  if (!/\.(html|js|txt|json|css|xml)$/i.test(f)) continue;
  if (f.includes("\\downloads\\") && /\.(js|zip)$/i.test(f) && !/user\.js$|xiaochao\.js$|manifest/.test(path.basename(f))) continue;
  let text;
  try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
  if (text.includes(newText) || text.includes("觉得好用就扫个码")) {
    newHits++;
    console.log("NEW " + f.replace(root, ""));
  }
  if (oldBits.some((b) => text.includes(b))) {
    oldHits++;
    console.log("OLD " + f.replace(root, ""));
  }
}
console.log("newHits=" + newHits + " oldHits=" + oldHits);

const manifest = JSON.parse(fs.readFileSync(path.join(root, "downloads", "manifest.json"), "utf8"));
const appSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "downloads", "app.zip"))).digest("hex");
const scriptSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "downloads", "xiaochao.js"))).digest("hex");
console.log("out manifest version=" + manifest.version + " shell=" + manifest.shellVersion);
console.log("app sha match=" + (appSha === manifest.appSha256));
console.log("script sha match=" + (scriptSha === manifest.scriptSha256));

const nextDir = path.join(root, "_next");
console.log("_next exists=" + fs.existsSync(nextDir));
function list(dir, prefix, depth) {
  if (depth < 0) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      console.log(prefix + ent.name + "/");
      list(full, prefix + "  ", depth - 1);
    } else {
      const st = fs.statSync(full);
      console.log(prefix + ent.name + " size=" + st.size);
    }
  }
}
console.log("----- _next -----");
list(nextDir, "", 2);
const odd = path.join(root, "downloads", "__next.downloads");
console.log("----- __next.downloads exists=" + fs.existsSync(odd) + " -----");
if (fs.existsSync(odd)) list(odd, "", 2);

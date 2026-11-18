const fs = require("fs");
const text = fs.readFileSync("D:\\workspace\\sgs-xc\\apps\\extension\\tools\\pack-release.js", "utf8");
const lines = text.split(/\r?\n/);
// print from hashShellDirectory / shell version / main
for (let i = 90; i < lines.length; i++) {
  const line = lines[i];
  if (/shell|version|RELEASE|hash|zip|1\.1\.|main\(|package\.json|xiaochao|userscript|manifest/i.test(line) || i >= 200) {
    // print all remaining after 90 if we want full rest
  }
}
// just print 91-end with numbers
for (let i = 90; i < lines.length; i++) {
  console.log(String(i + 1).padStart(4, " ") + "|" + lines[i]);
}

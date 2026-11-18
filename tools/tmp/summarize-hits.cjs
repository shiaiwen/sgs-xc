const fs = require("fs");
const text = fs.readFileSync("C:\\Users\\24745\\agent-tools\\e193439b-8ed0-4db0-8b74-40c7dad4b21d.txt", "utf8");
const blocks = text.split(/^====/m).filter(Boolean);
const out = [];
for (const b of blocks) {
  const lines = b.replace(/^\r?\n/, "").split(/\r?\n/);
  if (lines[0].startsWith("TOTAL")) {
    out.push(lines[0]);
    continue;
  }
  const file = lines[0] || "";
  const meta = lines[1] || "";
  const content = (lines.slice(2).join("\n") || "").replace(/\s+/g, " ").trim();
  const short = content.length > 240 ? content.slice(0, 240) + " ...[truncated " + content.length + " chars]" : content;
  out.push(file);
  out.push(meta);
  out.push(short);
  out.push("");
}
process.stdout.write(out.join("\n"));

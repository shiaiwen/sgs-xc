import fs from 'fs';
import path from 'path';

const root = process.cwd();
const skip = new Set(['node_modules', 'dist', '.git', '.reference', '.dev-data']);
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (skip.has(name)) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|vue|js|cjs)$/.test(name) && !name.endsWith('.d.ts') && !name.includes('_tmp-unused')) out.push(full);
  }
  return out;
}
const files = walk(root);
const texts = files.map((file) => [file, fs.readFileSync(file, 'utf8')]);
const corpus = texts.map(([, text]) => text).join('\n');
const hits = [];
for (const [file, text] of texts) {
  const names = [
    ...text.matchAll(/^(?:export )?(?:async )?function ([A-Za-z_][A-Za-z0-9_]{3,})/gm),
    ...text.matchAll(/^(?:export )?const ([A-Za-z_][A-Za-z0-9_]{3,})\s*=\s*(?:async )?(?:\([^)]*\)|[A-Za-z_][A-Za-z0-9_]*)\s*=>/gm)
  ];
  for (const match of names) {
    const name = match[1];
    const count = corpus.match(new RegExp(`\\b${name}\\b`, 'g'))?.length ?? 0;
    if (count === 1) hits.push(`${path.relative(root, file)} ${name}`);
  }
}
console.log([...new Set(hits)].sort().join('\n') || 'none');
console.log('count', new Set(hits).size);

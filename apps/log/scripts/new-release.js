#!/usr/bin/env node
/**
 * 生成 content/releases/<版本号>.md。
 * 用法：npm run new-release -- --version 1.0.41 --today --note "修复xxx" --recent "优化yyy"
 * 版本号跟小抄同一个号，以 apps/extension/package.json 的 version 为准。
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");

const rootDir = path.resolve(__dirname, "..");
const defaultReleasesDir = path.join(rootDir, "content", "releases");
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

class CliError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliError";
  }
}

const helpText = `生成 content/releases/<版本号>.md

用法：
  npm run new-release -- --version 1.0.41 --today --note "修复xxx" --recent "优化yyy"

版本号跟小抄同一个号，以 apps/extension/package.json 的 version 为准。

选项：
  --version <版本号>   指定版本，三段数字，例如 1.0.41
  --bump <级别>        不写版本时怎么递增：patch、minor、major。默认 patch
  --date <YYYY-MM-DD>  发布日期。不写则用上海当天
  --today              明确使用上海当天
  --title <标题>       不写则是「小抄」加版本号
  --note <条目>        本次更新，可重复，一次一条
  --recent <条目>      近期更新，可重复。一条都不写则不生成这一节
  --force              覆盖同名文件
  --dry-run            只打印，不写文件
  -h, --help           显示帮助

不带 --note，并且当前是交互终端时，会逐行询问。空行结束。
仓库根目录可以用 npm run log:new -- ，参数相同。
`;

// 按点分段，数字段按数值比。1.0.10 高于 1.0.2。站点列表用同一套顺序。
function compareVersions(left, right) {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftNumber = Number(leftParts[index] ?? 0);
    const rightNumber = Number(rightParts[index] ?? 0);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }
    const compared = (leftParts[index] ?? "").localeCompare(rightParts[index] ?? "");
    if (compared !== 0) return compared;
  }
  return left.localeCompare(right);
}

function isThreePartVersion(version) {
  return versionPattern.test(version);
}

function bumpVersion(version, kind) {
  const matched = versionPattern.exec(version);
  if (!matched) {
    throw new CliError(`最高版本 ${version} 不是三段数字，例如 1.0.41。用 --version 指定`);
  }
  const major = Number(matched[1]);
  const minor = Number(matched[2]);
  const patch = Number(matched[3]);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new CliError("--bump 只能是 patch、minor 或 major");
}

function highestVersion(versions) {
  let best = versions[0];
  for (let index = 1; index < versions.length; index += 1) {
    if (compareVersions(versions[index], best) > 0) best = versions[index];
  }
  return best;
}

function unescapeDoubleQuoted(value) {
  return value.replace(/\\n/g, "\n").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
}

function readFrontmatter(raw) {
  const matched = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!matched) return {};
  const data = {};
  for (const line of matched[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const found = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!found) continue;
    let value = found[2].trim();
    if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
      value = unescapeDoubleQuoted(value.slice(1, -1));
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    data[found[1]] = value;
  }
  return data;
}

function loadExisting(releasesDir, warn) {
  if (!fs.existsSync(releasesDir)) return [];
  const names = fs.readdirSync(releasesDir).filter((name) => name.endsWith(".md")).sort();
  const releases = [];
  for (const name of names) {
    const filePath = path.join(releasesDir, name);
    if (!fs.statSync(filePath).isFile()) continue;
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    const data = readFrontmatter(raw);
    const version = data.version == null ? "" : String(data.version).trim();
    if (!version) warn(`跳过 ${name}：没有 version，站点构建时会失败`);
    releases.push({ name, filePath, version });
  }
  return releases;
}

function yamlDoubleQuote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function normalizeBullets(items) {
  const bullets = [];
  for (const item of items) {
    for (const line of String(item).split(/\r?\n/)) {
      let text = line.trim();
      if (!text) continue;
      text = text.replace(/^[-*]\s+/, "").trim();
      if (!text) continue;
      bullets.push(text);
    }
  }
  return bullets;
}

function isValidDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split("-").map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function shanghaiDate(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "";
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  if (!isValidDate(`${year}-${month}-${day}`)) {
    throw new CliError("算不出上海当天的日期");
  }
  return `${year}-${month}-${day}`;
}

function renderMarkdown({ version, title, date, notes, recents }) {
  const lines = [
    "---",
    `version: ${yamlDoubleQuote(version)}`,
    `title: ${yamlDoubleQuote(title)}`,
    `date: ${yamlDoubleQuote(date)}`,
    "---",
    "",
    "## 本次更新：",
    "",
    ...notes.map((note) => `- ${note}`),
  ];
  if (recents.length > 0) {
    lines.push("", "## 近期更新：", "", ...recents.map((item) => `- ${item}`));
  }
  lines.push("");
  return lines.join("\n");
}

function parseArgs(argv) {
  const options = {
    version: undefined,
    bump: undefined,
    date: undefined,
    today: false,
    title: undefined,
    notes: [],
    recents: [],
    force: false,
    dryRun: false,
    help: false,
  };
  const valueFlags = new Map([
    ["--version", "version"],
    ["--bump", "bump"],
    ["--date", "date"],
    ["--title", "title"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (raw === "--") continue;
    let name = raw;
    let inline;
    if (raw.startsWith("--")) {
      const eq = raw.indexOf("=");
      if (eq !== -1) {
        name = raw.slice(0, eq);
        inline = raw.slice(eq + 1);
      }
    }

    const take = () => {
      if (inline !== undefined) return inline;
      const next = argv[index + 1];
      if (next == null || next === "--" || next.startsWith("--")) {
        throw new CliError(`${name} 后面要跟内容`);
      }
      index += 1;
      return next;
    };

    if (name === "--help" || name === "-h") {
      if (inline !== undefined) throw new CliError(`${name} 不接受内容`);
      options.help = true;
    } else if (valueFlags.has(name)) {
      options[valueFlags.get(name)] = take();
    } else if (name === "--note") {
      options.notes.push(take());
    } else if (name === "--recent") {
      options.recents.push(take());
    } else if (name === "--today" || name === "--force" || name === "--dry-run") {
      if (inline !== undefined) throw new CliError(`${name} 不接受内容`);
      if (name === "--today") options.today = true;
      if (name === "--force") options.force = true;
      if (name === "--dry-run") options.dryRun = true;
    } else {
      throw new CliError(`不认识的参数：${raw}`);
    }
  }

  return options;
}

function promptGroups(input, output, prompts) {
  const groups = prompts.map(() => []);
  const rl = readline.createInterface({ input, output, terminal: false });
  let index = 0;
  let settled = false;
  output.write(`${prompts[0]}\n`);
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      if (settled) return;
      settled = true;
      rl.close();
      if (error) reject(error);
      else resolve(groups);
    };
    rl.on("line", (line) => {
      if (settled || !groups[index]) return;
      if (!String(line).trim()) {
        index += 1;
        if (index >= prompts.length) {
          finish();
          return;
        }
        output.write(`${prompts[index]}\n`);
        return;
      }
      groups[index].push(String(line));
    });
    rl.on("close", () => finish());
    rl.on("error", (error) => finish(error));
  });
}

function writeRelease(targetPath, markdown) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tempPath, markdown, "utf8");
    try {
      fs.renameSync(tempPath, targetPath);
    } catch (error) {
      if (!error || (error.code !== "EEXIST" && error.code !== "EPERM")) throw error;
      fs.rmSync(targetPath, { force: true });
      fs.renameSync(tempPath, targetPath);
    }
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function createRelease(targetPath, markdown) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  let fd;
  try {
    fd = fs.openSync(targetPath, "wx");
  } catch (error) {
    if (error && error.code === "EEXIST") {
      throw new CliError(`文件已存在：${targetPath}\n原文件没有改动。要覆盖就加 --force`);
    }
    throw error;
  }
  try {
    fs.writeFileSync(fd, markdown);
  } finally {
    fs.closeSync(fd);
  }
}

async function run(argv, io = {}) {
  const output = io.stdout ?? process.stdout;
  const warn = (message) => {
    const error = io.stderr ?? process.stderr;
    error.write(`${message}\n`);
  };
  const releasesDir = io.releasesDir ?? defaultReleasesDir;
  const now = io.now ?? new Date();
  const interactive = io.interactive ?? Boolean(process.stdin.isTTY);
  const args = parseArgs(argv);

  if (args.help) {
    output.write(helpText);
    return { help: true, wrote: false };
  }
  if (args.version && args.bump) throw new CliError("版本号和 --bump 只能选一个");
  if (args.date && args.today) throw new CliError("日期和 --today 只能选一个");
  if (args.bump && args.bump !== "patch" && args.bump !== "minor" && args.bump !== "major") {
    throw new CliError("--bump 只能是 patch、minor 或 major");
  }

  const existing = loadExisting(releasesDir, warn);
  let version = args.version == null ? "" : String(args.version).trim();
  if (!version) {
    const versions = existing.map((item) => item.version).filter(Boolean);
    if (versions.length === 0) {
      throw new CliError("还没有更新日志，用 --version 指定版本号");
    }
    version = bumpVersion(highestVersion(versions), args.bump || "patch");
  }
  if (!isThreePartVersion(version)) {
    throw new CliError(`版本号格式不对：${version}。用三段数字，例如 1.0.41`);
  }

  const date = args.date == null ? shanghaiDate(now) : String(args.date).trim();
  if (!isValidDate(date)) throw new CliError(`日期格式不对：${date}。用 YYYY-MM-DD`);

  const titleText = args.title == null ? "" : String(args.title).trim();
  if (/[\r\n]/.test(titleText)) throw new CliError("标题不能换行");
  const title = titleText || `小抄 ${version}`;

  const targetPath = path.join(releasesDir, `${version}.md`);
  const duplicate = existing.find((item) => item.version === version && path.resolve(item.filePath) !== path.resolve(targetPath));
  if (duplicate) {
    throw new CliError(`版本 ${version} 已经写在 ${duplicate.filePath} 里。换一个版本号，否则站点构建会失败`);
  }
  const exists = fs.existsSync(targetPath);
  if (exists && !args.force) {
    throw new CliError(`文件已存在：${targetPath}\n原文件没有改动。要覆盖就加 --force`);
  }

  let notes = normalizeBullets(args.notes);
  let recents = normalizeBullets(args.recents);
  if (notes.length === 0 && !interactive) {
    throw new CliError("至少写一条本次更新，用 --note 传入");
  }
  if (notes.length === 0) {
    const prompts = ["本次更新，一行一条，空行结束"];
    if (args.recents.length === 0) {
      prompts.push("近期更新，一行一条，空行结束。没有就直接再按一次回车");
    }
    output.write(`版本：${version}\n日期：${date}\n`);
    const groups = await promptGroups(io.input ?? process.stdin, output, prompts);
    notes = normalizeBullets(groups[0] ?? []);
    if (args.recents.length === 0) recents = normalizeBullets(groups[1] ?? []);
  }
  if (notes.length === 0) throw new CliError("至少写一条本次更新");

  const markdown = renderMarkdown({ version, title, date, notes, recents });
  if (args.dryRun) {
    output.write(`${exists ? "将覆盖" : "将写入"} ${targetPath}\n\n${markdown}`);
    return { path: targetPath, markdown, wrote: false, dryRun: true };
  }

  if (args.force && exists) writeRelease(targetPath, markdown);
  else createRelease(targetPath, markdown);
  output.write(`已写入 ${targetPath}\n`);
  return { path: targetPath, markdown, wrote: true, dryRun: false };
}

async function main() {
  try {
    await run(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliError) {
      console.error(error.message);
      console.error("查看参数：npm run new-release -- --help");
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  CliError,
  compareVersions,
  run,
  shanghaiDate,
};

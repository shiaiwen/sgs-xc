#!/usr/bin/env node
/**
 * 发版后检查 apps/extension 的 version 是否已有 content/releases/<版本>.md。
 * 没有则从 _draft.md 生成；再没有则失败并提示 log:new。
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { run } = require("./new-release.js");

const logRoot = path.resolve(__dirname, "..");
const monoRoot = path.resolve(logRoot, "../..");
const releasesDir = path.join(logRoot, "content", "releases");
const draftPath = path.join(releasesDir, "_draft.md");

function readExtensionVersion() {
  const pkgPath = path.join(monoRoot, "apps", "extension", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const version = String(pkg.version || "").trim();
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`extension package.json 版本号无效：${version}`);
  }
  return version;
}

function parseDraft(raw) {
  const notes = [];
  const recents = [];
  let section = "notes";
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("<!--")) continue;
    if (trimmed.startsWith("#")) {
      if (/近期/.test(trimmed)) section = "recents";
      else if (/本次/.test(trimmed)) section = "notes";
      continue;
    }
    const bullet = trimmed.replace(/^[-*]\s+/, "").trim();
    if (!bullet) continue;
    if (section === "recents") recents.push(bullet);
    else notes.push(bullet);
  }
  return { notes, recents };
}

const draftReset = `<!-- 发版前在这里写条目，一行一条，以 - 开头。npm run release 会自动生成与 package.json 同号的 md 并清空本文件。 -->

`;

async function main() {
  const versionFlag = process.argv.indexOf("--version");
  const version = versionFlag >= 0 && process.argv[versionFlag + 1]
    ? String(process.argv[versionFlag + 1]).trim()
    : readExtensionVersion();

  const targetPath = path.join(releasesDir, `${version}.md`);
  if (fs.existsSync(targetPath)) {
    console.log(`[log] 更新日志已存在：${targetPath}`);
    return;
  }

  if (!fs.existsSync(draftPath)) {
    console.error(`[log] 缺少 ${version}.md，也没有 ${draftPath}`);
    console.error("[log] 发版前请任选一种方式：");
    console.error(`  1. 编辑 content/releases/_draft.md 写 - 条目，再执行 npm run release`);
    console.error(`  2. npm run log:new -- --version ${version} --today --note "说明"`);
    process.exit(1);
  }

  const { notes, recents } = parseDraft(fs.readFileSync(draftPath, "utf8"));
  if (notes.length === 0) {
    console.error("[log] _draft.md 里至少写一条以 - 开头的本次更新");
    process.exit(1);
  }

  const argv = ["--version", version, "--today", ...notes.flatMap((note) => ["--note", note])];
  for (const recent of recents) argv.push("--recent", recent);

  await run(argv, { releasesDir, stdout: process.stdout, interactive: false });
  fs.writeFileSync(draftPath, draftReset, "utf8");
  console.log("[log] 已从 _draft.md 生成更新日志，并清空草稿");
}

main().catch((error) => {
  console.error("[log]", error.message || error);
  process.exit(1);
});

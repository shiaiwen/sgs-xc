"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { PassThrough } = require("node:stream");
const test = require("node:test");
const { CliError, run, shanghaiDate } = require("./new-release.js");

const logRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(__dirname, "new-release.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "log-release-"));
}

function capture() {
  let text = "";
  const stdout = new PassThrough();
  stdout.setEncoding("utf8");
  stdout.on("data", (chunk) => {
    text += chunk;
  });
  return { stdout, read: () => text };
}

function frontmatter(version, date, body = "- 旧条目") {
  return [
    "---",
    `version: "${version}"`,
    `title: "小抄 ${version}"`,
    `date: "${date}"`,
    "---",
    "",
    "## 本次更新：",
    "",
    body,
    "",
  ].join("\n");
}

function expectedMarkdown({ version, title, date, notes, recents }) {
  const lines = [
    "---",
    `version: "${version}"`,
    `title: "${title}"`,
    `date: "${date}"`,
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

test("上海日期跨过零点用东八区日历日", () => {
  assert.equal(shanghaiDate(new Date("2026-10-26T15:59:59.000Z")), "2026-10-26");
  assert.equal(shanghaiDate(new Date("2026-10-26T16:00:00.000Z")), "2026-10-27");
});

test("按参数写出带引号的 frontmatter", async () => {
  const dir = tempDir();
  const io = capture();
  const result = await run(
    ["--version", "1.0.3", "--today", "--note", "修复xxx", "--recent", "优化yyy"],
    { releasesDir: dir, stdout: io.stdout, now: new Date("2026-10-26T16:00:00.000Z"), interactive: false },
  );
  const markdown = expectedMarkdown({
    version: "1.0.3",
    title: "小抄 1.0.3",
    date: "2026-10-27",
    notes: ["修复xxx"],
    recents: ["优化yyy"],
  });
  assert.equal(result.wrote, true);
  assert.equal(result.markdown, markdown);
  assert.equal(fs.readFileSync(result.path, "utf8"), markdown);
  assert.equal(path.basename(result.path), "1.0.3.md");
  assert.match(io.read(), /已写入/);
});

test("没有近期更新就不写这一节", async () => {
  const dir = tempDir();
  const result = await run(
    ["--version", "1.0.3", "--date", "2026-10-27", "--note", "修复xxx", "--note", "- 再补一条"],
    { releasesDir: dir, stdout: capture().stdout, interactive: false },
  );
  assert.equal(result.markdown, expectedMarkdown({
    version: "1.0.3",
    title: "小抄 1.0.3",
    date: "2026-10-27",
    notes: ["修复xxx", "再补一条"],
    recents: [],
  }));
  assert.equal(result.markdown.includes("近期更新"), false);
});

test("不写版本号时按最高版本递增 patch，1.0.10 高于 1.0.2", async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "1.0.2.md"), frontmatter("1.0.2", "2026-10-18"));
  fs.writeFileSync(path.join(dir, "old.md"), frontmatter("1.0.10", "2026-01-01"));
  const result = await run(
    ["--note", "修复xxx", "--date", "2026-10-27"],
    { releasesDir: dir, stdout: capture().stdout, interactive: false },
  );
  assert.equal(path.basename(result.path), "1.0.11.md");
  assert.match(result.markdown, /version: "1.0.11"/);
});

test("minor 和 major 从最高版本递增", async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "1.4.8.md"), frontmatter("1.4.8", "2026-10-18"));
  const minor = await run(
    ["--bump", "minor", "--note", "甲", "--date", "2026-10-27"],
    { releasesDir: dir, stdout: capture().stdout, interactive: false },
  );
  assert.equal(path.basename(minor.path), "1.5.0.md");
  const major = await run(
    ["--bump", "major", "--note", "乙", "--date", "2026-10-27"],
    { releasesDir: dir, stdout: capture().stdout, interactive: false },
  );
  assert.equal(path.basename(major.path), "2.0.0.md");
});

test("同名文件没有 --force 时失败且不改内容", async () => {
  const dir = tempDir();
  const target = path.join(dir, "1.0.2.md");
  const original = frontmatter("1.0.2", "2026-10-18");
  fs.writeFileSync(target, original);
  await assert.rejects(
    () => run(
      ["--version", "1.0.2", "--note", "新条目", "--date", "2026-10-27"],
      { releasesDir: dir, stdout: capture().stdout, interactive: false },
    ),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.match(error.message, /已存在/);
      assert.match(error.message, /没有改动/);
      return true;
    },
  );
  assert.equal(fs.readFileSync(target, "utf8"), original);
});

test("--force 只覆盖同名文件", async () => {
  const dir = tempDir();
  const target = path.join(dir, "1.0.3.md");
  const sibling = path.join(dir, "1.0.2.md");
  const siblingBody = frontmatter("1.0.2", "2026-10-18");
  fs.writeFileSync(target, frontmatter("1.0.3", "2026-10-01", "- 旧"));
  fs.writeFileSync(sibling, siblingBody);
  const result = await run(
    ["--version", "1.0.3", "--note", "新条目", "--date", "2026-10-27", "--force"],
    { releasesDir: dir, stdout: capture().stdout, interactive: false },
  );
  assert.match(result.markdown, /- 新条目/);
  assert.equal(fs.readFileSync(target, "utf8"), result.markdown);
  assert.equal(fs.readFileSync(sibling, "utf8"), siblingBody);
});

test("别的文件里已经有这个版本时拒绝，--force 也不写", async () => {
  const dir = tempDir();
  const other = path.join(dir, "notes.md");
  const original = frontmatter("1.0.3", "2026-10-01");
  fs.writeFileSync(other, original);
  await assert.rejects(
    () => run(
      ["--version", "1.0.3", "--note", "新条目", "--date", "2026-10-27", "--force"],
      { releasesDir: dir, stdout: capture().stdout, interactive: false },
    ),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.match(error.message, /notes\.md/);
      return true;
    },
  );
  assert.equal(fs.existsSync(path.join(dir, "1.0.3.md")), false);
  assert.equal(fs.readFileSync(other, "utf8"), original);
});

test("--dry-run 只打印不写盘", async () => {
  const dir = tempDir();
  const io = capture();
  const result = await run(
    ["--version", "1.0.3", "--date", "2026-10-27", "--note", "修复xxx", "--dry-run"],
    { releasesDir: dir, stdout: io.stdout, interactive: false },
  );
  assert.equal(result.wrote, false);
  assert.equal(fs.existsSync(result.path), false);
  assert.match(io.read(), /将写入/);
  assert.match(io.read(), /version: "1.0.3"/);
  assert.match(io.read(), /- 修复xxx/);
});

test("已存在的文件加 --dry-run 且没有 --force 时不打印成将覆盖", async () => {
  const dir = tempDir();
  const target = path.join(dir, "1.0.3.md");
  const original = frontmatter("1.0.3", "2026-10-01");
  fs.writeFileSync(target, original);
  await assert.rejects(
    () => run(
      ["--version", "1.0.3", "--note", "新", "--date", "2026-10-27", "--dry-run"],
      { releasesDir: dir, stdout: capture().stdout, interactive: false },
    ),
    (error) => error instanceof CliError,
  );
  assert.equal(fs.readFileSync(target, "utf8"), original);
});

test("非交互且没有本次更新时失败", async () => {
  const dir = tempDir();
  await assert.rejects(
    () => run(
      ["--version", "1.0.3", "--date", "2026-10-27", "--recent", "只有近期"],
      { releasesDir: dir, stdout: capture().stdout, interactive: false },
    ),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.match(error.message, /本次更新/);
      return true;
    },
  );
  assert.equal(fs.readdirSync(dir).length, 0);
});

test("交互补全本次更新和近期更新", async () => {
  const dir = tempDir();
  const input = new PassThrough();
  const io = capture();
  const pending = run(
    ["--version", "2.0.0", "--date", "2026-10-27"],
    { releasesDir: dir, stdout: io.stdout, input, interactive: true },
  );
  input.end("第一条\n第二条\n\n近期一条\n\n");
  const result = await pending;
  assert.equal(result.markdown, expectedMarkdown({
    version: "2.0.0",
    title: "小抄 2.0.0",
    date: "2026-10-27",
    notes: ["第一条", "第二条"],
    recents: ["近期一条"],
  }));
  assert.equal(fs.readFileSync(result.path, "utf8"), result.markdown);
});

test("自定义标题里的引号会转义", async () => {
  const dir = tempDir();
  const result = await run(
    ["--version", "1.2.0", "--date", "2026-10-27", "--title", "他说\"好\"", "--note", "甲"],
    { releasesDir: dir, stdout: capture().stdout, interactive: false },
  );
  assert.match(result.markdown, /title: "他说\\"好\\""/);
});

test("非法日期、非法版本、版本和 bump 同时出现都会拒绝", async () => {
  const dir = tempDir();
  const base = { releasesDir: dir, stdout: capture().stdout, interactive: false };
  await assert.rejects(
    () => run(["--version", "1.0.3", "--date", "2026-02-31", "--note", "甲"], base),
    (error) => error instanceof CliError,
  );
  await assert.rejects(
    () => run(["--version", "1.0", "--date", "2026-10-27", "--note", "甲"], base),
    (error) => error instanceof CliError,
  );
  await assert.rejects(
    () => run(["--version", "01.0.3", "--date", "2026-10-27", "--note", "甲"], base),
    (error) => error instanceof CliError,
  );
  await assert.rejects(
    () => run(["--version", "1.0.3", "--bump", "patch", "--note", "甲"], base),
    (error) => error instanceof CliError,
  );
  assert.equal(fs.existsSync(path.join(dir, "1.0.3.md")), false);
});

test("命令行直接跑：重复版本失败，试运行不落盘", () => {
  const sample = path.join(logRoot, "content", "releases", "1.0.2.md");
  const before = fs.readFileSync(sample);
  const rejected = spawnSync(process.execPath, [
    scriptPath,
    "--version",
    "1.0.2",
    "--note",
    "不要写入",
    "--date",
    "2026-10-27",
  ], { cwd: logRoot, encoding: "utf8" });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /已存在/);
  assert.equal(fs.readFileSync(sample).equals(before), true);

  const preview = path.join(logRoot, "content", "releases", "9.9.9.md");
  const dry = spawnSync(process.execPath, [
    scriptPath,
    "--version",
    "9.9.9",
    "--note=试运行",
    "--dry-run",
    "--date",
    "2026-10-27",
  ], { cwd: logRoot, encoding: "utf8" });
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /将写入/);
  assert.match(dry.stdout, /version: "9.9.9"/);
  assert.equal(fs.existsSync(preview), false);
});

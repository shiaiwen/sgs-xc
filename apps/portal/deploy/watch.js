/**
 * 保存后自动构建并上传 dist。
 * 用法：在本项目目录执行 npm run sync，这个窗口保持开着。
 */
const { spawn } = require("node:child_process");
const { watch } = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
let timer = null;
let running = false;
let queued = false;

function schedule() {
  queued = true;
  clearTimeout(timer);
  timer = setTimeout(flush, 800);
}

function flush() {
  if (!queued) return;
  if (running) return;
  queued = false;
  running = true;
  const child = spawn(process.execPath, ["deploy/push.js"], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => {
    running = false;
    if (code !== 0) console.error("同步失败，改完再保存一次即可重试");
    if (queued) flush();
  });
}

function bind(relativePath) {
  watch(path.join(rootDir, relativePath), { recursive: true }, () => schedule());
}

bind("src");
bind("content");
bind("public");
watch(path.join(rootDir, "next.config.ts"), () => schedule());
console.log(
  "正在监听。保存 src、content 或 public 后会自动同步到服务器，这个窗口不要关。",
);

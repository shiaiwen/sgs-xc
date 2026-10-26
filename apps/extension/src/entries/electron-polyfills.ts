/**
 * 微端 webview 的 Chromium 可能低于 98，需在其它模块执行前补齐缺失的全局 API。
 * 油猴入口也会先 import 本文件，避免老内核上配置克隆报错。
 *
 * 注意：JSON 回环无法保留 Date / undefined / 循环引用；小抄配置值均为纯 JSON，足够用。
 */
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <T>(value: T): T =>
    JSON.parse(JSON.stringify(value)) as T;
}

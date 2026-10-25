/**
 * 微端 webview 的 Chromium 可能低于 98，需在其它模块执行前补齐缺失的全局 API。
 */
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <T>(value: T): T =>
    JSON.parse(JSON.stringify(value)) as T;
}

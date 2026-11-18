/** 门户全局字体：Windows 用微软雅黑，苹果用苹方，带空格的族名须用引号。 */
export const PORTAL_FONT_FAMILY =
  '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Segoe UI", sans-serif';

/** 压过 Tailwind 预置的 html 字体。 */
export const PORTAL_FONT_CRITICAL_CSS = `html,body{font-family:${PORTAL_FONT_FAMILY}!important;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}`;

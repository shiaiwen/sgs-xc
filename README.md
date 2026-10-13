# 小抄门户

提供新版小抄下载，并用 Markdown 维护二级文章页。页面在构建时静态生成，带标题、描述、站点地图和 robots，方便搜索引擎收录。

## 本地运行

```bash
npm run dev
```

浏览器打开 http://localhost:3000 。

## 新增一篇文章

在 `content/pages` 新建 `文件名.md`。文件名就是路径，例如 `about.md` 对应 `/about`。

```md
---
title: 关于我
description: 页面简介，会写入 meta description。
updated: 2026-09-30
---

正文支持标题、列表、表格和代码块。
```

首页导航里的「关于我」指向 `/about`。要加新入口，改 `src/components/site-header.tsx` 里的链接。

## 上线前

把 `src/lib/site.ts` 里的 `url` 改成正式域名，站点地图和规范链接会跟着变。

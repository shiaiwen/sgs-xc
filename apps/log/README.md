# 小抄更新日志

静态站点，域名 [https://log.95chong.cn](https://log.95chong.cn)。页面在构建时生成。左侧是版本列表，右侧是该版本的说明。

## 本地运行

在仓库根目录执行：

```bash
npm run dev:log
```

浏览器打开 http://localhost:3010 。

## 新增一版

在 `content/releases` 新建一个 `.md` 文件。文件名随意，建议用版本号，例如 `1.0.3.md`。版本号和日期写在开头，正文用 Markdown。

```md
---
version: "1.0.3"
title: "小抄 1.0.3"
date: "2026-10-27"
---

## 本次更新：

- 写下这一版改了什么。

## 近期更新：

- 补一条稍早的变化。没有就删掉这一节。
```

`version` 和 `date` 必填，并且都要加引号。`title` 不写时，页面标题用「小抄」加版本号。

列表按日期从新到旧排。同一天再按版本号从高到低排。版本号不要重复，重复时构建会失败。

仓库里自带的 `1.0.2.md`、`1.0.1.md`、`1.0.0.md` 是示例，发布前改成真实记录或删掉。

## 部署

1. DNS 给 `log.95chong.cn` 加一条 A 记录，指向和门户同一台机器。
2. 确认服务器证书包含 `log.95chong.cn`。参考配置沿用 `/etc/nginx/ssl/fullchain.cer` 和 `/etc/nginx/ssl/95chong.cn.key`，只有证书里已经有这个域名时才能直接用。
3. 把 `deploy/log.nginx.conf` 放到服务器 Nginx 配置目录，然后重载 Nginx。站点目录是 `/opt/log/dist`。
4. 在 `apps/log` 执行 `npm run deploy`。脚本会先构建，再上传到服务器。

默认上传到 `admin@123.56.3.130:/opt/log`。要换机器或目录，设置 `LOG_SSH` 和 `LOG_REMOTE`。没设 `LOG_SSH` 时会沿用 `XC_SSH`。

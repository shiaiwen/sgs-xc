# 小抄更新日志

静态站点，域名 [https://log.95chong.cn](https://log.95chong.cn)。页面在构建时生成。左侧是版本列表，右侧是该版本的说明。

## 本地运行

在仓库根目录执行：

```bash
npm run dev:log
```

浏览器打开 http://localhost:3010 。

## 用命令生成

在 `apps/log` 目录执行：

```bash
npm run new-release -- --version 1.0.4 --today --note "修复记牌闪一下" --recent "下载页补了安装说明"
```

仓库根目录用下面这条，参数相同：

```bash
npm run log:new -- --version 1.0.4 --today --note "修复记牌闪一下" --recent "下载页补了安装说明"
```

不写 `--version` 时，按 `content/releases` 里最高的版本号把最后一段加一。现有最高是 `1.0.3` 时，会生成 `1.0.4`。`--bump minor` 升中间那段，`--bump major` 升第一段。

`--note` 是本次更新，`--recent` 是近期更新，都可以重复，一次一条。不写 `--recent`，文件里就没有近期更新这一节。日期不写就是上海当天，也可以用 `--date 2026-10-27`。

同名文件已经存在时，命令会失败，原来的文件不动。确定要重写再加 `--force`。只看内容、不写文件，加 `--dry-run`。

不带 `--note`，并且是在本机终端里直接运行时，会一行一行询问，空行结束。

## 新增一版

也可以自己在 `content/releases` 新建 `.md`。文件名随意，建议用版本号，例如 `1.0.3.md`。上面的命令会写成 `<版本号>.md`。版本号和日期写在开头，正文用 Markdown。

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

## 部署

1. DNS 给 `log.95chong.cn` 加一条 A 记录，指向和门户同一台机器。
2. 确认服务器证书包含 `log.95chong.cn`。参考配置沿用 `/etc/nginx/ssl/fullchain.cer` 和 `/etc/nginx/ssl/95chong.cn.key`，只有证书里已经有这个域名时才能直接用。
3. 把 `deploy/log.nginx.conf` 放到服务器 Nginx 配置目录，然后重载 Nginx。站点目录是 `/opt/log/dist`。
4. 在 `apps/log` 执行 `npm run deploy`。脚本会先构建，再上传到服务器。

默认上传到 `admin@123.56.3.130:/opt/log`。要换机器或目录，设置 `LOG_SSH` 和 `LOG_REMOTE`。没设 `LOG_SSH` 时会沿用 `XC_SSH`。

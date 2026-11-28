# 小抄服务端

给小抄客户端提供礼包码和版本清单。进程读 `data/` 里的 JSON，改文件后下次请求即生效，不用改代码。礼包码另有每小时的自动刷新，见下面接口一节。

线上地址是 `https://95chong.cn`，Nginx 把 `/api/` 转到服务器本机的 `127.0.0.1:8787`。代码在 `/opt/sgs-xc-server`，用 pm2 进程名 `sgs-xc-server` 跑。

## 本地

需要 Node.js 18+。

```bash
npm install
npm start
```

默认监听 `http://127.0.0.1:8787`。换端口时设置 `PORT`。

## 接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/health` | 健康检查，返回 `{ "ok": true }` |
| GET | `/api/game-gift-codes` | 礼包码列表 |
| GET | `/api/xiaochao-version` | 小抄版本清单 |
| GET | `/api/account-config?account=登录账号&userId=用户编号` | 读这个账号的开关和小抄背景 |
| POST | `/api/account-config` | 把客户端的开关和小抄背景逐项并进库里 |
| GET | `/api/account-skins?account=登录账号&userId=用户编号` | 读这个账号在皮肤解锁里选好的皮肤 |
| POST | `/api/account-skins` | 把客户端的皮肤记录并进库里 |
| POST | `/api/account-reset` | 重置小抄时清掉这个账号的开关、背景和皮肤记录 |

`/api/game-gift-codes` 返回 `ok`、`version`、`updatedAt`、`upstreamUpdatedAt`、`count` 和 `codes`。每条礼包码有 `id` 和 `code`。

礼包码每 `3600` 秒拉一次上游 `https://xiaochao.org/api/game-gift-codes`，启动时先拉一次。拉到的码写进 `data/gift-codes-upstream.json`，接口把它排前面，`data/gift-codes.json` 里手写的码补在后面，同一个码只留一条。上游拉不动时保留上一份缓存，缓存也没有才只返回手写的那份。所以要临时加码，改 `data/gift-codes.json` 即可；上游已经下架、但手写文件里还留着的码仍会返回，需要自己删掉。

换上游地址设 `GIFT_CODE_UPSTREAM_URL`，换刷新间隔设 `GIFT_CODE_REFRESH_MS`。`data/gift-codes-upstream.json` 是运行时缓存，不进版本库。

`/api/xiaochao-version` 读 `data/xiaochao-manifest.json`，返回 `version`、`notes`、`pageUrl`、`appUrl`、`appSha256`。文件缺失或内容不是 JSON 时返回 `{ "ok": false }`，状态码 404。

账号相关的三个接口存在 Postgres 的 `account_config`、`account_skins` 表里，`account` 列是游戏的登录账号，统一转成小写。表和新加的列不存在时第一次请求自动建。连接串读环境变量 `DATABASE_URL`，写在服务目录的 `.env` 里也行。没配时只有这几个接口报错，礼包码和版本清单照常。小抄按纯文本发 JSON 正文，浏览器不用先发跨域询问，服务端不看内容类型。

以前这两张表按游戏用户编号存。新服务第一次启动时把它们改名成 `account_config_legacy`、`account_skins_legacy`，再建空的新表。请求里同时带了 `account` 和 `userId` 的是新版小抄：库里按登录账号存，旧表里这个编号的那一行读写时并进新表，并完删掉。只带 `account` 的是旧版小抄，那时发的是用户编号，照旧读写旧表。

`/api/account-config` 的 POST 内容是 `{ "account", "userId", "document" }`。`document` 是 `{ "version": 2, "settings": {...}, "background": {...} }`，每一项是 `{ "value", "savedAt" }`。同一项库里和传上来的都有时留 `savedAt` 大的，一样大时留库里的，返回合并后的整份。别的版本的旧文档当作空的。

`/api/account-skins` 的 POST 内容是 `{ "account", "userId", "skins" }`，`skins` 按武将编号存 `skinID`、`isDynamic`、`savedAt`。同一个武将库里和传上来的都有时，留 `savedAt` 大的，返回合并后的整份。

`/api/account-reset` 的 POST 内容是 `{ "account", "userId", "resetAt" }`。两张表都记下 `reset_at`，`savedAt` 不晚于它的项删掉，以后传上来也不收。读和写的返回里都带 `resetAt`，小抄读到后把本机重置以前的改动改回默认。

## 工单附件保留与清理

工单存储在 `data/feedback-tickets.json`，附件存储在 `data/feedback-attachments/<token>/`。
只有 `fixed`（已修复）和 `rejected`（不采纳）状态的附件会过期，完成后保留 30 天；后补上传的附件从上传时间起保留 30 天。
修改处理说明或在两种结束状态之间切换不会重置期限。重新进入 `received` 或 `processing` 会取消清理计时，再次处理完成时重新计时。
已有的结束工单缺少完成时间时，从首次检查起获得完整的 30 天保留期。

管理端 `PATCH /admin/feedback/:token` 可传 `{"retainAttachments":true}` 保留重要附件，传 `false` 恢复按原期限清理。

门户工单管理登录在环境变量中配置 `FEEDBACK_ADMIN_USERNAME` 与 `FEEDBACK_ADMIN_PASSWORD`，调用 `POST /admin/feedback/login` 获取 `sessionToken`，后续管理接口在 `Authorization: Bearer` 里带上该令牌，有效期 24 小时。清理脚本等自动化仍可使用 `FEEDBACK_ADMIN_TOKEN`。保留标记和重新打开均无法恢复已经删除的文件。

服务监听成功后检查一次，之后每 24 小时检查一次。清理保留工单文字、处理说明、修复版本和附件名称，只删除附件文件并记录 `deletedAt`。
公开查询不再给已清理附件返回下载地址，原下载地址返回 HTTP 410。删除失败不标记成功，下次检查重试。

在仓库根目录可手动预览或执行，预览不会修改任何工单和附件。
实际执行需先启动本地服务，并在命令终端设置与服务一致的 `FEEDBACK_ADMIN_TOKEN`（自定义端口也需设置相同的 `PORT`）；命令通过受保护的 `POST /admin/feedback-attachments/cleanup` 接口执行，避免独立进程并发改写工单 JSON：

```bash
npm run cleanup:feedback -w apps/server -- --dry-run
npm run cleanup:feedback -w apps/server
npm run test:feedback -w apps/server
```

部署不会上传本地的 `feedback-tickets.json` 和附件目录，避免覆盖线上工单及清理记录。
此清理任务只管理服务的附件目录；外部备份应另行设置保留期限，避免过期附件在备份中长期累积。

## 发布

周年庆互助的接口、账本规则、迁移步骤和未验证项见 [周年庆互助接入说明](src/anniversary-assist/README.md)。
该模块不再自动创建表，启用前需要显式执行数据迁移；本地开发期间不直接操作线上账本。

本机已能 SSH 到 `admin@123.56.3.130` 时：

```bash
npm run deploy
```

脚本会把源码和 `data/` 上传到 `/opt/sgs-xc-server` 并执行 `npm ci --omit=dev`。它不负责拉起进程。上传后在服务器上重启：

```bash
pm2 restart sgs-xc-server
```

第一次启动：

```bash
cd /opt/sgs-xc-server
PORT=8787 pm2 start src/index.js --name sgs-xc-server
pm2 save
```

换机器或目录时设置 `SGS_XC_SSH`、`SGS_XC_REMOTE`。

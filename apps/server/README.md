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
| GET | `/api/account-config?account=账号` | 读这个游戏账号的开关和小抄背景 |
| POST | `/api/account-config` | 把客户端的开关和小抄背景逐项并进库里 |
| GET | `/api/account-skins?account=账号` | 读这个游戏账号在皮肤解锁里选好的皮肤 |
| POST | `/api/account-skins` | 把客户端的皮肤记录并进库里 |
| POST | `/api/account-reset` | 重置小抄时清掉这个账号的开关、背景和皮肤记录 |

`/api/game-gift-codes` 返回 `ok`、`version`、`updatedAt`、`upstreamUpdatedAt`、`count` 和 `codes`。每条礼包码有 `id` 和 `code`。

礼包码每 `3600` 秒拉一次上游 `https://xiaochao.org/api/game-gift-codes`，启动时先拉一次。拉到的码写进 `data/gift-codes-upstream.json`，接口把它排前面，`data/gift-codes.json` 里手写的码补在后面，同一个码只留一条。上游拉不动时保留上一份缓存，缓存也没有才只返回手写的那份。所以要临时加码，改 `data/gift-codes.json` 即可；上游已经下架、但手写文件里还留着的码仍会返回，需要自己删掉。

换上游地址设 `GIFT_CODE_UPSTREAM_URL`，换刷新间隔设 `GIFT_CODE_REFRESH_MS`。`data/gift-codes-upstream.json` 是运行时缓存，不进版本库。

`/api/xiaochao-version` 读 `data/xiaochao-manifest.json`，返回 `version`、`notes`、`pageUrl`、`appUrl`、`appSha256`。文件缺失或内容不是 JSON 时返回 `{ "ok": false }`，状态码 404。

账号相关的三个接口存在 Postgres 的 `account_config`、`account_skins` 表里，表和新加的列不存在时第一次请求自动建。连接串读环境变量 `DATABASE_URL`，写在服务目录的 `.env` 里也行。没配时只有这几个接口报错，礼包码和版本清单照常。小抄按纯文本发 JSON 正文，浏览器不用先发跨域询问，服务端不看内容类型。

`/api/account-config` 的 POST 内容是 `{ "account", "document" }`。`document` 是 `{ "version": 2, "settings": {...}, "background": {...} }`，每一项是 `{ "value", "savedAt" }`。同一项库里和传上来的都有时留 `savedAt` 大的，一样大时留库里的，返回合并后的整份。别的版本的旧文档当作空的。

`/api/account-skins` 的 POST 内容是 `{ "account", "skins" }`，`skins` 按武将编号存 `skinID`、`isDynamic`、`savedAt`。同一个武将库里和传上来的都有时，留 `savedAt` 大的，返回合并后的整份。

`/api/account-reset` 的 POST 内容是 `{ "account", "resetAt" }`。两张表都记下 `reset_at`，`savedAt` 不晚于它的项删掉，以后传上来也不收。读和写的返回里都带 `resetAt`，小抄读到后把本机重置以前的改动改回默认。

## 发布

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

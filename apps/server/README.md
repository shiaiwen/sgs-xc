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

`/api/game-gift-codes` 返回 `ok`、`version`、`updatedAt`、`upstreamUpdatedAt`、`count` 和 `codes`。每条礼包码有 `id` 和 `code`。

礼包码每 `3600` 秒拉一次上游 `https://xiaochao.org/api/game-gift-codes`，启动时先拉一次。拉到的码写进 `data/gift-codes-upstream.json`，接口把它排前面，`data/gift-codes.json` 里手写的码补在后面，同一个码只留一条。上游拉不动时保留上一份缓存，缓存也没有才只返回手写的那份。所以要临时加码，改 `data/gift-codes.json` 即可；上游已经下架、但手写文件里还留着的码仍会返回，需要自己删掉。

换上游地址设 `GIFT_CODE_UPSTREAM_URL`，换刷新间隔设 `GIFT_CODE_REFRESH_MS`。`data/gift-codes-upstream.json` 是运行时缓存，不进版本库。

`/api/xiaochao-version` 读 `data/xiaochao-manifest.json`，返回 `version`、`notes`、`pageUrl`、`appUrl`、`appSha256`。文件缺失或内容不是 JSON 时返回 `{ "ok": false }`，状态码 404。

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

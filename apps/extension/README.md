# 三国杀小抄

为三国杀 OL 提供微端脚本和浏览器 userscript。功能代码位于 `src/`，打包时会同时生成两种版本。

## 开发

```powershell
npm install
npm run dev              # 启动本地微端开发环境
npm run dev:userscript   # 启动浏览器脚本开发服务器
```

主要目录：

| 目录 | 用途 |
| --- | --- |
| `src/entries` | 微端和浏览器脚本入口 |
| `src/core` | 启动、配置和功能装配 |
| `src/features` | 游戏功能 |
| `src/adapters` | 游戏和平台适配 |
| `src/ui` | 设置面板 |
| `tools/release-app-shell` | 随微端安装包发布的壳程序 |

## 版本

- 根目录 `package.json` 的 `version` 是小抄脚本版本。打包后写入脚本 `@version` 和服务端版本清单。
- `tools/release-app-shell/package.json` 的 `version` 是微端壳版本。只更新脚本功能时不需要修改它。
- 发布版本必须高于线上 API 清单的版本：<https://95chong.cn/api/xiaochao-version>。

## 发布

1. 将根目录 `package.json` 的 `version` 改为高于线上版本的三段号。

2. 在本仓库根目录打包并复制门户文件。两条也可以合成 `npm run pack:portal`：

   ```powershell
   npm run pack
   npm run copy:portal
   ```

   `pack` 会构建微端脚本和 userscript，生成：

   - `release/wd-xc-<版本>.zip`：微端手动安装包。
   - `release/app.zip`：微端自动更新包。
   - `release/xiaochao-manifest.json`：版本、下载地址和 `app.zip` 校验值。
   - `dist/userscript/xiaochao.user.js`：浏览器 userscript。

   `copy:portal` 将安装包、清单和 userscript 复制到 `../portal/public/downloads`（monorepo 内的门户下载目录）。它会先删除该目录里的旧 `.zip` 文件，再放入本版安装包。

3. 发布到线上。在 monorepo 根目录（`sgs-xc`）执行一条命令：

   ```powershell
   npm run release
   ```

   它按顺序完成：打包小抄 → 拷贝到门户下载目录 → 上传门户下载文件（`apps/portal` 的 `deploy:downloads`）→ 上传版本服务（`apps/server` 的 `deploy`）。顺序固定不可分割，缺一步线上就会版本不一致。

   只想本地打包不上传时，才单独执行 `npm run pack`。

4. 把刚打好的包装进本机微端（可选，本机自测用）。先完全退出 `SGSOL.exe`，再在本目录执行：

   ```powershell
   npm run deploy
   ```

   需要管理员权限。`npm run deploy` 执行 `tools/deploy-release.js`：打包 `release/wd-xc-<版本>.zip`（已打包过可加 `--no-pack`）、解压到 `C:\Program Files\SGSOL\resources`，并把 `xiaochao.js` 覆盖到 `%APPDATA%\SGSOL\xiaochao`。装完重新打开微端。

   门户页面代码有改动时，才使用 `npm run deploy -w apps/portal` 发布整站。版本服务的 API 每次请求都会读取清单文件，上传后无需重启。

5. 确认以下地址已返回新版本和对应文件：

   - <https://95chong.cn/api/xiaochao-version>：更新检查使用的 API 清单，必须同步。
   - <https://xc.95chong.cn/downloads/manifest.json>：下载页用它选择版本化的微端安装包。
   - <https://xc.95chong.cn/downloads/sgs-xc.user.js>：浏览器脚本。

微端启动时通过 API 检查版本；发现新版本后，用户确认并通过 Windows UAC，微端才会替换安装文件。浏览器脚本的检查更新按钮也读取 API 清单；Tampermonkey 根据脚本的 `@updateURL` 更新脚本。

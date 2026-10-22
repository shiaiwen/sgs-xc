# 小抄参考脚本锚点索引

本地镜像路径：`apps/extension/.dev-data/appbak/`。生成命令：

```bash
cd apps/extension && node tools/refresh-reference-reverse.js
```

默认 zip 见仓库规则 `reference-xiaochao-zip.mdc`。`REFERENCE_MANIFEST.json` 记录本次解包版本与 SHA256。

行号以 **1.6.31** 的 `xiaochao-pretty.js` 为准；换 zip 后需重新跑刷新脚本并核对行号。

## 自动领取

| 符号 / 行为 | 约略行号 | 说明 |
| --- | ---: | --- |
| `N4` | 16203–16206 | 囤粮令 `SendDDZTLLAwardReq`；`autoTaskSkipHuanLeDouSwitch` 为真时直接 return |
| `HG` 活动批 | 19031–19038 | `N4(Hl)` 与任务循环并列；任务循环里 `NA` + `autoTaskSkipHuanLeDouSwitch` |
| `Nu` / `NA` | 16497–16502 | 任务奖励是否含武将 / 欢乐豆类物品 |
| `Fi` / `Fh` | 16154–16172 | 按奖励名与物品 id 判断欢乐豆 |
| `N0` | 16174–16178 | 合并「跳过武将」「跳过欢乐豆」领奖过滤 |

## 狗托 / 系统公告跑马灯

| 符号 / 行为 | 约略行号 | 说明 |
| --- | ---: | --- |
| `FV` 协议名列表 | 15835 | `CHAT_MARQUEE_*` |
| `FD` | 15847–15852 | 找带 `ShowMarquee` / `HideAllMarquee` 的 manager |
| `FG` / `Fu` / `FA` | 15870–15976 | 顶部广播 UI 隐藏与恢复；日志文案含「系统公告屏蔽」 |
| `FB` | 15978+ | 包装 Show/Hide，触发 `FA` 同步 |

## 官服九五折充值

| 符号 / 行为 | 约略行号 | 说明 |
| --- | ---: | --- |
| `u8` | 22102–22113 | 仅游卡官服、`ChannelId` 为 1000/209488/1074/110074、区号 1100、非调试/体验服时返回 `LoginManager.YokaAcc` |
| `u9` | 22116–22145 | 在 `RechargeWindow` 上挂「官服95折」入口，参考脚本打开 `https://cz.xiaochao.org/#account=`。本项目改为打开 `https://95chong.cn/#account=` |
| `ux` | 22148–22185 | 包装 `enterWindow` / `destroy` |

本项目把按钮贴在「立即充值」左边，宽高和外观跟立即充值同一套，不再叠在按钮上方。

## 局后结算

官网日志 **1.6.29 → 1.6.30** 写明「回撤一些局后结算屏蔽」；**1.6.26** 有「快速跳过局后结算」、**1.6.27** 山河图结算卡住修复。zip 仍为 1.6.31 时，以 `updates.txt` 中 1.6.29 之后条目对照本项目 `block-effects` / 自动托管关窗逻辑，不要只按更旧压缩包行为改。

## 明牌协议入口

混淆后协议名常不可直接 grep。明牌分支清单见 `.cursor/rules/mingpai-branch-inventory.mdc`；深度规格在 `.dev-data/mingpai-spec/`（需单独维护，不进 git）。

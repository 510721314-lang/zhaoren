# 2026-10-30 · 首页加载问题排查（未闭环）

## 1. 目标

用户报「测试首页加载问题」。目标：判断首页冷启动是否有回归（白屏/内容旧/报错），并给出可复现证据。

## 2. 结论

- **未能完成自动化实测**：miniprogram-automator 连上 IDE 后 RPC 无响应，属工具链问题，**不是应用代码问题**。
- **静态核对未发现本轮改动（`4ed79df` 首页角标）引入阻塞**：新增的 `refreshNoticeBadge()` 是异步 `peek_login`，不阻塞首屏渲染；代价是冷启动**多一次云调用**（`fetchUser` 已调一次 peek，onShow 再调一次）。属可优化项，非缺陷。
- 用户未提供具体症状（白屏久 / 内容旧 / 报错 / 仅跑测试），**问题现象仍待澄清**。

## 3. 证据（命令与实测值）

| 步骤 | 命令 | 实测 |
|---|---|---|
| 1 | `npm run test:e2e` | 失败：`[load-env] cliPath 不存在: C:\Users\Administrator\Desktop\微信WEB开发者工具\cli.bat`（`.env` 陈旧路径） |
| 2 | 覆盖 `WX_DEVTOOLS_CLI_PATH="C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"` 后重跑 | 失败：`✖ CLI auto 失败: 'C:\Program' is not recognized`（`e2e-smoke.js` 用 `execFileSync(..., {shell:true})` 未给含空格路径加引号） |
| 3 | 绕过脚本直接跑 `cli.bat auto --project "C:\zhaoren" --auto-port 9420` | `✔ auto` |
| 4 | 临时脚本连 `ws://127.0.0.1:9420`（位于 `%TEMP%`，未入库） | `connected` 成功；`mp.currentPage()` 与 `page.data()` 均 **`timeout waiting for automator response`**（等 10s + 重试 5 次，两次运行结果一致） |
| 5 | 首页冷启动请求序列（静态核对 `pages-v2/index/index.js`） | onLoad L115 `peek_login` + L116 `fetchSquare(true)`；首次 onShow L189 `refreshNoticeBadge`（又一次 `peek_login`）；L219 `fetchSquare`；耍伴端 L216 `startNearbyPoll` + `fetchNearby` |

判定：IDE 自动化 RPC 层不响应（疑似开发者工具已占用 45353 服务端口 / 模拟器卡住），非仓库代码问题。

## 4. 改动与提交

- **零代码改动**。本轮相关代码已在此前提交：`4ed79df`（`refreshNoticeBadge`）、`f3e6def`（批4+批5）。
- 本文件为唯一新增 docs 制品。

## 5. 未决项

1. 首页加载问题的**具体症状**未确认（需用户回答 A 白屏久 / B 内容旧 / C 报错 / D 仅跑测试）。
2. `scripts/e2e-smoke.js` 的 Windows 路径引号缺陷与 `.env` 陈旧 `WX_DEVTOOLS_CLI_PATH` **未修**（会影响下次自动化冒烟）。
3. 可选优化：`fetchUser` 内设 `this.__badgeAt`，避免冷启动两次 `peek_login`。

## 6. 下次入口

1. 用户关掉开发者工具窗口后重开，再跑 `cli.bat auto --project "C:\zhaoren" --auto-port 9420` + 临时探测脚本（若 RPC 仍超时，改为真机/模拟器手工核对）。
2. 若确认要修 `e2e-smoke.js`，按 §1 最小改动：`execFileSync` 加 `windowsHide` + 给 cliPath 加引号（或改 `spawn` 传数组参数），并同步更新 `.env` 的 `WX_DEVTOOLS_CLI_PATH`。

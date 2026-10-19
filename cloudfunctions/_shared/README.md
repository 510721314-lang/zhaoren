# cloudfunctions/_shared/ · 共享代码暂存目录

> ⛔ **本目录的文件【不随云函数打包上传】！**
> 微信云开发按「单函数目录」打包，`cloudfunctions/_shared/` 不在任何函数包内。
> 直接写 `require('../_shared/xxx')` 在云端必然 **MODULE_NOT_FOUND** → 整个云函数加载失败
> （`FUNCTIONS_INVOCATION_FAILED`，该函数全部接口不可用，后台直接读不出数据）。

## 正确用法（三步，缺一不可）

1. **建 sync 脚本** —— 参照 `sync-*.ps1`，把本目录的 canonical 文件复制到各消费函数目录；
2. **登记 SYNC_MAP** —— 在 `scripts/check-shared-sync.js` 的 `SYNC_MAP` 登记「文件名 → 消费函数列表」。
   漏登记会被该脚本的**自动发现**判为 `[UNREGISTERED]` 并拦截（fail-closed）；
3. **函数内用本地副本** —— 写 `require('./xxx')`，**不是** `require('../_shared/xxx')`。

## 为什么有这两道闸门（2026-10-19 事故）

一次线上事故：新增 `_shared/*.js` 后**未登记、未复制、直接跨目录 require**。
当时本地 `verify:offline` 全绿、`deploy` 返回 success、download SHA 全 MATCH ——
但线上 `admin-action` / `partner-action` / `admin-web` 三个函数**整体崩溃**。
根因：**本地文件系统里 `_shared/` 存在（require 能解析），云端打包后不存在**。

现有闸门（均已并入 `npm run verify:offline`）：
- `scripts/check-shared-sync.js` —— 规范源与各函数本地副本 SHA-256 一致性 **+ 未登记模块自动发现**
- `scripts/check-require-scope.js` —— 跨目录 `require('..')` 物理扫描（先剥离注释再匹配，零误报）

## 目录内文件分类

- **可部署共享模块**：在任一函数目录存在同名副本（`openid.js` / `logger.js` / `take_rules.js` …）→ **必须登记 SYNC_MAP**
- **非部署件**：单测 `*.test.js`、mock `_mock_sdk.js` / `_replay.js`、工具 `lookup-oids.js` / `ab_equivalence.js`
  → 无函数副本，自动发现天然跳过（无需手工排除清单）

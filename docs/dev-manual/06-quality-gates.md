# Ch6 · 质量门禁与自动化校验

> 事实来源：[package.json](file:///c:/zhaoren/package.json)、[scripts/gate.ps1](file:///c:/zhaoren/scripts/gate.ps1) 及各 checker 脚本头注。

## 6.1 门禁总览

一键回归门禁：

```
npm run verify
```

等价于按序执行：

```
check-syntax → check-ssot → check-shared-sync → check-handlers
→ check-index-ledger → check-deploy-config → check-manual-links → npm test
```

其中 `npm test` = `node --test "cloudfunctions/_shared/*.test.js"` && `node cloudfunctions/_shared/ab_equivalence.js`。

> 纯静态/无 IDE 环境用 `npm run verify:offline`（`check-deploy-config` 加 `--offline`，不联云端）。

**当前基线**：`npm run verify` **335 pass / 0 fail**；A/B 等价 203 例（87 explicit + 116 auto，其中 7 例标注 known-evolution）。

## 6.2 各检查器职责

| 检查器 | 校验内容 | 失败即阻断 |
|---|---|---|
| [check-syntax.js](file:///c:/zhaoren/scripts/check-syntax.js) | 对所有云函数 `index.js` 与共享模块做 `node --check`（仅解析不执行） | 是 |
| [check-ssot.js](file:///c:/zhaoren/scripts/check-ssot.js) | 前端 `config/index.js` 不应新增业务阈值硬编码（阈值应从云端读，前端仅兜底）；场景 code 跨端一致 | 是 |
| [check-shared-sync.js](file:///c:/zhaoren/scripts/check-shared-sync.js) | `_shared` 规范源与各函数本地副本 **SHA-256** 一致（防漂移） | 是 |
| [check-handlers.js](file:///c:/zhaoren/scripts/check-handlers.js) | 用真实 mock SDK 逐 action 过 `index.js`，断言「0 抛错」（覆盖 order-action + admin-action，116 条路径） | 是 |
| [check-index-ledger.js](file:///c:/zhaoren/scripts/check-index-ledger.js) | 设计索引台账（`init-db` INDEXES）vs 云端扫描缓存 `indexes-actual.json`：集合存在但索引未建 → FAIL；缓存缺失/幽灵集合 → WARN | 视情况 |
| [check-deploy-config.js](file:///c:/zhaoren/scripts/check-deploy-config.js) | 各函数 `config.json` 期望 timeout vs 云端实际 timeout（CLI 不可用时降级 WARN） | 视情况 |
| [check-manual-links.js](file:///c:/zhaoren/scripts/check-manual-links.js) | 本手册 `docs/dev-manual/*.md` 内所有 `file:///` 链接指向的文件/目录真实存在（防引用腐烂） | 是 |
| `npm test` | 单元测试 + A/B 等价 | 是 |

补充检查器（未默认进 `verify`，按需/门禁脚本调用）：

| 检查器 | 校验内容 |
|---|---|
| [check-nightmask.js](file:///c:/zhaoren/scripts/check-nightmask.js) | 所有 `pages-v2` 下 night-mask 组件挂载点是否有 `bind:reserve`（未成年人保护合规红线，功能不可用=必挂） |
| check-audit-prune.ps1 | 审计日志清理相关校验 |
| [check-heartbeat.ps1](file:///c:/zhaoren/scripts/check-heartbeat.ps1) | 部署后心跳验证（读 AWK_KEY，无需日志通道） |

## 6.3 测试体系

- **框架**：Node 内置 `node:test`（零依赖）。Windows 下 `node --test` 传目录不 glob，须传 glob 串 `"cloudfunctions/_shared/*.test.js"`。
- **单测**：`_shared/*.test.js`。用例自包含（重置函数避免缓存副作用），mock 模拟真实语义。
- **入口契约测试**：`_mock_sdk.js` 拦截 `wx-server-sdk`，可在不改运行时代码的前提下断言 action 分发/鉴权/返回码。
- **A/B 等价重放**：`ab_equivalence.js` 用 `_replay.js` 对拆分前后（或行为变更前后）做逐字节等价验证；`known-evolution` 标注**有意变更**的用例，避免回归误报。
- **新增纯逻辑共享模块时必须同步补 `*.test.js`**。

## 6.4 一键 gate（提交/交付前）

```
powershell -File scripts/gate.ps1      # exit 0 = ALL PASS
```

8 步：check-nightmask → check-ssot → check-syntax → check-shared-sync → npm test → check-index-ledger → smoke-check（`.predeploy/smoke-check.ps1`）→ check-heartbeat。

前置：node 在 PATH（否则 `$env:Path += ';C:\Program Files\nodejs'`）；step 6/7 需 `$env:AWK_KEY`。`check-heartbeat` 心跳陈旧为 WARN（不阻断）。

## 6.5 何时跑什么

| 场景 | 应跑 |
|---|---|
| 日常改动后 | `npm run verify` |
| 提交前 | `npm run verify`（或 `scripts/gate.ps1`） |
| 改 `_shared/` 后 | 对应 `sync-*.ps1` → `npm run verify`（含 SHA 门禁） |
| 改索引台账/补建索引后 | `node scripts/tcb-scan-indexes.js` 刷新缓存 → `check-index-ledger` |
| 部署后 | `check-heartbeat.ps1`（+ 空转验证） |
| 提审前 | gate.ps1 全绿 + 三审计零 P0 + 真机全生命周期回归 |

## 6.6 已知误报/瞬态（排障提示）

- `gate.ps1` step 7 的 `home_probe_square` 偶发 `count=0` 属**冷启动瞬态**，重跑 `smoke-check.ps1` 即恢复，非数据问题。
- `check-index-ledger` 在 actual 缓存不存在时 WARN 不阻断（索引核对是联网/时效操作，硬塞会误报）——需主动刷新缓存。
- `check-deploy-config` 的 triggers/permissions **不在 CLI 输出中**，只能控制台核对；脚本仅比对 timeout。

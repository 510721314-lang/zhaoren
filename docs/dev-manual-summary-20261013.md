# 技术开发手册 编写与推送 总结报告

> 报告日期：2026-10-13 ｜ 工作目录：`c:\zhaoren` ｜ 提交：`b49c92c` ｜ 远端：`origin/master`

## 一、背景与定调

本轮工作目标是产出一份**独立（自含）的技术开发手册**。

关键定调（用户原话）：
> 「我们的技术实现在我授权下已经超越了原 PRD，因此没有必要再对齐原 PRD。本次需要形成独立的技术开发手册。」

据此确立三条原则：
1. **以代码为唯一事实源** —— 所有结论均带 `file:///` 代码出处；凡手册与代码不一致，以代码为准。
2. **脱离 PRD 自含** —— 业务域、数据模型、状态机均在手册内完整定义，无「与 PRD 冲突以 PRD 为准」条款；不做事后 PRD 差异对齐。
3. **不写凭据明文** —— envId / AppID / AppSecret / admin key / 加密密钥只记「存放位置与读取机制」。

交付形态：拆分目录 [docs/dev-manual/](file:///c:/zhaoren/docs/dev-manual)。

## 二、产出清单（13 文件 / 约 127 KB / 1605 行新增）

| 卷 | 文件 | 行数 | 内容 |
|---|---|---|---|
| 底座 | [00-index.md](file:///c:/zhaoren/docs/dev-manual/00-index.md) | 48 | 手册索引与阅读指南 |
| | [00-factbase.md](file:///c:/zhaoren/docs/dev-manual/00-factbase.md) | 161 | 事实底座（云函数/action/副本/页面映射/门禁/部署链） |
| 卷一 架构底座 | [01-architecture.md](file:///c:/zhaoren/docs/dev-manual/01-architecture.md) | 93 | 系统总览与运行拓扑 |
| | [02-module-map.md](file:///c:/zhaoren/docs/dev-manual/02-module-map.md) | 114 | 目录、云函数、页面模块地图 |
| 卷二 工程规范 | [04-conventions.md](file:///c:/zhaoren/docs/dev-manual/04-conventions.md) | 69 | 开发约定与协作规范 |
| | [05-redlines.md](file:///c:/zhaoren/docs/dev-manual/05-redlines.md) | 92 | 硬约束与不可触碰红线 |
| | [06-quality-gates.md](file:///c:/zhaoren/docs/dev-manual/06-quality-gates.md) | 80 | 质量门禁与自动化校验 |
| 卷三 交付运维 | [07-deploy-release.md](file:///c:/zhaoren/docs/dev-manual/07-deploy-release.md) | 72 | 部署与发布流程 |
| 卷四 业务实现 | [03-data-model.md](file:///c:/zhaoren/docs/dev-manual/03-data-model.md) | 190 | 数据模型与 CONFIG_SCHEMA |
| | [09-business-domains.md](file:///c:/zhaoren/docs/dev-manual/09-business-domains.md) | 270 | 业务域实现（含订单状态机全图） |
| | [10-ops-runbook.md](file:///c:/zhaoren/docs/dev-manual/10-ops-runbook.md) | 147 | 运维手册 |
| | [11-docs-index.md](file:///c:/zhaoren/docs/dev-manual/11-docs-index.md) | 134 | 文档与经验索引 |
| 附录 | [90-appendix.md](file:///c:/zhaoren/docs/dev-manual/90-appendix.md) | 80 | 术语表 / 留存负债 / 实现决策台账 / 变更记录 |

配套工程：

| 文件 | 说明 |
|---|---|
| [scripts/check-manual-links.js](file:///c:/zhaoren/scripts/check-manual-links.js) | 手册链接门禁（校验 `file:///` 链接存在性），53 行 |
| [package.json](file:///c:/zhaoren/package.json) | 将 link 检查接入 `npm run verify` 与 `verify:offline` |

## 三、各章要点

- **Ch3 数据模型**：26 个业务集合 + 3 个运行时集合；32 条索引台账（`INDEXES` SSOT）；`CONFIG_SCHEMA` 15 组键 + 非 SCHEMA 散点键；`SEED_CONFIG` 种子；配置生效时延（scene_list 5min / scene_groups 60s）。
- **Ch9 业务域**：**订单状态机全图** —— 14 个合法 S 码、5 类正交位、22 条迁移白名单、CAS 乐观锁 + 事件驱动强制拦截、`mapStatus` 读兼容；覆盖资金/结算、协商取消链、催办三段式、爽约申诉、资料审核、安全上报、定时域等 11 个业务域。
- **Ch10 运维**：环境与身份（脱敏）、巡检清单、三重备份恢复、环境切换、配置同步、密钥轮换、故障速查表、事件分级响应。
- **Ch11 索引**：本手册章节 + 既有文档资产（runbooks / 设计 / 验收）+ 22 个项目技能意图索引 + 门禁脚本入口。
- **附录**：术语表（16 项）、留存负债（0 在册 · 历史项均已闭环）、**实现决策台账 D1–D25**（记录「实现为何这么做」，不做 PRD 差异对齐）、变更记录。

## 四、执行过程

| 阶段 | 内容 | 结果 |
|---|---|---|
| 阶段一 | 事实底座 + Ch1/Ch2/Ch4/Ch5/Ch6/Ch7 + 链接门禁 | 8 文件落盘 |
| 阶段二 | 取证（order_state / init-db / admin-action CONFIG_SCHEMA / 5 个 `_shared` 规则模块 / order-timer 扫描链 / 运行 SOP）→ 写 Ch3/Ch9/Ch10/Ch11/附录 → 补 factbase §7 → 更新 index | 5 正文 + 底座清零 |

取证方式：以代码为唯一事实源，直接读取 `_shared/*.js`、`init-db/index.js`（`COLLECTIONS`/`INDEXES`/`SEED_CONFIG`）、`admin-action`（`CONFIG_SCHEMA`/`config_set`），并对 24 个集合的字段结构做代码级核对。

## 五、质量验证（全绿）

| 校验 | 命令 | 结果 |
|---|---|---|
| 手册链接 | `node scripts/check-manual-links.js` | **183 个 `file:///` 链接全部有效**（13 个手册文件） |
| 全量离线门禁 | `npm run verify:offline` | **335 pass / 0 fail**；`SYNTAX ALL OK (187 files)`；`SHARED SYNC ALL OK` |

`verify:offline` 覆盖链：check-syntax → check-ssot → check-shared-sync → check-handlers → check-index-ledger → check-deploy-config(--offline) → **check-manual-links** → npm test。

## 六、提交与推送

- **提交**：`b49c92c` — `docs(dev-manual): 新增技术开发手册(13 文件, 脱离 PRD 独立自含) + 链接门禁 check-manual-links`
  - 15 files changed, 1605 insertions(+), 2 deletions(-)
- **推送**：`776d577..b49c92c  master -> master`（使用 `-c http.proxy= -c https.proxy=` 绕过失效代理）
- **同步状态**：`master...origin/master` 无领先/落后
- **远端**：`github.com/510721314-lang/zhaoren`

本次仅提交手册改动，**未包含** A1 三处改动与其他未跟踪文件（保持原样）。

## 七、需用户介入项（非本轮产出）

1. `zz-warmup` 触发器更新受微信「代码上传」IP 白名单阻塞（报 `-10008`）。
2. 上轮未提交的 A1 三处改动：`cloudfunctions/zz-warmup/config.json`、`cloudfunctions/zz-warmup/index.js`、`scripts/create-warmup-trigger.js`。
3. 小程序提审。

## 八、后续维护约定

1. 手册修订遵循「以代码为唯一事实源」：改代码后同步修订对应章节。
2. 新增/修改手册内引用后，跑 `node scripts/check-manual-links.js`（已接入门禁）确保链接有效。
3. 交付前跑 `npm run verify`（在线）或 `verify:offline`（离线）保绿。
4. 变更记入 [90-appendix §A.4 变更记录](file:///c:/zhaoren/docs/dev-manual/90-appendix.md)。
# Ch11 · 文档与经验索引

> 事实来源：仓库实测枚举（2026-10）。本章是**入口索引**，帮助定位代码之外的既有资产（设计文档 / 运维 SOP / 技能库 / 门禁脚本）。

## 11.1 本手册章节

| 卷 | 章 | 文件 |
|---|---|---|
| 底座 | 索引 | [00-index.md](file:///c:/zhaoren/docs/dev-manual/00-index.md) |
| | 事实底座 | [00-factbase.md](file:///c:/zhaoren/docs/dev-manual/00-factbase.md) |
| 卷一 架构 | Ch1 | [01-architecture.md](file:///c:/zhaoren/docs/dev-manual/01-architecture.md) |
| | Ch2 | [02-module-map.md](file:///c:/zhaoren/docs/dev-manual/02-module-map.md) |
| 卷二 规范 | Ch4 | [04-conventions.md](file:///c:/zhaoren/docs/dev-manual/04-conventions.md) |
| | Ch5 | [05-redlines.md](file:///c:/zhaoren/docs/dev-manual/05-redlines.md) |
| | Ch6 | [06-quality-gates.md](file:///c:/zhaoren/docs/dev-manual/06-quality-gates.md) |
| 卷三 交付 | Ch7 | [07-deploy-release.md](file:///c:/zhaoren/docs/dev-manual/07-deploy-release.md) |
| 卷四 业务 | Ch3 | [03-data-model.md](file:///c:/zhaoren/docs/dev-manual/03-data-model.md) |
| | Ch9 | [09-business-domains.md](file:///c:/zhaoren/docs/dev-manual/09-business-domains.md) |
| | Ch10 | [10-ops-runbook.md](file:///c:/zhaoren/docs/dev-manual/10-ops-runbook.md) |
| | 附录 | [90-appendix.md](file:///c:/zhaoren/docs/dev-manual/90-appendix.md) |

## 11.2 既有文档资产（`docs/`）

### 11.2.1 运维 SOP（[docs/runbooks/](file:///c:/zhaoren/docs/runbooks)）

| 文件 | 内容 |
|---|---|
| [ops-runbook.md](file:///c:/zhaoren/docs/runbooks/ops-runbook.md) | init-db/env 切换/测试数据打标清理/巡检与注错演练 |
| [deploy.md](file:///c:/zhaoren/docs/runbooks/deploy.md) | 部署 SOP |
| [backup-restore.md](file:///c:/zhaoren/docs/runbooks/backup-restore.md) | 三重备份与恢复演练 |
| [key-rotation.md](file:///c:/zhaoren/docs/runbooks/key-rotation.md) | `admin_web_key` 轮换 |
| [config-sync.md](file:///c:/zhaoren/docs/runbooks/config-sync.md) | 全仓配置同步 |
| [troubleshooting.md](file:///c:/zhaoren/docs/runbooks/troubleshooting.md) | 坑位速查 |
| [audit-checklist.md](file:///c:/zhaoren/docs/runbooks/audit-checklist.md) | 交付前审计清单 |
| [user-side-todo.md](file:///c:/zhaoren/docs/runbooks/user-side-todo.md) | 需用户侧完成的待办 |

### 11.2.2 设计与方案

| 文件 | 内容 |
|---|---|
| [design-20261007-pricing-noshow-flows.md](file:///c:/zhaoren/docs/design-20261007-pricing-noshow-flows.md) | 定价/爽约流程设计 |
| [design-20261010-noshow-withdraw.md](file:///c:/zhaoren/docs/design-20261010-noshow-withdraw.md) | 爽约撤回设计 |
| [design-20261007-guest-onboarding-flow.md](file:///c:/zhaoren/docs/design-20261007-guest-onboarding-flow.md) | 访客引导流程 |
| [admin-web-blueprint-v3-20260921.md](file:///c:/zhaoren/docs/admin-web-blueprint-v3-20260921.md) | 后台蓝图 |
| [order_main_axis_state_machine_vertical.html](file:///c:/zhaoren/docs/order_main_axis_state_machine_vertical.html) | 主轴状态机可视化 |
| [order_exception_flows_vertical.html](file:///c:/zhaoren/docs/order_exception_flows_vertical.html) | 异常流程可视化 |
| [map-marker-strategy.md](file:///c:/zhaoren/docs/map-marker-strategy.md) | 地图 marker 策略 |
| [ui-system-plan-20261001.md](file:///c:/zhaoren/docs/ui-system-plan-20261001.md) | UI 体系计划 |

### 11.2.3 验收 / 走查 / 评审

| 文件 | 内容 |
|---|---|
| [verification/tech-review-20261010.md](file:///c:/zhaoren/docs/verification/tech-review-20261010.md) | 技术评审 |
| [verification/p0-p2-status-20261006.md](file:///c:/zhaoren/docs/verification/p0-p2-status-20261006.md) | P0-P2 状态 |
| [verification/cold-start-protocol.md](file:///c:/zhaoren/docs/verification/cold-start-protocol.md) | 冷启动协议 |
| [regression-checklist.md](file:///c:/zhaoren/docs/regression-checklist.md) | 回归清单 |
| [tech-debt-delivery-report-20261012.md](file:///c:/zhaoren/docs/tech-debt-delivery-report-20261012.md) | 技术债交付报告 |

### 11.2.4 商业 / 产品（非技术，参考）

[business-plan-20261006.md](file:///c:/zhaoren/docs/business-plan-20261006.md)、[pitch-20261006.md](file:///c:/zhaoren/docs/pitch-20261006.md)、[commercial-launch-guide.md](file:///c:/zhaoren/docs/commercial-launch-guide.md)、[change-list-20261004.md](file:///c:/zhaoren/docs/change-list-20261004.md)、[payment-real-20261004.md](file:///c:/zhaoren/docs/payment-real-20261004.md)。

### 11.2.5 onboarding 提示词历史

`docs/onboarding-prompt-*.md`（2026-09-30 起多版）——冷启动/交接提示词演进；最新经验已收敛进本手册。

## 11.3 项目技能库（`.trae/skills/`，24 个）

> 技能是「意图 → 动作」的封装产物，覆盖开发/审计/运维/美化/流程协作五类。使用时按触发意图选取。

### 11.3.1 提审与审计

| 技能 | 用途（触发） |
|---|---|
| `zhaoren-audit` | 提审就绪度审计 + 防偏离机制检查（新会话方向校准 / 提交前合规检查） |
| `mp-pre-release-audit` | 提审前未开发功能全量审计（占位功能 / mock 排查 / release checklist） |
| `miniprogram-audit` | 提审前 7 项静态对齐审计（v2 页面对齐 / 全链路静态扫描） |
| `mp-privacy-release` | 隐私指引配置 + 真机发布链路调试（scope 未声明 / confirmText 4 字符） |
| `zhaoren-tech-review` | 双代理交叉技术评审（多提交/大 diff，2/2 确认才立项） |
| `mini-a11y-perf-check` | 无障碍与性能审计（暗黑模式 / 安全区 / 字体缩放 / setData） |

### 11.3.2 开发与重构

| 技能 | 用途（触发） |
|---|---|
| `cloud-function-split` | 物理拆分巨型 `index.js` 为 `action_*.js`（零行为变更） |
| `cloud-entry-contract-test` | 云函数入口层 mock 契约测试（输入→返回码） |
| `error-message-tracing` | 报错文案溯源排查法（弹错/原地踏步时定位来源） |
| `admin-web-write-ui-pattern` | admin-web 写操作 UI 模式（二次确认 + 原因 + 防双击） |

### 11.3.3 运维与部署

| 技能 | 用途（触发） |
|---|---|
| `zhaoren-ops` | 运维与提审前补丁（部署 / openid 映射 / 双角色 / init-db） |
| `wechat-cloudfunction-deploy` | 云函数部署与排障（`Cannot find module wx-server-sdk`） |
| `wx-cloud-deploy` | DevTools CLI 串行部署 + 远程 npm install + 验证 |
| `cloud-console-test-driver` | Computer Use 驱动云端测试面板批量调云函数 |
| `cloud-backup-restore` | 云端全量备份与恢复（`.predeploy/backup.ps1`） |
| `admin-web-remote-access` | admin-web 后台网络配置与远程访问排查 |
| `powershell-windows-traps` | PowerShell 5 Windows 陷阱与对策 |
| `zhaoren-config-sync` | 全仓配置一致性（前端 enum / admin_config / 云函数） |

### 11.3.4 UI 与体验

| 技能 | 用途（触发） |
|---|---|
| `mini-ui-beautify` | 原生小程序存量 UI 美化（token 收敛 / 适配 / 评分闭环） |
| `wxapp-ui-polish` | 视觉美化与体验走查（Design Token / 动效 / 多机型适配） |
| `mini-interaction-motion` | 交互细节（按钮反馈 / 骨架屏 / 空状态 / 入场动效） |
| `zhaoren-perf-baseline` | 性能基线实测（包体成分 / 启动链路 / 云函数保温） |

### 11.3.5 流程与协作

| 技能 | 用途（触发） |
|---|---|
| `zhaoren-handoff-prompt` | 生成跨会话衔接/投喂（handoff）提示词（会话将达上限、新开任务续作；实测取证 + 双专家评审） |
| `zhaoren-experience-sedimentation` | 经验沉淀落地（根因定性 / 口径定型 / 会话收尾 → 固化进规则 / CHANGELOG / 台账 / 技术债 / 交接文档 / 项目记忆） |

## 11.4 门禁与运维脚本入口（`scripts/`）

| 脚本 | 用途 |
|---|---|
| [scripts/gate.ps1](file:///c:/zhaoren/scripts/gate.ps1) | 全量门禁 7 步（交付前必跑） |
| [scripts/check-shared-sync.js](file:///c:/zhaoren/scripts/check-shared-sync.js) | `_shared` 副本 SHA 一致性 |
| [scripts/check-ssot.js](file:///c:/zhaoren/scripts/check-ssot.js) | 前端无新增硬编码阈值 |
| [scripts/check-handlers.js](file:///c:/zhaoren/scripts/check-handlers.js) | 逐 action 过 index.js 断言 0 抛错 |
| [scripts/check-index-ledger.js](file:///c:/zhaoren/scripts/check-index-ledger.js) | 索引台账校验 |
| [scripts/check-manual-links.js](file:///c:/zhaoren/scripts/check-manual-links.js) | 本手册 `file:///` 链接存在性 |
| [scripts/check-heartbeat.ps1](file:///c:/zhaoren/scripts/check-heartbeat.ps1) | order-timer 心跳 |
| [scripts/rotate-admin-key.js](file:///c:/zhaoren/scripts/rotate-admin-key.js) / [scripts/rehearse-key-rotation.js](file:///c:/zhaoren/scripts/rehearse-key-rotation.js) | 密钥轮换与演练 |
| [scripts/dump-index-ledger.js](file:///c:/zhaoren/scripts/dump-index-ledger.js) | 导出索引台账 |
| [scripts/build-admin-web.ps1](file:///c:/zhaoren/scripts/build-admin-web.ps1) | 后台端构建 |

> 全量脚本清单与职责见 [02-module-map.md §2.6](file:///c:/zhaoren/docs/dev-manual/02-module-map.md)。

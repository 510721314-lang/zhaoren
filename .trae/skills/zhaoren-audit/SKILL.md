---
name: zhaoren-audit
description: 提审就绪度审计 + 防偏离机制检查。Use when starting a new session to output direction calibration, or before any commit/deploy/publish to run compliance checks. Do not use for writing code.
---

# 找人帮忙 提审就绪度审计 & 防偏离检查

本 Skill 是产品战略铁律（`.trae/rules.md` 第九章）的可执行落地。每次新会话开始、每次 commit 前、每次部署前，都应触发。

## 触发时机

1. **新会话开始**：在输出任何代码之前，先跑「方向校准自检」
2. **commit 前**：跑检查脚本
3. **部署前**：跑完整就绪度清单（Phase 0+1）

## 一、方向校准自检（新会话必跑）

输出以下格式，用户确认后再继续编码：

```
=== 方向校准自检 ===
规则来源: .trae/rules.md 第九章（产品战略铁律）
当前 Phase: [Phase 0 / 1 / 2 / 3]
进度: [已完成项数/总项数]

本会话计划:
□ [具体任务1，如"补齐 night-mask 14 处 bind:reserve"]
□ [具体任务2，如"部署 partner-apply 云函数"]

禁止偏离方向提醒:
- 不砍场景/不做 MVP 简化
- 所有商业环节 mock 可达
- UI 与功能并行
```

## 二、提审就绪度检查（commit/deploy 前必跑）

按 `.trae/rules.md` 第九章第 9-16 条逐项执行：

### Phase 0 合规红线
```bash
node scripts/check-nightmask.js   # exit 0 = 通过
node scripts/check-ssot.js         # exit 0 = 通过
```

**不通过的修复方式：**
- night-mask：在对应 wxml 的 `<night-mask>` 标签里加 `bind:reserve="onReserve"`，并确保该页面 JS 里有 `onReserve` 方法（可空实现先让按钮生效）
- SSOT：硬编码迁移到 `admin_config.global` 字段，前端启动时 `callCloud('admin-action',{action:'config_get'})` 覆盖

### Phase 1 安全检查
- admin_openids 非空（调 admin-action config_get 确认）
- 云端越权回归（匿名调 init-db/order-timer 必须 forbidden）

### Phase 2 全量检查
```bash
node --check cloudfunctions/*/index.js
node --check miniprogram/**/*.js
powershell -File .trae/predeploy.ps1 -Deploy [target]
```

### Phase 3 提审前终检
- TRAE-security-review 跑全仓安全扫描
- mp-pre-release-audit 技能跑微信审核 7 项
- 真机双身份链路走通（user→publish → partner→accept → 四确认 → S0 → 履约 → 评价）
- 三重备份验证（GitHub + git bundle + robocopy SHA256）

## 三、战略方向校验（每次 commit message 检查）

禁止出现以下关键词：
- "砍场景" / "简化版" / "MVP" / "先跑几个核心" / "精简"
- 违反 `.trae/rules.md` 第九章第 1 条的任何表述

Commit 消息必须格式：`feat(模块名): [Phase X] 简短描述`

## 四、可用脚本清单

| 脚本 | 位置 | 用途 |
|------|------|------|
| check-nightmask.js | scripts/check-nightmask.js | night-mask bind:reserve 全量检查 |
| check-ssot.js | scripts/check-ssot.js | config/index.js 硬编码审计 |
| predeploy.ps1 | .trae/predeploy.ps1 | 部署预检门（node --check + commit gate + CLI 部署） |

## 五、与现有 Skill 的协作关系

| Skill | 何时用 | 与本 Skill 关系 |
|-------|--------|-----------------|
| zhaoren-ops | 云函数运维 / openid 映射 / 身份双角色 | 互补：ops 做运维操作，audit 做提审前检查 |
| zhaoren-config-sync | admin_config ↔ enum ↔ 前端配置同步 | 互补：config-sync 处理同步，audit 检查是否有新增硬编码 |
| mp-pre-release-audit | 微信审核 7 项对齐 | 上下游：本 Skill Phase 0-2 → mp-pre-release-audit Phase 3 |

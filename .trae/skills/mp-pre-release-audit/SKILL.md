---
name: mp-pre-release-audit
description: 找人小程序提审前未开发功能全量审计。Use when the user asks for 提审前功能审计、未开发功能清单、占位功能排查、mock实现排查、待开发功能优先级、release checklist。Do not use for 日常功能开发或 bug fix。
---

# 找人小程序 · 提审前功能审计

对 `pages-v2/` 全部 17 页做"假实现 / 缺后端 / 死路"三维度扫描，输出 P0/P1/P2 三档清单。

## 范围

- **前端**：`pages-v2/` 下 app.json 注册的全部页面（index / square / message / profile / login / publish / demand-detail / partner-detail / chat / pay / order-detail / safety / evaluate / workbench / accept-config / wallet / partner-apply）
- **核心云函数**：order-action（状态机主入口）、partner-action（供给侧）、payment-mock（资金）、demand-publish（发布）、im-conv / im-send（IM）、safety-report（安全）
- **不查**：v1 旧页面（app.json 已 disabled）、home-action（展示聚合）、admin-action（后台）、数据库 schema

## 前置准备（3 步 grep 拿到全量证据）

```
# Step 1 — 所有 toast 占位提示
Grep pattern: showToast.*(待|暂|占位|建设中|开发中|即将上线|即将开放|功能建设中)
path: pages-v2, glob: *.js

# Step 2 — 所有 navigate fail 死路（目标页不存在或 v1 旧路由）
Grep pattern: navigateTo\(\{[^}]*fail:\s*\(\)\s*=>\s*wx\.showToast
path: pages-v2, glob: *.js

# Step 3 — 云函数 action 清单（对比前端调用名）
Grep pattern: case\s+'|action\s*===
path: cloudfunctions/<函数名>/index.js
```

## 固定检查点清单（必须覆盖）

### 状态机假实现（P0 候选）

| 页面 | 区块 | 检查点 | 正确动作 |
|---|---|---|---|
| order-detail | O3 | `confirmModify` 改期 → 是否调 order-action.modify？ | 必须调后端 |
| order-detail | O3 | `onResumeService` S3.5→S3 / `onToPartial` S3.5→S4 → 是否调 order-action.resume_service / partial_confirm？ | 必须调后端 |
| order-detail | O4 | `confirmCancel` 取消 → 是否调 order-action.cancel？ | 已有 cancel action，但前端**是否调用**是关键 |
| order-detail | O5 | `onRatioConfirm` S4→S5 → 是否调 order-action.ratio_confirm？ | 必须调后端 |
| order-detail | O6 | `onComplaint` S8→S10.5 → 是否调 order-action.complaint？ | 必须调后端 |
| workbench | W1 | `onAcceptToggle` 接单开关 → 是否调 partner-action.set_switch？ | 必须调后端 |

### 核心功能缺后端（P1 候选）

| 页面 | 区块 | 检查点 |
|---|---|---|
| safety | A3 打卡 | 是否调 safety-report.checkin？ |
| safety | A4 SOS | 是否调 safety-report.trigger_sos / silent_sos？ |
| safety | — onKefuResolve | 是否调 safety-report.resolve_sos？ |
| publish | B1/B10 草稿箱+自动保存 | 是否落 demand_draft 集合？ |
| wallet | V5 提现弹窗 | 是否调 payment-mock.withdraw？ |
| profile | U3 订单 4 宫格 | 4 个入口是否跳转不存在的 v1 `/pages/order/order`？ |
| index | H4 场景卡 fail 兜底 | 是否还写"发布页将在批次2上线"这种过时文案？ |
| partner-detail | T5 定向咨询 | 是否仅 toast 无 action？ |

### 死路 / 过时兜底（P2 候选）

message 页置顶/删除、系统通知列表、客服入口、profile 信用明细、wallet 工具行（发票/完税/银行卡）、index 搜索、紧急联系人、partner-review admin_openids 白名单初始化。

## 优先级标准

- **P0 · 状态机假实现（阻断提审）**：前端改 `order.status` 但后端不落库，数据不一致 / demand 不释放 / supply 不更新。**补 5 个 order-action action + 前端对调**。
- **P1 · 核心功能缺后端（提审易被查）**：有完整 UI 但关键动作未调云端。safety 全链路 / publish 草稿 / wallet withdraw。**补 3 组 action**。
- **P2 · 长尾占位（可延后）**：提示 toast、存本地 mock、navigate fail 死路。先隐藏入口或保留文案说明即可。

## 报告格式（固定骨架）

```
# {项目} 未开发功能清单（提审前部署）

审计范围：{app.json 注册页总数} 个 pages-v2 页面 + {核心云函数清单}
优先级定义：P0 状态机假实现 / P1 核心缺后端 / P2 长尾占位

## P0 · 状态机假实现（共 N 项）

### #N. {页面} · {区块}（→{状态变化}）
- 【当前】：{前端代码位置} 做了什么，没做什么
- 【后果】：{数据不一致的具体表现}
- 【后端】：已就绪 / 缺失什么 action
- 【修复】：{一行说明}

## P1 · 核心功能缺后端（共 N 项）

## P2 · 长尾占位（共 N 项 + 附表）

## 附 · 需新建的 action / 集合汇总
```

## 缺失汇总模板

| 类型 | 名称 | 归属云函数 | 说明 |
|---|---|---|---|
| 需新建 action | modify / resume_service / partial_confirm / ratio_confirm / complaint | order-action | 状态机补齐 |
| 需新建 action | checkin / trigger_sos / silent_sos / cancel_silent_sos / resolve_sos | safety-report | 安全报备 |
| 需新建 action | withdraw / fast_withdraw / withdraw_list | payment-mock | 资金钱包 |
| 需新建集合 | demand_draft / safety_report / withdraw_record / complaint | — | 配套持久化 |

## 输出纪律

1. 每项必须附**文件:行号**路径，禁止臆测
2. "后端已就绪但前端没调" 和 "后端根本缺 action" 要明确区分（别统称"缺"）
3. 同文件的多个假实现合并到一条报告（order-detail 5 个可以合并为"order-detail 5 个状态流转全是本地 setData"）
4. 不要读 action 之外的文件（不要进 WXML、不要读 utils）——Grep 证据 + 云函数 action 清单足够

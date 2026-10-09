# 技术评审报告（2026-10-10，专家评审·增量更新）

> 基线文档：docs/verification/tech-review-20261006.md（2026-10-06 专家评审，保留不删改）+ p0-p2-status-20261006.md（2026-10-06 检核）。
> 本文为**增量评审**：以 10-06 基线为参照，标注已闭环项、新发现风险与代码规模实测。评价对象：zhaoren「找个人帮忙」小程序（原生小程序 + CloudBase，16 云函数，单开发者）。

## 总体判断

工程化程度延续 10-06 判断：**显著高于单人小项目平均水准**，且过去 4 天把 10-06 报告的 P0/P1 主体债务全部闭环（知识入 git、观测断层、部署回滚、config 版本历史、audit 留存）。当前下限从「观测断层」转移到两处：**单文件规模债（admin-action 3257 行）** 与 **排障工具链盲区（islogin 假阳性 / tcb fn log 不可用）**。提审在即，结构性重构一律推至提审后，本轮不做。

## 一、2026-10-06 以来已闭环项（状态迁移）

| 10-06 级别 | 项 | 10-06 状态 | 现状 | 证据 |
|---|---|---|---|---|
| P0 | bus factor=1 知识资产裸奔 | 🟨（user 侧阻塞 B4-B7） | 🟨→✅ 大部分闭环 | B0-B3 全部完成（B3 冷启动验证 0 阻塞）；**2026-10-09/10 新增**：项目记忆/经验持续入 project_memory + SKILL.md 入 git 管理 |
| P1 | 观测断层（order-timer 无自观测） | ✅ | ✅ 稳定 | heartbeat + gate 第 7 步常态化；本轮 9 函数 openapi 失败日志 log.d→log.w，prod 可观测面扩大 |
| P1 | 部署无回滚机制 | ✅ | ✅ 持续执行 | deploy-log.md 记录表 + 部署前 bundle 归档成为习惯（本轮 eda406c 已归档 zhaoren-deploy-20261009-231406.bundle） |
| P1 | config 无版本历史 | ✅ | ✅ 稳定 | config_history + config_set 快照持续工作 |
| P2 | audit_log 无留存期限 | ✅ | ✅ 稳定 | auditPrune 已可观测可安全启用 |
| P1 | 云调用权限声明机制缺口（**新发现**） | 未识别 | 🟨→✅ 已修复 | 订阅消息「收不到」根因 = order-timer 缺 permissions.openapi 声明（-604101）被 log.d 静默；2026-10-09 补 9 函数声明 + 失败日志升 log.w（commit eda406c，已部署）；**教训已固化**：排查「云调用静默失败」先查 config.json permissions |

## 二、新发现风险（10-06 后）

| 维度 | 级别 | 风险 | 现有缓解 |
|---|---|---|---|
| 可维护性 | **P0** | **admin-action 单文件 3257 行**（全仓最大），RBAC + 全 action 分发表平铺 | 门禁 + 单测兜底，但改动极易互炸、冷启动偏慢；重构已列入提审后迭代清单（按业务域拆子文件聚合） |
| 可维护性 | P1 | **订单状态机分散**：order-timer / order-action 各自 casStatus，无统一权威定义 | 无（提审后收敛至 _shared/order_state.js，含单测） |
| 排障 | P1 | **工具链盲区**：`cli islogin` 假阳性（显示 login:true 实际凭据失效，以 deploy success 为准）；`tcb fn log` 多窗口全空不可用（prod 静默 + 通道限制叠加） | 已写 SKILL 排障速查；生产排障依赖手工拉日志 |
| 架构 | P1 | **鉴权/身份判断多点复制**：resolveOpenid 各函数自带，环境判定单点漏洞曾出 bug | openid.test.js 4 条 + fail-closed 语义固化 |
| 测试 | P1 | **云函数入口层零测试**：action 分发/鉴权逻辑无自动化覆盖 | gate smoke + 人工回归；提审后试点 3 个高价值函数 mock 测试 |
| 部署 | P2 | 部署批量 40001 = IDE 登录凭据失效，曾阻塞整批部署 | 已固化 `cli login -f image` 扫码重登流程（SKILL） |
| 运行时 | P2 | Nodejs16.13 运行环境 | 提审后升级评估 |

## 三、代码规模实测（2026-10-10）

```
云函数 index.js 行数（16 函数）：
admin-action 3257 │ order-action 1906 │ demand-publish 1679 │
user-login 1194  │ partner-action 1133 │ payment-mock 867 │
home-action 805  │ init-db 606 │ order-timer 587 │ safety-report 502 │
blog-action 462  │ demand-match 456 │ im-send 430 │ im-conv 362 │
evaluation-submit 237 │ partner-apply 206

共享模块单测（_shared 8 模块 130 条，全部零依赖 node:test）：
take_rules 48 / money_rules 30 / no_show_rules 18 / security_policy 12 /
heal 8 / partner_audit 5 / openid 4 / test_data 5

前端：原生小程序主包 + 4 分包（pkgAdmin/pkgAgreement/pkgPrivacy/pkgLow）
管理端：admin-web 云函数代理 Vue SPA（打包资源入 public/）
门禁：gate.ps1 8 步（nightmask/SSOT/语法/shared-sync/npm test/index-ledger/smoke/heartbeat）
```

## 四、建议优先改善项

**提审前（不动代码，维持现状）**
1. 订阅消息「接单提醒」手机实收闭环（当前唯一未闭环验证点，23:05 复推已跑至订阅分支，等真机确认）
2. 走查③举证补测 + 上传体验版

**提审后（结构化重构，均已列入迭代清单）**
1. **P0**：admin-action 拆分（单入口 RBAC 不动，按业务域拆子文件聚合，降冷启动与维护成本）
2. **P1**：订单状态机收敛为 _shared/order_state.js（复用 node:test 基建补全单测）
3. **P1**：云函数入口层自动测试（payment-mock/order-action/demand-publish mock wx-server-sdk 试点，套路复用 openid.test.js）
4. **P1**：鉴权单点收敛（resolveOpenid 统一）
5. **P2**：Node 运行时升级 + 前端请求统一封装
6. **CI 串门禁**：gate.ps1 接入 GitHub Actions（提审后）

## 一句话结论

10-06 评审的主体债务 4 天内基本闭环，工程纪律是可持续的；**下一阶段工程债 = admin-action 规模债 + 状态机分散 + 工具链盲区**，全部属提审后重构项——提审前保持冻结是正确决策。

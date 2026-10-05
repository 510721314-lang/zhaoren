# 回归基线清单（前期已测通过的核心功能）

> 目的：防止后续修改让「前期测试通过的功能」悄悄失效。
> 使用规则：每次云函数改动部署后、每次前端关键逻辑改动后、每次 commit 前，按下面顺序执行。

## 执行顺序（必须全部通过才可交付/提交）

1. **合规静态检查**（zhaoren-audit 要求）
   ```powershell
   node scripts/check-nightmask.js   # exit 0
   node scripts/check-ssot.js        # exit 0
   node --check cloudfunctions/*/index.js
   ```
2. **网关冒烟**（自动验证云端核心链路在用）
   ```powershell
   powershell -File .predeploy/smoke-check.ps1   # exit 0 = SMOKE ALL PASS
   ```
3. **人工抽验**：只抽验与本次改动相关的链路（见下表），不必全跑。

## 一、能力开关一致性（防回归核心，本次事故教训）

**规则：prod 环境的能力开关必须收敛到单一决策点，禁止多个开关各自为政。**

- 场景：`mock_payment_enabled`（admin_config，admin-action 管理）= mock 资金动作总开关
- 打赏 `tip_enabled`：**派生自** dev 环境 ∨ mock_payment_enabled，不做独立开关；
  链路：admin-action config_public → bootstrap `payment.tip_enabled` → 前端 `CONFIG.PAYMENT.tipEnabled`（兜底 false）
  → 服务端 payment-mock 门控（mock_tip 随 mock_payment_enabled 同口径）。
- 平台总开关 switch_access / switch_blog / switch_im：缺省 true（正常态）。
- 夜间红线 time_redline：open_min=360 / close_min=1440（00:00-06:00 禁预约履约）。

改动任何一处开关前后，必须运行 smoke-check.ps1 第 1 项确认下发值正确。

## 二、核心链路（冒烟自动覆盖）

| 链路 | 冒烟项 | 预期 |
|---|---|---|
| 公开配置下发 | config_public | tip_enabled=true、switch_access=true、红线 360/1440 |
| 种子需求在位 | seed_scene_demands | created=0 且 skipped≥48（幂等，不破坏数据） |
| 广场列表 | home_probe_square | matching ≥ 1 |
| 改期通知 | home_probe_system_notice | 查询链路通（system_notice 集合可读） |

## 三、人工抽验清单（按改动相关性抽验）

| 功能 | 验证方法 | 上次通过 |
|---|---|---|
| 抢单（含连点防抖） | 快速连点只响应一次；取消后可再抢 | 2026-10-05 |
| 四确认 → 支付 → 开始履约 | 双账号全流程走通 | 2026-09（MVP 基线） |
| 改期确认即时通知 | 需求方同意改期后，耍伴端订单详情页 ≤8s toast+横幅+数据刷新 | 2026-10-05 |
| 聊天页订单动态 | 停留聊天页时对方任何状态变化 ≤5s toast | 2026-10-05 |
| 打赏 | user 侧完成态订单「💝 打赏耍伴」按钮可用（tip_enabled=true）；耍伴收到「收到打赏」通知 | 2026-10-05 恢复 |
| 夜间红线 | 00:00-06:00 不可预约/履约 | 2026-09（MVP 基线） |
| 双模式 UI | 深色/浅色均可读，tokens.wxss 无死代码 | 2026-10-04 |

## 四、事故记录

| 日期 | 现象 | 根因 | 修正 |
|---|---|---|---|
| 2026-10-05 | 打赏按钮消失、mock_tip 报已关闭 | 双开关：config_public.payment.tip_enabled 仅 dev 派生 + payment-mock prod 恒禁，唯一测试环境为 prod → 功能整体关闭 | 收敛到 mock_payment_enabled 单点；新增 smoke-check 第 1 项守护 |
| 2026-10-05 | 耍伴停留等对方确认时无提示 | 前端通知轮询仅完成态生效（订单状态变化只写 system_notice，不写 IM） | 订单详情 8s 全状态轮询 + 聊天页 5s notice 轮询；本清单人工抽验第 3、4 项守护 |
| 2026-10-05 | 快速连点抢单跳出多条冲突信息 | 抢单入口无防重入 | take-order 全局锁；本清单人工抽验第 1 项守护 |
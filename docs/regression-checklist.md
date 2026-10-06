# 回归基线清单（前期已测通过的核心功能）

> 目的：防止后续修改让「前期测试通过的功能」悄悄失效。
> 使用规则：每次云函数改动部署后、每次前端关键逻辑改动后、每次 commit 前，按下面顺序执行。

## 执行顺序（必须全部通过才可交付/提交）

1. **合规静态检查**（zhaoren-audit 要求）
   ```powershell
   node scripts/check-nightmask.js     # exit 0
   node scripts/check-ssot.js          # exit 0
   node scripts/check-syntax.js        # exit 0（全部云函数 node --check）
   node scripts/check-shared-sync.js   # exit 0（共享模块防漂移哈希校验）
   npm test                            # 108 条单测全绿（node:test 零依赖）
   ```
2. **网关冒烟**（自动验证云端核心链路在用；改密钥后须先 `$env:AWK_KEY=<新钥>`）
   ```powershell
   powershell -File .predeploy/smoke-check.ps1        # exit 0 = SMOKE ALL PASS
   powershell -File scripts/check-heartbeat.ps1       # order-timer 巡检心跳（缺跳仅 WARN 不阻断，输出排障指引）
   ```
   或一条命令跑完七步：`powershell -File scripts/gate.ps1`（B2 一键门禁，含上面全部）
3. **CI**（GitHub Actions，push master 自动跑单测+静态检查；见 .github/workflows/ci.yml）
4. **人工抽验**：只抽验与本次改动相关的链路（见下表），不必全跑。

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
| 打赏逐笔记录 | 订单详情打赏行下平铺逐笔明细（金额+备注+时间），双方可见 | 2026-10-05 |
| 钱包双专栏 | 「接单收入」（已结算服务费）与「打赏」（逐笔流水）两栏：时间段筛选（全部/本月/近30/近90）+ 汇总联动；提现含打赏 | 2026-10-05 |
| 首页空路径兜底 | 微信自动恢复现场偶发 page "" 时自动进首页，不弹「页面不存在」 | 2026-10-05 |
| 夜间红线 | 00:00-06:00 不可预约/履约 | 2026-09（MVP 基线） |
| 双模式 UI | 深色/浅色均可读，tokens.wxss 无死代码 | 2026-10-04 |

## 四、共享规则模块（D2-5 防漂移抽取，2026-10-06）

> 规范源在 `cloudfunctions/_shared/`，**修改后必须跑对应 sync-*.ps1 同步副本，CI 会做哈希一致性拦截**。

| 模块 | 内容 | 消费方 | 测试 |
|---|---|---|---|
| take_rules.js | 时间红线/东八区自然日/价格区间钳制/每周时段/Haversine | order-create, demand-publish, order-action, home-action | 44 条 |
| money_rules.js | 分账公式/打赏校验/提现两段校验/余额口径 | payment-mock, order-create, order-action | 30 条 |
| test_data.js | is_test 白名单打标（isTestOpenid/isTestPair） | demand-publish, order-create, admin-action, init-db | 5 条 |
| partner_audit.js | 耍伴资料审核增量 | partner-action, admin-action | 29 条存量组 |

规则语义教训（写入单测固化）：
- **0 是合法值**：费率 0=免佣、价格下限 0——禁止 `\|\|` 兜底（money_rules.splitOrderAmount 已修正历史 `\|\| 1000` 吞 0 隐患；`Number(null)===0` 语言坑也已守卫）。
- 拒绝码（wd_amount/tip_amount 等）是与前端/后台的契约，抽函数时逐字保留。

## 五、运维工具与密钥（D1/D6/D7，2026-10-06）

- **admin_web_key 已轮换**（2026-10-06），仓库脚本零硬编码，统一读 `$env:AWK_KEY`（用户级 setx 已配）。新钥在仓库外 `C:\zhaoren-bak\admin-key-20261006.txt`。**勿把新钥写回任何 git 内文件。**
- **测试数据打标**：admin_config.test_openids 白名单（已种入 test_partner_001、oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c）；命中者建需求/建单自动 `is_test=true`。白名单经 admin-action config_set 的 `test_openids_add / test_openids_remove` 维护。
- **purge_test_data**（init-db，管理员）：默认 dry-run 只统计；真删须 `confirm:'PURGE'`；仅删 is_test=true；级联 7 张子表；单次上限 500。
- **危险操作确认门**：config_set 切 env=dev 须 `confirm:'SWITCH_DEV'`（切回 prod 免确认）；admin-web Config.vue 已同步弹窗输入。
- **error_scan 巡检**（order-timer）：每轮定时扫描 P0/P1 事件 / audit_log fail / 卡死提现(>48h) → 推管理员 system_notice；游标 `admin_config.error_scan_last_at`（config_get 可见，>0 即巡检在跑）。演练：管理员 `{action:'run', drill:true}`。**心跳自观测**（2026-10-06）：每轮同时写 `error_scan_heartbeat_at`，门禁第 7 步 `scripts/check-heartbeat.ps1` 检测存活——心跳为 0 / 超 30 分钟未刷新输出 WARN + 排障指引（不阻断门禁，等触发器确认后可升级为 FAIL）

### 待办（用户侧 2 分钟）
1. 控制台 → 云函数 → order-timer → 触发器：确认 `orderTimer` 每 5 分钟且已启用（部署后 error_scan_last_at 仍为 0，疑似触发器未生效/被暂停）。
2. 触发器确认后等一个周期，config_get 看 `error_scan_last_at > 0` 且 `error_scan_heartbeat_at > 0`（或跑 `scripts/check-heartbeat.ps1` 输出 `[heartbeat] OK`）即巡检闭环。

## 六、事故记录

| 日期 | 现象 | 根因 | 修正 |
|---|---|---|---|
| 2026-10-05 | 打赏按钮消失、mock_tip 报已关闭 | 双开关：config_public.payment.tip_enabled 仅 dev 派生 + payment-mock prod 恒禁，唯一测试环境为 prod → 功能整体关闭 | 收敛到 mock_payment_enabled 单点；新增 smoke-check 第 1 项守护 |
| 2026-10-05 | 耍伴停留等对方确认时无提示 | 前端通知轮询仅完成态生效（订单状态变化只写 system_notice，不写 IM） | 订单详情 8s 全状态轮询 + 聊天页 5s notice 轮询；本清单人工抽验第 3、4 项守护 |
| 2026-10-05 | 快速连点抢单跳出多条冲突信息 | 抢单入口无防重入 | take-order 全局锁；本清单人工抽验第 1 项守护 |
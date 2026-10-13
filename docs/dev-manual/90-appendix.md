# 附录 · 术语表 / 留存负债 / 实现决策台账 / 变更记录

> 事实来源：代码与项目既有约定（2026-10）。本附录**自含**，供快速查阅与追溯「实现为何这么做」。

## A.1 术语表（术语在本手册内的定义）

| 术语 | 定义 |
|---|---|
| **S 码 / 主轴状态** | 订单履约主轴状态，`S1/S0/S2/S2_5/S3/S3.5/S4/S5/S8`（主轴 9 态）+ `S10.5`（争议占位）+ `S6/S7/S10`（终态）+ `S9`（退役态），全量 14 个合法码 |
| **正交位** | 不挤占 `status` 的独立维度字段：`eval_state` / `dispute_state` / `dispute_type` / `frozen` / `fund` |
| **四确认** | 下单前的逐项确认（时间/地点/内容/费用），8 位确认全满才生成订单 |
| **CAS 乐观锁** | `casTransition`：仅当订单当前状态 ∈ expect 时更新，以 `stats.updated===1` 判定「抢到」 |
| **SSOT（单一事实源）** | 同一逻辑/数据只有一个权威定义处；本项目：运营参数在 `admin_config.global`、共享逻辑在 `_shared/` |
| **`_shared` 多副本** | 微信云函数按单目录打包、不能跨目录 require，故「规范源 + 复制 + SHA 门禁」 |
| **fail-closed** | 失败时降级/拒绝，绝不放行主流程（权限、mock、云调用失败一律收紧） |
| **`mock_openid`** | 测试期模拟身份入参；prod 全失效；dev 需 `dev_until` 未来时间戳 |
| **协商取消链** | S2 用 `cancel_request` 挂起字段实现的取消协商（非新状态），见 §9.1.5 |
| **催办三段式** | S2 履约催办：T0 提醒耍伴 → T+1h 用户通知 → T+4h 引导申诉 |
| **爽约申诉** | `no_show_report`：S2/S3.5 且过约定开始时间可提交，经举证→管理端裁定 |
| **结算基数** | 参与分账的订单金额；部分退款仅冲减基数，不进入全额退款终态 |
| **走查** | 交付前的端到端人工核对（页面/流程/文案一致性） |
| **门禁** | `npm run verify` 的自动化校验链（check-* + 单测 + A/B 等价） |
| **P0–P3** | 平台事件分级：P0 紧急 / P1 安全越权 / P2 运营写操作 / P3 业务异常 |
| **`grab_notify`** | 需求发布后向范围内耍伴批量推送的抢单通知 |
| **`profile_audited_snapshot`** | 耍伴资料**已过审快照**（展示只读此字段，fail-closed 双缓冲） |

## A.2 留存负债（当前无在册项 · 2026-10-13 全量闭环）

来源：Ch5 §5.8 与 [tech-debt-delivery-report-20261012.md](file:///c:/zhaoren/docs/tech-debt-delivery-report-20261012.md)。

| 负债 | 影响 | 触发/评估条件 |
|---|---|---|
| （无在册留存负债） | — | — |

> **2026-10-13 已闭环（移出负债）**：
> - **云端索引创建**：tcb 直连通道（`tcb-scan-indexes.js` / `tcb-diff-indexes.js` / `tcb-exec.js`），实测设计 33 / 已建 33 / 缺失 0，**无需控制台手工**（见 [03-data-model.md](file:///c:/zhaoren/docs/dev-manual/03-data-model.md) §3.4 与 [Ch4 §4.7](file:///c:/zhaoren/docs/dev-manual/04-conventions.md)）。
> - **`zz-warmup` 触发器更新**：改走 `tcb fn trigger create`（绕开「代码上传」IP 白名单 `-10008`），已把云端触发器更新为全天候 `0 */5 * * * * *`（见 [07-deploy-release.md](file:///c:/zhaoren/docs/dev-manual/07-deploy-release.md) §7.3）。
> - **DB 数据恢复**：admin-action 新增 `config_restore` + `import_collection`（[action_import.js](file:///c:/zhaoren/cloudfunctions/admin-action/action_import.js)），[restore.ps1](file:///c:/zhaoren/.predeploy/restore.ps1) 已接线，DB 集合可 replace 回灌。
> - **备份清单漏集合**：manual-backup `$COLLECTIONS` 漏 `complaint`，已补齐 → 37 集合，与服务端 `EXPORT_COLLECTIONS` 白名单对齐。
> - **`order-timer` 分页 `skip` 漂移**：`scanAll` 由 skip 分页改**游标分页**（`orderBy('_id')` + `_id > 上页末位`，复用恒存的 `_id` 索引、无需新建组合索引；云端实测 `sort:{_id:1}` 过滤查询可用），并发写者下不再跳过/重扫（D23）。
> - **争议单超期升级（`dispute_escalate_d=30`）**：落地为**升级信号**——`order-timer` §4.8 扫 `dispute_state='open'` 且发起（`dispute_opened_at`/`complaint_at`）超期未裁决 → 幂等标记 `dispute_escalated_at` + 写 P1 `dispute_escalate_overdue` 事件（errorScan 推送全体管理员）；裁决仍走人工，不做自动裁决（D24）。
> - **失败计数读-改-写竞态**：`admin-action.admin_login`、`user-login.password_login`、`user-login` 短信验证码三处统一改 `_.inc` 原子自增 + 达阈值条件置锁（并发下不丢计数）（D25）。
> - **客服会话全局唯一占位**：2026-10-12 修复（`kefu_open` 改用按用户唯一占位 `order_id: 'kefu_'+openid`，不再用空串撞 `uk_order_id` 唯一索引），已随 10-13 批次部署；2026-10-13 经 `functions download` 云端核验命中 `kefu_` 标记。

## A.3 实现决策台账（记录「实现为何这么做及其理由」）

> **声明**：实现已在授权下**超越原 PRD**，故本台账**不做 PRD 差异对齐**，只记录**当前代码为何如此实现**及其约束。用户已明确：本手册脱离 PRD 独立自含。

| # | 决策 | 理由 / 约束 | 出处 |
|---|---|---|---|
| D1 | 订单状态用**正交位**拆分（评价/争议/资金/冻结） | 避免所有维度挤占 `status` 导致状态爆炸；`status` 只表履约主轴 | [order_state.js](file:///c:/zhaoren/cloudfunctions/_shared/order_state.js#L44-L51) |
| D2 | 状态机**双写过渡** | 存量迁移期读写空窗风险，先同写旧 status + 新正交位 | Ch5 §5.3 |
| D3 | 迁移采用**表驱动白名单 + CAS** | 并发安全 + 可读的结构约束；`from=['*']` 规则令纯 from→to 无约束力，故**强制校验事件驱动** | [order_state.js L151-L160](file:///c:/zhaoren/cloudfunctions/_shared/order_state.js#L151-L160) |
| D4 | 保留 `mapStatus` **读兼容** | 让未迁移存量数据也能被新读方正确理解（S9→S8+auto_done 等） | [order_state.js L169-L188](file:///c:/zhaoren/cloudfunctions/_shared/order_state.js#L169-L188) |
| D5 | 共享逻辑走 **`_shared/` + sync 副本 + SHA 门禁** | 微信按单目录打包、不支持跨目录 require；SHA 门禁防漂移 | [check-shared-sync.js](file:///c:/zhaoren/scripts/check-shared-sync.js) |
| D6 | `openid.js` **全量 17 个业务函数单一源**（2026-10-13 收敛） | 原 `admin-action` 超集（网关密钥校验）上移其 `index.js` 包装层 `resolveOpenidWithProxy`；原 `init-db` 变体废弃（缺 `dev_until` fail-closed 加固属安全隐患），`invalidateEnvCache` 并入规范源导出 | [00-factbase §2b](file:///c:/zhaoren/docs/dev-manual/00-factbase.md) |
| D7 | **显式 0 是合法值**（费率/价格下限），禁 `||` 兜底 | `0=免佣`/`0=合法下限`；`Number(null)===0` 语言坑须先判 null | [money_rules.js L57-L65](file:///c:/zhaoren/cloudfunctions/_shared/money_rules.js#L57-L65) |
| D8 | 拒绝码**逐字保留** | 拒绝码是与前端/后台的契约，抽函数/重构不得改名 | [config-sync.md](file:///c:/zhaoren/docs/runbooks/config-sync.md) |
| D9 | `order-timer` 全量**分页循环** | 单页 `limit` 会让积压 >BATCH 的滞留单据永不被扫到 | [order-timer/index.js L31-L55](file:///c:/zhaoren/cloudfunctions/order-timer/index.js#L31-L55) |
| D10 | 催办用**订单标记位** `urge_t*_at` 幂等 + `cancel_request/frozen` 互斥 | 防重复轰炸、防与协商取消/申诉冲突 | [urge_rules.js L57-L91](file:///c:/zhaoren/cloudfunctions/_shared/urge_rules.js#L57-L91) |
| D11 | 退款上限**不含打赏**、失败**自动补偿回滚** | 打赏是独立口径；状态一致性优先 | Ch5 §5.2 |
| D12 | 爽约申诉**一期零赔付**（仅扣信用分/停用） | 用户已拍板，降低资金风险 | [no_show_rules.js L70-L81](file:///c:/zhaoren/cloudfunctions/_shared/no_show_rules.js#L70-L81) |
| D13 | 撤回**占用配额**（不写 `is_deleted`） | 撤回后同单同人不可再提交，防刷 | [no_show_rules.js L86-L92](file:///c:/zhaoren/cloudfunctions/_shared/no_show_rules.js#L86-L92) |
| D14 | 资料展示**只读 `profile_audited_snapshot`** | fail-closed 双缓冲，未过审内容不上线 | [partner_audit.js](file:///c:/zhaoren/cloudfunctions/_shared/partner_audit.js) |
| D15 | 订阅消息**仅在「小程序端触发」的云函数**走云调用 | 微信云调用仅在客户端触发链路自动鉴权；定时器/网关/CLI 触发必报 `-501001` | Ch5 §5.6 |
| D16 | 审计用**哈希链** `prev_hash→chain_hash`，删最早连续段 | 删最早连续段不产生断链告警，校验仍 `ok` | [audit.js](file:///c:/zhaoren/cloudfunctions/_shared/audit.js) |
| D17 | `error_scan` **豁免机器调用与自身兜底事件** | 避免机器噪声/自有兜底事件造成告警风暴 | [order-timer/index.js L91](file:///c:/zhaoren/cloudfunctions/order-timer/index.js) |
| D18 | 客服会话**按用户唯一占位** `order_id: 'kefu_'+openid` | 原空串占位撞 `uk_order_id` 唯一索引（全局仅容一条）致多用户并发开客服失败；改按用户唯一占位复用同一索引、互不冲突（2026-10-13 云端核验） | [im-conv/index.js L169-L202](file:///c:/zhaoren/cloudfunctions/im-conv/index.js#L169-L202) |
| D19 | `init-db` 对 `admin_config` **补缺失不覆盖** | 防重跑种子把线上运营值降级；差异走 `force_migrate_scenes` | [config-sync.md](file:///c:/zhaoren/docs/runbooks/config-sync.md) |
| D20 | 环境切 dev **强制带有效期 + 4h 兜底回 prod** | 防测试身份门控被长期遗忘；fail-closed 默认 prod | Ch5 §5.1 |
| D21 | `admin_login` 失败写 **P1 `admin_login_fail`**，且**连续 5 次失败锁定 10 分钟** | 避免匿名爆破无观测；锁定复用 `_shared/security_policy.js`（与 user-login 同口径，`pwd_fail_count`/`pwd_lock_until`），锁定中不验密直接拒绝 | Ch5 §5.1 |
| D22 | 场景隐藏过滤**统一在 `home-action.scene_groups` 出口** | 单一出口避免过滤散落导致泄漏 | Ch5 §5.5 |
| D23 | `order-timer` 分页改**游标分页**（`_id` 游标 + `orderBy('_id')`） | skip 分页在并发写者下会越过未处理文档（延迟一轮）；`_id` 恒有索引、零新建索引成本，且对写者完全稳定 | [order-timer/index.js L31-L55](file:///c:/zhaoren/cloudfunctions/order-timer/index.js#L31-L55) |
| D24 | 争议超期升级只做**升级信号**（P1 平台事件），禁止自动裁决 | 自动裁决的资金/责任风险不可控；P1 事件复用 errorScan 既有巡检推送链路，幂等标记 `dispute_escalated_at` 防重复 | [order-timer §4.8](file:///c:/zhaoren/cloudfunctions/order-timer/index.js) |
| D25 | 失败计数一律**原子自增 + 达阈值条件写** | 读-改-写在并发下丢计数可绕过锁定阈值；`_.inc` + 条件写两者皆幂等、无锁成本（`passwordFailPatch` 纯函数现无运行时调用者，保留——删除需连带 3 副本同步+重部署，随下次 init-db 部署顺带清理） | [action_auth_pre.js L61-L72](file:///c:/zhaoren/cloudfunctions/admin-action/action_auth_pre.js#L61-L72) / [user-login L1196-L1205](file:///c:/zhaoren/cloudfunctions/user-login/index.js#L1196-L1205) |

## A.4 变更记录

| 日期 | 版本/事件 | 说明 |
|---|---|---|
| — | `admin_config.version = V15-MVP` | 当前种子配置版本标记（[init-db](file:///c:/zhaoren/cloudfunctions/init-db/index.js#L141)） |
| 2026-10-06 | D2-3 / D4-5 防漂移 | 抽 `take_rules.js` / `money_rules.js` 共享规则 |
| 2026-10-07 | 第三批 3B | 爽约申诉 + 审计留存清理 + `config_history` |
| 2026-10-10 | 履约域 Wave1 | 抽 `order_state.js`，状态机收口（`casStatus` 去重） |
| 2026-10-12 | 批 1.x / Wave2 止血 | 全段分页扫描、加时超时自动拒绝、停用到期恢复、`after_sale_days`/`partial_judge_days` 服务端键补齐 |
| 2026-10-13 | 本手册 | 《技术开发手册》落盘（以代码为唯一事实源，脱离 PRD 独立自含） |
| 2026-10-13 | 运维负债闭环 | 索引走 tcb 直连通道核对（设计 33 / 已建 33 / 缺失 0）；`zz-warmup` 触发器经 tcb 更新为全天候并同步 `cloudbaserc.json`；新增 `config_restore` + `import_collection` 支撑 DB 恢复；备份清单补 `complaint` → 37 集合 |
| 2026-10-13 | 代码/架构负债闭环 | ① `admin_login` 防爆破锁定（5 次/10 分钟，复用 `_shared/security_policy.js` 并入 SYNC_MAP）；② `openid.js` 全量 17 函数单一源收敛（admin-action 超集/init-db 变体归零，force_set_env 补写 `dev_until`） |
| 2026-10-13 | 留存负债全量闭环 | ① `order-timer` 游标分页（消 skip 漂移，D23）；② 争议单超期升级落地（`dispute_escalate_d` → P1 `dispute_escalate_overdue`，D24）；③ 三处失败计数原子化（admin_login / password_login / SMS，D25）；④ 客服会话全局占位复核已修（`kefu_` 云端命中）→ **A.2 在册负债清零**；门禁 pass 360/0（+9 例） |
| 2026-10-13 | 运营配置说明化 | `CONFIG_SCHEMA` 全 78 项新增 `d` 设置说明（SSOT 单点维护，`config_get` 统一下发）；运营配置页表单项下方内嵌灰色说明 + 页头使用提示；Ch10 §10.5.1 新增「运营配置页维护指引」（三页签操作规则 + 高风险项清单） |

> 手册修订流程：以代码为唯一事实源 → 改动后跑 `node scripts/check-manual-links.js` 与 `npm run verify` → 更新本附录变更记录。

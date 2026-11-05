# 找人帮忙项目技术负债清单（2026-11-05 刷新版）

> 盘点日期：2026-11-05　基线：体验版 **v1.6.92**（TOTAL 789.7 KB / 808,667 B，main 547.6 KB）；HEAD `0172ba0`（工作区干净、已推送）
> 数据来源：云端回读（`config_get` / `config_public` / `nosql`）、[deploy-log](deploy-log.md)、[CHANGELOG](CHANGELOG.md)、[FUNCTION-REGISTRY](FUNCTION-REGISTRY.md)、本会话实测（`npm test` / 入口测试 / SHA 核验）
> 替代关系：本文件为**现行唯一**技术负债清单；[tech-debt-inventory-20261015.md](tech-debt-inventory-20261015.md) 转为**历史归档**（其日期口径、KNOWN 计数、REGISTRY 待验证数已过时）。
> 维护约定：每条处置后在本文标注「已偿还(日期/commit)」或「已决策不处理(原因)」，并同步 CHANGELOG / REGISTRY / deploy-log。

## 总览

| 分组 | 数量 | 状态 |
|---|---|---|
| P0 提审阻断类 | 5 | 4 结案；**P0-3 待配额复测** |
| P1 有意保留/临时放宽 | 8 | 6 已偿还/已核实；**P1-6 待发布关闸**；P1-3/4/5 有意保留 |
| P2 结构性债 | 13 | 5 已偿还；**P2-2/P2-3/P2-4 开放**；P2-7~10、12/13 真机待验 |
| P3 卫生/已接受 | 25 | 15 已结案/已偿还；**10 项开放**（见 §3） |
| 备份体系 B-1~B-6 | 6 | B-1/B-2 待自动窗口复核；**B-3/B-4 开放**；B-5/B-6 已接受/已处理 |
| 本会话新增 N-3~N-7 | 5 | ✅ 全部偿还（2026-11-05，`a1f3dac`，见 §5） |

关键计数（2026-11-05 实测）：`npm test` A/B **456 EQUIVALENT / 79 known-evolution**；入口测试 `order-action.entry.test.js` **67/67**；索引台账 **49 条**；`_shared` 同步门禁 **ALL OK**；空 catch 净口径约 **155 处**（窄类 25/25 已收口）。

---

## §0 上线前必须清零

| # | 事项 | 状态 | 证据 | 处置 |
|---|---|---|---|---|
| P1-6 | `realname_face_mode=mock` 为提审期临时放宽（原 `wx`） | ⬜ 当前 mock | 云端回读 `realname_face_mode=mock`（2026-11-05） | **发布同轮**：①`config_set realname_face_mode='wx'`；②`admin-action realname_reset_simulated` 清打标账号；未关闸＝任何人可自授实名 |
| P0-3 | 云函数调用额度（20 万/周期） | ⬜ 待复测 | 2026-10-28 周期累计约 19.35 万、余约 0.65 万；优化后估算 1,000–1,300 调用/天、2,200–2,800 DB/天 | **11-05 套餐重置后**按单触发器 `0 */15 7-22 * * * *` 恢复保温，观察 1–2 天日曲线，确认 ≤1,500 调用/天 |
| N-1 | REGISTRY **#144 / #145 / #146** 待真机 | ⬜ 3 条 | REGISTRY 状态列「待验证」 | 按 [runbook §3.10–3.12](runbooks/release-zero-checklist.md) 真机通过后转「已验证」并补 `// @VERIFIED` |
| N-2 | `is_test` 测试单残留 | ⬜ 6 张未软删（`F`/`K`/`I`/`J`/`L`/`M`） | 云端回读（2026-11-05） | 验收后执行 `node scripts/test-order-tool.js cleanup`（旧 `.tmp-tcb/cleanup-test-orders.js` 亦可），回读「剩余未软删 = 0」 |
| 发布同轮 | 三订阅模板 `miniprogram_state` `trial → formal` | ⬜ 三模板均 trial | 云端回读 `sub_msg_templates`（2026-11-05） | 正式发布当天改，改后回读确认（HANDOFF T-8.15） |
| 发布同轮 | 补 2 条「自定义」隐私声明（手填手机号、设备信息） | ⬜ | [release-zero-checklist §4.2](runbooks/release-zero-checklist.md) | 后台指引补充，与端内 `privacy.wxml` 2.2/2.8 对齐 |
| 发布同轮 | `mock_payment_enabled` 口径拍板 | ⬜ 当前 true | 云端回读 `true` | MVP 模拟支付；提审说明写明「不产生真实扣款」，是否保持由用户拍板 |

---

## §1 P1 · 有意保留 / 已核实（8 项）

| # | 负债 | 状态 |
|---|---|---|
| P1-1 | 旧 `start_service`（S2→S3 直连）服务端保留、前端无入口 | ✅ 已偿还（2026-11-01 形态A，仅墓碑守卫） |
| P1-2 | 旧 `complete_service`（S3→S5 直连） | ✅ 已偿还（同上，由 `finish_apply`+`finish_confirm` 取代） |
| P1-3 | `start_photo` 服务端保留、S3 前端入口已移除 | 有意保留（全量 grep 0 命中，不回开） |
| P1-4 | `demand-match.hall_list` 标 deprecated 仍在线 | 有意保留；**下线动作留提审后**（静态零调用已证） |
| P1-5 | MVP 禁做项占位：短信发送、人脸三分支、mock 现金 `is_mock=true` | 有意保留；禁止接真实打款 |
| P1-6 | `realname_face_mode=mock` 临时放宽 | ⬜ **见 §0**（发布同轮关闸） |
| P1-7 | `auto_approve_partner` 曾被临时置 true 且无审计 | ✅ 已偿还（2026-11-01 回 false；2026-11-05 回读仍 false） |
| P1-8 | `order_main.uk_order_no` 等 5 条唯一索引存在性 | ✅ 已核实（2026-10-22 引擎取证 5/5 `unique=true`） |

---

## §2 P2 · 结构性债（开放项）

| # | 负债 | 影响 | 处置时点 |
|---|---|---|---|
| P2-2 | 前端页面级单测缺失（纯函数已跨目录覆盖；`setData`/跳转/按钮态仍靠真机） | 回归依赖人工 | 提审后续作（拆分方案 §5 条目 6） |
| P2-3 | 9 份 `_orig_baseline.js` 约 1.07 万行冻结常驻并随函数部署 | 包体/暴露面 | **✅ 已偿还（2026-11-05）**：迁移至 `cloudfunctions_baseline/<fn>.js`（内容冻结、不进部署）；测试时临时副本 `__baseline_tmp.js` 退出即删；9 函数重部署后包体合计约 **-170 KB**，回读 baseline=NONE ×9 |
| P2-4 | `_shared` 多副本物理同步（openid 17 份 / logger 16 份 / audit 11 份） | 改规范源须跑 sync | 接受（`check-shared-sync` 门禁已守） |
| P2-7 | A10 发布表单快照 | 已实施，**真机待验** | 随真机窗口 |
| P2-8 | A11 发布中断「继续完成发布」横幅 | 已实施，**真机待验** | 同上 |
| P2-9 | B13 首页「继续完成入驻」横幅 | 已实施，**真机待验** | 同上 |
| P2-10 | B11 八步入驻链（3a/3b/3c 已实施） | **真机待验** | 同上 |
| P2-12 | 工作台「今日待履约」口径（已改 `today_pending`） | **真机待复核** | 同上 |
| P2-13 | 工作台「本周收入」口径（已改 `week_income_fen`） | **真机待复核** | 同上 |
| P2-11 | 工作台 SOS 上报（已偿还）；残留「无进行中订单时无法关联 order_id」 | 产品边界 | 提审后可评估「非订单关联求助」 |

> 已偿还：P2-1（前端巨页拆分）、P2-5（题库 SSOT）、P2-6（门禁覆盖面 F3/F4/F5/F6/F7+⑥，2026-11-02 收尾）。

---

## §3 P3 · 卫生级（10 项开放）

| # | 负债 | 证据/影响 | 处置 |
|---|---|---|---|
| P3-3 | `emergency_contact.phone` / `demand.contact_phone` 明文 | 隐私合规；`backfill-phone-enc.js` 仅覆盖 `user_account` | 提审后单独立项（设计+评审+真机） |
| P3-10 | `KNOWN_EVOLUTION` 3 条 stale（`my_orders_partner`/`my_orders_user`/`notice_list`） | 声明表与运行时差集；当前运行时 **79 例** | 提审后删 3 条并复跑 A/B（应仍 EQUIVALENT） |
| P3-14b | `bootstrap.js` take 链 `navigateTo` 的 `fail: () => {}` 静默 | 栈满仅丢一次跳转 | 已批准「零代码」豁免；触碰该文件时同修 |
| P3-15 | 法律合规残留：⑤版本库不可用时回填源为未保存表单；⑥「删除」实为「停用」措辞不统一；⑦满态判定误报；⑧批量发布快照完整性待专项 | admin-web/legal 体验与一致性 | 提审后按 ⑤⑥⑦ 优先 |
| P3-16 | 工作台信用分两源（`user_account.partner_credit_score` vs `partner_profile.score`） | 可能出现「分数 L2 段却显示 L3」 | **✅ 已偿还（2026-11-05）**：`balance_info` 已返回 `credit_score`（取 `partner_profile.score`）；`workbench` 收敛为单一展示字段 `creditScore`（无档案回退账户原值），WXML 不再直接读 `user.partner_credit_score` |
| P3-20④ | 首页冷启动 `fetchUser` 与 `refreshNoticeBadge` 各调一次 `peek_login` | 配额微浪费 | 下次首页改动顺带去重 |
| P3-23 | `S2_6` 预告片文案缺「待」字 | 真实态与预告态易混 | **✅ 已偿还（2026-11-05 复核）**：`order-progress/index.js` 已有 `PREVIEW_NAME = { S2_6: '待发起开始履约' }` 并在非当前态分支套用 |
| P3-25 | `admin-action/index.js` 682 行仍含 `ROLE_GRANTS`+鉴权+schema | 维护成本 | 提审后最小版拆分（`authz.js`，A/B 必须全绿） |
| P3-1 | 空 catch 净约 155 处（窄类 25/25 已收口） | 多数有意设计 | 已结案口径；仅资金/CAS/发送主路径候选在解冻后复判 |
| P3-8 | 系统超时转争议不写 `complaint` 集合 | 自动转争议单时间线少 1 条卡片 | 已裁定不修（低危、读方有兜底） |

> 已结案/已偿还：P3-2（testmode 死开关保留）、P3-4（G3 提醒）、P3-5（S2_5 存量兼容）、P3-6（版本号区间补登）、P3-7（时段敏感测试）、P3-9（smoke 编码）、P3-11（CI 噪音）、P3-12（索引/审计清理，49 条台账）、P3-13（路由异常 5 项，A3/A4 决策保留）、P3-18（昵称/头像编辑）、P3-19（前端语法门禁）、P3-21（注释失真）、P3-22（`splitting_fen` 口径）、P3-24（空 catch 抽样结案）。

---

## §4 备份体系（B-1~B-6）

| # | 负债 | 状态 |
|---|---|---|
| B-1 | 自动备份路径（incr/full/verify） | ✅ incr/full/verify 自动路径已于 2026-10-22 实证；2026-11-03 加固（单函数超时/心跳/锁接管）后**未实跑**，下次自动窗口观察 |
| B-2 | lark 异地推送（PATH/token） | 已修（WorkingDirectory + 路径自解析）；**待自动窗口复核 `lark=OK`** |
| B-3 | 集合名单多处硬编码 | ✅ **已偿还（2026-11-05）**：新增 `scripts/collections-canonical.json` 规范源 + `scripts/check-collections-consistency.js` 门禁，校验 **5 处**（`raw-export.js` / `manual-backup.ps1` / `backup.ps1` / `action_export.js` / `action_import.js`）；已挂载 `verify` + `verify:offline`（VERIFY_ONLY），实测 38 集合 × 5 处一致 |
| B-4 | 飞书远端历史包清理 | 策略已定「保留最近 5 节点」；自动清理未实现，暂人工月度执行 |
| B-5 | CHECKSUMS 豁免 `functions_code\` | 已接受（完整性由云端实时下载机制保证） |
| B-6 | 加密备份密钥单点 | ✅ 已处理（用户已抄存异地副本） |

---

## §5 本会话新增负债（N-3~N-7）

| # | 负债 | 证据 | 影响 | 建议处置 |
|---|---|---|---|---|
| N-3 | **配置默认值多处重复**：`admin-action/index.js`（CONFIG_SCHEMA def）、`action_config_read.js`、`action_config_public.js`、`action_change_s2.js#s2Cfg`、`action_modify_extend.js#modifyCfg`、`miniprogram/config/index.js` 各自维护一套默认值 | 本次改 7+4 个键时需同步 5–6 处；`MODIFY.confirmHours` 曾出现 2 vs 24 不一致 | ✅ **已偿还（2026-11-05，`a1f3dac`）**：新增 `_shared/config_defaults.json`（canonical）+ `config_defaults.js`（`resolveModify`/`resolveS2Change`）+ `sync-config-defaults.ps1`（3 副本 SHA 校验）；CONFIG_SCHEMA 11 个 def、config_read/config_public/change_s2/modify_extend/order-timer 全部改调 resolver；新增 `check-config-defaults.js` 门禁 |
| N-4 | **死代码 `admin-web-frontend/src/views/Config.vue`**：`router` 已把 `/config` 重定向 `/operations`，该文件不进入构建，但仍含「⑤b S2 变更规则」与改期表单 | dist 中 0 命中 `s2Change*`；曾导致后台误判「表单已上线」 | ✅ **已偿还（2026-11-05，`a1f3dac`）**：文件已删除；`/config` 仍重定向 `/operations`，schema 驱动表单为唯一入口 |
| N-5 | **顶层键 + `modify_config` 嵌套双读兼容层**：`s2Cfg`/`modifyCfg` 均为「顶层优先、嵌套兜底」 | 两套存储口径长期并存，易出现「改了 A 没改 B」 | ✅ **已收口（2026-11-05，`a1f3dac`）**：`pick` 只读顶层键（`modifyMinLeadHours` 等 / `s2Change*`），删除 `modify_config` 嵌套兜底；部署后网关回读 4/2/72/24 与 1/1/2/120/15/1/2 正常 |
| N-6 | **测试单只能手工 DB 克隆**：无后台造单工具，靠 `.tmp-tcb/create-*.js` 克隆真实单 | 反复出现 `_id` 类型/ObjectId、确认位 0/4 等假故障（本会话 3 次） | ✅ **已偿还（2026-11-05，`a1f3dac`）**：新增 `scripts/test-order-tool.js`（`create` 克隆最近真实单 + 32 位字符串 `_id` + S2/S1 确认位；`cleanup` 软删并回读） |
| N-7 | **前端配置异步竞态**：bootstrap 异步拉 `config_public`，未完成时页面用 `config/index.js` 硬编码兜底 | 已用 `onLoad/onShow` 重算缓解（order-detail/chat），仍非强一致；断网时提示可能与后台不一致 | ✅ **已偿还（2026-11-05，`a1f3dac`）**：`bootstrap.js` 增加 `cloud_config_cache_v1`（7 天 TTL、仅 `CLOUD_MAP` 键）；启动先 hydrate 再异步刷新；断网/冷启动先用上次云端配置 |

---

## §6 维护与体检

- 规则体系季度体检：见[原清单 §规则体检台账](tech-debt-inventory-20261015.md)（下次到期 2027-01-05，`npm run rules:report`）。
- 每次处置负债：更新本表状态 + 日期 + 证据（命令回执/后台字段/真机谁验），并同步 [CHANGELOG](CHANGELOG.md) 与 [FUNCTION-REGISTRY](FUNCTION-REGISTRY.md)。
- 真值优先级：云端回读 > 本清单 > [HANDOFF-20261103](HANDOFF-20261103.md) > CHANGELOG > 助手记忆。

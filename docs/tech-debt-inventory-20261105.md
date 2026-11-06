# 找人帮忙项目技术负债清单（2026-11-05 刷新版）

> 盘点日期：2026-11-05（2026-11-06 增量刷新）　基线：体验版 **v1.6.95**（TOTAL 790.1 KB / 809,040 B，main 548.0 KB；与 v1.6.94 字节一致）；HEAD `8b0c92d`（工作区干净、已推送）
> 数据来源：云端回读（`config_get` / `config_public` / `nosql`）、[deploy-log](deploy-log.md)、[CHANGELOG](CHANGELOG.md)、[FUNCTION-REGISTRY](FUNCTION-REGISTRY.md)、本会话实测（`npm test` / 入口测试 / SHA 核验）
> 替代关系：本文件为**现行唯一**技术负债清单；[tech-debt-inventory-20261015.md](tech-debt-inventory-20261015.md) 转为**历史归档**（其日期口径、KNOWN 计数、REGISTRY 待验证数已过时）。
> 维护约定：每条处置后在本文标注「已偿还(日期/commit)」或「已决策不处理(原因)」，并同步 CHANGELOG / REGISTRY / deploy-log。

## 总览

| 分组 | 数量 | 状态 |
|---|---|---|
| P0 提审阻断类 | 5 | **5 全部结案**（P0-3 于 2026-11-06 取按函数实测：触发器仅 112 次/24h，与 cron 精确吻合） |
| P1 有意保留/临时放宽 | 8 | 6 已偿还/已核实；**P1-6 已决策保持 mock（2026-11-05）**；P1-3/4/5 有意保留 |
| P2 结构性债 | 13 | 5 已偿还；**P2-2/P2-3/P2-4 开放**；P2-7~10、12/13 真机待验 |
| P3 卫生/已接受 | 25 | 20 已结案/已偿还（2026-11-06 新增 P3-10 / P3-15⑤⑥⑦⑧ / P3-20④ / P3-25 / **P3-3**）；**真实开放 0 项**；P3-1 资金主路径已收口、P3-14b 为已批准零代码豁免 |
| 备份体系 B-1~B-6 | 6 | B-1/B-2 待自动窗口复核；**B-3/B-4 开放**；B-5/B-6 已接受/已处理 |
| 本会话新增 N-3~N-7 | 5 | ✅ 全部偿还（2026-11-05，`a1f3dac`，见 §5） |

关键计数（2026-11-05 实测）：`npm test` A/B **456 EQUIVALENT / 79 known-evolution**；入口测试 `order-action.entry.test.js` **67/67**；索引台账 **49 条**；`_shared` 同步门禁 **ALL OK**；空 catch 净口径约 **155 处**（窄类 25/25 已收口）。

---

## §0 上线前必须清零

| # | 事项 | 状态 | 证据 | 处置 |
|---|---|---|---|---|
| P1-6 | `realname_face_mode=mock` 为提审期临时放宽（原 `wx`） | ✅ 已决策保持（2026-11-05 你拍板） | 云端回读 `realname_face_mode=mock`（2026-11-05） | **发布不关回 `wx`、不执行 `realname_reset_simulated` 清打标**；风险接受：mock 下实名可自授（提审说明已写「当前版本不做人脸采集」）；真实核身接线单独立项（提审后） |
| P0-3 | 云函数调用额度（20 万/周期） | ✅ **已结案（2026-11-06）** | **按函数实测**（`tcb logs search` + `count(distinct request_id)`，11-05 11:54→11-06 11:54）：`zz-warmup` **64**（精确匹配 `0 */15 7-22`）、`order-timer` **48**（匹配 `0 */30`），触发器合计 **112 次/24h**，加 sub-call 约 240 次；全函数合计 ≈3,160。最大占用为 `admin-web` 824 + `admin-action` 732（后台页面常开轮询），非触发器所致。`tcb fn detail zz-warmup` 回读仅 1 条 `warmupTimer`（无旧双触发器） | 触发器分支**无超额风险**；若需压量，关掉常开的 admin-web 页面即可。`scripts/create-warmup-trigger.js` 依赖 `miniprogram-ci` 未装，触发器已存在时**禁止执行**（避免 §30 双份） |
| N-1 | REGISTRY **#144 / #145 / #146** 待真机 | ✅ **已结案（2026-11-06，自动化）** | `auto-test-s2-change.js` **44/44 PASS**（S1 8 位重置 / A-B 窗 / 接受只改该字段 / 拒绝超时）；`auto-ui-pages.js` **pass=9 fail=0 need_human=0**（含 3.12-runtime S1 页实测：`nextStep="四确认未完成"` 且无「申请变更」按钮；3.11 端到端「云端 4/2/72 ↔ 页面文案」；S2 正对照） | 已在 [runbook §3.10–3.12](runbooks/release-zero-checklist.md) 转 ✅；如后续改动该页面须重跑 `node scripts/auto-ui-pages.js` |
| N-2 | `is_test` 测试单残留 | ✅ 已清零（2026-11-05，2026-11-06 复跑） | `node scripts/test-order-tool.js cleanup` → 2026-11-05 `cleaned=6 remaining=0`；2026-11-06 `cleaned=31 remaining=0` | 全部软删（可回滚）并连软删 `order_confirmations`；真机前用 `create --status S1/S2` 重建 |
| 发布同轮 | 三订阅模板 `miniprogram_state` `trial → formal` | ⬜ 三模板均 trial | 云端回读 `sub_msg_templates`（2026-11-05） | 正式发布当天改，改后回读确认（HANDOFF T-8.15） |
| 发布同轮 | 补 2 条「自定义」隐私声明（手填手机号、设备信息） | ⬜ | [release-zero-checklist §4.2](runbooks/release-zero-checklist.md) | 后台指引补充，与端内 `privacy.wxml` 2.2/2.8 对齐 |
| 发布同轮 | `mock_payment_enabled` 口径拍板 | ✅ 已拍板保持开启（2026-11-05） | 云端回读 `true` | MVP 模拟支付；2026-11-05 你拍板**保持开启**，提审说明写明「不产生真实扣款」；接真实支付另立评估 |

---

## §1 P1 · 有意保留 / 已核实（8 项）

| # | 负债 | 状态 |
|---|---|---|
| P1-1 | 旧 `start_service`（S2→S3 直连）服务端保留、前端无入口 | ✅ 已偿还（2026-11-01 形态A，仅墓碑守卫） |
| P1-2 | 旧 `complete_service`（S3→S5 直连） | ✅ 已偿还（同上，由 `finish_apply`+`finish_confirm` 取代） |
| P1-3 | `start_photo` 服务端保留、S3 前端入口已移除 | 有意保留（全量 grep 0 命中，不回开） |
| P1-4 | `demand-match.hall_list` 标 deprecated 仍在线 | 有意保留；**下线动作留提审后**（静态零调用已证） |
| P1-5 | MVP 禁做项占位：短信发送、人脸三分支、mock 现金 `is_mock=true` | 有意保留；禁止接真实打款 |
| P1-6 | `realname_face_mode=mock` 临时放宽 | ✅ 已决策保持 mock（2026-11-05 你拍板：发布不关回 `wx`、不清打标；真实核身接线提审后立项） |
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
| P3-3 | `emergency_contact.phone` / `demand.contact_phone` 明文 | 隐私合规；`backfill-phone-enc.js` 仅覆盖 `user_account` | **✅ 已偿还（2026-11-06）** · 批1 读侧双读已部署：新增 `safety-report/phone_crypt.js` 副本并让 `safety-report` / `user-login` / `admin-action` / `order-action` / `demand-publish` 五处读取「有 `phone_enc` 解密、无则回退明文」，`contact_phone_mask` 优先展示；门禁 273 files / A/B 456，5 函数部署 success + SHA 回读 MATCH。**批2 写侧加密 ✅ 2026-11-06 已部署**（`set_emergency_contact` / `user_ec_update` / `demand-publish` 三处写入改 `phonePatch` + `phone: _.remove()`，密钥缺失 fail-closed；门禁 A/B 456，3 函数 SHA 回读 MATCH）**批3 存量回填 ✅ 2026-11-06 已执行**（先只读备份到 `.backup-p3b3-2026-11-06T13-52-59`：EC 12 / demand 1286 文档，SHA256 `3A1AE691DA595078` / `76BC9980FD41B754`；`--apply` 回填 EC 12/12、demand 100/100，两阶段「先写密文校验齐全再删明文」；独立复检：密文文档 12+100 **解密往返+HMAC+掩码全一致**、与原备份明文**交集 100%**、残留明文 **0**）。**P3-3 结案**；`demand.service_target.phone` 未纳入（用户确认暂不做）；真机：**EC 回显 ✅ 2026-11-06**（截图完整回显 `13568965386` / `13980000000`，另证 30 天频控 toast「2026-11-16 后可再次修改」生效），**SOS 弹窗 ✅ 2026-11-06**（订单 `#TEST840710820J` 详情弹出「李老师(伙伴)」「老三(配偶)」+ 报警110/急救120，两条联系人由 `safety-report.getMyContacts` 解密读取成功；实际呼出需再点一次确认号码非空） |
| P3-10 | `KNOWN_EVOLUTION` 3 条 stale（`my_orders_partner`/`my_orders_user`/`notice_list`） | 声明表与运行时差集；当前运行时 **79 例** | ✅ **已偿还（2026-11-03，复核于 2026-11-06）**：`ab_equivalence.js` L672 已留档「三条白名单已 stale，删除以免漂移被静默兜住」；当前 A/B 仍 **456 EQUIVALENT / 79 known**，三条独立行为由 `order-action.entry.test.js` 守护 |
| P3-14b | `bootstrap.js` take 链 `navigateTo` 的 `fail: () => {}` 静默 | 栈满仅丢一次跳转 | 已批准「零代码」豁免；触碰该文件时同修 |
| P3-15 | 法律合规残留：⑤版本库不可用时回填源为未保存表单；⑥「删除」实为「停用」措辞不统一；⑦满态判定误报；⑧批量发布快照完整性待专项 | admin-web/legal 体验与一致性 | **⑤⑥⑦⑧ 全部 ✅ 已偿还（2026-11-06）**：⑤`openEdit` L399-402 在 `legal_doc_get` 失败时 `ElMessage.error` 后 `return`（fail-closed）；⑥`Legal.vue` L59/L82/L114 统一「停用（删除=停用）」措辞；⑦L74/L287 满态判定改为「已配置数 ≥ 场景总数」；⑧`action_legal_doc.js#writeVersion` 三处加固——版本号读取失败 **fail-closed**（原 `.catch(()=>({data:[]}))` 会静默当 0 写 v1）、归档前先取旧生效版 `_id` 并在 `add` 失败时**恢复 archived→published**（消除「旧版已归档、新版不存在」的快照空洞）、`add` 失败返回 `legal_add_fail` 并 `log.e` 留痕 |
| P3-16 | 工作台信用分两源（`user_account.partner_credit_score` vs `partner_profile.score`） | 可能出现「分数 L2 段却显示 L3」 | **✅ 已偿还（2026-11-05）**：`balance_info` 已返回 `credit_score`（取 `partner_profile.score`）；`workbench` 收敛为单一展示字段 `creditScore`（无档案回退账户原值），WXML 不再直接读 `user.partner_credit_score` |
| P3-20④ | 首页冷启动 `fetchUser` 与 `refreshNoticeBadge` 各调一次 `peek_login` | 配额微浪费 | ✅ **已偿还（复核于 2026-11-06）**：`pages-v2/index/index.js` L135 新增 `__badgeAt` 标记——fetchUser 的 `peek_login` 已含未读数，首次 `onShow` 的 `refreshNoticeBadge` 命中标记即跳过；L142-144 另有 30s 节流 |
| P3-23 | `S2_6` 预告片文案缺「待」字 | 真实态与预告态易混 | **✅ 已偿还（2026-11-05 复核）**：`order-progress/index.js` 已有 `PREVIEW_NAME = { S2_6: '待发起开始履约' }` 并在非当前态分支套用 |
| P3-25 | `admin-action/index.js` 682 行仍含 `ROLE_GRANTS`+鉴权+schema | 维护成本 | **✅ 已偿还（2026-11-06）**：新增 `authz.js`（`ADMIN_ROLE_LABEL` / `ADMIN_ROLES` / `ROLE_GRANTS` 68 条 + `canAccess` / `forbiddenMsg`）；`index.js` 只保留「取角色 → 判定 → 拒绝留痕」编排。等价性证明 **AUTHZ-EQUIV 4/4**：action 集合一致（68）、每条放行角色一致、`canAccess` 与旧表达式 **276 组全同值**、`forbiddenMsg` 逐字一致；已部署并 `code download` 回读 `index.js` / `authz.js` **SHA256 均 MATCH** |
| P3-1 | 空 catch 净约 155 处（窄类 25/25 已收口） | 多数有意设计 | **资金/一致性主路径 ✅ 已收口（2026-11-06 复判）**：`payment-mock/action_pay.js` 两处补偿回写（支付失败回滚 `paid_fen`、退款失败回滚 `refunded_fen`）原为 `.catch(()=>{})` 完全无痕，改为 `reportCompensateFail()` → `log.e` + `platform_event(P0, pay_compensate_fail)`；`order-action/action_change.js` L330 确认位回滚补 `log.w`。其余空 catch 维持「有意设计」口径，解冻后复判 |
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

### §5.1 专家核验新发现（2026-11-06；C1/C2 登记不处理，C3 已修待部署验证）

| # | 负债 | 证据 | 影响 | 处置 |
|---|---|---|---|---|
| C1 | `zz-seed-orders` 的 `genNo`（秒级时间戳 + 3 位 base36，约 9.7 万空间）同秒批量造单可能撞 `uk_order_no`；`index.js` L561/L756 直接 `add` 无重试且 `.catch(()=>{})` 吞错，仍按 `tasks.length` 报「全建成」 | `cloudfunctions/zz-seed-orders/index.js:661-664`、`L561`、`L596`、`L756` | 演示/种子数据**假成功**（少建却显示完成） | 提审后处理：`genNo` 加随机位 + 失败计数如实返回；当前不影响真实下单 |
| C2 | `admin-action` 的 `order_main` 导入 `mode='append'` 无冲突兜底：任一已存单号（含软删占位）会让整块 500 条 add 抛 `E11000`，灾备恢复中断 | `cloudfunctions/admin-action/action_import.js:70-74`（`replace` 因先硬删才安全，见 `:59-66`） | 灾备恢复流程风险 | 提审后处理；文档已约束 `order_main` 只用 `mode='replace'`（见 [03-data-model](dev-manual/03-data-model.md) L87） |
| C3 | `init-db` 的 `purge_test_data` 删除范围过宽：筛选只做 `where({is_test:true})` 后 `remove()`，而 `is_test` 只是「参与方命中 `admin_config.test_openids`」的打标，**真实单号（`ORD…`）的历史单也会被打标**；云端实测 `is_test:true` 未删单 **91 条中 86 条非 `TEST840710820` 前缀**，且参与方去重后**有 1 个不在现白名单** → 一次 `confirm:'PURGE'` 会硬删真实用户历史单且不可恢复，与本模块「绝不误删真实用户数据」直接冲突 | 原 `cloudfunctions/init-db/index.js:312-390`（`demand`/`order_main` 两处 `where({is_test:true}).remove()`） | 误删真实历史单（硬删，无软删兜底）；取证脚本 `probe-purge-scope-20261106.js` 回执已留档于 CHANGELOG 2026-11-06 行 | ✅ **已修（2026-11-06，代码层）**：默认范围收紧为夹具前缀 `TEST840710820` + 关联 demand 精确匹配；`scope:'all_istest'` 须**同时**传 `expect_orders=<实测数>`（不符返回 `idb_purge_expect_mismatch`）；删除语句由 `where({is_test:true})` 改为 `where({_id:_.in(ids)})`；dry-run 新增 `preview{scope,out_of_scope_orders,sample_orders}`；审计 payload 带 `scope`。**待办：运行时 dry-run 未实跑（`admin_config.env=prod` + `admin_openids` 非空，控制台测试面板无真实 OPENID 会被 `idb_forbidden` 拦下；CLI 不能 invoke，§38）→ 改用两层替代验证：①「SHA256 字节一致 + 只读复算（夹具 5 单 / 越界 86 单）」；②2026-11-06 进程内 mock SDK 契约测试 **21/21 PASS**（默认 dry-run 只统计、默认真删只删夹具前缀且被打标真实单与未关联 is_test demand 均存活、all_istest 缺 expect_orders 返回 `idb_purge_expect_mismatch`、全量 dry-run/真删数量一致、审计 scope 正确）** |

---

## §6 维护与体检

- 规则体系季度体检：见[原清单 §规则体检台账](tech-debt-inventory-20261015.md)（下次到期 2027-01-05，`npm run rules:report`）。
- 每次处置负债：更新本表状态 + 日期 + 证据（命令回执/后台字段/真机谁验），并同步 [CHANGELOG](CHANGELOG.md) 与 [FUNCTION-REGISTRY](FUNCTION-REGISTRY.md)。
- 真值优先级：云端回读 > 本清单 > [HANDOFF-20261103](HANDOFF-20261103.md) > CHANGELOG > 助手记忆。

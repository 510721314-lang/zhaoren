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
| P2 结构性债 | 14 | 5 已偿还；**P2-2 已偿还（4 页 28 条，2026-11-07）/ P2-3 已偿还 / P2-4 接受**；**P2-7~10、12/13 已转自动化通过（2026-11-06）**；**P2-14 已决策关闭不拆（2026-11-08）** |
| P3 卫生/已接受 | 36 | **21 已结案/已偿还（2026-11-12 新增 P3-35 清理；2026-11-06 新增 P3-10 / P3-15⑤⑥⑦⑧ / P3-20④ / P3-25 / P3-3）**；**2026-11-09 新增 5 项开放（P3-26~P3-30，见 §3.1）**；**2026-11-11 评审新增 3 项开放（P3-31~P3-33，见 §3.2）**；**2026-11-12 漂移事故处置新增 3 项开放（P3-34~P3-36，见 §3.3；P3-35 当日已结案）**；**2026-11-12 分拆登记 P3-37~P3-41（见 §3.4/§3.5）**；**2026-11-13 P3-39/P3-42/P3-43 已偿还、P3-40/P3-41 开放**；P3-1 资金主路径已收口、P3-14b 为已批准零代码豁免 |
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
| 发布同轮 | 三订阅模板 `miniprogram_state` `trial → formal` | ✅ **已提前执行（2026-11-07）** | 云端回读 `sub_msg_templates` 三值均 **`formal`**，`tmpl_id`/`fields`/`page` 逐字未变（`nModified=1`） | 你裁定「系统完善不受体验版约束，必要时可重传体验版」；回滚 = 同命令改回 `trial`（1 分钟） |
| 发布同轮 | 隐私指引按 **11 项标准/自定义声明** 重新填报 | ⏸ 待后台填报（你） | [release-zero-checklist §4.2](runbooks/release-zero-checklist.md) | **2026-11-08 口径订正**：手机号/设备信息走**标准项**，非自定义（原「补 2 条自定义」文案作废）；判据 = 11 项勾选 + 每条用途描述齐全 + 状态「已通过」；**B-1 ✅ ≠ 本条清零**（本条 = HANDOFF T-7.3，当前唯一提审阻塞项） |
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
| P2-2 | 前端页面级单测缺失（纯函数已跨目录覆盖；`setData`/跳转/按钮态仍靠真机） | 回归依赖人工 | **✅ 已偿还（2026-11-07）**：新增 `scripts/mp-page-harness.js` 页面沙箱 + **4 个页面 28 条断言全 PASS**——workbench 8（W1-W8）、pay 8（Y1-Y8）、order-detail 6（O1-O6）、publish 6（P1-P6），覆盖云调用契约 / 金额分转元 / 口径映射与兜底 / 按钮态 / 防连点 / 脱敏透传 / nextStep 视角 / SOS 兜底 / AA 弹窗 / 代发签字强制；**零源码改动、零新依赖**，`scripts/pages-*.test.js` 自动纳入 `npm test`。其余页面按需增量 |
| P2-3 | 9 份 `_orig_baseline.js` 约 1.07 万行冻结常驻并随函数部署 | 包体/暴露面 | **✅ 已偿还（2026-11-05）**：迁移至 `cloudfunctions_baseline/<fn>.js`（内容冻结、不进部署）；测试时临时副本 `__baseline_tmp.js` 退出即删；9 函数重部署后包体合计约 **-170 KB**，回读 baseline=NONE ×9 |
| P2-4 | `_shared` 多副本物理同步（openid 17 份 / logger 16 份 / audit 11 份） | 改规范源须跑 sync | 接受（`check-shared-sync` 门禁已守）；**2026-11-07 用户裁定维持现状，T-7.6-P2-4 闭环、零动作** |
| P2-7 | A10 发布表单快照 | ✅ 自动化通过（`auto-ui-pages.js` P2-7，路径 20/20 同源） | 2026-11-06 |
| P2-8 | A11 发布中断「继续完成发布」横幅 | ✅ 自动化通过（P2-8：渲染+触发+跳转） | 2026-11-06 |
| P2-9 | B13 首页「继续完成入驻」横幅 | ✅ 自动化通过（P2-9：step/total/label + EC 分支） | 2026-11-06 |
| P2-10 | B11 八步入驻链（3a/3b/3c 已实施） | ✅ 自动化通过（P2-10：8 步、路由全注册） | 2026-11-06 |
| P2-12 | 工作台「今日待履约」口径（已改 `today_pending`） | ✅ 自动化通过（P2-12 静态 + 12b 渲染） | 2026-11-06 |
| P2-13 | 工作台「本周收入」口径（已改 `week_income_fen`） | ✅ 自动化通过（P2-13 静态 + 13b 渲染 `0.00`） | 2026-11-06 |
| P2-11 | 工作台 SOS 上报（已偿还）；残留「无进行中订单时无法关联 order_id」 | 产品边界 | **✅ 已偿还（2026-11-12 回填）**：2026-11-07 用户裁定立项「自由求助」→ 当日已实施上线（P2-11 feat：`free_sos`/`free_sos_status`/`free_sos_resolve` 三 action + workbench 无单入口，见 CHANGELOG 2026-11-07）；REGISTRY **#148 已转「已验证」**（自动化口径，2026-11-12；T-9.1 D 组自动化收口 + 真机抽验随 T-9.1 全案闭环，X-7 禁重开）。提审口径维持「订单内 SOS + 自由求助」双通道，不阻塞提审 |
| P2-14 | 前端三个巨型页面：`order-detail.js` **1386 行**、`chat.js` **1081 行**、`publish.js` **1078 行**（2026-11-08 实测，不含 node_modules） | 可读性/维护成本 | **2026-11-08 用户裁定：明确关闭，不拆**。不拆理由：① 三者均为 `Page({})` 单对象承载生命周期 + 事件 + setData，抽到 `utils` 要改 `this` 绑定与渲染路径，属 §5 高危（UI/交互/键盘/安全区），改完必须 iOS+Android 真机各验；② `chat.js` 属 IM 前置限制（附录A 第 5 条）能力链路、`publish.js` 属发单主链路、`order-detail.js` 属订单 13 态展示，回归成本远高于收益；③ 行数大但**无 action 分发复杂度**（与 T-7.26 拆分的「线性 `action ===` 链」不同型），拆分不减认知负担。**重开条件**：若后续要做，须先用 [mp-page-harness.js](file:///c:/zhaoren/scripts/mp-page-harness.js)（P2-2 已建）补齐该页断言再动，禁止裸拆 |

> 已偿还：P2-1（前端巨页拆分）、P2-5（题库 SSOT）、P2-6（门禁覆盖面 F3/F4/F5/F6/F7+⑥，2026-11-02 收尾）。
> P2-14 为 2026-11-08 复核后对「剩余三个巨型页面」的**关闭裁定**（不拆），与 P2-1 不冲突：P2-1 针对当轮已拆页，P2-14 明确不再扩拆。

---

## §3 P3 · 卫生级（10 项开放）

| # | 负债 | 证据/影响 | 处置 |
|---|---|---|---|
| P3-3 | `emergency_contact.phone` / `demand.contact_phone` 明文 | 隐私合规；`backfill-phone-enc.js` 仅覆盖 `user_account` | **✅ 已偿还（2026-11-06）** · 批1 读侧双读已部署：新增 `safety-report/phone_crypt.js` 副本并让 `safety-report` / `user-login` / `admin-action` / `order-action` / `demand-publish` 五处读取「有 `phone_enc` 解密、无则回退明文」，`contact_phone_mask` 优先展示；门禁 273 files / A/B 456，5 函数部署 success + SHA 回读 MATCH。**批2 写侧加密 ✅ 2026-11-06 已部署**（`set_emergency_contact` / `user_ec_update` / `demand-publish` 三处写入改 `phonePatch` + `phone: _.remove()`，密钥缺失 fail-closed；门禁 A/B 456，3 函数 SHA 回读 MATCH）**批3 存量回填 ✅ 2026-11-06 已执行**（先只读备份到 `.backup-p3b3-2026-11-06T13-52-59`：EC 12 / demand 1286 文档，SHA256 `3A1AE691DA595078` / `76BC9980FD41B754`；`--apply` 回填 EC 12/12、demand 100/100，两阶段「先写密文校验齐全再删明文」；独立复检：密文文档 12+100 **解密往返+HMAC+掩码全一致**、与原备份明文**交集 100%**、残留明文 **0**）。**P3-3 结案**；`demand.service_target.phone` 未纳入（用户确认暂不做）；真机：**EC 回显 ✅ 2026-11-06**（截图完整回显 `13568965386` / `13980000000`，另证 30 天频控 toast「2026-11-16 后可再次修改」生效），**SOS 弹窗 ✅ 2026-11-06**（订单 `#TEST840710820J` 详情弹出「李老师(伙伴)」「老三(配偶)」+ 报警110/急救120，两条联系人由 `safety-report.getMyContacts` 解密读取成功；实际呼出需再点一次确认号码非空）；**2026-11-07 体验版 v1.6.96 复验**：EC 完整号 ✅（`13568965386`）、SOS 弹窗 ✅（李老师(伙伴)/老三(配偶) + 报警110/急救120，重复求助弹幂等提示）、**admin-web 用户详情掩码 ✅**；同日发现 **需求详情联系电话缺项**（云端已回传 `contact_phone_masked`，前端未渲染）→ 已修 1 文件 +3 行，待真机复验 |
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

### §3.1 2026-11-09 BUG 扫描单独立项（P3-26~P3-30，开放）

| # | 负债 | 证据（文件:行号） | 影响 | 建议处置 |
|---|---|---|---|---|
| P3-26 | 单号/流水号日期前缀按 UTC 本地 getter 生成 | `payment-mock/index.js:46`、`order-create/index.js:123`、`demand-publish/index.js:187`、`admin-action/index.js:237` | 北京 00:00–07:59 建单前缀为前一日，仅影响对账辨识；唯一性由随机位 + 唯一索引保证，不受影响 | **✅ 已修并部署（2026-11-09）**：四处统一 +8 + `getUTC*`；5 函数串行部署 + 回读 SHA256 全 MATCH（见 deploy-log）；待真机抽验单号日期前缀 |
| P3-27 | 紧急联系人 30 天冷却提示日期按 UTC | `user-login/action_misc.js:27` | 凌晨时段「X 后可再次修改」显示早一天 | **✅ 已修并部署（2026-11-09）**：改 +8 + `getUTC*`；user-login 部署 + 回读 13/13 MATCH；待真机抽验提示日期 |
| P3-28 | `order-timer` 巡检游标/心跳写入失败被 `.catch(() => {})` 静默 | `order-timer/index.js:208`、`:251` | 游标不推进会导致巡检窗口重复或告警重复，且无日志可查 | **✅ 已修并部署（2026-11-09）**：两处改 `log.w` 留痕，控制流不变；18/18 SHA256 MATCH（见 deploy-log） |
| P3-29 | `order-create` 配置读取失败回退硬编码费率/门槛 | `order-create/index.js:58-70` | DB 瞬时失败窗口内按 `platform_fee_rate_fen=1000`、`min_credit_*=600`、`youth_limit_fen=20000` 建单，可能与线上配置不一致 | **✅ 已修并部署（2026-11-09，用户拍板 fail-closed）**：`getConfig` 失败返回 null，建单返 `order_config_unavailable`、签署返 `sign_config_unavailable`；13/13 SHA256 MATCH（见 deploy-log） |
| P3-30 | `app.js` `cloudCall` 超时重试不中止在途调用 | `miniprogram/app.js:79-104` | 读类超时最多产生 3 次实际调用，占用基础版配额（数据幂等无错） | **✅ 已修（2026-11-09，随下次体验版上传生效）**：超时重试复用同一在途 Promise，仅真实失败才发起新调用；总等待预算不变 |

> 立项依据：[20261109-bug-scan.md](session-log/20261109-bug-scan.md)。处置按 §3「先说后做 + 最小改动」逐项走；**当前（2026-11-09）：P3-26/27/28/29 已修并部署；P3-30 已修，随下次体验版上传生效**。

---

## §3.2 2026-11-11 方案A 双专家评审登记（P3-31~P3-33，开放）

| # | 负债 | 证据（文件:行号） | 影响 | 建议处置 |
|---|---|---|---|---|
| P3-31 | extend 通道 reason_type 校验零测试覆盖 | `oa_extend_reason_type` 全仓仅命中实现（`action_modify_extend.js:248`）与 docs/API.md，`order-action.entry.test.js` 与 `auto-test-s2-change.js` 均无 extend 类型用例（后者 grep `action: 'extend'` 零命中） | extend 类型校验回归无断言守护（s2_change/modify 均有「字段缺失」型用例，独 extend 缺） | 触碰 `action_modify_extend.js` 时补「缺失型拒绝 + 2-20 字文案放行」两条入口用例 |
| P3-32 | 同类校验字数上限口径差 | 后台自由文案写入限 2-10 字（`action_config_set.js:424-426`）vs 客户端提交放行 2-20 字（`order-action/index.js:133`） | 管理者配不出 11-20 字选项；11-20 字仅旧版硬编码/直调云函数可达，展示端原样拼接无截断风险 | **登记不修（2026-11-11）**；若统一到 2-20 需同步改 config_set + config_public 两处与 UI maxlength |
| P3-33 | reason_type 绕过占位词/内容安全（与 reason 双标） | `REASON_PLACEHOLDER_EXACT`（`order-action/index.js:135`）仅拦 reason；reason_type 只过 `normalizeReasonType`（`action_modify_extend.js:72-74`/`:247-249`） | 管理者配置「临时有事」为选项后，用户选中提交直接入库；同文案作 reason 会被拒 | **已决策登记口径（2026-11-11）**：type 是分类非自述，值源自管理者配置且 config_history 留痕——「管理者配置即信」，不加重试黑名单 |

> 立项依据：[FUNCTION-REGISTRY #167](FUNCTION-REGISTRY.md)（方案A 双专家评审 B 侧产出）。**当前（2026-11-11）：三项均开放，随对应文件触碰时逐项走「先说后做」。**

### §3.3 2026-11-12 改期规则配置漂移事故处置登记（P3-34~P3-36，开放）

| # | 负债 | 证据（文件:行号） | 影响 | 建议处置 |
|---|---|---|---|---|
| P3-34 | 改期/加时发起时前端无提前量预检 | `order-detail.js:1057-1088` onModify 仅查 S2/次数/冻结/在途，提前量在提交时才拦（`:1164-1167`）；服务端 `action_modify_extend.js:47-56` 校验完好无资损 | 用户体验：填完表单才被拦；前端预检若用缓存值（bootstrap ≤7 天）有误拦风险 | **登记暂缓（2026-11-12 双专家 2/2）**：提审后做；预检阈值须标注「缓存可能滞后，以服务端拒绝为最终裁决」 |
| P3-35 | admin_config 遗留嵌套 `modify_config` 死数据 | 实测 `admin_config(_id:"global").modify_config={confirmHours:24,maxSpanH:72,maxTimes:2,minLeadHours:4}`（11-10 分钟制迁移漏清旧结构）；`resolveModify` 只读顶层键（`order-action/config_defaults.js:16-26`），规则页保存只写顶层 | 当前零行为影响；但任何人恢复嵌套读取或重跑迁移会出诡异问题；巡检脚本已 WARN | **✅ 已清理（2026-11-12，用户授权）**：tcb nosql `$unset`（q 锁 `_id:"global"`+is_deleted 守卫）`nModified=1`，回读 `modify_config` 已消失、顶层键全完好（4/2/72/10）；复跑 `npm run audit:config` 嵌套 WARN 消失；探针 FAIL 属直写无留痕预期现象（人工确认） |
| P3-36 | 巡检脚本 WARN 噪音未收敛 | `scripts/audit-config-drift.js` 首跑 23 条「偏离默认」WARN，多为有意运营配置（接单上限 40/费率区间/提醒分层等） | 噪音稀释信号，长期会掩盖真漂移 | 加 baseline 文件（每条偏离带 reason/日期留痕），脚本读 baseline 抑制已确认偏离；与 P3-35 一并做 |

> 立项依据：[FUNCTION-REGISTRY #169](FUNCTION-REGISTRY.md) + [CHANGELOG 2026-11-12](CHANGELOG.md)（改期规则 2/1/2 全案：写入者=用户本人 11-08 22:38 后台「改期设置」，留痕链完好；三次验证者修正见 CHANGELOG）。**当前（2026-11-12）：三项均开放。**

### §3.4 2026-11-12 前端巨页分拆批次2a/2b 登记（P3-37~P3-38，开放）

| # | 负债 | 证据（文件:行号） | 影响 | 建议处置 |
|---|---|---|---|---|
| P3-37 | `TM_FIELD` 双源常量 | `miniprogram/pages-v2/chat/chat.js:11` 与 `miniprogram/utils/confirm-flow.js:122` 各定义一份 `{TM1:time,TM2:location,TM3:content,TM4:fee}`（归属表 v2.0 决策 D-1 裁定局部复制） | 后续增删模板/确认字段需两处同步，漂移会导致模板卡选项映射错位（静默，无报错） | **仍开放（2026-11-12）**：C19 只钉住 TM1，TM2-TM4 未断言；若后续再拆，统一迁 `config/enums.js`（与 `TM_TEMPLATES` 同域） |
| P3-38 | 分拆后模块体积逼近页面 | `miniprogram/utils/confirm-flow.js` 547 非空行（= chat.js 670 的 81.6%，其中批次2b 占 322 行） | 模块已承担「数据加工 + 确认链 + 编辑/提交/响应链」三域，继续堆叠会重现巨页问题（只是换了文件） | **登记不动作（2026-11-12 双代理 B#4）**：阶段B 前评估按域再分区（confirm-view / confirm-action / change-submit）；不设硬阈值，避免为拆而拆 |

### §3.5 2026-11-12/13 双代理检核登记（P3-39~P3-43；P3-39/P3-42/P3-43 已偿还，P3-40/P3-41 开放）

| # | 负债 | 证据（文件:行号） | 影响 | 建议处置 |
|---|---|---|---|---|
| P3-39 | `_acting` 页级互斥锁可能永久占用（继承缺陷，非分拆引入） | `miniprogram/utils/order-modal.js:8-14`（旧实现）：先置锁后调 `wx.showModal`，仅 `fail` / Promise reject 释放 | 若 `wx.showModal` 同步抛错，或 `opts.success` 返回永不 settle 的 Promise（云调用挂起），整页二次确认永久锁死 | **已偿还（2026-11-13，用户 §2 书面批准，`5cbfa2e`）**：`order-modal.js` 改「弹窗期不计时 + 业务期 20s 租约」（句柄 `page.__actingTimer`，正常结算/失败仍提前 release）；`order-poll.js:13-20` `clearTimers` 连锁清句柄并置 `_acting=false`（onHide/onUnload 已调，`order-detail.js` 零 diff）；新增 O19（租约到期 + clearTimers 放锁）/O20（弹窗期不计时）守护。`wx.showModal` 同步抛错分支仍不吞异常（§7），维持 fail 回调处置 |
| P3-40 | `__confLoaded` 纯死写 | `miniprogram/utils/confirm-flow.js:45` 写入；全仓 0 处读取 | 误导后续读者以为存在「已加载」分支判断 | 下一轮清理时删除该写（与 `firstLoad` 弃置同口径，当前不影响行为） |
| P3-41 | harness modal 记录 JSON clone 丢回调 | `scripts/mp-page-harness.js:89` `clone(src)` 后 `success/fail` 不可见 | 后续用例若断言 `m.success(...)` 会得 `undefined` 而假通过 | harness 头注标注「modal 记录只能断言数据字段；回调请用 `__confirm`/`__cancel`/`__fail`」 |
| P3-42 | 备份分页失败曾静默产出不完整数据 | `.predeploy/manual-backup.ps1:86-97`（旧实现 `[SKIP]` 直接 break，`truncated` 仍为 false）；实例：`zhaoren_backup_20261112-1434\db\order_main.json` total=406 / list=100 / truncated=false | 灾备文件缺行且无任何告警，恢复时按「完整备份」使用会丢数据 | **已修（2026-11-12 T-13.3）**：失败重试 1 次 + 仍失败置 `truncated=true` 并打 `[FAIL]`；**根因已定位（2026-11-13）**：PS5.1 `Invoke-RestMethod` 对 ~118KB 大响应返回 **String**（page2 起），`$resp.ok` 为 $null 被误判失败；且 `ConvertFrom-Json` 遇空键名报「参数 name 的值无效」。已改 `JavaScriptSerializer`（MaxJsonLength=64MB）解析 + L6 下载超时 90→300s；order_main 分页 406/406 已实证 |
| P3-43 | A/B 门禁偶发假红（临时基线文件跨进程竞态） | `cloudfunctions/_shared/ab_equivalence.js`（旧固定名实现 `:622` 定义 `__baseline_tmp.js`、`:649` 启动预删；读副本在 `:727`）；首次 `npm test` 报 ENOENT，重跑通过（2026-11-13 双代理 B#5 实测） | 并发/清理竞态时门禁假红，误阻塞放行或诱发重跑掩盖真问题 | **已偿还（2026-11-13，`2653ef4`）**：临时名改 `__baseline_tmp_<pid>_<ts>.js`（进程唯一）+ 去掉启动预删 + SIGINT/SIGTERM 清理 + 主循环 try/finally 且以 `process.exitCode` 退出；`.gitignore` 扩 `__baseline_tmp*.js`。实证：并发双进程 A/B 均 **455 EQUIVALENT**、stderr 空、残留 **0** |

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

### D4 组 · 2026-11-08 双专家核验结论（原「后端同源缺陷」4 条 + 1 条新疑点）

| ID | 声称/问题 | 代码位置 | 结论与依据 | 处置 |
|---|---|---|---|---|
| D4-1 | 评审曾报「`action_modify_extend.js` 改期跨度校验失效（单位/方向/类型错）」 | `cloudfunctions/order-action/action_modify_extend.js:54`、`config_defaults.js:22` | **经双专家 2/2 核验：声称不成立**。实现为 `Math.abs(newTs - Number(start_time))/3600000` 与 `maxSpanH`（默认 72，钳 1–720）比较，单位/方向/归一化均正确 | **不修**（2026-11-08）：唯一穿透条件是订单缺 `start_time`（全库 4 条均为测试单，`NaN > 72` 恒假），真实用户不可达；已补边界单测 `order-action.entry.test.js`「改期跨度超上限拒绝（oa_modify_span）」防回归 |
| D4-2 | 评审曾报「`action_query.js:336` 的 `end_time` 为字符串拼接，与数字时间戳比较恒不成立」 | `cloudfunctions/order-action/action_query.js:336`（`end_time` 仅 L336/L354 两处） | **经双专家 2/2 核验：声称不成立**。实为纯数字加法 `start_time + duration_h*3600*1000`；L354 的 `gapMin` 只做列表渲染的通勤间隔提示，不参与任何 DB 过滤/排序 | **不修**（2026-11-08）：仅缺 `start_time` 的单会让 `gapMin=NaN`、通勤紧张预警静默（同上 4 条测试单）；如未来出现字符串型脏单，`+` 才会退化为拼接，届时再加 `Number()` 兜底 |
| D4-3 | 评审曾报「`_shared/no_show_rules.js:49` 爽约申诉窗口误判（多副本可能不同源）」 | `cloudfunctions/_shared/no_show_rules.js:49-56`；副本 `order-action` / `admin-action`（共 3 份） | **经双专家 2/2 核验：声称不成立**。L49 仅为 `Number(start_time)||0`，真窗口在 L51（`now>=start`）与 L54（`now<=start+48h`，钳 1–168）；三副本 SHA256 一致（逐字节同源）；`demand-publish/action_publish.js:41` 限时长 ≤12h，48h 窗口不会误杀 | **不修**（2026-11-08）：已有 `no_show_rules.test.js:70-71` 覆盖 48h 通过 / +1ms 拒绝；误判方向若发生只会「关闭」窗口而非放大 |
| D4-4 | 评审曾报「`payment-mock/action_account.js:32` 对 Date 类型字段用 `_.gte(数字)`，恒查不到」 | `cloudfunctions/payment-mock/action_account.js:28/32/34` | **经双专家 2/2 核验：声称不成立**。L32 查 `start_time`、L28/L34 查 `service_completed_at`，抽样 200 条全为 `$numberLong`，`$type:"date"`/`"string"` 计数均为 0，类型匹配 | **不修**（2026-11-08）：无漏算路径；该文件真正的疑点是时区（见下一行） |
| D4-5 | `payment-mock/action_account.js` 用**本地时区 getter** 构造「今日/本周一/本月 1 日」边界，而云函数运行时 TZ=UTC ⇒ 日界实为北京时间 08:00 | `cloudfunctions/payment-mock/action_account.js:9-20`、`:32`；对照 `cloudfunctions/order-action/index.js:40-41`（自注「云函数 TZ=UTC」） | 北京 00:00–08:00 起服务的单在「今日待履约」被归到前一日；每月 1 日 00:00–08:00 的已结算收入计入上月「本月收入」（D4-4 的**真实**相邻缺陷，原声称指错了字段类型） | **✅ 已修（2026-11-08，commit `e35e498`，已部署）**：只读聚合取证（双专家 1/1 提出 + 主对话代码级复核成立）——①**S2/S2_5/S3/S3_5 共 113 条，其中 start_time 落在北京 00:00–07:59 的有 22 条**（0点0/1点0/2点2/3点1/5点1/6点9/7点9），占比 19.5%，即「今日待履约」跨日错归**实际可触发**；②已结算单（S5/S8/S9）的 `service_completed_at` 最早小时为 8 点，00:00–07:59 **0 条**，故「本月收入」错归目前**无实际发生**（仅口径隐患）。实施：`CN_OFFSET=8h` + `Date.UTC(...)` 组合算日界（不依赖运行时 TZ），并支持 `event.now` 注入；新增单测钉死下发 DB 区间 = 北京当日 00:00 起 24h；`verify:offline` EXIT=0（tests 868）、payment-mock 串行部署 + `code download` SHA256 一致 |

---

## §6 维护与体检

- 规则体系季度体检：见[原清单 §规则体检台账](tech-debt-inventory-20261015.md)（下次到期 2027-01-05，`npm run rules:report`）。
- 每次处置负债：更新本表状态 + 日期 + 证据（命令回执/后台字段/真机谁验），并同步 [CHANGELOG](CHANGELOG.md) 与 [FUNCTION-REGISTRY](FUNCTION-REGISTRY.md)。
- 真值优先级：云端回读 > 本清单 > [HANDOFF-20261103](HANDOFF-20261103.md) > CHANGELOG > 助手记忆。

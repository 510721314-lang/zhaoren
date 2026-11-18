# 找人帮忙项目技术负债清单（2026-11-05 刷新版）

> 盘点日期：2026-11-05（2026-11-06 增量刷新）　基线：体验版 **v1.6.95**（TOTAL 790.1 KB / 809,040 B，main 548.0 KB；与 v1.6.94 字节一致）；HEAD `8b0c92d`（工作区干净、已推送）
> 数据来源：云端回读（`config_get` / `config_public` / `nosql`）、[deploy-log](deploy-log.md)、[CHANGELOG](CHANGELOG.md)、[FUNCTION-REGISTRY](FUNCTION-REGISTRY.md)、本会话实测（`npm test` / 入口测试 / SHA 核验）
> 替代关系：本文件为**现行唯一**技术负债清单；[tech-debt-inventory-20261015.md](tech-debt-inventory-20261015.md) 转为**历史归档**（其日期口径、KNOWN 计数、REGISTRY 待验证数已过时）。
> 后期路线图：[ROADMAP-post-review.md](ROADMAP-post-review.md)（2026-11-15 企业主体/保险/核身/税务规划与当前债映射；F12⑤/P1-5/P1-6 已移入后期）
> 维护约定：每条处置后在本文标注「已偿还(日期/commit)」或「已决策不处理(原因)」，并同步 CHANGELOG / REGISTRY / deploy-log。

## 总览

| 分组 | 数量 | 状态 |
|---|---|---|
| P0 提审阻断类 | 5 | **5 全部结案**（P0-3 于 2026-11-06 取按函数实测：触发器仅 112 次/24h，与 cron 精确吻合）；注：独立编号仅 P0-3，P0-1/2/4/5 仅总览口径、不可逐项追溯 |
| P1 有意保留/临时放宽 | 8 | **4 已偿还/已核实（P1-1/2/7/8）+ 1 已决策（P1-6 保持 mock，2026-11-05）+ 3 有意保留（P1-3/4/5）**（2026-11-15 评审订正：原「6 已偿还/已核实」与 8 项不平） |
| P2 结构性债 | 14 | **12 已偿还/转自动化（P2-1/2/3/5/6/11 + P2-7~10/12/13）+ 2 已决策（P2-4 接受 / P2-14 关闭不拆）+ 开放 0**（2026-11-15 评审订正：原「5 已偿还」为陈旧口径） |
| P3 卫生/已接受 | 63（编号 P3-1~P3-63，P3-17 空缺；2026-11-17 §7 复用号改号 P3-48/49/50；二轮扫描新增 P3-62/63） | **未闭合 7（P3-1/14b/26/38/44/45/46——P3-38 专指 §3.4；P3-47 已偿还见 §3.8；P3-51~61 已于 2026-11-17 全数修复；P3-62/63 已于 2026-11-18 修复）**；**56 已结案/已偿还（2026-11-17 P3-51~61 全仓扫描 11 项修复 + §7 改号三项 P3-48/49/50 随 #174 真机验证闭合；2026-11-13 新增 P3-31/P3-36/P3-37/P3-40 四项偿还；2026-11-18 P3-62/63 二轮扫描修复）**；2026-11-09 新增 5 项（P3-26~P3-30，其中 P3-26 仅余真机抽验尾巴，P3-27 已真机闭环，见 §3.1）；2026-11-11 评审新增 3 项（P3-31 已偿还，P3-32/P3-33 于 2026-11-15 收口，见 §3.2）；2026-11-12 漂移事故处置 3 项（P3-34 登记暂缓、P3-35/P3-36 已结案，见 §3.3）；2026-11-12 分拆登记 P3-37~P3-41（P3-37/P3-40 已偿还，见 §3.4/§3.5）；**2026-11-13 P3-39/P3-42/P3-43 已偿还**；2026-11-13 配额评审登记 P3-44~P3-45（P4，登记不动作，见 §3.6）；P3-1 资金主路径已收口、P3-14b 为已批准零代码豁免；2026-11-15 新增 P3-47（定向邀约编辑链路缺口，见 §3.8）；2026-11-17 §7 立项三项原编 P3-37/38/39 改号 P3-48/49/50 并全部闭合（见 §7）；2026-11-17 全仓扫描立项 P3-51~60+P3-61（见 §3.9）；2026-11-18 二轮扫描立项 P3-62/63（均已修） |
| 备份体系 B-1~B-6 | 6 | B-1/B-2 待自动窗口复核；**B-3 已偿还；B-4 已决策接受（2026-11-13，SOP 入 runbook）**；B-5/B-6 已接受/已处理 |
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
| 发布同轮 | 三订阅模板 `miniprogram_state` `trial → formal` | ✅ **已提前执行（2026-11-07）** | 云端回读 `sub_msg_templates` 三值均 **`formal`**，`tmpl_id`/`fields`/`page` 逐字未变（`nModified=1`） | 你裁定「系统完善不受体验版约束，必要时可重传体验版」；回滚 = 同命令改回 `trial`（1 分钟）。**2026-11-15 评审订正·状态漂移**：2026-11-14 #171 真机回归时 `paid` 已临时回 `trial`（见 [HANDOFF-20261114 T-14.3](HANDOFF-20261114.md)），**未改回 `formal` 前禁止提审**——本节不再代表现状 |
| 发布同轮 | 隐私指引按 **11 项标准/自定义声明** 重新填报 | ⏸ 待后台填报（你） | [release-zero-checklist §4.2](runbooks/release-zero-checklist.md) | **2026-11-08 口径订正**：手机号/设备信息走**标准项**，非自定义（原「补 2 条自定义」文案作废）；判据 = 11 项勾选 + 每条用途描述齐全 + 状态「已通过」；**B-1 ✅ ≠ 本条清零**（本条 = HANDOFF T-7.3；提审阻塞共 **2 项**：本条 + [T-14.3](HANDOFF-20261114.md) paid 模板 `miniprogram_state` 回 `formal`） |
| 发布同轮 | `mock_payment_enabled` 口径拍板 | ✅ 已拍板保持开启（2026-11-05） | 云端回读 `true` | MVP 模拟支付；2026-11-05 你拍板**保持开启**，提审说明写明「不产生真实扣款」；接真实支付另立评估 |

---

## §1 P1 · 有意保留 / 已核实（8 项）

| # | 负债 | 状态 |
|---|---|---|
| P1-1 | 旧 `start_service`（S2→S3 直连）服务端保留、前端无入口 | ✅ 已偿还（2026-11-01 形态A，仅墓碑守卫） |
| P1-2 | 旧 `complete_service`（S3→S5 直连） | ✅ 已偿还（同上，由 `finish_apply`+`finish_confirm` 取代） |
| P1-3 | `start_photo` 服务端保留、S3 前端入口已移除 | 有意保留（全量 grep 0 命中，不回开） |
| P1-4 | `demand-match.hall_list` 标 deprecated 仍在线 | 有意保留；**下线动作留提审后**（静态零调用已证） |
| P1-5 | MVP 禁做项占位：短信发送、人脸三分支、mock 现金 `is_mock=true` | 有意保留；禁止接真实打款；**2026-11-15 移入后期**：与 T-9.12 真实支付、代扣税、税务票据合并为「企业结算体系」，见 [ROADMAP-post-review.md](ROADMAP-post-review.md) |
| P1-6 | `realname_face_mode=mock` 临时放宽 | ✅ 已决策保持 mock（2026-11-05 你拍板：发布不关回 `wx`、不清打标；真实核身接线提审后立项）；**2026-11-15 移入后期路线图**：随企业主体规划的真实核身一并立项 |
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

## §3 P3 · 卫生级（编号 63 / 未闭合 7；§3.9 全仓扫描立项 P3-51~60+P3-61 已全数修复；二轮扫描 P3-62/63 已修）

| # | 负债 | 证据/影响 | 处置 |
|---|---|---|---|
| P3-3 | `emergency_contact.phone` / `demand.contact_phone` 明文 | 隐私合规；`backfill-phone-enc.js` 仅覆盖 `user_account` | **✅ 已偿还（2026-11-06）** · 批1 读侧双读已部署：新增 `safety-report/phone_crypt.js` 副本并让 `safety-report` / `user-login` / `admin-action` / `order-action` / `demand-publish` 五处读取「有 `phone_enc` 解密、无则回退明文」，`contact_phone_mask` 优先展示；门禁 273 files / A/B 456，5 函数部署 success + SHA 回读 MATCH。**批2 写侧加密 ✅ 2026-11-06 已部署**（`set_emergency_contact` / `user_ec_update` / `demand-publish` 三处写入改 `phonePatch` + `phone: _.remove()`，密钥缺失 fail-closed；门禁 A/B 456，3 函数 SHA 回读 MATCH）**批3 存量回填 ✅ 2026-11-06 已执行**（先只读备份到 `.backup-p3b3-2026-11-06T13-52-59`：EC 12 / demand 1286 文档，SHA256 `3A1AE691DA595078` / `76BC9980FD41B754`；`--apply` 回填 EC 12/12、demand 100/100，两阶段「先写密文校验齐全再删明文」；独立复检：密文文档 12+100 **解密往返+HMAC+掩码全一致**、与原备份明文**交集 100%**、残留明文 **0**）。**P3-3 结案**；`demand.service_target.phone` 未纳入（用户确认暂不做）；真机：**EC 回显 ✅ 2026-11-06**（截图完整回显 `135****5386` / `139****0000`，另证 30 天频控 toast「2026-11-16 后可再次修改」生效），**SOS 弹窗 ✅ 2026-11-06**（订单 `#TEST840710820J` 详情弹出「李老师(伙伴)」「老三(配偶)」+ 报警110/急救120，两条联系人由 `safety-report.getMyContacts` 解密读取成功；实际呼出需再点一次确认号码非空）；**2026-11-07 体验版 v1.6.96 复验**：EC 完整号 ✅（`135****5386`）、SOS 弹窗 ✅（李老师(伙伴)/老三(配偶) + 报警110/急救120，重复求助弹幂等提示）、**admin-web 用户详情掩码 ✅**；同日发现 **需求详情联系电话缺项**（云端已回传 `contact_phone_masked`，前端未渲染）→ 已修 1 文件 +3 行（**2026-11-07 真机复测闭环：①②④全过，见 REGISTRY #147**） |
| P3-10 | `KNOWN_EVOLUTION` 3 条 stale（`my_orders_partner`/`my_orders_user`/`notice_list`） | 声明表与运行时差集；当前运行时 **79 例** | ✅ **已偿还（2026-11-03，复核于 2026-11-06）**：`ab_equivalence.js` L672 已留档「三条白名单已 stale，删除以免漂移被静默兜住」；当前 A/B 仍 **456 EQUIVALENT / 79 known**，三条独立行为由 `order-action.entry.test.js` 守护 |
| P3-14b | `bootstrap.js` take 链 `navigateTo` 的 `fail: () => {}` 静默 | 栈满仅丢一次跳转 | 已批准「零代码」豁免；触碰该文件时同修 |
| P3-15 | 法律合规残留：⑤版本库不可用时回填源为未保存表单；⑥「删除」实为「停用」措辞不统一；⑦满态判定误报；⑧批量发布快照完整性待专项 | admin-web/legal 体验与一致性 | **⑤⑥⑦⑧ 全部 ✅ 已偿还（2026-11-06）**：⑤`openEdit` L399-402 在 `legal_doc_get` 失败时 `ElMessage.error` 后 `return`（fail-closed）；⑥`Legal.vue` L59/L82/L114 统一「停用（删除=停用）」措辞；⑦L74/L287 满态判定改为「已配置数 ≥ 场景总数」；⑧`action_legal_doc.js#writeVersion` 三处加固——版本号读取失败 **fail-closed**（原 `.catch(()=>({data:[]}))` 会静默当 0 写 v1）、归档前先取旧生效版 `_id` 并在 `add` 失败时**恢复 archived→published**（消除「旧版已归档、新版不存在」的快照空洞）、`add` 失败返回 `legal_add_fail` 并 `log.e` 留痕 |
| P3-16 | 工作台信用分两源（`user_account.partner_credit_score` vs `partner_profile.score`） | 可能出现「分数 L2 段却显示 L3」 | **✅ 已偿还（2026-11-05）**：`balance_info` 已返回 `credit_score`（取 `partner_profile.score`）；`workbench` 收敛为单一展示字段 `creditScore`（无档案回退账户原值），WXML 不再直接读 `user.partner_credit_score` |
| P3-20④ | 首页冷启动 `fetchUser` 与 `refreshNoticeBadge` 各调一次 `peek_login` | 配额微浪费 | ✅ **已偿还（复核于 2026-11-06）**：`pages-v2/index/index.js` L135 新增 `__badgeAt` 标记——fetchUser 的 `peek_login` 已含未读数，首次 `onShow` 的 `refreshNoticeBadge` 命中标记即跳过；L142-144 另有 30s 节流 |
| P3-23 | `S2_6` 预告片文案缺「待」字 | 真实态与预告态易混 | **✅ 已偿还（2026-11-05 复核）**：`order-progress/index.js` 已有 `PREVIEW_NAME = { S2_6: '待发起开始履约' }` 并在非当前态分支套用 |
| P3-25 | `admin-action/index.js` 682 行仍含 `ROLE_GRANTS`+鉴权+schema | 维护成本 | **✅ 已偿还（2026-11-06）**：新增 `authz.js`（`ADMIN_ROLE_LABEL` / `ADMIN_ROLES` / `ROLE_GRANTS` 68 条 + `canAccess` / `forbiddenMsg`）；`index.js` 只保留「取角色 → 判定 → 拒绝留痕」编排。等价性证明 **AUTHZ-EQUIV 4/4**：action 集合一致（68）、每条放行角色一致、`canAccess` 与旧表达式 **276 组全同值**、`forbiddenMsg` 逐字一致；已部署并 `code download` 回读 `index.js` / `authz.js` **SHA256 均 MATCH** |
| P3-1 | 空 catch 净约 155 处（窄类 25/25 已收口） | 多数有意设计 | **资金/一致性主路径 ✅ 已收口（2026-11-06 复判）**：`payment-mock/action_pay.js` 两处补偿回写（支付失败回滚 `paid_fen`、退款失败回滚 `refunded_fen`）原为 `.catch(()=>{})` 完全无痕，改为 `reportCompensateFail()` → `log.e` + `platform_event(P0, pay_compensate_fail)`；`order-action/action_change.js` L330 确认位回滚补 `log.w`。其余空 catch 维持「有意设计」口径，解冻后复判。**✅ 尾巴复判完成（2026-11-13，只读审计）**：按 `silent-catch-baseline.json` 口径全量 254 处四分桶——**A 高危 4**（补偿/自愈回写失败无痕，与已收口模式同类，只登记不修，修复需另立项走批准）：`order-action/action_change_s2.js:286-288`（S2 变更订单 CAS 失败→确认单回滚）、`admin-action/action_dispute_handle.js:99-101`（退款流水写失败→order_main 回滚补偿，前置已有 log.w）、`order-create/action_take.js:476` 与 `action_aux.js:101-103`（接单卡死自愈释放 matched→matching）；**✅ A 类 4 处已偿还（2026-11-13，`c70465bd`，用户立项批准）**：空 catch 改 `log.w`/资金级 `log.e` 留痕（`s2_conf_rollback_fail`/`dispute_refund_compensate_fail`/`take_heal_release_fail`/`check_heal_release_fail`），零逻辑变更，三函数部署 success + SHA 回读 80/80 MATCH，空 catch 基线 254→**250**；**B 类批 1 已偿还（2026-11-17，双专家评审+用户裁定折中方案）**：admin-login canonical 6 处静默 catch 补 `log.w` 留痕（L21 账号查询 fail-closed / L25/31/42 三处 P1 安全事件写失败 / L40 锁定条件写失败 / L47 解锁清零写失败，照 L37 既有先例模式，零逻辑变更），sync-admin-login.ps1 同步 admin-action/admin-web 两副本（ALL SYNCED），空 catch 基线 250→**238**（--write 刷新单独 commit）；**B 中危约 60**（次级写失败静默，主链不受影响：订阅消息发送留痕 patch〔order-action/index.js 11 + order-timer 3〕、订单超时通知写 2、~~admin-login P1 事件 12~~〔✅ 2026-11-17 批 1 已偿还，见上〕、user-login 锁定写 2、admin-action 运营伴随写约 15、blog 计数回写 4、需求过期流转 2、writeAudit 容错 2、exam 2、前端登录态/订阅授权类 5 等）；**B 类治理节奏（2026-11-17 双专家评审 + 用户裁定折中）**：批 1（admin-login P1 事件+资金相邻）立专项已修；批 2/3（订阅消息留痕 patch / 其余云端 ~20 处）降级「触碰对应函数时顺带修」；批 4（前端容错类）正式裁定维持不治理；**C 有意设计约 190**（audit.js 自容错 13、heal.js 自愈 8、zz-seed 测试种子 15、配置/资料读兜底约 30、createCollection 幂等建表 3、前端 Storage/UI/震动/清理/轮询容错余量）；**D 0**。**B 类批 2/3 已偿还（2026-11-18，用户批准解冻）**：云端 B 类空 catch 共 38 处补 `log.w` 留痕（零逻辑变更）——order-action/index.js 11 处（订阅消息留痕/计数/通知写失败）、order-timer/index.js 3 处（demand_grab 订阅消息）、user-login（index.js L304 sms_lock + action_auth.js L310 pwd_lock）2 处、admin-action 8 文件 15 处（noshow/partner_review/dispute/blog/im_kefu/order_demand_ops/user_moderation/user_ops 的运营伴随写）、blog-action/index.js 4 处（计数回写）、demand-publish/index.js 1 处（demand expired CAS 更新）、partner-action/action_exam.js 2 处（exam score/audit 写）。C 类（audit 自容错/heal 自愈/zz-seed/getConfig 兜底/createCollection/展示富化查询）不动；前端批 4 维持不治理。7 函数部署 success + SHA256 回读 15/15 MATCH，空 catch 基线 238→**200**（--write 刷新）。基线增量门（check-silent-catch）继续守「只增不追溯」 |
| P3-8 | 系统超时转争议不写 `complaint` 集合 | 自动转争议单时间线少 1 条卡片 | **✅ 已修（2026-11-15，commit `65e38c06` + order-action 部署）**：S2_6/S3_6 连续 2 次拒绝升级 S10.5 时补需求方侧 `dispute_open` 卡片（此前只发耍伴，双方可见缺口补齐）；order-timer 超时路径本已双方发卡，无需改 |

> 已结案/已偿还：P3-2（testmode 死开关保留）、P3-4（G3 提醒）、P3-5（S2_5 存量兼容）、P3-6（版本号区间补登）、P3-7（时段敏感测试）、P3-9（smoke 编码）、P3-11（CI 噪音）、P3-12（索引/审计清理，49 条台账）、P3-13（路由异常 5 项，A3/A4 决策保留）、P3-18（昵称/头像编辑）、P3-19（前端语法门禁）、P3-21（注释失真）、P3-22（`splitting_fen` 口径）、P3-24（空 catch 抽样结案）。

### §3.1 2026-11-09 BUG 扫描单独立项（P3-26~P3-30，开放）

| # | 负债 | 证据（文件:行号） | 影响 | 建议处置 |
|---|---|---|---|---|
| P3-26 | 单号/流水号日期前缀按 UTC 本地 getter 生成 | `payment-mock/index.js:46`、`order-create/index.js:123`、`demand-publish/index.js:187`、`admin-action/index.js:237` | 北京 00:00–07:59 建单前缀为前一日，仅影响对账辨识；唯一性由随机位 + 唯一索引保证，不受影响 | **✅ 已修并部署（2026-11-09）**：四处统一 +8 + `getUTC*`；5 函数串行部署 + 回读 SHA256 全 MATCH（见 deploy-log）；待真机抽验单号日期前缀；**云端实证（2026-11-13，只读）**：修复后 order_main 31 条中北京凌晨建单 3 条前缀 3/3 正确、错位 0（pay/demand 无凌晨样本，同款写法旁证） |
| P3-27 | 紧急联系人 30 天冷却提示日期按 UTC | `user-login/action_misc.js:27` | 凌晨时段「X 后可再次修改」显示早一天 | **✅ 已修并部署（2026-11-09）**：改 +8 + `getUTC*`；user-login 部署 + 回读 13/13 MATCH；**✅ 真机抽验通过（2026-11-15，体验版 v1.6.123）**：紧急联系人页 toast「紧急联系人每30天仅可变更1次, 2026-11-16 后可再次修改」，日期正确、未早一天，与 2026-11-06 基线一致 |
| P3-28 | `order-timer` 巡检游标/心跳写入失败被 `.catch(() => {})` 静默 | `order-timer/index.js:208`、`:251` | 游标不推进会导致巡检窗口重复或告警重复，且无日志可查 | **✅ 已修并部署（2026-11-09）**：两处改 `log.w` 留痕，控制流不变；18/18 SHA256 MATCH（见 deploy-log）；**云端实证（2026-11-13，只读）**：`error_scan_heartbeat_at`=当日北京 21:00:16（游标推进正常）、`audit_prune_last.at`=当日北京 03:00:15 凌晨档落库成功 |
| P3-29 | `order-create` 配置读取失败回退硬编码费率/门槛 | `order-create/index.js:58-70` | DB 瞬时失败窗口内按 `platform_fee_rate_fen=1000`、`min_credit_*=600`、`youth_limit_fen=20000` 建单，可能与线上配置不一致 | **✅ 已修并部署（2026-11-09，用户拍板 fail-closed）**：`getConfig` 失败返回 null，建单返 `order_config_unavailable`、签署返 `sign_config_unavailable`；13/13 SHA256 MATCH（见 deploy-log） |
| P3-30 | `app.js` `cloudCall` 超时重试不中止在途调用 | `miniprogram/app.js:79-104` | 读类超时最多产生 3 次实际调用，占用基础版配额（数据幂等无错） | **✅ 已修并生效（2026-11-09 随 v1.6.100 设为体验版，见 deploy-log）**：超时重试复用同一在途 Promise，仅真实失败才发起新调用；总等待预算不变 |

> 立项依据：[20261109-bug-scan.md](session-log/20261109-bug-scan.md)。处置按 §3「先说后做 + 最小改动」逐项走；**当前（2026-11-13 复核）：P3-26/28 云端实证通过；P3-29 被动验证维持；P3-30 已随 v1.6.100 体验版生效；P3-27 真机抽验通过（2026-11-15，toast 日期 2026-11-16 正确）**。

---

## §3.2 2026-11-11 方案A 双专家评审登记（P3-31~P3-33，开放）

| # | 负债 | 证据（文件:行号） | 影响 | 建议处置 |
|---|---|---|---|---|
| P3-31 | extend 通道 reason_type 校验零测试覆盖 | `oa_extend_reason_type` 全仓仅命中实现（`action_modify_extend.js:248`）与 docs/API.md，`order-action.entry.test.js` 与 `auto-test-s2-change.js` 均无 extend 类型用例（后者 grep `action: 'extend'` 零命中） | extend 类型校验回归无断言守护（s2_change/modify 均有「字段缺失」型用例，独 extend 缺） | **✅ 已偿还（2026-11-13，提前偿还——登记触发条件为「触碰 action_modify_extend.js」，本次经用户批准不触碰运行时文件）**：`order-action.entry.test.js` 补 2 条入口用例（缺失型拒绝 `oa_extend_reason_type` / 2-20 字文案放行 + CAS 写 `pending_extend.reason_type`）；store 构造 `S3+pricing_type:'fixed'`（双专家评审 B6 修正，避开 `oa_extend_price`/`oa_extend_reason` 前置拦截）；清单门 --update 72 文件/**949 用例**（+2），npm test 949/949 |
| P3-32 | 同类校验字数上限口径差 | 后台自由文案写入限 2-10 字（`action_config_set.js:424-426`）vs 客户端提交放行 2-20 字（`order-action/index.js:133`） | 管理者配不出 11-20 字选项；11-20 字仅旧版硬编码/直调云函数可达，展示端原样拼接无截断风险 | **✅ 已修（2026-11-15，commit `94edd778` + order-action 部署，用户拍板统一到 2-10）**：normalizeReasonType 2-20→2-10（三端同口径）+ 占位词/纯数字/全同字符拦截；门禁 49/49 PASS |
| P3-33 | reason_type 绕过占位词/内容安全（与 reason 双标） | `REASON_PLACEHOLDER_EXACT`（`order-action/index.js:135`）仅拦 reason；reason_type 只过 `normalizeReasonType`（`action_modify_extend.js:72-74`/`:247-249`） | 管理者配置「临时有事」为选项后，用户选中提交直接入库；同文案作 reason 会被拒 | **✅ 部分收口（2026-11-15，commit `94edd778`）**：normalizeReasonType 补占位词/纯数字/全同字符拦截（占位词双标消除）；cancel 自由文本 reason 过 checkText（安全检测缺口补齐）；「管理者配置即信」口径维持（config_history 留痕） |

> 立项依据：[FUNCTION-REGISTRY #167](FUNCTION-REGISTRY.md)（方案A 双专家评审 B 侧产出）。**当前（2026-11-17）：P3-33 双专家评审 2/2 维持登记不翻案**（管理者 RBAC 受信 + config_history 双留痕 + 提审不扫配置项，无翻案新证据；admin-action 已具备 msgSecCheck 能力——config.json 已声明权限 + action_im_kefu.js:129 现成调用；若未来治理＝checkText best-effort ~10 行，检测失败放行+告警防 msgSecCheck 抖动误拦，**触发条件＝admin-action 下次部署批次有 ≤10 行顺带空间**）。

### §3.3 2026-11-12 改期规则配置漂移事故处置登记（P3-34~P3-36，2026-11-14 全部闭合）

| # | 负债 | 证据（文件:行号） | 影响 | 建议处置 |
|---|---|---|---|---|
| P3-34 | 改期/加时发起时前端无提前量预检 | `order-detail.js:1057-1088` onModify 仅查 S2/次数/冻结/在途，提前量在提交时才拦（`:1164-1167`）；服务端 `action_modify_extend.js:47-56` 校验完好无资损 | 用户体验：填完表单才被拦；前端预检若用缓存值（bootstrap ≤7 天）有误拦风险 | **✅ 已修（2026-11-14 批 2，commit `7c85b183`）**：onModify 打开面板前软预检 toast「不足X小时,可能被拒」**不拦截**（缓存可能滞后，以服务端提交裁决为最终裁决——本列既定口径）；加时入口不加（S3 履约中进行中无提前量概念）；随下次体验版生效，待真机 iOS+Android |
| P3-35 | admin_config 遗留嵌套 `modify_config` 死数据 | 实测 `admin_config(_id:"global").modify_config={confirmHours:24,maxSpanH:72,maxTimes:2,minLeadHours:4}`（11-10 分钟制迁移漏清旧结构）；`resolveModify` 只读顶层键（`order-action/config_defaults.js:16-26`），规则页保存只写顶层 | 当前零行为影响；但任何人恢复嵌套读取或重跑迁移会出诡异问题；巡检脚本已 WARN | **✅ 已清理（2026-11-12，用户授权）**：tcb nosql `$unset`（q 锁 `_id:"global"`+is_deleted 守卫）`nModified=1`，回读 `modify_config` 已消失、顶层键全完好（4/2/72/10）；复跑 `npm run audit:config` 嵌套 WARN 消失；探针 FAIL 属直写无留痕预期现象（人工确认） |
| P3-36 | 巡检脚本 WARN 噪音未收敛 | `scripts/audit-config-drift.js` 首跑 23 条「偏离默认」WARN，多为有意运营配置（接单上限 40/费率区间/提醒分层等） | 噪音稀释信号，长期会掩盖真漂移 | **✅ 已偿还（2026-11-13，双专家评审修正版）**：新增 `scripts/audit-config-drift-baseline.json`（22 条按当日实测回执登记，reason 填来源指针——4 条有 docs 指针、18 条标「来源待查·待人工确认」，评审 B5 纪律）；脚本「偏离默认」分支（:65）读 baseline：命中一致→INFO / 值漂移→WARN 注明 baseline 记录 / 未登记→照常 WARN；**特殊运营态 WARN（:69-73）与 ERROR/红线/探针判据不读 baseline 保持裸奔**（评审 B10）。复跑实证 ERROR=0 **WARN 22→0** exit 0。23→22 对账：modify_config 遗留 WARN 已随 P3-35 清理消失 |

> 立项依据：[FUNCTION-REGISTRY #169](FUNCTION-REGISTRY.md) + [CHANGELOG 2026-11-12](CHANGELOG.md)（改期规则 2/1/2 全案：写入者=用户本人 11-08 22:38 后台「改期设置」，留痕链完好；三次验证者修正见 CHANGELOG）。**当前（2026-11-14）：三项全部闭合。**

### §3.4 2026-11-12 前端巨页分拆批次2a/2b 登记（P3-37~P3-38，开放）

| # | 负债 | 证据（文件:行号） | 影响 | 建议处置 |
|---|---|---|---|---|
| P3-37 | `TM_FIELD` 双源常量 | `miniprogram/pages-v2/chat/chat.js:11` 与 `miniprogram/utils/confirm-flow.js:122` 各定义一份 `{TM1:time,TM2:location,TM3:content,TM4:fee}`（归属表 v2.0 决策 D-1 裁定局部复制） | 后续增删模板/确认字段需两处同步，漂移会导致模板卡选项映射错位（静默，无报错） | **✅ 已偿还（2026-11-13，双专家评审修正版）**：统一迁 `config/enums.js:173`（`Object.freeze`，与 `TM_TEMPLATES` 同域）；chat.js:7 / confirm-flow.js:13 改解构引用，两处局部定义删除并留痕；引用面 6 点全量 grep 实测无遗漏；C19 断言为行为四支路不受影响，947/947 通过。**真机回归项已转自动化覆盖（2026-11-13 追加 C31）**：`pages-chat.test.js` 新增 C31 钉住 TM2-TM4 正/负向映射（location 负向=直调 wx.chooseLocation 地图选点、content/fee=editSheet 弹层），与 C19+C12+C13+C20 合计六链自动化覆盖，manifest 949→950；真机抽验转为**可选** |
| P3-38 | 分拆后模块体积逼近页面 | `miniprogram/utils/confirm-flow.js` **549 非空行 / 570 总行**（= chat.js 670 的 81.9%，其中批次2b 占 322 行；2026-11-15 评审实测订正原「547」） | 模块已承担「数据加工 + 确认链 + 编辑/提交/响应链」三域，继续堆叠会重现巨页问题（只是换了文件） | **登记不动作（2026-11-12 双代理 B#4）**：阶段B 前评估按域再分区（confirm-view / confirm-action / change-submit）；不设硬阈值，避免为拆而拆 |

### §3.5 2026-11-12/13 双代理检核登记（P3-39~P3-43；P3-39/P3-40/P3-41/P3-42/P3-43 均已偿还）

| # | 负债 | 证据（文件:行号） | 影响 | 建议处置 |
|---|---|---|---|---|
| P3-39 | `_acting` 页级互斥锁可能永久占用（继承缺陷，非分拆引入） | `miniprogram/utils/order-modal.js:8-14`（旧实现）：先置锁后调 `wx.showModal`，仅 `fail` / Promise reject 释放 | 若 `wx.showModal` 同步抛错，或 `opts.success` 返回永不 settle 的 Promise（云调用挂起），整页二次确认永久锁死 | **已偿还（2026-11-13，用户 §2 书面批准，`5cbfa2e`）**：`order-modal.js` 改「弹窗期不计时 + 业务期 20s 租约」（句柄 `page.__actingTimer`，正常结算/失败仍提前 release）；`order-poll.js:13-20` `clearTimers` 连锁清句柄并置 `_acting=false`（onHide/onUnload 已调，`order-detail.js` 零 diff）；新增 O19（租约到期 + clearTimers 放锁）/O20（弹窗期不计时）守护。`wx.showModal` 同步抛错分支仍不吞异常（§7），维持 fail 回调处置 |
| P3-40 | `__confLoaded` 纯死写 | `miniprogram/utils/confirm-flow.js:45` 写入；全仓 0 处读取 | 误导后续读者以为存在「已加载」分支判断 | **✅ 已偿还（2026-11-13，双专家评审修正版）**：删除 :45 写入（1 行）+ :7 契约注释删 `__confLoaded` 字样并留痕；`__s1Deadline`（活代码，chat.js 轮询直读）未触碰；npm test 947/947 通过 |
| P3-41 | harness modal 记录 JSON clone 丢回调 | `scripts/mp-page-harness.js:96` `const rec = clone(src)` 后 `success/fail` 不可见 | 后续用例若断言 `m.success(...)` 会得 `undefined` 而假通过 | **✅ 已偿还（2026-11-13）**：harness 头注 **:18-19** 已标注「modal 记录只能断言数据字段；回调请用 `__confirm`/`__cancel`/`__fail`」；2026-11-15 评审订正本节标题误留「开放」 |
| P3-42 | 备份分页失败曾静默产出不完整数据 | `.predeploy/manual-backup.ps1:86-97`（旧实现 `[SKIP]` 直接 break，`truncated` 仍为 false）；实例：`zhaoren_backup_20261112-1434\db\order_main.json` total=406 / list=100 / truncated=false | 灾备文件缺行且无任何告警，恢复时按「完整备份」使用会丢数据 | **已修（2026-11-12 T-13.3）**：失败重试 1 次 + 仍失败置 `truncated=true` 并打 `[FAIL]`；**根因已定位（2026-11-13）**：PS5.1 `Invoke-RestMethod` 对 ~118KB 大响应返回 **String**（page2 起），`$resp.ok` 为 $null 被误判失败；且 `ConvertFrom-Json` 遇空键名报「参数 name 的值无效」。已改 `JavaScriptSerializer`（MaxJsonLength=64MB）解析 + L6 下载超时 90→300s；order_main 分页 406/406 已实证 |
| P3-43 | A/B 门禁偶发假红（临时基线文件跨进程竞态） | `cloudfunctions/_shared/ab_equivalence.js`（旧固定名实现 `:622` 定义 `__baseline_tmp.js`、`:649` 启动预删；读副本在 `:727`）；首次 `npm test` 报 ENOENT，重跑通过（2026-11-13 双代理 B#5 实测） | 并发/清理竞态时门禁假红，误阻塞放行或诱发重跑掩盖真问题 | **已偿还（2026-11-13，`2653ef4`）**：临时名改 `__baseline_tmp_<pid>_<ts>.js`（进程唯一）+ 去掉启动预删 + SIGINT/SIGTERM 清理 + 主循环 try/finally 且以 `process.exitCode` 退出；`.gitignore` 扩 `__baseline_tmp*.js`。实证：并发双进程 A/B 均 **455 EQUIVALENT**、stderr 空、残留 **0** |

### §3.6 2026-11-13 配额门禁 B+C1 评审登记（P3-44~P3-45，P4 级，登记不动作）

> 来源：`zhaoren-tech-review` 双代理（事实核验 A + 必要性 B）对「常驻规则配额制」机制评估；C 方案（结构性升级）判定「当前不必要」，拆为 C1（并入 B 已实现 `1f5220b`）+ C2（本节登记不实现）。**2026-11-13 尾巴核对：C 方案仅 C1/C2 两个子项，不存在 C3，尾巴清零（用户确认）**。

| # | 负债 | 证据（文件:行号） | 影响 | 建议处置 |
|---|---|---|---|---|
| P3-44 | 配额门禁无 §-级字节预算 | `scripts/check-rules-size.js:138-139` 仅限 core 章节数 ≤22，无单节/摘要区上限 | 单个章节（如 §10–§39 摘要）可无界膨胀，挤占 §0–§9 与附录A 预算 | **登记不动作（P4）**：触发条件=单节或摘要区占 inject >50%，或 core 章节数 ≥20；达到再评估「按节设上限」 |
| P3-45 | 规则降级为技能的规避路径未登记 | 索引已在 inject 桶内；技能 `.trae/skills/**`、项目记忆、docs 完全不计量 | 紧急规则变更被配额阻塞时，内容可能被「降级」塞进技能/记忆，规避常驻可见性 | **登记不动作（P4）**：该路径不违规（技能不承诺常驻）；腾挪 SOP 已明确「优先落技能/归档 §N」；若发现规则被持续迁往技能规避配额再补登记 |

### §3.7 2026-11-14 #171 iOS 真机补验挂账（P3-46，开放）

| # | 负债 | 证据（文件:行号） | 影响 | 建议处置 |
|---|---|---|---|---|
| P3-46 | 「支付提醒」订阅链仅 Android 单端真机验证 | FUNCTION-REGISTRY #171：Android ③④⑤ 全过 + sub_msg_send_logs 秒级对账（2026-11-14 两单 `20261114182244657177`/`20261114709439500870`）；iOS 因当前无测试设备未跑（用户裁定挂账） | iOS 微信客户端锁屏通知样式/点击路由与 Android 有平台差异，送达表现未实证；代码路径两端同一（chat.js 授权 + paid_sub.js 发送均平台无关） | **有 iOS 测试条件时补验**：按 REGISTRY #171 验收步骤 ②-⑤ 走一遍（S1 手势授权→支付→送达→点卡片跳详情），留痕回查复用 `.tmp-tcb/q_171_devicetest.cjs`；通过后本条闭环 |

### §3.8 2026-11-15 定向邀约编辑链路缺口登记（P3-47，开放，本轮不改）

| # | 负债 | 证据（文件:行号） | 影响 | 建议处置 |
|---|---|---|---|---|
| P3-47 | **编辑已有「定向邀约」需求会被前端同口径拦截** | ①前端拦截 `miniprogram/pages-v2/publish/publish.js:947`（`match_mode==='direct' && !invitePartnerOpenid`），编辑模式不会回填 `invitePartnerOpenid`；②上送 `publish.js:1050` `target_openid: this.invitePartnerOpenid \|\| ''` 编辑态恒空；③服务端 `cloudfunctions/demand-publish/action_update.js:125` 对 `mode==='direct'` 缺 target 直接 `update_target_required` | 发布者编辑自己的定向需求（改时间/描述/价格等）时，无论改不改撮合模式都会被「定向邀约缺少指定耍伴」拦下，只能切广播或放弃编辑；发布页新建链路不受影响（2026-11-15 `1df4ff91` 已堵住空选入口） | **2026-11-17 双专家评审 2/2 确认修复方案；口径 A1→A2（用户裁定允许编辑+站内通知）后 ✅ 已偿还**：①detail 仅发布者回传 target_openid（action_query.js:161）+ publish.js 编辑回填（:284-288，commit `3bf76ce8`）；②编辑成功且 direct 写 system_notice type='demand_updated'（action_update.js:331-345，commit `21f2f389`）；③模拟器自动化验收全过（REGISTRY #181 已验证：卡片回显/更新成功无误拦/通知落库 to=test_partner_001）；④demand-publish 部署 SHA 2/2 MATCH。**遗留观察项（2026-11-17 技术评审双 2/2 登记）**：~~R1 切 broadcast 时 patch.target_openid 残留旧值~~（**✅ 已偿还（2026-11-17，commit `82794b95` + demand-publish 部署 SHA `CC664ECA` MATCH）**：patch.target_openid 改无条件写入 `mode==='direct' ? target_openid : ''`）；R2 通知 UI 可见性未以受邀者身份实测消息中心（落库已实证）；R3 重复编辑每次通知无幂等（内测低频可接受） |

### §3.9 2026-11-17 全仓 BUG 扫描立项（双代理 A 前端/B 云函数独立扫描 + B1/B2 独立核验；P3-51~P3-60，开放）

> 来源：用户发起全仓 BUG 扫描（A 方 miniprogram 99 JS 精读核心面 / B 方 cloudfunctions 核心函数全读）；B1/B2 经独立核验代理证实/降级。正面结论：资金链（支付/退款/提现/打赏）与超时链（S1/S0/S2_6/S3_6/评价）零新发现；时区横扫 +8 口径统一；take_rules/money_rules 纯函数一致。

| # | 负债 | 证据（文件:行号） | 影响 | 建议处置 |
|---|---|---|---|---|
| P3-51 | **S1 费用变更把「订单总额」按「时薪区间」校验，总额>100 元单协商必被拒**【中·核验证实】 | `order-action/action_change.js:78-87`（fee 分支钳 rate_min/max_fen=3000/10000，`:100` 写 total_fen，`:39` currentValue=order.total_fen）；同源 `action_confirm.js:121-147` update_item（前端无入口休眠链）；复现链：confirm-flow.js:363-425 传 total_fen；action_publish.js:229 时薪单 total=rate×duration（2h×60 元=12000 分即被拒）；action_change.js:88 youth 上限 20000 分自证总额可达 200 元 | S1 阶段总额>100 元或<30 元的订单任意费用协商（改 1 分也）必被 `oa_fee_out_of_range` 拒，报错误导为「时薪」 | **✅ 已修（2026-11-17，commit `01b861e0`+审核完善边界 hi=Infinity）**：fee 分支按 pricing_type 折算（hourly=rate 区间×duration_h；fixed=fixed_price_min/max_fen 留空不钳制）；order-action 部署 2 次 SHA MATCH（末次 `CC664ECA` 前版+边界修后回读 MATCH）；补 3 例单测（hourly 折算内/外+fixed 留空放行，npm test 1152/1152） |
| P3-52 | **S4→S5 ratio_confirm 单方一次调用即翻转，order_state.js no.14 guard「双方各确认一次」与 PRD 附录G「确认完成」冲突**【口径缺陷·已裁】 | `order-action/action_modify_extend.js:434-440`（单次 casStatus S4→S5，ratio 缺省 100，无双确认位）；order_state.js:129 vs PRD/PRD.md:1068 附录G；ratio_fen 无结算消费方；action_dispute.js:6 COMPLANT_OPEN_STATUS 不含 S5（有意设计 2026-11-14 拍板） | 单方翻转 S5 后对方丧失投诉通道（S5 起投诉关闭）；ratio 恒 100% 无协商输入 | **✅ 已修（2026-11-17 用户裁口径 a 维持单确认）**：order_state.js:129 guard 改「任一方确认（PRD 附录G 对齐）」+ API.md:306/dev-manual 05:21/09:61/09:106/09:140 五处订正（原「分段结算+退款工单」标注为 V15 PRD 未实现设计）；sync-order-state ALL SYNCED + order-timer 副本部署 SHA MATCH |
| P3-53 | **publish.js:239 编辑自定义时长回填死三元**【中】 | `miniprogram/pages-v2/publish/publish.js:239`：`durationPresets.includes(d.duration_hours) ? d.duration_hours : d.duration_hours` 两分支同值（false 分支应为 0），配合 wxml:91 自定义输入框仅 duration_hours===0 时渲染 | 编辑自定义时长（如 5h）需求：chip 无高亮、自定义输入框不出现，想改时长无入口（内部值仍提交） | **✅ 已修（2026-11-17，commit `2a1315bd`）**：false 分支改 0；随下次体验版验收（关联 P3-61 快照/草稿同病） |
| P3-54 | **safety.js:120 安全报备页回前台不恢复计时/GPS**【中·安全链路】 | `miniprogram/pages-v2/**/safety.js:120`：onShow 恢复条件 `sosActive \|\| _checkinStarted` 但全文件从未赋值 `_checkinStarted`；onHide 已 clearTimers+stopLocationTracking | 安全报备页切后台再回来：报备时长停摆、打卡倒计时冻结、GPS 静默停止无降级提示 | **✅ 已修（2026-11-17，commit `2a1315bd`）**：fetchData 成功分支置 `_checkinStarted=true`；随下次体验版，真机回归安全链路 |
| P3-55 | **square.js:157 运营位跳发布场景参数字段名错**【中】 | `miniprogram/pages-v2/square/square.js:157` 拼 `?scene=` 而 publish.js:298 onLoad 只认 `options.sceneCode`（首页同款 index.js:331 已于 2026-11-10 修复，广场漏改） | 广场活动卡「去发布某场景」场景预选静默失效 | **✅ 已修（2026-11-17，commit `2a1315bd`）**：改 `?sceneCode=`；随下次体验版验收 |
| P3-61 | **草稿/快照回填自定义时长静默变 3h**【低·技术评审 B 方发现】 | `miniprogram/utils/draft-store.js:84` 与 `miniprogram/pages-v2/publish/publish.js:415`：快照/草稿回填用 `d.duration_hours \|\| 3`——自定义 5h（存合并值 5）回填成预设外无高亮、输入框不显示（P3-53 同病漏点） | 草稿/快照恢复后自定义时长静默替换 | **✅ 已修（2026-11-17，commit `2c60dc08`）**：回填判预设值还原两态（`_dur`/`_durC` 对齐编辑回填口径）；随下次体验版 |
| P3-62 | **履约通知恒显示"耍伴"而非真实昵称**【中·二轮 BUG 扫描 A/B 发现】 | `cloudfunctions/order-action/action_lifecycle.js:197/577/682`：`writeNotice` body 用 `${order.partner_nickname \|\| '耍伴'}`，但 order_main 只存 partner_openid 无 partner_nickname 字段（已核 order-create 建档只写 partner_openid） | S2_6 到达/S3 现场照片/S3_6 完毕确认通知正文恒"耍伴已…"，不显示接单者昵称 | **✅ 已修（2026-11-18，commit `5b3ae58c` + 已部署）**：新增 `getPartnerNickname(col, openid)` helper 查 partner_profile 取 nickname/real_name（失败兜底"耍伴"，同 P3-60 口径）；三处通知改读 helper 返回值；start_apply/finish_apply 解构补 `col`；SHA 回读 `A8E81B5B…` |
| P3-63 | **demand-match 候选/报名者信用分恒显示 800**【中·二轮 BUG 扫描 B 方发现】 | `cloudfunctions/demand-match/index.js:123/493`：`p` 来自 partner_profile 集合（只有 credit_score），却读 `p.partner_credit_score`（user_account 才有）→ 恒 undefined 退化为 800。P3-59 已修 L87 WHERE 子句但漏修这两处字段读取 | 候选列表/报名者列表信用分恒显示 800，排序（DB orderBy）与准入校验（L349 读 user_account）不受影响 | **✅ 已修（2026-11-18，commit `e7d6db04` + 已部署）**：L123/L493 改 `p.credit_score`；L349 partnerUser（user_account）保留 partner_credit_score 不变；SHA 回读 `5B276FD3…` |
| P3-56 | **order-detail.js:910 里程碑确认弹窗百分比错**【低】 | `order-detail.js:910` `提交履约进度 ${next*30}%`：第三次（100% 节点）显示 90%，与 order-view.js:210 [30,60,100] 矛盾，且在二次确认决策点 | 里程碑确认弹窗标题百分比与实际不符 | **✅ 已修（2026-11-17，commit `2c60dc08`）**：改 `[30,60,100][next-1]`；随下次体验版 |
| P3-57 | **partner-apply.js:33 缓存 key 混用**【低】 | `partner-apply.js:33` 读 `'user_info'` 而全仓仅 app.js:120 写 `'userInfo'` → 恒取 {} | alreadyPartner 初值恒 false，按钮态短暂错误（onShow 探针自愈） | **✅ 已修（2026-11-17，commit `2c60dc08`）**：改读 'userInfo'；随下次体验版 |
| P3-58 | **orders.js loadMore 与 loadOrders 竞态**【低】 | `orders.js:127-149`：loadMore 在飞时切 tab/onShow 触发 loadOrders 重置，旧 then 追加 extra 进新列表、hasMore 被旧响应覆盖、__page 错位 | 列表翻页偶发错乱/重复 | **✅ 已修（2026-11-17，commit `2c60dc08`）**：加代次标记 `__loadSeq` 回调不匹配即丢弃；随下次体验版 |
| P3-59 | **demand-match top5 信用分字段错位，查询恒空**【低·疑似弃用入口】 | `demand-match/index.js:87-89` 用 `partner_credit_score`（只存在于 user_account），partner_profile 只有 `credit_score`（对照 demand-publish index.js:269-275 正确口径） | top5 恒 0 候选，invite「必须来自候选」前置死锁；grep 全仓无 top5 调用方 | **✅ 已修（2026-11-17，commit `1ace50b1`）**：字段改名 credit_score；demand-match 部署 SHA MATCH |
| P3-60 | **接单通知引用永不存在的 demand.partner_nickname**【低】 | `order-create/action_take.js:579` 读 `demand.partner_nickname`（action_publish 建档无此字段）→ 发单人「有人接单了」正文昵称恒空 | 通知文案昵称恒空 | **✅ 已修（2026-11-17，commit `1ace50b1`）**：改读 `partnerUser.nickname/real_name \|\| profile.nickname`；order-create 部署 SHA MATCH |

**观察项（登记不立案）**：①`action_query.js:393` my_counts 售后计数用裸 `$or`（官方 `_.or`），失败被吞成 0——**✅ 已修（2026-11-18，双专家 2/2 确认，commit `58b71d2f` + order-action 部署 SHA MATCH `278D9318`）**：改 `_.and([_.or([{user_openid},{partner_openid}]), {status:_.in([...])}, {is_deleted:false}])`，旁证 im-conv/index.js:327 同型；catch 保留 fail-closed；②im-send/im-conv `FREE_CHAT_STATUS` 未含 S2_5/S2_6/S3_6——四确认完成后的中间态窗口自由文本被拦（fail-safe 方向，口径缺口）；③evaluation-submit index.js:235-238 评价 CAS 整体覆盖 fund 正交位——admin 部分退款后评价会清 refunded_fen 历史（现无实害，账实口径隐患）。

| # | 负债 | 状态 |
|---|---|---|
| B-1 | 自动备份路径（incr/full/verify） | ✅ incr/full/verify 自动路径已于 2026-10-22 实证；2026-11-03 加固（单函数超时/心跳/锁接管）后**未实跑**，下次自动窗口观察 |
| B-2 | lark 异地推送（PATH/token） | 已修（WorkingDirectory + 路径自解析）；**待自动窗口复核 `lark=OK`** |
| B-3 | 集合名单多处硬编码 | ✅ **已偿还（2026-11-05）**：新增 `scripts/collections-canonical.json` 规范源 + `scripts/check-collections-consistency.js` 门禁，校验 **5 处**（`raw-export.js` / `manual-backup.ps1` / `backup.ps1` / `action_export.js` / `action_import.js`）；已挂载 `verify` + `verify:offline`（VERIFY_ONLY），实测 38 集合 × 5 处一致 |
| B-4 | 飞书远端历史包清理 | ✅ **已决策接受（2026-11-13 路线 B）**：不自动化，人工月度执行「保留最近 5 节点」，SOP 已入 [runbooks/backup-restore.md §5](runbooks/backup-restore.md)（列表→排序→网页端手动删→留痕） |
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

### §5.1 专家核验新发现（2026-11-06；C1/C2 已修 2026-11-14，C3 已修待运行时实跑）

| # | 负债 | 证据 | 影响 | 处置 |
|---|---|---|---|---|
| C1 | ~~`zz-seed-orders` 的 `genNo`（秒级时间戳 + 3 位 base36，约 9.7 万空间）同秒批量造单可能撞 `uk_order_no`；`index.js` L561/L756 直接 `add` 无重试且 `.catch(()=>{})` 吞错，仍按 `tasks.length` 报「全建成」~~（T-7.26 拆分后指控点收窄：night_orders 计数链本身如实——失败 continue 不计数，仅 genNo 空间与 service_orders `created=tasks.length` 假报成立） | ~~`cloudfunctions/zz-seed-orders/index.js:661-664`、`L561`、`L596`、`L756`~~ → `action_night_orders.js:70`、`action_service_orders.js:70`、`action_service_orders.js` created 统计 | 演示/种子数据**假成功**（少建却显示完成） | **✅ 已修（2026-11-14 批 1，commit `9b695ed0` + zz-seed-orders 部署，SHA 2 文件 MATCH）**：genNo 随机位 3→6 字符（36³≈4.7万→36⁶≈21亿）×2 处；service_orders created 改按 `rs.filter(demandId)` 实际成功数统计；不影响真实下单 |
| C2 | ~~`admin-action` 的 `order_main` 导入 `mode='append'` 无冲突兜底：任一已存单号（含软删占位）会让整块 500 条 add 抛 `E11000`，灾备恢复中断~~ | ~~`cloudfunctions/admin-action/action_import.js:70-74`~~ | 灾备恢复流程风险 | **✅ 已修（2026-11-14 批 1，同 commit `9b695ed0` + admin-action 部署，SHA 1 文件 MATCH）**：append 模式整块 add 撞唯一键降级逐条 add，冲突单跳过并如实返回 `skipped_conflict` 计数（logEvent 同步记录）；**replace 模式语义不变**（先清空，冲突属异常仍整块抛错）；文档约束 order_main 只用 replace 维持 |
| C3 | `init-db` 的 `purge_test_data` 删除范围过宽：筛选只做 `where({is_test:true})` 后 `remove()`，而 `is_test` 只是「参与方命中 `admin_config.test_openids`」的打标，**真实单号（`ORD…`）的历史单也会被打标**；云端实测 `is_test:true` 未删单 **91 条中 86 条非 `TEST840710820` 前缀**，且参与方去重后**有 1 个不在现白名单** → 一次 `confirm:'PURGE'` 会硬删真实用户历史单且不可恢复，与本模块「绝不误删真实用户数据」直接冲突 | 原 `cloudfunctions/init-db/index.js:312-390`（2026-11-14 拆分后实现位于 `init-db/action_seed.js:5-89`；`demand`/`order_main` 两处 `where({is_test:true}).remove()`） | 误删真实历史单（硬删，无软删兜底）；取证脚本 `probe-purge-scope-20261106.js` 回执已留档于 CHANGELOG 2026-11-06 行 | ✅ **已修（2026-11-06，代码层）**：默认范围收紧为夹具前缀 `TEST840710820` + 关联 demand 精确匹配；`scope:'all_istest'` 须**同时**传 `expect_orders=<实测数>`（不符返回 `idb_purge_expect_mismatch`）；删除语句由 `where({is_test:true})` 改为 `where({_id:_.in(ids)})`；dry-run 新增 `preview{scope,out_of_scope_orders,sample_orders}`；审计 payload 带 `scope`。**待办：运行时 dry-run 未实跑（`admin_config.env=prod` + `admin_openids` 非空，控制台测试面板无真实 OPENID 会被 `idb_forbidden` 拦下；CLI 不能 invoke，§38）→ 改用两层替代验证（已于 2026-11-15 全部闭环，见下）：①「SHA256 字节一致 + 只读复算（夹具 5 单 / 越界 86 单）」；②2026-11-06 进程内 mock SDK 契约测试 **21/21 PASS**（默认 dry-run 只统计、默认真删只删夹具前缀且被打标真实单与未关联 is_test demand 均存活、all_istest 缺 expect_orders 返回 `idb_purge_expect_mismatch`、全量 dry-run/真删数量一致、审计 scope 正确）**。**✅ 运行时 dry-run 实跑闭环（2026-11-15，管理员真机 vConsole 通道——IDE 云端测试面板/后台网关均无真实 OPENID 必被拒，已两次实证）**：返回 `ok:true, dry_run:true`，`stats={demand:1, order_main:55, system_notice:131, order_status_log:26, im_message:10, im_conversation:5, pay_transaction:0, evaluation:0}`，`preview={scope:'test_prefix', out_of_scope_orders:122, sample_orders:TEST840710820A…J}`——与只读复算口径一致（越界 86→122 为 2026-11-06 后新增测试单，非回归）；仅观测零删除，真删仍需显式 confirm 不在本轮 |

### D4 组 · 2026-11-08 双专家核验结论（原「后端同源缺陷」4 条 + 1 条新疑点）

| ID | 声称/问题 | 代码位置 | 结论与依据 | 处置 |
|---|---|---|---|---|
| D4-1 | 评审曾报「`action_modify_extend.js` 改期跨度校验失效（单位/方向/类型错）」 | `cloudfunctions/order-action/action_modify_extend.js:54`、`config_defaults.js:22` | **经双专家 2/2 核验：声称不成立**。实现为 `Math.abs(newTs - Number(start_time))/3600000` 与 `maxSpanH`（默认 72，钳 1–720）比较，单位/方向/归一化均正确 | **不修**（2026-11-08）：唯一穿透条件是订单缺 `start_time`（全库 4 条均为测试单，`NaN > 72` 恒假），真实用户不可达；已补边界单测 `order-action.entry.test.js`「改期跨度超上限拒绝（oa_modify_span）」防回归 |
| D4-2 | 评审曾报「`action_query.js:336` 的 `end_time` 为字符串拼接，与数字时间戳比较恒不成立」 | `cloudfunctions/order-action/action_query.js:336`（`end_time` 仅 L336/L354 两处） | **经双专家 2/2 核验：声称不成立**。实为纯数字加法 `start_time + duration_h*3600*1000`；L354 的 `gapMin` 只做列表渲染的通勤间隔提示，不参与任何 DB 过滤/排序 | **不修**（2026-11-08）：仅缺 `start_time` 的单会让 `gapMin=NaN`、通勤紧张预警静默（同上 4 条测试单）；如未来出现字符串型脏单，`+` 才会退化为拼接，届时再加 `Number()` 兜底 |
| D4-3 | 评审曾报「`_shared/no_show_rules.js:49` 爽约申诉窗口误判（多副本可能不同源）」 | `cloudfunctions/_shared/no_show_rules.js:49-56`；副本 `order-action` / `admin-action`（共 3 份） | **经双专家 2/2 核验：声称不成立**。L49 仅为 `Number(start_time)||0`，真窗口在 L51（`now>=start`）与 L54（`now<=start+48h`，钳 1–168）；三副本 SHA256 一致（逐字节同源）；`demand-publish/action_publish.js:41` 限时长 ≤12h，48h 窗口不会误杀 | **不修**（2026-11-08）：已有 `no_show_rules.test.js:70-71` 覆盖 48h 通过 / +1ms 拒绝；误判方向若发生只会「关闭」窗口而非放大 |
| D4-4 | 评审曾报「`payment-mock/action_account.js:32` 对 Date 类型字段用 `_.gte(数字)`，恒查不到」 | `cloudfunctions/payment-mock/action_account.js:28/32/34` | **经双专家 2/2 核验：声称不成立**。L32 查 `start_time`、L28/L34 查 `service_completed_at`，抽样 200 条全为 `$numberLong`，`$type:"date"`/`"string"` 计数均为 0，类型匹配 | **不修**（2026-11-08）：无漏算路径；该文件真正的疑点是时区（见下一行） |
| D4-5 | `payment-mock/action_account.js` 用**本地时区 getter** 构造「今日/本周一/本月 1 日」边界，而云函数运行时 TZ=UTC ⇒ 日界实为北京时间 08:00 | `cloudfunctions/payment-mock/action_account.js:9-20`、`:32`；对照 `cloudfunctions/order-action/index.js:40-41`（自注「云函数 TZ=UTC」） | 北京 00:00–08:00 起服务的单在「今日待履约」被归到前一日；每月 1 日 00:00–08:00 的已结算收入计入上月「本月收入」（D4-4 的**真实**相邻缺陷，原声称指错了字段类型） | **✅ 已修（2026-11-08，commit `e35e498`，已部署）**：只读聚合取证（双专家 1/1 提出 + 主对话代码级复核成立）——①**S2/S2_5/S3/S3_5 共 113 条，其中 start_time 落在北京 00:00–07:59 的有 22 条**（0点0/1点0/2点2/3点1/5点1/6点9/7点9），占比 19.5%，即「今日待履约」跨日错归**实际可触发**；②已结算单（S5/S8/S9）的 `service_completed_at` 最早小时为 8 点，00:00–07:59 **0 条**，故「本月收入」错归目前**无实际发生**（仅口径隐患）。实施：`CN_OFFSET=8h` + `Date.UTC(...)` 组合算日界（不依赖运行时 TZ），并支持 `event.now` 注入；新增单测钉死下发 DB 区间 = 北京当日 00:00 起 24h；`verify:offline` EXIT=0（tests 868）、payment-mock 串行部署 + `code download` SHA256 一致 |

---

## §3.7 双代理全仓技术评审登记（2026-11-13；2026-11-14 综合评审续登 F10-F12）

> 评审方式：general-purpose 双代理（A 结构猎手 10 项 / B 五文件逐行抽查 12 项），F1-F5 已修复（commit `13903862` + 五函数部署，见 deploy-log）；F1 为 2/2 双确认，F2-F5 经主对话读码裁决属实。正面结论：网关鉴权无绕过、定时器并发安全、接单/支付无双花窗口、配置 SSOT 健全。
> 2026-11-14 综合评审（双代理 A 云端/B 前端+治理，主对话复核降级 1 项、合并重复 1 项）：总体「可交付 MVP+」，无 P2 可利用漏洞；发现 F10/F11（资金口径，第一档）+ F12（登记项），正面结论：资金 CAS+事务+补偿、提现串行锁、隐私掩码全量、门禁可实跑。

| # | 事项 | 状态 | 处置 |
|---|---|---|---|
| F9 | home-action `fillPublisherSurname` 外层 `catch (e) {}` 为空（index.js:277），`user_account` 查询异常时 `_pub_openid`（=creator_openid）随首页响应外泄（F2 least-privilege 的异常路径盲区，同步审核代理 A 发现） | **✅ 已修（2026-11-13，commit `92d63f08` + home-action 部署）** | catch 改 `list.forEach(delete _pub_openid)`；单函数 deploy success + SHA MATCH；门禁 verify EXIT=0 / 951 用例 / A/B 455 |
| F6 | admin-web 错误卫生三件：12 处 502/504 分支直接回 `e.message`（index.js:254 等）；`/api` 请求体无大小上限即 JSON.parse（:209-211）；CORS 全局 `*`（:18-22，鉴权靠 header key 风险有限）——CORS 子项 **✅ 已裁定维持 `*` 销账（2026-11-14 甲方案 A3）**，502 泄漏子项 **✅ 已收口（2026-11-15，commit `17ff9a7c` + admin-web 部署：failJson 统一 13 处 502 兜底，错误细节 console.error 进日志、响应只回通用文案）**；body 上限子项 **✅ 已裁定降级关闭（2026-11-17 双专家评审）** | **三件全部销账** | body 上限：网关侧已有实测硬顶（`runbooks/troubleshooting.md:65-68`：98KB 过/102KB 拒，约 100KiB 平台上限），超限请求到不了函数（admin-web/index.js:209-217 JSON.parse 现状确认），函数内 413 预检属重复防御且有误伤合法 90KB+ 运营位包的风险。**重开条件＝脱离云函数 HTTP 通道（tcbgw）换部署形态** |
| F7 | `payment-mock` mock_refund 允许 **S3→S7** 自助全额退款（action_pay.js:185-191），与附录A MVP 合法流转「S3 仅→S3.5/S5」字面冲突；冻结/争议拦截已补（:189-191） | **✅ 已修（2026-11-13，commit `d553e513` + payment-mock 部署）** | 用户拍板「以附录A为准」→ 状态校验（:185）与 CAS 抢占（:217）均收紧为仅 S2；单函数 deploy success（12 files / 26.6 KB）+ SHA MATCH（`A0765906…`）；门禁 951/951 / A/B 455 / verify EXIT=0；前端无 mock_refund 入口，纯服务端收口 |
| F8 | admin-web 网关内探活串行 for 循环逐单查流水（index.js:359-411），受 2.5s 网关限约束，数据量增大必超时降级 502 | **✅ 已修（2026-11-15，commit `17ff9a7c` + admin-web 部署 SHA 4/4）** | tip 探活逐单串行改 Promise.all 并行；同批 failJson 统一 13 处 502 兜底（F6 错误卫生件①收口） |
| F1-附 | im-send sec_degraded 写侧已删（fail-closed 行为保留）；admin-action/action_im_kefu 补审名单**读侧恒空**（原写侧死代码致永不生效） | **无害残留** | 名单页永远为空属预期；若日后启用降级放行需重写双端契约 |
| F10 | hourly 加时确认把 `add_amount_fen` 并入 total_fen/fee_fen/partner_income_fen（order-action/action_modify_extend.js:338-348），而 pay_transaction **无任何 extend 支付流水** → 未付金额进入结算基数（`partner_income_fen` 聚合可提现余额）与退款上限（2026-11-14 综合评审 A 代理发现，用户立项第一档 (a)） | **✅ 已修（2026-11-14，commit `d32561ba` + order-action 部署，SHA 25 文件 MATCH）** | 加时只加时长不加金额（与 fixed 口径统一为「加时暂不计费」）；fee/income 沿用订单现值（顺带消除 hourly 按 config 费率重算的 fee 漂移）；两处通知文案改「加时暂不计费」；前端 6 处「加时金额 ¥X」展示同步去金额（confirm-flow/order-submit×2/order-view×2/order-detail.wxml+js）；新增 [order_extend_confirm.test.js](../cloudfunctions/_shared/order_extend_confirm.test.js) 4 断言守护 |
| F11 | admin-action 争议退款上限按 `total_fen` 且回写 `fund.paid_fen=total_fen`（action_dispute_handle.js:35,65），与 payment-mock 已修实付口径不一致 → 加时单可退超实付（同上评审 A 代理发现，第一档 (b)） | **✅ 已修（同上 commit + admin-action 部署，SHA 51 文件 MATCH）** | 退款基准改 `fund.paid_fen`（缺失回退 total_fen，与 payment-mock action_pay.js:194 同款）；上限/默认退额/fund 回写三处自动跟随 |
| F12 | 2026-11-14 综合评审其余发现：~~前端 order-poll 1Hz 静态文案 setData（order-poll.js:105-113）~~ / chat 每次轮询两次全量 setData（chat.js:284,352）/ ~~rules-size-baseline 水位漂移 10B（scripts/rules-size-baseline.json:10）~~ / ~~`miniprogram/mock/*` 22.9KB 零引用驻主包~~ / order-timer 20+ 段无全局 deadline（index.js:579-653）/ home-action 冷启动 3 次 createCollection（index.js:34-44）/ 后台 e.message 透传（与 F6 重复合并）/ 清单门只认行首单引号（P4）/ S10.5→S8 流转越界（P4 待拍板）/ 青少年限额 age 缺失放行（P4，**2026-11-15 移入后期**：随真实核身回填 age 一并处理，过渡期风险已接受——发单侧未实名用户不受 200 元上限约束，见 [ROADMAP-post-review.md](ROADMAP-post-review.md) §三）/ `!event` 迁移守卫旁路（P4，主对话复核降级：51 处调用全为内部代码无外部路径） | **第二档 3 项已修（2026-11-14，commit `2de25183`）：①startCountdown 去 1Hz 定时器改为状态刷新时一次性写入（order-poll.js，setData 60次/分→0，零断言受影响）；②水位基线 --write 刷新至实测 16383B/16384B；③mock 目录 6 文件 22.9KB git rm（V15.1 陈年 mock 脚手架，全仓零 require，git 历史可回滚）**。剩余维持登记不动作；~~chat 双写 setData 为下一批候选~~**chat 双写已修（2026-11-14 批 2，commit `7c85b183`）：①renderMessages 无新消息（shouldScroll=false）直接 return 跳过全量 messages setData；②updateMsgStatuses 加 changed 判定，模板卡状态/已选无变化不 setData（均不在 @VERIFIED 体内，随下次体验版生效待真机）**；S10.5→S8 口径**已裁决（2026-11-14 乙案）**：系撤回投诉存量兼容路径（`COMPLAINT_RESTORE_STATUS` 含 S8/S9，D1 2026-10-12 拍板背书；投诉发起侧 2026-10-15 已收窄至 S2-S4，新单不可达），非附录A「S10.5→S5/S7」所指裁决出口，维持现状不收紧（action_dispute.js:5 悬置注释已闭合）；兜底触发条件=存量 S8/S9 起源争议单清零后从恢复白名单移除 S8/S9（届时字面合规，1 行改动） |

---

## §3.8 金额展示取整同类缺陷·双代理评审登记（2026-11-15）

> 触发：用户真机发现「订单 19.90 元但首页显示 20 元」。根因：多处「分→元」用 `Math.round(fen/100)`，1990 分被抬成 20（DB 实证 `rate_fen=1990`）。真缺陷 5 处已修（commit `e036c0e6`，4 云函数部署，见 CHANGELOG）；测试盲区已封（[_shared/money-format.test.js](../cloudfunctions/_shared/money-format.test.js) 1990 分夹具 3 断言，原夹具全为整百、`ha_square_*`/`dp_detail_ok` 在 KNOWN_EVOLUTION 白名单 → 回退成 Math.round 仍全绿的盲区已消除）。

| # | 事项 | 状态 | 处置 |
|---|---|---|---|
| M1 | admin 三处 WXML 直接 `{{item.total_fen / 100}}` 输出 ¥19.9 不补零（admin/demands.wxml:9、admin/orders.wxml:8、admin/config.wxml:44 —— **三页均已随 pkgAdmin 分包移除**，对应 admin-web Demand/Orders/Config 模块）——值正确仅缺补零；WXML 不支持函数调用，修复须先在页 JS 预计算 `*_text` 字段（3 文件） | **✅ 已修（2026-11-15，commits `fac60654`/`8df80b53`/`21343db8` 三小轮 + 体验版 v1.6.125）** | 三页 JS 预计算 `total_yuan_text`/`rate_yuan_text`（`(fen/100).toFixed(2)`）+ wxml 改引用；真机验收：admin 需求/订单/配置三页金额两位小数 |
| M2 | order-create 接单价格区间拦截 toast 4 处未补两位小数（[action_take.js:297/301/308/312](../cloudfunctions/order-create/action_take.js)），显示 "¥19.9"——值正确 | **✅ 已修（2026-11-15，commit `5cff4d69` + order-create 部署 SHA 11/11）** | 4 处改 toFixed(2)；补 2 条守护断言（19901/4999 非整百夹具锁 ¥199.01/¥49.99）；门禁 49/49 PASS |
| M3 | partner-detail `getRateYuan`（[partner-detail.js:263](../miniprogram/pages-v2/partner-detail/partner-detail.js)）**全仓零调用为死代码**（双代理 A 证伪主对话原判「详情页时薪展示」） | **✅ 已修（2026-11-18，双专家 2/2 确认，commit `58b71d2f`）** | 删除 L262-266（注释+方法共 5 行）；grep 全仓零调用实证；sceneRatesMap 仍有其他消费者未触碰 |
| M4 | bootstrap `fenToYuan` 用 Math.round（[bootstrap.js:12](../miniprogram/utils/bootstrap.js)），仅喂整元配置限额（youth/insurance/withdraw 上限），语义正确但易被误复用到金额展示 | **✅ 已修（2026-11-18，双专家 2/2 确认，commit `58b71d2f`）** | L11 上方补注释「仅限整元配置限额转换; 金额展示禁用, 须用 (fen/100).toFixed(2)」；零行为变更，与 admin-web format.js:3 toFixed(2) 划清边界 |
| M5 | 编辑回填显示 19.9 不补零：[publish.js:245/253/415](../miniprogram/pages-v2/publish/publish.js) `String(d.budget)`、[confirm-flow.js:364](../miniprogram/utils/confirm-flow.js) `String(cur/100)`——数值正确（回写不失真），仅输入框观感 | **✅ 已修（2026-11-15，commit `7373e4a3` + 体验版 v1.6.125；原登记不修经用户批准批次方案改为回填）** | 4 处改 toFixed(2) 补零；未用 budget_text 字符串契约字段（维持原红线）；真机验收：编辑需求/费用时输入框两位小数 |
| M6 | demand-publish `buildRecommendPartners` 推荐价区间 `Math.round(scoped/100)`（[index.js:324/327](../cloudfunctions/demand-publish/index.js)）——双代理 A 证伪主对话原判「筛选阈值」：实为 partner-card 展示（[partner-card/index.wxml:40](../miniprogram/components/partner-card/index.wxml)），数据源 `scene_rates` 被 accept-config.js:543 强制整元 → 取整无差异 | **登记不修**（值域恒整数） | 若日后放开非整元 scene_rates，须同步改 toFixed(2) |
| M7 | admin-action `action_demand_order_views.js:68` 输出裸浮点 `total_yuan`（值对不补零）；admin-web 前端 `fenToYuan`（format.js:3）已 toFixed(2)，暂无直接渲染裸值方 | **登记不修**（无实害） | 若后续有人直接渲染 total_yuan，须统一为 toFixed(2) 口径 |
| M8 | `cloudfunctions_baseline/` 冻结基线仍含旧 Math.round 实现（order-action.js:56、demand-publish.js:312）——不部署不生效，但作 A/B 对照与回滚源头 | **登记不修**（基线为冻结快照） | **禁止据 baseline 回滚金额相关文件**；如需回滚须手工带出 toFixed(2) 修复 |

---

## §6 维护与体检

- 规则体系季度体检：见[原清单 §规则体检台账](tech-debt-inventory-20261015.md)（下次到期 2027-01-05，`npm run rules:report`）。
- 每次处置负债：更新本表状态 + 日期 + 证据（命令回执/后台字段/真机谁验），并同步 [CHANGELOG](CHANGELOG.md) 与 [FUNCTION-REGISTRY](FUNCTION-REGISTRY.md)。
- **新增 P2/P3 编号前先 grep 本清单全文防复用**（2026-11-17 实证：§7 曾复用 §3.4/§3.5 的 P3-37/38/39 致「未闭合」清单两义，已改号 P3-48~50 并留映射注记）。
- 真值优先级：云端回读 > 本清单 > [HANDOFF-20261103](HANDOFF-20261103.md) > CHANGELOG > 助手记忆。

---

## §7 2026-11-15 立项登记 · 选单模式与接单开关（已闭合 · 2026-11-17 改号 P3-48~50）

> 来源：选单模式真机回归期间双代理评审（A 事实核验 / B 方案设计）2/2 确认。用户已批准「另案」处置，本轮不实施。**三项已于 2026-11-15 全部修复并验证闭合（见各条）；2026-11-17 原编号 P3-37/38/39 改为 P3-48/49/50，消除与 §3.4/§3.5 的复用歧义——历史记载（HANDOFF-20261115 T-15.x、REGISTRY #174）中的 P3-37/38/39 指 §7 三项即本节。**

| # | 负债 | 证据（文件:行号） | 影响 | 建议处置 |
|---|---|---|---|---|
| P3-48 | 「报名」侧不校验 `accept_switch`，与「接单」侧行为不一致 | 接单侧硬门禁 [action_take.js:69-72](../cloudfunctions/order-create/action_take.js) 返 `order_switch_off`；报名侧 [demand-match/index.js:341-342](../cloudfunctions/demand-match/index.js) 仅校验信用分与实名，**无 accept_switch 判断** | **✅ 已修并部署（2026-11-15，commit `e109ebe1`）**：`demand-match` apply 在耍伴身份审核通过后新增 `accept_switch===false → apply_switch_off`（字段缺省视为开，与 `partner-action` 的 `switchOn` 口径一致）；前端 `_applySelect` 错误码映射补 `apply_switch_off` 文案。CLI 部署 `success=true`（6 files / 10.4 KB），`tcb fn code download` 回读 **index.js SHA256 MATCH**；门禁 `verify:offline` EXIT=0 / `HANDLER-RUNTIME` 146 actions no throw。→ **✅ 已闭合（2026-11-15）**：部署后负向验收通过（模拟器 T-15.5：apply 返回 `apply_switch_off`、UI 实际弹引导弹窗落 accept-config）；REGISTRY #174 已标已验证。**原编号 P3-37（§7），2026-11-17 改号；历史记载中的 P3-37 即本条** |
| P3-49 | `workbench` 页属孤儿页（全仓零用户入口） | 唯一跳转曾为 [take-order.js:109](../miniprogram/utils/take-order.js)（2026-11-15 随方案 A 已回滚为 accept-config）；`app.json:17` 注册但 tabBar 仅 4 项（[:104-109](../miniprogram/app.json)）；`scripts/auto-ui-pages.js:419` 为自动化脚本调用，非用户入口。**核心风险**：该页承载 `free_sos`（无单紧急求助）前端**全仓唯一**调用点（[workbench.js:326](../miniprogram/pages-v2/workbench/workbench.js)），不可达即红线 §9「无单=自由求助」能力线上无入口 | **✅ 已裁定并修复（2026-11-15，用户选 A）**：[profile.js:65-72](../miniprogram/pages-v2/profile/profile.js) `partnerEntries` 补 1 行「接单工作台」，经 `onPartnerEntry` 通用路由自动拼 `/pages-v2/workbench/workbench`（`LOW_PKG_KEYS` 未含该 key，映射正确）。恢复整页可达（无单求助/周日历/数据卡/资金速览）。→ **✅ 已闭合（2026-11-15 用户真机）**：随 #174 三修通过（体验版 v1.6.128）。**原编号 P3-38（§7），2026-11-17 改号；此后 P3-38 专指 §3.4「confirm-flow 模块体积」** |
| P3-50 | 无单紧急求助仅耍伴可达，纯需求方无入口（原 P3-38 衍生，现 P3-49，独立缺陷） | workbench 卡在 `identity === 'partner'` 分支内（[profile.wxml:94](../miniprogram/pages-v2/profile/profile.wxml)）；红线 §9 未限定「无单求助」仅耍伴可用；云端 [safety-report/index.js:213-236](../cloudfunctions/safety-report/index.js) 的 `free_sos` 系列**不校验角色** | **✅ 已修（2026-11-15，commit `184825e1` + 体验版 v1.6.128，用户确认业务口径「非耍伴允许 free_sos」）**：新建 [utils/free-sos.js](../miniprogram/utils/free-sos.js) 作三态逻辑单一真相；`workbench.freeSosFlow` 改为委托（去重，原 −30/+1 行）；[profile.wxml:178-184](../miniprogram/pages-v2/profile/profile.wxml) 用户工作台新增「安全 · 紧急求助」入口 + `onFreeSos`（拨号/仅上报二次确认）。零后端改动、零部署。→ **✅ 已闭合（2026-11-15 用户真机）**：随 #174 三修通过（安全链路）。**原编号 P3-39（§7），2026-11-17 改号；此后 P3-39 专指 §3.5「_acting 锁」** |

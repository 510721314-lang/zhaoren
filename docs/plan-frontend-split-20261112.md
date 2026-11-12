# 前端巨型页面分拆方案（双代理评审修订版 v1.0）

> 日期：2026-11-12　状态：已批准（用户裁定：落盘后分阶段执行）
> 评审来源：`zhaoren-tech-review` 双代理（A 事实核验 10 项：9 属实 1 不符；B 完整性 15 项：2 矛盾/7 遗漏/2 误导/4 自含性，全部采纳修正）
> 执行纪律：**每阶段完成后汇报 → 同步专家审核执行结果 → 按审核意见完善 → 方可进入下阶段**（用户 2026-11-12 指定）
> 关联裁定：P2-14（2026-11-08「不拆」，本方案为其**有条件重开**）；重开条件原文「须先用 mp-page-harness.js 补齐该页断言再动，禁止裸拆」

## 一、重开动因（回应 P2-14 不拆理由）

| 裁定理由（2026-11-08） | 现状回应 |
|---|---|
| ①能力链路回归成本高 | harness 基建已就绪（4 页 28 断言）；断言先行可把回归成本从真机降为脚本 |
| ②无 action 分发复杂度，拆分不减认知负担 | 属实，故只拆「编排/提交域」不拆渲染；阶段C 设量化判据，允许结论=不拆 |
| ③规模尚可控 | 债务仍在累积：order-detail 1386→非空 1489、chat 1081→非空 1369（关闭后 +103/+288） |

## 二、实测基线（2026-11-12，双口径，代理A核验）

| 页面 | 非空行 | 总行 | @VERIFIED 分布（实证） |
|---|---|---|---|
| order-detail.js | 1489 | 1566 | 3 处：L1 文件级、L605 onStartService、L966 onAddTime |
| chat.js | 1369 | 1422 | 4 处：L105 onShow、L623 startPolling、L635/662 applyNotices 系 |
| publish.js | 1078 | 1126 | 2 处：L1-2 文件级 |

云函数侧不在本方案范围（order-timer/index.js 709 行、注册名 SECTIONS，模式同型但口径健康）。

## 三、分阶段执行

### 阶段0 · 断言先行（重开条件兑现）【已完成 2026-11-12】
- chat 页 harness 用例 `scripts/pages-chat.test.js`：最终 **C1-C16 全部「可直接驱动」**（C1 载入契约/C2 角色镜像/C3 batch_blocked/C4 s1Left/C5 变更弹窗幂等/C6 S0 双端/C7 once 锚/C8 通知域/C9 commHit/C10 同 id 异 created_at/C11 applyFail 三分流/C12 动作链栅门/C13 一键三闸/C14 横幅构建/C15 S2·S5 catch-up/C16 幂等键名级断言）
- **桩驱动项取舍（审核回写）**：轮询 tick / showActionSheet / chooseLocation 需扩展 harness 或 wx 桩，**不列入阶段0，登记为阶段A 前置项**（触及对应链路时随用例补桩）
- order-detail/publish 触碰区断言：清单见下，于阶段B/C 开工前兑现
  - order-detail 触碰区断言清单：加时提交链、改期提交链、取消提交链、_modal 互斥
  - publish 触碰区断言清单：发布提交链（缺口待阶段C 评估时补）

**阶段0 专家审核与完善记录（2026-11-12，双代理 2/2）**
- 代理A（守护力）：初版 C1-C8 判定——confirmList/S0 双端/once 锚/通知去重有基本守护；**缺口**：四确认动作链无用例（最重）、commHit/横幅/S2/S5 分支零覆盖、幂等键无键名级断言、3 个反向假设中 2 个不红（键退化盲区）。→ 已补 C9-C16 + harness `calls.storage` 写留痕（`mp-page-harness.js:55,106-108`），键名级断言闭环
- 代理B（合规）：零行为变更/门禁口径/自动纳入全部通过；**建议**：桩驱动取舍回写方案（本节已回写）、归属表验收人写明（见下）、@VERIFIED L105/L623 处置口径（见下）——均已采纳
- **归属表验收口径**：阶段A 第 1 步产出的 applyConfirmation 逐段归属表，须经双代理审核通过 + 用户确认后，方可动 chat.js
- **@VERIFIED L105/L623 处置口径**：onShow/startPolling 两枚标记位于 applyNotices 调用链上；阶段A 采用「转发壳保持调用点不变」模式（先例=order-poll.js），**不改动两处标记函数体**；若实施中发现必须触碰，按 core §2 单独书面批准
- **死代码登记（只登记不修）**：chat.js:459-472「💳 订单支付」分支不可达——L369-370 同条件先 `mark('user_S0')`（1b 先于分支 4 判定），分支 4 永假；阶段A 外移弹窗群时按原样搬迁（保留不可达性，零行为变更），不清理

### 阶段A · chat.js（1369 非空）
1. 前置产出 **applyConfirmation 逐段归属表**（须经双代理审核通过 + 用户确认后，方可动 chat.js）——**v1.1 已双代理审核修订（2026-11-12）**：

**归属表 v1.1**（段号连续覆盖 L245-477，逐行可机械核对）

| 段 | 行号 | 内容 | 归属 | 契约/约束 |
|---|---|---|---|---|
| 1 | 246-252 | progress+count | confirm-flow | 真纯计算，无依赖 |
| 2 | 254-270 | confirmList 构建 | confirm-flow | ctx 注入：data.role、__changeValueText（内部链 fmtDateTime） |
| 3 | 271-284 | unlocked/s1Deadline/s1Left | confirm-flow | **实例态回写**：__confLoaded 写入、__s1Deadline 落 page 实例（轮询 tick L616-617/confirmItem L745 直读，不得改模块内部变量）；~~firstLoad 死变量原样随迁~~ → **批次1 审核收口（2026-11-12）：firstLoad 经双代理确认全文件零读取点，按「登记弃置」处理不再随迁**（confirm-flow.js 头注留痕） |
| 4 | 286-303 | pendingBanner | confirm-flow | ctx 注入：__orderSummary（链 getScene+fmtDateTime） |
| 5 | 305-318 | pendingChange | confirm-flow | ctx 注入：__changeValueText/fmtDateTime |
| 6 | 319-321 | s2Counts | confirm-flow | 归 patch |
| 7 | 322-341 | setData 主体（17 键） | **留页面** | confirm-flow 返回 patch→页面单次 setData(patch,单回调)；**17 键集合快照守护**（items/progress/confirmedCount/confirmList/unlocked/freeChat/orderStatus/startTime/pendingBanner/pendingChange/frozen/s2Counts/s1Left/s1Text/chatBlocked/batchBlocked/orderSummary）；4 个「读旧值条件保留」键（freeChat/startTime/chatBlocked/batchBlocked）必须以 this.data 求值（W9 兜底 C3-b 依赖） |
| 8 | 342-350 | 回调编排 | **留页面** | updateMsgStatuses/__s2Auto 编排不动 |
| 9 | 350-354 | shown/mark 闭包 | chat-notice | stOid 来源 this.data.orderId |
| 10-14 | 357-472 | 五弹窗分支（含 L459-472 死代码💳原样随迁） | chat-notice | 入参 (page, d, nextStatus)；expire_at 取 **d.pending_change 原始值**（禁从 pcn 取）；页面方法仅 __orderSummary（5 处同步）+goPay（死代码内）；三分支跳转为内联 redirectTo |
| 15 | 473-475 | unlocked toast | **chat-notice（随弹窗群，与方案 L357-475 边界一致）** | confirm-flow 需返回非 patch 字段 wasUnlocked/unlocked（setData 后 data.unlocked 已翻转，页面无法事后还原） |
| 16 | 476-477 | 闭合 | — | — |

**实施约束（双代理审核产出，违反即行为变更）**
- ① 「纯计算」定性修正为「**无 UI 副作用计算**」：段 2-6 含实例态读写与 Date.now()，依赖经 ctx 注入；ctx 注入清单=4 方法（__orderSummary/fmtDateTime/__changeValueText/__s1Text）+ data 7 键（role/unlocked/orderStatus/freeChat/startTime/chatBlocked/batchBlocked）；**fallback 合并位置定死在 confirm-flow 侧**（ctx 读当前 data → 出完整 patch）
- ② 弹窗群调用点必须保持 **setData 回调内部、L343-348 编排之后**（pcn 读 this.data.pendingChange 依赖 patch 已落 data）；禁止拆多次 setData
- ③ applyConfirmation 调用点 3 处钉死：fetchData L157 / refreshConfirmation L482 / pollOrderChat L600（**注：为批次1 前行号；批次1 后现行为 `chat.js:160/267/385`，以实测为准**）——方法留页作壳，调用面零变化
- ④ confirm-flow.js 最终内容=本表段 1-6 **另含**动作链方法（onConfirmRow/confirmEdit*/~~`__s2SameValue`~~ 等，方案第 3 步另立清单；**`__s2SameValue` 经批次2 归属表 v2.0 裁定改留页面，见 D-4**）；chat-notice.js 同载 applyNotices 域（@VERIFIED L635/L662 书面批准随迁）+ 本表段 9-15，模块内分区注释、once 键前缀（status: vs chat_notice:/chat_comm:）互不串
- ⑤ 死代码清单：L459-472 💳 分支（不可达成因=同键先 mark，外移不复活——三前提：同一 once-anchor 单例/键串原样/1b 先于段 14）**原样随迁**；L273 firstLoad 死变量经批次1 双代理审核确认零读取点，**登记弃置不随迁**（2026-11-12 收口，confirm-flow.js 头注留痕）
- ⑥ 跨页键 `status:<oid>:change_<field>:<expire>` 双侧 grep 逐字复核（§39 纪律）纳入验收

**实施第 0 步（守护补强，先于外移动笔）**：a) C6 断言改**唯一性**（user_S0 弹窗恰 1 条——封死「死代码复活双弹」盲区，代理A#4）；b) 新增「applyConfirmation patch 键集合==17 键快照」断言（复用 calls.setData 留痕）；c) 弹窗调用点在 setData 回调内的时序断言（代理B#12）

2. `utils/chat-notice.js`：applyNotices 弹窗/横幅域外移（**含 @VERIFIED L635/L662 两枚，需用户书面批准随迁**，标记同迁语义不变）
3. `utils/confirm-flow.js`：四确认动作链外移（依赖清单：data 的 chatBlocked/batchBlocked/orderStatus/pendingChange/s2Counts/startTime/frozen + 实例态 __s1Deadline/__s2Auto/__s2RefreshTried/__commTmplId/__subReqDone + 方法 refreshConfirmation/sendTemplate/__sendMissingConfirmCards/__requestCommSub/_handleOaConflict/_handleApplyFail/__s2SameValue，全部经 page 首参 ctx 注入，先例=`utils/order-poll.js`）
4. 附 wxml bindtap 14 方法对照表（goBack/goOrderDetail/goPay/onS2ChangeTap/onConfirmRow/onRespondChange/onConfirmAll/onQuickKey/sendText/closeEditSheet/confirmEditTime/confirmEditContent/confirmEditFee/confirmEditOther），漏一个=点击静默，实施后 grep 复核
5. 附跨页 Storage 键表：`status:<oid>:change_<field>:<expire>` 由 chat.js:353-354/395-398 与 order-detail.js:415-419 双侧拼接，**逐字一致**，实施后双侧 grep 复核（§39 同款纪律）

#### 阶段A · 批次2 动作链归属表 v2.0（2026-11-12 起草；**状态：双代理审核已收口，待用户确认；chat.js 零改动**）

> 现场基线（实测）：`chat.js` 总 1125 / 非空 **1073**（批次1 后）；`utils/confirm-flow.js` 总 114 / 非空 112。本表行号以当前工作区实测为准（HEAD=95262ff）。
> 目标文件：`utils/confirm-flow.js`「分区二：四确认动作链」（方案 §三-阶段A 第 3 步）；页面保留转发壳，wxml 与调用面零改。
> 评审来源：`zhaoren-tech-review` 双代理（2026-11-12）；A 事实核验 12 项（9 属实 / 3 表述级不符）、B 完整性 12 项（3 放行阻断 / 3 必修 / 4 建议 / 2 通过），2/2 确认项已回写本节。

**① 逐段归属（覆盖 L424-979 与 L1081-1117 全部行，连续无空档；各段区间含前导注释行）**

| 段 | 行号 | 内容 | 归属 | 契约/约束 |
|---|---|---|---|---|
| B1 | 424-439 | `onTmOption`（模板卡 option 事件：TM5 无字段 toast / positive→confirmItem / 否则 startEdit；chatBlocked 闸） | confirm-flow | wxml `bind:optiontap` 保留，页面留 1 行壳 |
| B2 | 441-467 | `confirmItem`（S2 拒 / S1 窗口已尽→`_handleOaConflict` 前置拦截 / `__requestCommSub` / `confirm_item` 云调用 / 失败分流 / 网络兜底） | confirm-flow | 依赖 page：`__s1Deadline`、`_handleOaConflict`、`__requestCommSub`、`refreshConfirmation`；页面留壳（C12 直调） |
| B3 | 469-491 | `onConfirmRow`（四栅：非 S1→chatBlocked→pendingChange→myOk） | confirm-flow | wxml `bindtap` 保留，页面留壳 |
| B4 | 493-548 | `_handleOaConflict` + `_handleApplyFail` | **留页面** | 方案第3步 ctx 依赖清单点名；C7/C11/C16 直调，随迁会破坏守护面 |
| B5 | 550-595 | `onConfirmAll`（chatBlocked/batchBlocked/S2 三闸 + 二次确认弹窗 + `confirm_all` + 补卡编排） | confirm-flow | 依赖 page：`__requestCommSub`、`_handleOaConflict`、`__sendMissingConfirmCards`、`refreshConfirmation`；wxml 留壳 |
| B6 | 597-605 | `__sendMissingConfirmCards`（串行补卡 300ms） | **留页面** | 方案第3步 ctx 依赖；与 `sendTemplate` 同域（消息） |
| B7 | 607-729 | `startEdit`（状态闸（仅 S1/S2，S2 限 location/content）/ 四项前置判定（开关→冻结→时间窗→次数）/ `__s2RefreshTried` 重取一次 / `chooseLocation` 及 fail 兜底 / time·content·fee 三个 editSheet 分支） | confirm-flow | 依赖 page：`refreshConfirmation`、`__s2SameValue` 不经过此处；实例态 `__s2RefreshTried`；失败重试递归改为模块内自调；页面留壳（applyConfirmation 壳调用点改写） |
| B8 | 731-734 | `onS2ChangeTap` | confirm-flow | wxml 两按钮 `data-field` 不变，页面留壳 |
| B9 | 736 | `closeEditSheet` | confirm-flow | wxml 4 处绑定，页面留壳 |
| B10 | 738-747 | `onEditDate` / `onEditTimeHm` / `onEditFeeInput` / `onEditContentChange` | confirm-flow | wxml `bindchange`/`bindinput`，各留 1 行壳 |
| B11 | 749-763 | `confirmEditTime`（日期时间解析 + 未来时间校验） | confirm-flow | wxml 留壳 |
| B12 | 765-772 | `confirmEditContent`（至少保留一项） | confirm-flow | 同上 |
| B13 | 774-786 | `confirmEditFee`（元→分整数校验） | confirm-flow | 同上 |
| B14 | 789 | `onOtherInput` | confirm-flow | wxml 留壳 |
| B15 | 791-803 | `confirmEditOther`（非空 + `CONFIG.ORDER.reasonMaxLen` 上限） | confirm-flow | wxml 留壳；`CONFIG` 由模块自行 require |
| B16 | 805-876 | `applyChange`（S2 同值前置拦截 / 原因类型 ActionSheet（`slice(0,6)`）/ 原因 ≥`reasonMinLen` 弹窗 / `change_apply`·`s2_change_apply` 提交 / 失败→`_handleApplyFail`） | confirm-flow | 依赖 page：`__s2SameValue`、`_handleApplyFail`、`refreshConfirmation`；无外部调用点，不设壳 |
| B17 | 878-928 | `onRespondChange`（accept/reject 文案三分支（S2 / fee / 其他）/ `change_respond`·`s2_change_respond`） | confirm-flow | wxml 两按钮，页面留壳 |
| B18 | 930-951 | `onQuickKey`（TM5→editSheet other；其余→sendTemplate） | **留页面** | 消息域入口；TM5 计数链在 `sendTemplate` 内 |
| B19 | 953-979 | `sendTemplate`（+ TM5 达阈值→askKefu） | **留页面** | 消息域；`__sendAllConfirmTemplates`（引导链）共用 |
| B20 | 1081-1096 | `__s2SameValue` | **留页面（裁定 D-4）** | 与后端 `action_change_s2` sameValue 需双侧对账（§39 口径），且被 `applyChange` 同域调用；**与方案约束④「`__s2SameValue` 随迁」冲突，以本表裁定为准**，实施时同步回写约束④与 HANDOFF T-13.1 注 |
| B21 | 1097-1117 | `fmtDateTime` / `__s1Text` / `__changeValueText` | **留页面** | 已被 confirm-flow 段1-6 经 page ctx 调用，不重复随迁 |
| B22 | 981-1124 | `askKefu` / `onTextInput` / `startRateCooldown` / `clearRateTimer` / `sendText` / `goPay` / `goBack` / `goOrderDetail` / `nowTime` / `fmtTime` / `scrollBottom` / `onReserve` | **留页面** | 客服·自由文本·导航·工具域；批次2 零触碰（A#10 补登记，B#6 漏项收口） |

- 外移合计：**15 段 / 18 方法 / 423 行（实测，含注释，全部为非空行）**（B1-B3、B5、B7-B17）；留页：B4、B6、B18-B22。
- 页面新增壳：**17 个一行壳**（15 个 wxml 绑定 + `confirmItem`（C12 直调）+ `startEdit`（调用面稳定）），净减约 380 行（预期 chat.js 非空 ~690，以实测为准）。
- **壳写法硬约束（B#7 放行阻断项）**：必须用对象方法简写 `onXxx(e) { confirmFlow.onXxx(this, e); }`，**禁止箭头属性**（定义期 `this` 为 undefined）；需要返回 Promise 的壳（`refreshConfirmation` 不迁、无需改）与外移方法的壳（`confirmEdit*`）**必须 `return confirmFlow.x(this, ...)`**。

**② ctx 注入清单（page 首参，先例 `utils/order-poll.js`）**

| 类别 | 明细 |
|---|---|
| page 方法（6 + 1 间接） | `refreshConfirmation` / `__sendMissingConfirmCards` / `__requestCommSub` / `_handleOaConflict` / `_handleApplyFail` / `__s2SameValue`；另 `setData`（外移段 10 处写，ctx=page 天然可用，清单显式登记） |
| 间接页面能力 | `sendTemplate`：外移段内**零直调**，仅经留页 `__sendMissingConfirmCards`（B6）间接，页面内自洽（A#5 收口） |
| data 键（读取 15） | `orderId` / `orderStatus` / `chatBlocked` / `batchBlocked` / `pendingChange` / `confirmList` / `items` / `s2Counts` / `startTime` / `frozen` / `editDate` / `editTimeHm` / `editFeeYuan` / `editContentOpts` / `otherText`；**写入键 `editSheet` 不在读取清单，勿误删**（A#6） |
| 实例态（2） | `__s1Deadline`（B2） / `__s2RefreshTried`（B7） |
| 模块自持 | `callCloud`、`CONFIG`、`TM_TEMPLATES`、`TM_FIELD`（见决策点 D-1）、`wx` |

**③ 调用点改写：零处（v2.0 复审订正）**
- `applyConfirmation` 壳内 [chat.js L258](file:///c:/zhaoren/miniprogram/pages-v2/chat/chat.js#L258) 的 `this.startEdit(autoField)` **保持原样**——`startEdit` 保留页面壳后经壳转发即等价，diff 最小、贴合「调用面零变化」（A#4 / B#10 2/2 收口）。
- 其余调用全部落在随迁段内部（模块内自调或经 page ctx），页面其他调用点零变化。

**④ wxml 绑定对照（实施后逐项 grep 复核，漏一个=点击静默）**

| 事件 | 绑定（chat.wxml 行） | 方法 | 批次2 处置 |
|---|---|---|---|
| bindtap | 6 / 8 / 20 / 31 / 78 | `goBack` `goOrderDetail` `goPay` | 只留页 |
| bindtap | 108 | `onConfirmAll` | 置壳 |
| bindtap | 134 / 150 | `onQuickKey` / `sendText` | 只留页（消息域） |
| bindtap | 40 / 41 | `onS2ChangeTap` | 置壳 |
| bindtap | 65 | `onConfirmRow` | 置壳 |
| bindtap | 98 / 99 | `onRespondChange` | 置壳 |
| bindtap | 164/165/179/180/192/193/205/206 | `closeEditSheet`（4 处）/ `confirmEditTime` / `confirmEditContent` / `confirmEditFee` / `confirmEditOther` | 置壳 |
| bindchange | 156 / 159 / 171 | `onEditDate` / `onEditTimeHm` / `onEditContentChange` | 置壳 |
| bindinput | 149 / 188 / 201 | `onTextInput`（留页）/ `onEditFeeInput` / `onOtherInput` | 前 1 留页、后 2 置壳 |
| bindconfirm | 149 | `sendText` | 只留页 |
| bind:optiontap | 122 | `onTmOption` | 置壳 |
| bind:close | 155 / 170 / 185 / 198 | `closeEditSheet`（自定义事件，另 4 处） | 置壳（同一壳复用） |
| bind:btntap | 16 | `reload` | 只留页 |
| bind:reserve | 213 | `onReserve` | 只留页 |

合计 **35 处事件绑定 / 23 个方法**（bindtap 21 · bindchange 3 · bindinput 3 · bindconfirm 1 · optiontap 1 · bind:close 4 · bind:btntap 1 · bind:reserve 1）。方案第4步的「bindtap 14 方法」仅列外移候选的口径；本表为全量绑定面（A#9 / B#6 2/2 收口），实施后逐项 grep 复核。

**⑤ 不可触碰项**
- `@VERIFIED 2026-11-10 onShow`（L108）与 `startPolling` 内 @VERIFIED（L408）**零触碰**（T-13.1 明文）；`L250`/`L417` 两处含「@VERIFIED」字样的迁移注记**非标记位**，实施时勿误判（A#10）。
- 消息/渲染/轮询/导航/格式化域（B4、B6、B18-B22）原样留页。
- 跨页 Storage 键（`status:<oid>:change_<field>:<expire>`）由 chat-notice/order-detail 持有，批次2 不新增不修改。

**⑥ 行为等价证明方式**
1. **既有断言一律不改**：`npm test` 911 全绿；C7/C11/C16 直调留页方法（B4），C12/C13 直调外移方法壳（A#12 措辞收口）。
2. **嵌套 `this` 归零（B#1 放行阻断项）**：外移段内嵌套箭头回调 5 方法 15 处（B2 L459/462；B5 L576/579/583/588×2；B7 L649/693；B16 L815/821/824/835；B17 L905/921），必须逐处改为 `page.`/模块内自调；实施后对 `utils/confirm-flow.js` 执行 `grep -n "this\."`，**命中必须为 0**（文件首行 `'use strict'`，裸 `this`=undefined 会导致点击静默）。
3. **递归时序契约（B#3）**：B7 必须保持 `__s2RefreshTried=true`（L645）→ `refreshConfirmation`（L647）→ 递归自调（L649）→ 复位 `false`（L650）顺序，复位不得提前；模块内自调，禁止「模块→page 壳→模块」二次转发。
4. 机械比对 `git show`：逐行核对仅允许白名单——`this.`→`page.`/模块自调、新增 `require` 行与函数签名、`module.exports` 追加、分区头注；**禁止重排语句**（loading→cloud→hideLoading 成对顺序即为契约）。
5. `verify:offline` EXIT=0 + `SHARED SYNC ALL OK`；空 catch 门禁：chat.js 基线 7 不变、confirm-flow 维持 0（随迁段零空 catch，**不刷新基线**）。
6. ~~真机走查挂 v1.6.118（T-13.5，iOS+Android 各一遍）~~ **2026-11-12 已由 §T-13.5 自动化口径取代（仅遗留视觉/触感/机型抽验）**：逐项确认 / 一键确认（含补卡）/ 改地点（选点取消与定位被拒）/ 改内容 / 改时间 / 改费用 / 特殊需求 / 接受·拒绝变更 / 窗口已尽与次数上限拦截 / 原因类型 ActionSheet 截断与取消。

**⑦ 待裁定项（请审核与用户确认）**
- **D-1 `TM_FIELD` 归宿**：**已裁定（用户 2026-11-12）= confirm-flow 局部复制 1 行 + 头注声明与 `chat.js:11` 同源**（零 import 变更、回滚最轻，登记双源负债）；不迁至 confirm-flow 再 export（渲染域反向依赖动作模块，层次倒挂，B#5）。
- **D-2 批次粒度**：**已裁定（用户 2026-11-12）= 拆两小批**：2a 确认链（B1-B3+B5，4 方法 112 行，已有 C12/C13 守护）→ 2b 编辑/提交链（B7-B17，14 方法 311 行，前置补桩后落地）；各留回滚点、各自门禁全绿。
- **D-3 内部方法壳**：`confirmItem`（C12 直调）/`startEdit`（调用面稳定）保留 1 行壳；`applyChange` 无外部调用，不设壳；**调用点改写=0 处**（见 ③）。
- **D-4 `__s2SameValue` 归属**：**已裁定（用户 2026-11-12）= 留页面**；方案约束④已回写，HANDOFF T-13.1 的「随迁」表述在批次2 收口时同步注记。

**⑧ 实施第 0 步与收口（B#9/B#11 补充）**
1. **补桩用例 3 条（先于外移动笔）**：B7 重取一次（成功/仍失败两分支）、B16 原因类型→原因文案→提交载荷、B17 accept/reject 文案与 `change_respond`/`s2_change_respond` 载荷；用 harness 的 `wx.showActionSheet`/`chooseLocation` 桩。既有断言不动。
2. **提交拆分**：按 core §9 三类隔离——业务代码（chat.js + confirm-flow.js）单 commit；测试基建（pages-chat.test.js 补桩）单独 commit；docs（本表 + REGISTRY/CHANGELOG）单独 commit。D-2 若拆两批则每批仍按此三分。
3. **回滚点**：归属表 docs commit `b598de7` 为批次2 基点（再往前 `95262ff`）；2a 代码 commit 与 2b 代码 commit 各自独立，回滚=`git revert <批次commit>`，不 `reset --hard`。
4. 收口：`docs/FUNCTION-REGISTRY.md` + `docs/CHANGELOG.md` 追加行；HANDOFF T-13.1/T-13.5 状态回填。

### 阶段B · order-detail.js（1489 非空）
1. 「操作互斥锁外移」：_modal/_acting ~30 行壳（预期减行量级小，收益=解耦非减行，如实表述）
2. action 提交器：onModify/onExtend 等提交链外移——**触碰文件级 @VERIFIED 覆盖区（加时超时拒绝/S2 协商取消），逐项书面批准**
3. 开工前补触碰区断言（见阶段0 清单）

#### 阶段B · B2 提交器归属表 v1.1（2026-11-12 草修订；**状态：双代理审核已收口（A：5 属实 / 2 行号订正 / 1 语义订正；B：6 项契约已回写）→ 可进入实施**）

> 前置：用户 2026-11-12 逐项书面批准 B2 范围＝`submitExtend` / `submitModify` / `onCancel` / `onExtendConfirm` / `onModifyConfirm` / `onModifyReject`（触碰第 1 行文件级 @VERIFIED 点名的「加时超时拒绝 / S2 协商取消链双出口」，批准后仍须归属表 + 双代理审核才动代码）。
> 现场基线：`order-detail.js` 总 1560 / 非空 **1483**（B1 后实测）；目标文件新增 `utils/order-submit.js`（仅提交/响应链，不混入渲染）。
> 行为等价口径：逐字搬迁 + `this.`→`page.`（含 `const that = this` → `const that = page`）+ 页面留同名转发壳；wxml 绑定名零改。

**① 逐段归属**

| 段 | 行号 | 内容 | 归属 | 契约/约束 |
|---|---|---|---|---|
| S1 | 978-1021 | `submitExtend`（时长 1-12 闸 / 原因类型必选 / 原因 ≥`reasonMinLen` / `extend` 载荷 `reason.slice(0,extendReasonMax)` / 成功关面板+弹窗+`fetchData`） | order-submit | `const that = page`；成功**后**关 `extendPanelVisible`（1009）→ 弹窗 → `return page.fetchData`；依赖 page：`data.extend*`、`fetchData` |
| S2 | 1023-1047 | `onExtendConfirm`（无在途 toast / `cancelIsAction:true`（取消键=拒绝业务动作）/ `extend_confirm`·`extend_reject` / `_handleConflict` / 刷新） | order-submit | `const that = page`（含 `success` 箭头内联）；`this._modal`→`page._modal`、`that._handleConflict`→`page._handleConflict`；依赖 page：`_modal`、`_handleConflict`、`fetchData` |
| S3 | 1141-1202 | `submitModify`（日期时间必填 / `buildModifyTs` 未来值 / 选回原时间拦截 / `minLeadHours` / 原因类型必选 / 原因 ≥`reasonMinLen` / `_modal` 二次确认 / `modify` 载荷 / 成功 toast+刷新） | order-submit | `const that = page`；`this.buildModifyTs`→`page.buildModifyTs`；**请求前**关 `modifyPanelVisible`（1180，与 S1 时机不同，禁拉平）；`Date.now()` 为全局；依赖 page：`buildModifyTs`、`_modal`、`_handleConflict`、`fetchData`、`CONFIG.MODIFY.*` |
| S4 | 1204-1224 | `onModifyConfirm`（`modify_confirm` / 冲突收敛 / 刷新） | order-submit | `const that = page`；`success(res) {` **方法简写原样保留**（`_modal` 以 `opts.success(res)` 调用，简写内 `this`=opts，正文只许用 `that`/`page`，禁止改写成依赖 `this`）；`pm` 为空兜底文案「确认同意本次改期？」 |
| S5 | 1226-1246 | `onModifyReject`（`modify_reject` / 冲突收敛 / 刷新） | order-submit | 同 S4（`success(res)` 简写保留，禁用 `this`） |
| S6 | 1466-1499 | `onCancel`（梯度退款规则文案 / 当前档位 `cancelTiers[currentCancelIdx]` / `cancel` 载荷 `reason: 按<label>梯度退款` / 成功 toast + 1.5s `navigateBack`） | order-submit | `const that = page`；`setTimeout` 必须用全局（禁顶部缓存引用，否则测试桩失效）；依赖 page：`_modal`、`_handleConflict` |

**② 留页面（不随迁）**
- `onModify`（1051-1082，入口状态闸 + 打开面板）、面板输入 helpers（`closeExtendPanel` 967 / `onExtendHoursTap` 969 / `onExtendReasonInput` 973 / `onExtendReasonTypeChange` 1132 / `closeModifyPanel` 1084 / `onModifyDateChange` 1109 / `onModifyTimeChange` 1113 / `onModifyReasonInput` 1123 / `onModifyReasonTypeChange` 1129）、`buildModifyTs` 1137-1139 薄代理、`_modal` 163-165 薄代理、`_handleConflict` 169。
- 理由：这些是渲染态与入口域，搬走只增跨文件耦合、不减认知负担（方案 §一②「只拆编排/提交域不拆渲染」）。

**②b 跨文件契约（双代理 B 审核产出，违反即行为变更）**
1. 成员调用一律 `page.xxx()` 实时调用，**禁止解构/别名缓存**（如 `const { fetchData } = page`）；`page.data.*` 逐处实时读，禁止跨 `await` 快照。
2. 成功路径的 `return page.fetchData(...)` **return 不得丢**（丢则 `_modal` 的 `_acting` 在刷新前释放 → 连点重复提交）。
3. 面板可见性归页面：模块仅在成功路径按原时机 `setData`（S1 成功后关 / S3 请求前关），**写入键** `extendPanelVisible`/`modifyPanelVisible` 经 `page.setData` 回写，不在 15 个读键清单内。
4. 提交器**不得增删状态闸**（状态/冻结/在途/次数判定仍由页面 `onModify` 入口负责，与原一致）。
5. 提交流程为「提交器 → `page._modal` 壳 → `utils/order-modal`」单向两层转发，**不是**递归自调，不属「禁二次转发」条款；禁止优化为直接 `orderModal.showModal(...)` 或解构 `_modal`。
6. `success(res) { ... }` 方法简写原样保留；其内 `this` 指向 `opts`（`order-modal.js` 以 `opts.success(res)` 调用），禁改箭头或依赖 `this`。

**③ ctx 注入清单**
| 类别 | 明细 |
|---|---|
| page 方法（4） | `_modal` / `_handleConflict` / `buildModifyTs` / `fetchData` |
| data 读取键（15） | `order` / `extendHours` / `extendReasonTypes` / `extendReasonTypeIndex` / `extendReason` / `reasonMinLen` / `extendReasonMax` / `modifyDate` / `modifyTime` / `modifyReasonTypes` / `modifyReasonTypeIndex` / `modifyReason` / `modifyReasonMax` / `cancelTiers` / `currentCancelIdx` |
| data 写入键（2） | `extendPanelVisible`（S1 成功后）/ `modifyPanelVisible`（S3 请求前）——经 `page.setData` 回写，不在读键清单内 |
| 模块自持 | `callCloud`、`CONFIG`、`wx`、`setTimeout`（全局）、`Date.now()`（全局） |

**④ 页面壳（6 个，wxml 7 处绑定）**
`submitExtend`(wxml:410) · `submitModify`(376) · `onCancel`(127) · `onExtendConfirm`(243/244) · `onModifyConfirm`(323) · `onModifyReject`(322) —— 全部对象方法简写、首参透传 `this`、尾逗号。

**⑤ @VERIFIED 处置（core §2）**
- **为什么必须改**：阶段B 的目标是把「提交/响应编排域」从 1483 非空行的页面解耦（只拆提交域、不拆渲染）；6 方法为该域的最小闭包，外移范围已由用户逐项书面批准（2026-11-12）。
- **书面批准范围**：`submitExtend` / `submitModify` / `onCancel` / `onExtendConfirm` / `onModifyConfirm` / `onModifyReject`（文件级 @VERIFIED 覆盖整个 `order-detail.js`，6 方法均落在覆盖内，故 §2 批准必要）。
- **语义订正（双代理 A 核验）**：第 1 行「S2 协商取消链双出口」指**取消转裁决**（服务端 S7/S2 两出口，`FUNCTION-REGISTRY.md:53`）；页面侧取消链=`onCancel`。`onModifyConfirm`/`onModifyReject` 是**改期**双出口（`modify_confirm`/`modify_reject`）。三项分别锁定，不混为一谈。
- **向后兼容**：页面保留 6 个同名对象方法壳（首参 `this` 透传），wxml 7 处绑定（`order-detail.wxml:127/243/244/322/323/376/410`）与测试 6 处调用点零改。
- **不变量（搬迁后逐字保持）**：加时确认链 `extend_confirm`/`extend_reject` 与无在途 toast「无待处理的加时申请」；`onCancel` 梯度档位计算与「按<label>梯度退款」；改期双出口载荷/文案/toast；`confirmColor`/`duration` 等易漂移值；第 1 行标记原文与 `:369-378` 超时拒绝渲染文案**留页未触碰**。
- `order-submit.js` 头注声明「搬迁自 @VERIFIED 文件第 1 行覆盖区，行为等价，用户 2026-11-12 书面批准」。

**⑥ 实施第 0 步（先于外移）与验收**
1. 断言：**O11-O13 已写入**（加时同意/拒绝双出口、改期同意/拒绝双出口、取消档位切换，工作区待提交）；**再补 O14-O16**：O14 `_handleConflict` 命中（不弹 `r.msg`、触发刷新）、O15 网络 catch（`hideLoading` + 「网络异常」）、O16 `onModifyConfirm` 的 `pm` 为空兜底文案。
2. 机械等价：`git show` 归一化比对 0 差异（白名单：签名/`that = page`/`this`→`page`/尾逗号/壳/`require`）；**行号以本表 v1.1 为准**（S3=1141-1202、`onModify`=1051-1082）。
3. **裸 `this` 门禁**：`grep -n "this\." miniprogram/utils/order-submit.js` 命中必须为 **0**（`success(res)` 简写内亦然）。
4. 门禁：`npm test`（HEAD 922 + O11-O13 3 条 + O14-O16 3 条 = **928**；历史快照，最终以 T-13.5 全量 **932** 为准）、`verify:offline` EXIT=0、A/B 455、silent-catch 不增。
5. 提交拆分：测试基建（O11-O16）单独 commit → 业务代码（order-detail.js + utils/order-submit.js）单独 commit → docs 台账单独 commit。
6. 真机走查挂 v1.6.118（T-13.5；**2026-11-12 已由 §T-13.5 自动化口径替代**）：加时提交/同意/拒绝、改期提交/同意/拒绝、取消（各档位文案）、连点防重。
7. 双代理执行审核 0 缺陷后 → 阶段C 评估。

### 阶段C · publish.js（1078 非空）· **结论：不拆（2026-11-12 量化评估）**
- 量化判据：候选外移纯函数行数 / wxml 绑定密度 / @VERIFIED 触碰数 / 耦合成员数（含 `getApp().globalData.availableScenes` R9 依赖——不可外移）
- publish.js L1-2 文件级 @VERIFIED 覆盖发布+代发校验主链，触碰即须书面批准

**评估实测（2026-11-12，HEAD=`5333fc9`）**

| 判据 | 实测 | 判读 |
|---|---|---|
| 非空行 | **1078**（总 1126） | 与台账一致 |
| 顶层方法 | **73 个**，其中 wxml 绑定 handler **46 个**（63%） | 绝大多数为绑定入口，搬走只增壳 |
| wxml 绑定密度 | 46 处 / 1078 行 ≈ **4.3%** | 高密度（每 23 行一处绑定） |
| 候选外移纯函数 | 仅 `fmtDate` 6 行（2 处内部调用、无 wxml 绑定）≈ **0.56%** | 收益低于评审/回滚成本 |
| 已外移域 | `publish-validate` 139 / `publish-locate` 144 / `draft-store` 114 / `geo-wx` reverseGeocode | 校验/定位/草稿/逆地理已全部迁出，余量为编排 |
| @VERIFIED 触碰 | **2 处文件级**（L1-2），发布主链 `onPublish`/`_continuePublish`/`validatePublish`/`confirmPublish`/`_doPublish`（847-1112，约 266 行）全在覆盖区 | 触碰即需 §2 书面批准，风险/收益倒挂 |
| 耦合成员 | `getApp().globalData.availableScenes`（R9）+ `callCloud` + `uploadFile`/定位 + `redline` + 导航 | 提交链深度耦合，非纯函数 |

**结论：不拆**。理由：①纯函数余量仅 6 行（0.56%），拆分不减认知负担；②46/73 方法为 wxml 绑定入口，只能壳化；③提交主链 266 行全在文件级 @VERIFIED 覆盖区，拆分需逐项批准且回归成本高；④校验/定位/草稿等真正可测域已于阶段1/2 外移完毕。**本结论即方案允许的「不拆」出口，不产生代码改动**。

### T-13.5 真机走查 → 自动化口径（2026-11-12）

> 用户指定「自动化测试完成」：把 T-13.5 真机清单逐项映射到页面级 harness 断言（不替代视觉/触感抽验，但拆分放行不再依赖真机）。

| 真机项 | 自动化断言 | 状态 |
|---|---|---|
| chat 逐项确认 | C12 四栅 + C19 正向 `confirm_item` | 通过 |
| 一键确认（含补卡） | C13 三闸 + C20 成功支路（补卡不重发 + 刷新） | 通过 |
| 改地点 | C19 负向进编辑态 + C21 选点重取/fail-safe | 通过 |
| 改内容 | C22 原因类型→原因→`s2_change_apply` 载荷 | 通过 |
| 改时间 | C26 `change_apply`（time=时间戳）+ 缺字段闸 | 通过 |
| 改费用 | C27 元→分取整 + 非法金额闸 | 通过 |
| 特殊需求 | C25 `change_apply`（other，不带 S2 原因字段） | 通过 |
| 接受/拒绝变更 | C23 accept 载荷 + C24 同值拦截 | 通过 |
| 窗口已尽/次数上限 | C12 窗口已尽前置拦截 + C11 次数上限分流 | 通过 |
| order-detail 加时全链 | O7 提交 + O11 同意/拒绝 + O14 冲突收敛 + O15 网络兜底 | 通过 |
| 改期全链 | O8 提交 + O12 同意/拒绝 + O16 无在途兜底 | 通过 |
| 取消（各档位） | O9 载荷 + O13 档位切换 | 通过 |
| 连点防重 | O10 互斥 + O17 fail 放锁 + O18 业务 reject 放锁 | 通过 |
| 拆分零行为变更 | 模块内裸 `this`=0、wxml 绑定零改、`npm test` 全绿、A/B 455 | 通过 |

**结论**：T-13.5 的交互/载荷类清单已全部自动化（`scripts/pages-chat.test.js` C1-C27、`scripts/pages-order-detail.test.js` O1-O18，全量 **932/932**）；仅「视觉/触感/机型适配」不可自动化，随 v1.6.118 由用户抽验（iOS+Android），**不再作为拆分放行阻塞**。

### 通用纪律（每阶段）
- 单阶段单 commit，断言+门禁全绿才进下阶段，失败 revert 本阶段
- `npm test` + `verify:offline` 全绿；A/B 等价不回归
- §6 回归清单表：区分开发者工具自证 / 真机 iOS+Android（能力链路列第 1 条）；收尾按 §9 落 REGISTRY/CHANGELOG
- 每阶段收口：汇报 → 双代理审核执行结果 → 完善 → 进下阶段

## 四、验证者修正记录（防复发）

1. 代理A证伪「云函数全部 ≤700 行」：order-timer=709、注册名 SECTIONS——云函数侧移出范围
2. 代理B证伪草案函数名 `applyHit`：实际为 applyNotices 内局部变量 respondHit/modifyHit/commHit
3. 行数口径统一：非空行（1489/1369/1078）与总行（1566/1422/1126）双口径并列；台账 P2-14 旧值（1386/1081/1078）为 2026-11-08 口径
4. @VERIFIED 重叠面为原草案盲区：三页共 9 处标记，涉及区全部前置书面批准（最大风险项）

## 五、执行进度

| 阶段 | 状态 | 汇报 | 专家审核 | 完善 | commit |
|---|---|---|---|---|---|
| 0 断言先行 | **已完成（2026-11-12）** | C1-C8 交付 | A：3 盲区+动作链裸奔；B：合规 3 通过+2 建议 | C9-C16+storage 留痕，意见全采纳 | `f3b8049` |
| A chat.js | **批次1 已完成（2026-11-12）**：实施第 0 步守护补强（C6 唯一性+C17 17键快照+C18 弹窗时序）→ applyConfirmation 拆分（confirm-flow 段1-6 / chat-notice 段9-15）→ applyNotices 域外移（@VERIFIED 两枚随迁，用户书面批准）。chat.js 非空 1369→**1073**（-296）；门禁 verify:offline EXIT=0 / npm test 911/911 / A/B 455；bindtap 14/14、跨页键双侧 grep 复核通过；silent-catch 基线订正（chat.js 10→7，chat-notice=3，机械随迁） | 待汇报 | 待双代理审核 | — | 见 git log |
| A-批次2a 确认链 | **已完成（2026-11-12）**：B1-B3 + B5（onTmOption/confirmItem/onConfirmRow/onConfirmAll，114 行）外移 `confirm-flow.js` 分区二，页面保留 4 个转发壳（wxml 绑定与调用面零改）；chat.js 非空 1073→**967**（-106，含注释收口）、confirm-flow 非空 112→231；门禁 911/911、A/B 455、verify:offline EXIT=0、silent-catch 254 不变、模块内裸 `this` 0 处 | 2a 已汇报 | **双代理 0 缺陷**（A 8/8 属实：114 行归一化比对 0 差异；B 8 项通过，登记 P3-37） | 注释叠层/双空行/头注已订正；回填 tech-debt P3-37 | `cfc77ce`（代码）+ `bf4259c`（docs） |
| A-批次2b 编辑/提交链 | **已完成（2026-11-12）**：B7-B17（startEdit/onS2ChangeTap/closeEditSheet/onEdit*/confirmEdit*/onOtherInput/applyChange/onRespondChange，14 方法 322 行）外移 `confirm-flow.js` 分区二（续），页面留 13 壳（applyChange 模块内自调不设壳）；先补 C19-C25 断言（onTmOption 四支路/confirm_all 成功/重取两分支+复位/S2 原因链/响应链/同值拦截/S1 change_apply）；chat.js 非空 967→**670**（-297）、confirm-flow 231→**547**；门禁 **918/918**、A/B 455、verify EXIT=0、silent-catch 254 不变、模块裸 `this` 0 处 | 2b 已汇报 | **双代理 0 缺陷**（A 16 项：322 行归一化 312/312、0 差异；B 10 项通过，登记模块体积 P3-38） | 已补 C24/C25 + C21 复位断言 | 待授权 |
| B order-detail.js | **B1 已完成**：O7-O10（`c3669a0`）→ `_modal` 外移 [utils/order-modal.js](file:///c:/zhaoren/miniprogram/utils/order-modal.js)（`c97a379`），11 处调用点经薄代理零改；**双代理均完成**（B 0 功能缺陷 + `__fail`/O17/O18；A 5/5 属实：10 行逐行等价、`_acting` 仍页实例态、11 调用点/23 处直连 `wx.showModal` 边界干净）。**B2 已完成并提交**：归属表 v1.1（A/B 收口）→ 6 提交器外移 [utils/order-submit.js](file:///c:/zhaoren/miniprogram/utils/order-submit.js)，6 壳；order-detail 非空 **1483→1288**、order-submit 211；断言 O1-O18、**930/930**（历史快照，T-13.5 后全量 932）、A/B 455、verify EXIT=0、裸 `this` 0；提交 `2597c21`（测试）/ `732f368`（代码）/ `5333fc9`（docs），已 push | B2 已汇报 | **双代理 0 缺陷**（A 5/5 + B 0 功能缺陷） | 已补 O11-O18 + harness `__fail` | `2597c21`+`732f368`+`5333fc9` |
| C publish.js | **已评估（2026-11-12）：结论=不拆**。实测 1078 非空 / 73 方法（46 为 wxml 绑定，密度 4.3%）/ 候选纯函数仅 `fmtDate` 6 行（0.56%）/ 提交主链 266 行全在 2 处文件级 @VERIFIED 覆盖区 / R9 `availableScenes` 耦合；校验·定位·草稿域已外移（139/144/114） | 已汇报 | 量化评估即结论（方案允许出口） | 零代码 | — |
| T-13.5 自动化口径 | **已完成（2026-11-12）**：chat C1-C27 + order-detail O1-O18 覆盖真机清单全部交互/载荷项（含新增 C26 改时间 / C27 改费用）；双代理检核后补强「过去时间闸 / 闸门命中零请求」(C26) 与「非法金额零请求」(C27)；全量 **932/932**、A/B 455；映射表见本文件 §T-13.5 | 已汇报 | A 7/7 属实、B 20 项属实+3 处口径夸大已补 | 已补断言 + 订正 order-modal 19/历史快照标注 + 登记 P3-39~P3-41 | 待授权 |

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
- ③ applyConfirmation 调用点 3 处钉死：fetchData L157 / refreshConfirmation L482 / pollOrderChat L600——方法留页作壳，调用面零变化
- ④ confirm-flow.js 最终内容=本表段 1-6 **另含**动作链方法（onConfirmRow/confirmEdit*/__s2SameValue 等，方案第 3 步另立清单）；chat-notice.js 同载 applyNotices 域（@VERIFIED L635/L662 书面批准随迁）+ 本表段 9-15，模块内分区注释、once 键前缀（status: vs chat_notice:/chat_comm:）互不串
- ⑤ 死代码清单：L459-472 💳 分支（不可达成因=同键先 mark，外移不复活——三前提：同一 once-anchor 单例/键串原样/1b 先于段 14）**原样随迁**；L273 firstLoad 死变量经批次1 双代理审核确认零读取点，**登记弃置不随迁**（2026-11-12 收口，confirm-flow.js 头注留痕）
- ⑥ 跨页键 `status:<oid>:change_<field>:<expire>` 双侧 grep 逐字复核（§39 纪律）纳入验收

**实施第 0 步（守护补强，先于外移动笔）**：a) C6 断言改**唯一性**（user_S0 弹窗恰 1 条——封死「死代码复活双弹」盲区，代理A#4）；b) 新增「applyConfirmation patch 键集合==17 键快照」断言（复用 calls.setData 留痕）；c) 弹窗调用点在 setData 回调内的时序断言（代理B#12）

2. `utils/chat-notice.js`：applyNotices 弹窗/横幅域外移（**含 @VERIFIED L635/L662 两枚，需用户书面批准随迁**，标记同迁语义不变）
3. `utils/confirm-flow.js`：四确认动作链外移（依赖清单：data 的 chatBlocked/batchBlocked/orderStatus/pendingChange/s2Counts/startTime/frozen + 实例态 __s1Deadline/__s2Auto/__s2RefreshTried/__commTmplId/__subReqDone + 方法 refreshConfirmation/sendTemplate/__sendMissingConfirmCards/__requestCommSub/_handleOaConflict/_handleApplyFail/__s2SameValue，全部经 page 首参 ctx 注入，先例=`utils/order-poll.js`）
4. 附 wxml bindtap 14 方法对照表（goBack/goOrderDetail/goPay/onS2ChangeTap/onConfirmRow/onRespondChange/onConfirmAll/onQuickKey/sendText/closeEditSheet/confirmEditTime/confirmEditContent/confirmEditFee/confirmEditOther），漏一个=点击静默，实施后 grep 复核
5. 附跨页 Storage 键表：`status:<oid>:change_<field>:<expire>` 由 chat.js:353-354/395-398 与 order-detail.js:415-419 双侧拼接，**逐字一致**，实施后双侧 grep 复核（§39 同款纪律）

### 阶段B · order-detail.js（1489 非空）
1. 「操作互斥锁外移」：_modal/_acting ~30 行壳（预期减行量级小，收益=解耦非减行，如实表述）
2. action 提交器：onModify/onExtend 等提交链外移——**触碰文件级 @VERIFIED 覆盖区（加时超时拒绝/S2 协商取消），逐项书面批准**
3. 开工前补触碰区断言（见阶段0 清单）

### 阶段C · publish.js（1078 非空）· 允许结论=不拆
- 量化判据：候选外移纯函数行数 / wxml 绑定密度 / @VERIFIED 触碰数 / 耦合成员数（含 `getApp().globalData.availableScenes` R9 依赖——不可外移）
- publish.js L1-2 文件级 @VERIFIED 覆盖发布+代发校验主链，触碰即须书面批准

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
| A-批次2 动作链外移 | 未开工（onConfirmRow/confirmEdit*/__s2SameValue 等入 confirm-flow；wxml 14 方法对照表落地） | — | — | — | — |
| B order-detail.js | 未开工 | — | — | — | — |
| C publish.js | 未开工 | — | — | — | — |

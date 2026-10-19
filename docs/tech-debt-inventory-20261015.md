# 找人帮忙项目技术负债清单（刷新版）

> 盘点日期：2026-10-15　**刷新：2026-10-16 二次刷新（HEAD `6ce3209`，本地=origin/master MATCH，工作区干净）**
> 基线：HEAD `ab9de38`（本地=origin/master，分叉 0/0，工作区干净）
> 数据来源：FUNCTION-REGISTRY/CHANGELOG/deploy-log 实测 + 代码扫描（空 catch、文件行数、eol、引用关系均当场命令核实）；2026-10-16 刷新项：待验证 ID 全集、两巨页行数、单测数、空 catch 净口径（163）、P2-5 题库深比（0 漂移）均当场命令重测
> 继承：`docs/tech-debt-delivery-report-20261012.md`（10-09～10-12 六批整改已偿还项不在本单重复列）
> 维护约定：每条债务处置后在本文件标注「已偿还(日期/commit)」或「已决策不处理(原因)」，并同步 FUNCTION-REGISTRY/CHANGELOG。

## 总览

本会话（2026-10-15 后半段）已偿还 6 项：deploy-log 10-15 台账欠账、阶段 G 两阈值硬编码（#71 后台化）、线上 confirmHours=2 误配、payment-mock CRLF/LF 伪漂移（.gitattributes）、zz-seed 文件头误导注释、订阅 trial→formal 发布操作入册。

**当前剩余主体是「真机验证缺口」**（2026-10-16 二次复核实测 **28 条** REGISTRY 待验证：59/60/62/71 已转已验证移出，72-75 亦已随 1.6.7 转已验证，本批新增 79-83；成员与四类归并见 P0-1 + [runbook](runbooks/regression-pending-20261016-checklist.md)），其次是有意保留的兼容面与提审后再治的结构性债。前端巨页拆分阶段 1（C1/C2/C3）、里程碑 2（C4-C7）与阶段 3 B+A0+A1+A3 均已完成（P2-1 部分偿还），余 A2 与阶段 4 未开工（见拆分方案 §8）。

---

## P0 · 提审前应清零或确认（2 项）

| # | 负债 | 最新状态 / 证据 |
|---|---|---|
| P0-1 | **28 条 REGISTRY「待验证」**（2026-10-16 复核实测全集；四类归并与**可勾选操作指引**见 [runbooks/regression-pending-20261016-checklist.md](runbooks/regression-pending-20261016-checklist.md)） | ID 四类：①**历史存量 15**（6,9,10,11,12,16,17,21,23,24,26,27,28,40,41）；②**能力链 4**（59,64,67,68）；③**本批拆分 5**（79,80,81,82,83；其中 #81/#82/#83 可先在开发者工具模拟器目检）；④**挂起/控制台 4**（34,61,63,65，**均不需真机**）。**复核订正**：原记 26 条既残留已随 1.6.7 转已验证的 **72-75**、又漏 **#83** → 实为 **28**；**#63 由「真机」改「挂起」**（前端「确认我已到场」按钮已随流程更正移除，`order-detail.wxml` L255 注释为证；服务端 `user_confirm_start` 保留但前端无引用，验收=确认前端无残留调用，口径同 #61/#65）。能力链残余口径：**#67 仅余 T-7.1.2（finish 确认超时→S10.5）**，阈值已可后台设 1 分钟造数（见已验证 #71），验毕改回 15/30；**#10 支付走 mock**，提审前需替换真实支付 → 【2026-10-18 用户裁定：**已决策不处理**】维持模拟支付（`payment-mock`）为 MVP 正式方案（与 HANDOFF C-3.10 一致），不接真实支付/分账/真实退款打款；若提审被要求整改再独立立项 |
| P0-2 | **v1.6.6 版本号四次复用隐患** | 10-15 四次 upload 均为 v1.6.6「流程优化」，mp 后台无法仅凭版本号区分包次（已登 deploy-log 10-15 备注）。下次 upload **必须递增版本号** |

已偿还（本会话）：~~deploy-log 10-15 四批部署行欠账~~；~~阶段 G 两阈值硬编码~~（commit `4f68d93`，REGISTRY #71，已部署+网关 config_get 实证+download SHA MATCH）；~~线上 confirmHours=2 误配~~（网关 config_set 改回 24，复核 {24,72,2,4}）。订阅 trial→formal 已转为发布日操作（见 `docs/runbooks/audit-checklist.md`「正式发布当天操作清单」），不再计债。

---

## P1 · 有意保留的兼容/挂起面（5 项，纪律禁回切/禁擅改）

| # | 负债 | 证据 | 口径 |
|---|---|---|---|
| P1-1 | 旧 `start_service`（状态机 no.5 直连 S2→S3）服务端保留、无前端入口 | `cloudfunctions/order-action/action_lifecycle.js:149` | 收口属状态机改动，须单独书面授权 + 向后兼容方案 |
| P1-2 | 旧 `complete_service`（no.13 直连 S3→S5）保留共存 | `cloudfunctions/order-action/action_lifecycle.js:687` | 同上 |
| P1-3 | `start_photo`（REGISTRY #65）服务端保留、S3 前端入口已移除（凭证前置到 S2） | REGISTRY #65 | 验收=确认前端无残留调用，不回开 |
| P1-4 | demand-match `hall_list` 标 deprecated 仍在线（广场已走 home-action.square） | `cloudfunctions/demand-match/index.js:389` | 下线前须确认无旧版客户端调用 |
| P1-5 | MVP 禁做项的代码 TODO：短信发送占位、人脸三分支占位；#64 mock 现金（is_mock=true） | `user-login/action_auth.js:45`、`user-login/action_account.js:165` | 产品决策债，商业化批次偿还；禁止接真实打款 |

---

## P2 · 结构性债（5 项，平台/历史约束，多有机制兜底）

| # | 负债 | 证据 | 评估 |
|---|---|---|---|
| P2-1 | ~~**前端巨型页面**~~ **✅ 已偿还（2026-10-19）**：order-detail.js **1290** 行（原 1692）+ .wxml **362**（原 470）+ .wxss **273**（原 313）；publish.js **999** 行（原 1296）+ .wxml **252**（原 309）+ .wxss **446**（原 577） | `miniprogram/pages-v2/order-detail/`、`pages-v2/publish/` | **全部里程碑双阈值达标**：里程碑 1（纯函数 C1/C2/C3）+ 里程碑 2（服务模块 C4-C7）+ 里程碑 3（B 草稿 A0/A1/A2/A3 组件化）+ 里程碑 4（交互组件 no-show-card / safety-card / scene-picker / auth-sign-sheet）共 **16 个 commit** 全落盘。`.js` 减量 order-detail 1692→1290（−402）、publish 1296→999（−297）；`.wxml/.wxss` 累计减量 order-detail −148、publish −188。阈值里程碑 3 ≤1250/≤1000 → 里程碑 4 ≤1320/≤1000 **双达标**（order-detail 1290/1320、publish 999/1000）。wxml/wxss 减量 336 行，净增组件文件 10 个，总组件化收益 = 页面复杂度下降 + 主包体积仅增 6.1 KB（490.6→496.0 KB）。详细落盘见 [plan-frontend-split-20261015.md](plan-frontend-split-20261015.md) §8 |
| P2-2 | **前端零页面单测（部分缓解）**：**504** 单测全部在 cloudfunctions/_shared，其中 geo_guard/**order-view/publish-validate/util/constants 五例已跨目录测 miniprogram/utils 纯函数**（阶段 1 新增 46 例 438→484；2026-10-16 无机批次再 +19 例 484→503；其后累计至 **504**，含 constants 对 enums SSOT 的防漂移断言，REGISTRY #76），基建先例已存在 | `cloudfunctions/_shared/*.test.js` | 纯函数已随拆分+专项补测；**页面 setData/跳转/按钮态仍纯靠真机**。续作路径见 [plan-frontend-split-20261015.md](plan-frontend-split-20261015.md) §5.6（测试照 _shared 先例、不动 npm run verify） |
| P2-3 | **9 份 `_orig_baseline.js` 约 1.07 万行冻结常驻并随函数部署**（运行时永不 require） | 9 个拆分函数目录下 | project_rules §10 禁删/改名/改——A/B 锚点价值交换包体与暴露面，已接受的债 |
| P2-4 | `_shared` 多副本物理同步：openid.js 17 份、logger.js 16 份、audit.js 11 份等 | 14 个 sync-*.ps1 + check-shared-sync 门禁 | CloudBase 无 layer 的必然结果；改规范源忘跑 sync 已被门禁拦截 |
| P2-5 | 考试题库硬编码双份，无 sync 守护 | `partner-action/index.js` L92-123、`admin-action/action_exam.js` L4-29 | **2026-10-16 程序化深比较：base+W1 共 20 题题干/选项/answer_idx/元信息逐字一致，当前 0 漂移**（性质=双写漂移风险，非现存故障）。改题仍需两处手改；治理二选一（提审后批准）：抽 `_shared` 单份+sync，或 seed 进 exam_bank 后仅留极简兜底。触业务代码须先走批准 |
| P2-6 | **防复发闸门覆盖面残留（owed，不阻断；2026-10-19 双专家评审专家 B 确证）** | `scripts/check-require-scope.js`、`scripts/check-shared-sync.js` | ①**F3 动态 require 漏检**：`require(变量)` / `require.resolve('../x')` / `import('../x')` 无法静态判定（现以 `[DYNAMIC REQUIRE WARN]` 非阻断提示兜底，当前仓库 0 命中）；②**F4 非 .js 与子目录不扫**：`.cjs/.mjs/.node` 及函数目录子目录不在扫描面；③**F5 M1 对「改名副本」盲区**：`_shared/foo.js` → `a/foo_v2.js` 时 M1 判 0 消费方、M2 亦视为合法；④**F6 `KNOWN_DRIFT` 登记后永久静默豁免**，缺 §10 要求的配对独立断言（现含 `heal.js` 2 例）；⑤**F7 `_shared/*.json` 等非 js 共享资源无守护**。治理时机：提审后专项，逐项补断言/扩面后收窄豁免 |

---

## P3 · 卫生级 / 已接受的债（5 项，均已决策）

| # | 负债 | 决策与依据 |
|---|---|---|
| P3-1 | **空 catch 163 处**（2026-10-16 净口径重盘，替代旧「74 处/18 云函数」口径：全仓 495 块 catch 中 163 空，前端 48/云函数 115；带注释 46、无注释 117；已排除 _orig_baseline、admin-web/public 构建产物、_shared 副本、测试） | 多数为**有意设计**：①doc().get 不存在抛错→返回 null（约 13 处，行内已注释）②wx 系统信息/震动/Storage/deleteFile 等非关键 API 兜底 ③并发控制流。**payment-mock/index.js:121 releaseWithdrawLock 已只读核实为低风险**：锁残留系 fail-closed（不双花），acquire 对超 30s（WD_LOCK_TTL_MS）陈旧锁有抢占（L111），最坏 30s 内拒提，仅建议补 log.d。仅「审计/通知/会话 update 副作用静默」窄类（约 20 处）值得补日志 → **提审后立专项**，逐处证明不改变返回/不阻断主流程，多函数分批+全量部署回归 |
| P3-2 | `miniprogram/utils/testmode.js` 死开关（isTestMode 恒 false、setTestMode 空操作，全仓零 require） | **保留**作定位链路事故的降级旁路（2026-09-15 隐私整改时刻意留），删除收益≈0 |
| P3-3 | 两处手机号明文历史保留：`emergency_contact.phone`、`demand.contact_phone` | **维持 2026-10-12 拍板暂缓**。`scripts/backfill-phone-enc.js` 实测只覆盖 user_account.phone；真做需把这两处的业务读写一并改为 phone_crypt 加密写/解密读+掩码展示+存量两阶段回填，触隐私/联系人能力链路。提审后单独立项（设计+评审+真机） |
| P3-4 | G3「超时前提醒 2 次」未做（阶段 G 仅做超时即转 S10.5） | **属新功能不是隐蔽债**。需定义 S2.6/S3.6 到期前提醒的时机/次数/渠道、与现有催办 urge 的防骚扰关系、订阅 -501001 降级站内信、幂等标记字段。另出 PRD 级方案 |
| P3-5 | S2_5 存量兼容路径（历史 S3 发起的在途改期走旧逻辑，不再新增） | `.trae/rules.md §三.1` 红线载明，随存量订单自然消亡，不动 |

已偿还（本会话）：~~zz-seed-orders 文件头「验收视觉后删除」误导~~（已订正为「自测造数工具·保留·不部署·fail-closed·REGISTRY #34」，该目录有 6 例入口契约测试 + admin-web 种子代理分支，非孤儿）；~~payment-mock CRLF/LF 伪漂移~~（新增 `.gitattributes` 强制 cloudfunctions js/json eol=lf，工作区 w/crlf 实测归零，commit `ab9de38`）。

---

## 治理成本（非缺陷，登记备查）

- **KNOWN_EVOLUTION 33 例**：A/B 有意演进白名单（ab_equivalence.js），每登记一例均配独立行为断言，符合 project_rules §10。
- **28 条待验证中的三个挂起项**（#61 旧 start_service、#65 start_photo、**#63 user_confirm_start**）：服务端保留无入口，验收口径=确认前端无残留调用。

## 建议处置优先级

1. **真机回归**（2026-10-16 二次复核口径：#72-75 已随 1.6.7 转已验证；本批 **#79/#80/#81/#82/#83**，其中 **#81/#82/#83 可先在开发者工具室内目检**；能力链 **#59/#64/#67（仅余 T-7.1.2）/#68**；历史存量 15 个 ID——**完整可勾选操作指引见 [runbook](runbooks/regression-pending-20261016-checklist.md)**）——唯一能让 P0-1 下降的动作，需人工真机/开发者工具执行；#34 走云控制台、#61/#63/#65 改「室内确认前端无残留调用」（均不需真机）；#60/#62/#71 已于 10-15 转已验证。
2. **提审决策项**：版本号递增**已履行**——2026-10-17 上传 **`1.6.10`**（承载 #79-83 + #84/#85；1.6.7/1.6.8 曾分别用于 #72-75 与 #77；P0-2）；正式版发布当天按 runbook 把订阅两模板 trial→formal 并真机验送达。
3. **真机窗口后的结构债主线**：~~P2-1 已偿还（2026-10-19）~~ → P2-5（题库双份）+ P3-1（空 catch 窄类）可并入同批；P2-2 页面单测续作路径见拆分方案 §5.6
4. **独立立项、不与卫生债混做**：P3-3（两处手机号加密改造）、P3-4（G3 超时前提醒）。
5. **持续不动**：P1 全组（兼容/挂起）、P2-3（基线）、P2-4（多副本，门禁已守）、P3-2/P3-5。

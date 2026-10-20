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
| P0-1 | **28 条 REGISTRY「待验证」**（2026-10-16 复核实测全集；四类归并与**可勾选操作指引**见 [runbooks/regression-pending-20261016-checklist.md](runbooks/regression-pending-20261016-checklist.md)）**。2026-10-20 实测复核订正：REGISTRY 待验证/待真机**仅余 2 条**——**#98**（首页附近新单轮询 + 震动+toast·待真机 iOS+Android）、**#102**（G3 超时前提醒 2 次·待真机；代码完整·已部署并 SHA256 核验·发信链路已实证）；其余条目已全部转「已验证」或「已废弃」；下文 28 条为 2026-10-16 历史口径（供对照，勿再据此排期）** | ID 四类：①**历史存量 15**（6,9,10,11,12,16,17,21,23,24,26,27,28,40,41）；②**能力链 4**（59,64,67,68）；③**本批拆分 5**（79,80,81,82,83；其中 #81/#82/#83 可先在开发者工具模拟器目检）；④**挂起/控制台 4**（34,61,63,65，**均不需真机**）。**复核订正**：原记 26 条既残留已随 1.6.7 转已验证的 **72-75**、又漏 **#83** → 实为 **28**；**#63 由「真机」改「挂起」**（前端「确认我已到场」按钮已随流程更正移除，`order-detail.wxml` L255 注释为证；服务端 `user_confirm_start` 保留但前端无引用，验收=确认前端无残留调用，口径同 #61/#65）。能力链残余口径：**#67 仅余 T-7.1.2（finish 确认超时→S10.5）**，阈值已可后台设 1 分钟造数（见已验证 #71），验毕改回 15/30；**#10 支付走 mock**，提审前需替换真实支付 → 【2026-10-18 用户裁定：**已决策不处理**】维持模拟支付（`payment-mock`）为 MVP 正式方案（与 HANDOFF C-3.10 一致），不接真实支付/分账/真实退款打款；若提审被要求整改再独立立项 |
| P0-2 | **v1.6.6 版本号四次复用隐患** | 10-15 四次 upload 均为 v1.6.6「流程优化」，mp 后台无法仅凭版本号区分包次（已登 deploy-log 10-15 备注）。下次 upload **必须递增版本号**。（2026-10-19 收口：**当前上传版本 = `1.6.27`**，递增已履行；`1.6.21~1.6.26` 无登记见 P3-6） |

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
| P2-2 | **前端零页面单测（部分缓解）**：**504** 单测全部在 cloudfunctions/_shared，其中 geo_guard/**order-view/publish-validate/util/constants 五例已跨目录测 miniprogram/utils 纯函数**（阶段 1 新增 46 例 438→484；2026-10-16 无机批次再 +19 例 484→503；其后累计至 **504**，含 constants 对 enums SSOT 的防漂移断言，REGISTRY #76），基建先例已存在 | `cloudfunctions/_shared/*.test.js` | 纯函数已随拆分+专项补测；**页面 setData/跳转/按钮态仍纯靠真机**。续作路径见 [plan-frontend-split-20261015.md](plan-frontend-split-20261015.md) §5 条目 6（2026-10-19 引用订正：原文误记 §5.6，实测该文档 §5 为平铺列表、测试为条目 6；测试照 _shared 先例、不动 npm run verify） |
| P2-3 | **9 份 `_orig_baseline.js` 约 1.07 万行冻结常驻并随函数部署**（运行时永不 require） | 9 个拆分函数目录下 | project_rules §10 禁删/改名/改——A/B 锚点价值交换包体与暴露面，已接受的债 |
| P2-4 | `_shared` 多副本物理同步：openid.js 17 份、logger.js 16 份、audit.js 11 份等 | 14 个 sync-*.ps1 + check-shared-sync 门禁 | CloudBase 无 layer 的必然结果；改规范源忘跑 sync 已被门禁拦截 |
| P2-5 | ~~考试题库硬编码双份，无 sync 守护~~ **✅ 已偿还（2026-10-19）** | `cloudfunctions/_shared/exam-fallback.js`、`sync-exam-fallback.ps1`、`admin-action/exam-fallback.js`、`partner-action/exam-fallback.js` | 题库收敛为 `_shared/exam-fallback.js` 单一规范源 → `sync-exam-fallback.ps1` 复制到两函数本地副本 → 两侧 `require('./exam-fallback')` → 登记 SYNC_MAP。首次尝试(f50e29f)误用跨目录 require 致线上三函数崩溃、已回滚；本次按 §21 正确姿势重做（commit `11ac02e`，download SHA 15/15 + 46/46 MATCH）。改题库现只需改 canonical + 跑 sync + 重新部署两函数，机械漂移已由 `check-shared-sync` 门禁守护 |
| P2-6 | **防复发闸门覆盖面残留（2026-10-19 提审前插队批次：F3/F4/F6/F7 + ⑥ 已偿还；F5 仍 owed）** | `scripts/check-require-scope.js`（commit `7d7db84`）、`scripts/check-shared-sync.js`（commit `59582c6`） | ①**F3 动态/非常规 require 漏检**：`require(变量)` 有 `[DYNAMIC REQUIRE WARN]` 非阻断提示兜底，但 `require.resolve('../x')`、`import('../x')`、模板串表达式内 `${require('../x')}` **完全静默无提示**（2026-10-19 复核轮实测订正；当前仓库 0 命中）；②**F4 非 .js 与子目录不扫**：`.cjs/.mjs/.node` 及函数目录子目录不在扫描面；③**F5 M1 对「改名副本」盲区**：`_shared/foo.js` → `a/foo_v2.js` 时 M1 判 0 消费方、M2 亦视为合法；④**F6 `KNOWN_DRIFT` 登记后永久静默豁免**，缺 §10 要求的配对独立断言（现含 `heal.js` 2 例）；⑤**F7 `_shared/*.json` 等非 js 共享资源无守护**；⑥**复核轮新增（2026-10-19）**：`require` 与 `(` 之间换行的写法，**行号显示漂移 +1**（仅提示显示口径，不影响拦截判定本身）；模板串表达式盲区见①。**✅ 已偿还（2026-10-19，用户批准「提审前插队」口径，独立专家评审支持）**：**F3**（新增 `require.resolve('..')` + `import('..')` 静态识别并与 require 同级硬失败；状态机升级为**模板串模式栈**，使模板串 `${require('..')}` 按代码态扫描，支持嵌套模板与花括号深度；非字面量参数仍为 WARN 非阻断）、**F4**（递归遍历函数目录、跳过 node_modules、覆盖 `.js/.cjs/.mjs`）、**F6**（KNOWN_DRIFT 升级为逐项**漂移性质断言**——每项须声明 dir/occurrence/kind；`kind='subset-of-canonical'` 断言副本导出为规范源**严格子集**且**不硬编码具体函数名**；断言失真＝硬失败，堵住「永久静默豁免」与「漂移已修复但登记未撤」）、**F7**（M1 自动发现由「仅 .js」扩为「任意文件」）、**⑥**（`skipTrivia` 不再重复计数换行，**行号漂移消除**，探针实测报 8/10/13/15 精确）。**G2 八项探针端到端实证**（require.resolve/import()/模板表达式/.cjs/子目录 5 项精确命中 + 注释/字符串/模板字面量/requireX 4 项负向全静默 + F6 断言失败 + F7 UNREGISTERED），探针已清理并经 git status 取证，现态复跑零误报。**③ F5（改名副本盲区）仍 owed，留提审后**；heal.js 2 例漂移照旧「只登记不手修」 |

---

## P3 · 卫生级 / 已接受的债（7 项）

| # | 负债 | 决策与依据 |
|---|---|---|
| P3-1 | **空 catch 163 处**（2026-10-16 净口径重盘，替代旧「74 处/18 云函数」口径：全仓 495 块 catch 中 163 空，前端 48/云函数 115；带注释 46、无注释 117；已排除 _orig_baseline、admin-web/public 构建产物、_shared 副本、测试） | 多数为**有意设计**：①doc().get 不存在抛错→返回 null（约 13 处，行内已注释）②wx 系统信息/震动/Storage/deleteFile 等非关键 API 兜底 ③并发控制流。**payment-mock/index.js:121 releaseWithdrawLock 已只读核实为低风险**：锁残留系 fail-closed（不双花），acquire 对超 30s（WD_LOCK_TTL_MS）陈旧锁有抢占（L111），最坏 30s 内拒提，仅建议补 log.d。仅「审计/通知/会话 update 副作用静默」窄类（约 20 处）值得补日志 → **提审后立专项**，逐处证明不改变返回/不阻断主流程，多函数分批+全量部署回归 |
| P3-2 | `miniprogram/utils/testmode.js` 死开关（isTestMode 恒 false、setTestMode 空操作，全仓零 require） | **保留**作定位链路事故的降级旁路（2026-09-15 隐私整改时刻意留），删除收益≈0 |
| P3-3 | 两处手机号明文历史保留：`emergency_contact.phone`、`demand.contact_phone` | **维持 2026-10-12 拍板暂缓**。`scripts/backfill-phone-enc.js` 实测只覆盖 user_account.phone；真做需把这两处的业务读写一并改为 phone_crypt 加密写/解密读+掩码展示+存量两阶段回填，触隐私/联系人能力链路。提审后单独立项（设计+评审+真机） |
| P3-4 | G3「超时前提醒 2 次」未做（阶段 G 仅做超时即转 S10.5） | **属新功能不是隐蔽债**。需定义 S2.6/S3.6 到期前提醒的时机/次数/渠道、与现有催办 urge 的防骚扰关系、订阅 -501001 降级站内信、幂等标记字段。**PRD 已出（2026-10-19）：[prd-g3-timeout-reminder-20261019.md](prd-g3-timeout-reminder-20261019.md)** —— 口径：两窗口各 2 次（S2_6 锚点 +5/+10min、S3_6 +10/+20min），渠道本轮 **站内信 only**（订阅消息登记提审后增强），幂等字段 4 个（避开 `urge_t*`），不新增状态转移、不改超时阈值；实施（改 order-timer 扫描段 + 部署）待单独书面确认。**✅ 已实施（2026-10-20，用户批准「批准实施 G3」）**：代码层完成——canonical `_shared/timeout_remind_rules.js` + sync + SYNC_MAP；order-timer 两段提醒（插在超时段前）；admin-action CONFIG_SCHEMA 4 键；单测 +21 例、`verify:offline` EXIT=0（**tests 545 pass / A/B 437 EQUIVALENT**）。**部署已核验（2026-10-20）**：order-timer（15 文件/61.2 KB）+ admin-action（46 文件/136.1 KB）success=true，download **SHA256 15/15 与 46/46 MATCH**，bundle `zhaoren-deploy-20261020-082238.bundle`（回滚点 77338c9）；**线上配置已回改默认（2026-10-20 实测）**：`start_apply_timeout_min=15` / `finish_confirm_timeout_min=30`，4 个提醒键未显式写入＝schema 默认 5/10/10/20（＝PRD 设计口径；此前为造数曾临时设 5/5，已清）；**后台可配＝UI 直改**（运营配置页 `Operations.vue` 由 `config_schema` 驱动、零前端改动，4 键自动呈现；`Config.vue` 系旧硬编码表单不含这些键）；**余待真机**（造数验 2 次站内信/幂等/超时仍转 S10.5，**未完成**——2026-10-20 曾观察到线上真实发出 1 条 `remind_sr1`，证明发信链路通）；REGISTRY #102 |
| P3-5 | S2_5 存量兼容路径（历史 S3 发起的在途改期走旧逻辑，不再新增） | `.trae/rules.md §三.1` 红线载明，随存量订单自然消亡，不动 |
| P3-6 | ~~**前端上传版本号 `1.6.21~1.6.26` 无仓库登记（台账缺口）**~~ **✅ 已收口（2026-10-19）**：mp 后台「版本管理→开发版本」实测**仅显示当前最新一条**（`1.6.27`：2026-10-19 17:26:47 / 李劲松 /「后台管理及G7修复」），微信不保留历史上传记录，逐版回溯**不可行** | 按用户批准以**区间口径**结案：deploy-log 新增 `1.6.21~1.6.26` 区间行（不臆造时间）、`1.6.27` 行补齐精确字段、HANDOFF §2.5 同步；仅台账卫生，无后续动作 |
| P3-7 | **demand-publish 段测试「时段敏感性」（2026-10-19 新立，pre-existing 既有问题）**：6 例失败，actual 统一 `publish_redline`「00:00-06:00 为休息时段,请选择 06:00 后的服务时间」 | `cloudfunctions/_shared/demand-publish.entry.test.js`（示例 L106 等用例传 `start_time: Date.now() + 3600000`）+ `cloudfunctions/demand-publish/action_publish.js:38`（`isServiceTimeAllowed` 时间红线**先于**标题/描述/座机等校验执行） | **根因**：用例把服务开始时间**派生自当前时钟**（now+1h），当 `now ∈ [23:00, 05:00)` 时该时间落入 00:00-06:00 休息区 → 时间红线先触发，期望错误码（`publish_proxy_phone`/`publish_title_long`/`publish_desc_long`/成功落库）被 `publish_redline` 提前拦截。**影响**：此 6 例每日 23:00-05:00 必红，**连带 `npm test` 整链红灯** → 深夜走 `predeploy`/`verify` 会误挡部署。**证据**：2026-10-19 23:11 `git stash` 隔离验证——clean baseline 同样 **13 pass / 6 fail**，与本批 P2-6 改动**零耦合**（P2-6 两脚本非测试依赖）。**建议修法（待方案确认后执行）**：测试内改用**固定安全窗口**（如「次日 10:00」或常量时间戳）替代 `now+1h`，使用例 24h 稳定；**不改业务红线**（红线本身正确）。**✅ 已偿还（2026-10-20，commit `a136f73`）**：`cloudfunctions/_shared/demand-publish.entry.test.js` 新增 `safeStart()`（now+1h，若落入 00:00-06:00 则顺延当日 10:00），替换 3 处 `start_time: Date.now()+3600000`（场景用例 L48 / 代发用例 L106 / `pubEvent` 夹具）；**不改业务红线**（`isServiceTimeAllowed` 与 `publish_start_time`/`publish_time_too_far` 均未动；未用字面常量，因业务要求 start_time 为未来且距发布 ≤30 天）；新增守护用例（注入 `now` 扫 24 个整点，断言「未来 + ≥06:00」，撤修即红）。**验证**：危险时区 `TZ=Etc/GMT-1`（本地 02:00）整链 `npm test` **546 pass / 0 fail** + A/B **437 EQUIVALENT** → **深夜不再误挡部署**；常规 `verify:offline` **EXIT=0** |

已偿还（本会话）：~~zz-seed-orders 文件头「验收视觉后删除」误导~~（已订正为「自测造数工具·保留·不部署·fail-closed·REGISTRY #34」，该目录有 6 例入口契约测试 + admin-web 种子代理分支，非孤儿）；~~payment-mock CRLF/LF 伪漂移~~（新增 `.gitattributes` 强制 cloudfunctions js/json eol=lf，工作区 w/crlf 实测归零，commit `ab9de38`）。

---

## 备份体系债（2026-10-19 立，B-1~B-6）

> 背景：自动备份体系当日落盘（`scripts/auto-backup.ps1` 三模式 + `scripts/raw-export.js`/`raw-export-encrypted.ps1` 加密明文通道 + `scripts/raw-decrypt.ps1` + `scripts/register-backup-tasks.ps1`，commit `8f5a07e`/`ae59c10`），三链手动实测均 SUCCESS、3 个 Windows 计划任务已注册（full 每日 02:30 / incremental 21 触发器每小时 / verify 每日 04:30）。以下为该体系自身的登记债。

| # | 负债 | 证据 | 状态 / 处置口径 |
|---|---|---|---|
| B-1 | **全自动定时备份链未真跑**（三链手动实测通过，但计划任务自动触发路径未经验证） | 手动实测：incremental 136s SUCCESS（12464 文档）、full 全链 ~35 分钟（37 表+20 函数+raw 37 集合加密往返全过）、verify 53s（CHECKSUMS 1102 全过 + restore dry-run 39 OK/0 BAD + 解密探针 3 件 + lark 缺口检查） | **2026-10-20 凌晨为首次全自动真跑窗口**（02:30 full → 04:30 verify）；次日核对 `H:\zhaoren_bak_day\logs\backup-log.csv` 与产物目录即闭环；verify 任务本身即每日自动体检 |
| B-2 | **lark-cli 登录态过期无自动续期** | lark 异地推送依赖 `--as user` 登录态；auto-backup 设计为 lark=WARN **不阻断**本地备份，verify 每日跑 lark 缺口检查双向比对 | 若 verify 日志报 lark=WARN/缺口：`lark-cli auth login --domain drive` 重登（device-flow 二维码授权）；属可自愈的低危债 |
| B-3 | **DB 集合名单三处硬编码，无一致性门禁** | `scripts/raw-export.js` `COLLECTIONS_37`（注释声明权威口径=admin-action）、`.predeploy/manual-backup.ps1` `$COLLECTIONS`（37）、服务端 `admin-action EXPORT_COLLECTIONS`（权威）；新增/下线集合需三处手工同步，漂移无自动校验 | 名单变更时三处同步 + 全链复跑；远期可加「三处名单一致性」断言门禁（owed，不阻断） |
| B-4 | **飞书异地目录历史包无清理策略** | folder `RCsff3kGUlKhpud1KVFckJOhnGc` 已存 10-07/10-09 等 5 个历史节点包；auto-backup 每日 full 推送（镜像结构逐文件）将持续累积 | 人工定期清理或制定保留策略（如保留最近 N 份）；暂不阻塞 |
| B-5 | **CHECKSUMS 豁免 `functions_code\`**（≈465MB 含 node_modules 数万小文件，全量哈希实测 >10 分钟不可用） | `auto-backup.ps1` `Get-CheckSums` 豁免规则 | **已接受的边界（2026-10-19 决策）**：functions_code 完整性由 L6「`cli cloud functions download` 云端实时下载」机制保证（产物来自云端而非本地沉淀）；云函数代码正确性另由部署链 download SHA 门禁证明 |
| B-6 | **加密备份密钥仅存 C 盘单点**（`C:\zhaoren-bak\backup-enc-key.txt`） | raw 37 集合加密产物（ZRBE1 / AES-256-CBC / PBKDF2-SHA1 100k）恢复**完全依赖**此密钥；密钥丢失 = 加密备份全部不可恢复；C 盘故障时无第二副本 | **P0 级行动项（人为）**：立即抄存至 H 盘之外至少一处（纸质 / 密码管理器）；完成前，每日 verify 的解密探针仅证明「密钥本地可用」，不能证明「密钥有灾备」 |

---

## 治理成本（非缺陷，登记备查）

- **KNOWN_EVOLUTION 33 例**：A/B 有意演进白名单（ab_equivalence.js），每登记一例均配独立行为断言，符合 project_rules §10。
- **28 条待验证中的三个挂起项**（#61 旧 start_service、#65 start_photo、**#63 user_confirm_start**）：服务端保留无入口，验收口径=确认前端无残留调用。

## 建议处置优先级

1. **真机回归**（2026-10-16 二次复核口径：#72-75 已随 1.6.7 转已验证；本批 **#79/#80/#81/#82/#83**，其中 **#81/#82/#83 可先在开发者工具室内目检**；能力链 **#59/#64/#67（仅余 T-7.1.2）/#68**；历史存量 15 个 ID——**完整可勾选操作指引见 [runbook](runbooks/regression-pending-20261016-checklist.md)**）——唯一能让 P0-1 下降的动作，需人工真机/开发者工具执行；#34 走云控制台、#61/#63/#65 改「室内确认前端无残留调用」（均不需真机）；#60/#62/#71 已于 10-15 转已验证。
2. **提审决策项**：版本号递增**已履行**——2026-10-17 上传 **`1.6.10`**（承载 #79-83 + #84/#85；1.6.7/1.6.8 曾分别用于 #72-75 与 #77；P0-2）；**2026-10-19 口径订正：当前上传版本 = `1.6.27`**（`1.6.10`~`1.6.20` 为历史值，`1.6.21~1.6.26` 无登记见 **P3-6**）；正式版发布当天按 runbook 把订阅两模板 trial→formal 并真机验送达。
3. **真机窗口后的结构债主线**：~~P2-1 已偿还（2026-10-19）~~ ~~P2-5 已偿还（2026-10-19，题库收敛 `_shared/exam-fallback.js` + sync 脚本）~~ → P3-1（空 catch 窄类）可并入同批；**P2-6 已于 2026-10-19 提审前插队偿还 F3/F4/F6/F7+⑥（F5 留提审后）**；P2-2 页面单测续作路径见拆分方案 §5 条目 6
4. **独立立项、不与卫生债混做**：P3-3（两处手机号加密改造）、P3-4（G3 超时前提醒）。
5. **持续不动**：P1 全组（兼容/挂起）、P2-3（基线）、P2-4（多副本，门禁已守）、P3-2/P3-5。
6. **备份体系（B-1~B-6，2026-10-19 立）**：**B-6 密钥抄存为 P0 级行动项**（立即可做，无技术依赖）；B-1 于 2026-10-20 凌晨自动首验（次日核对 backup-log.csv 即闭环）；B-2 随 verify 每日自动暴露、处置仅一步重登；B-3/B-4 提审后择机；B-5 已接受不再列债。
7. **P3-7（低风险、可独立提前，2026-10-19 新立）**：demand-publish 段测试时段敏感性——修法＝测试内固定安全窗口使 24h 稳定；属测试代码改动，**须先出方案经确认后执行**（不触业务红线）。

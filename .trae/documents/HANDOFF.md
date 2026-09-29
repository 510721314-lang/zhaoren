# zhaoren 项目工作衔接交接单（跨账号/跨任务）

> 用途：新账号登录 TRAE、新建任务继续本项目的只读交接文档。新任务的 AI 应**先读本文件 + `.trae/skills/zhaoren-audit/SKILL.md`**，再开始工作。
> 原则：本文件自包含；若新任务无记忆，请依托本文件 + 磁盘代码 + `.trae/skills/zhaoren-audit/SKILL.md`。
> 【可直接复制的起始提示词另见同目录 `HANDOFF-PROMPT.md`】——含落盘版完整提示词、审计“只报告不修码”硬性边界、W9 未完成项标注。

---

## 0. 方向校准（新会话第一动作，来自 zhaoren-audit skill）
按 `.trae/rules.md` 第九章输出方向校准自检：规则来源 / 当前 Phase / 进度 / 本会话计划 / 禁止偏离（不砍场景、所有商业环节 mock 可达、UI 与功能并行）。**用户确认后才能编码。**

---

## 1. 项目与技术栈
- 微信原生小程序（WXML/WXSS/JS/JSON）+ 云开发 CloudBase（wx-server-sdk，Node18）
- 路径 `c:\Users\Administrator\Desktop\zhaoren`；云环境 ID 唯一常量在 `miniprogram/envList.js`
- 业务：同城功能性陪伴服务撮合（非社交），成都首发；PRD V15 正式版
- 21 个云函数 + 19 业务集合；9 个场景 W1/W2/W3/W4/W7/W8/W9/W10/W11 全开

## 2. 环境事实（本次已核验）
- `admin_config.env === 'dev'`（quick_check 返过 dev）→ mock_openid 放行；prod 会 fail-closed
- 云端测试面板 mock 发布者身份：发单人 A=`oLDJ73Yz_Yy_6yN5MrxhVFDTw9c`（真实存在于 user_account）
- **challenge**：本机无 cloudbase CLI，无 computer-use/cloudbase MCP 挂载 → AI 无法自动读写云端，需用户配合云端测试面板 / 云数据库
- 部署：云函数改必须 `.trae/predeploy.ps1 -Deploy <单函数>`（单个串行，`--remote-npm-install`），禁串行
- 静态验证：`.trae/scripts/scan-miniprogram.ps1`；miniprogram-automator 与 DevTools 不兼容勿重试

## 3. 已验收基线（accepted tag，改动必须经用户确认）
参考 tag（13 个）：accepted-20260925-detail-link / flow / bugfix / weaknet / nearby / nearby-loc、accepted-20260926-batch456 / fenzhang(12b729f 分账mock)、accepted-20260927-chat-confirm / order-notice / chat-status-notify / rule15 / security-fix(36daa77)。
最新 HEAD：`13c6840`（交接文档）；功能 HEAD `5c1ad92`（pay/order-detail 子场景显示）；其下 `36daa77`（admin-web 代理旁路安全修复，已打 security-fix tag）。
改动触及任一 accepted tag 内文件/功能 → 先 `git diff <tag>..HEAD -- <文件>` 列改动计划，**等用户明确说同意才动**。

## 4. 本次会话（索引数据填充）已完成的成果
- 起因：首页/广场各场景显示 0 条。根因 = 云端仅 5 条需求且全 `matched`（被旧测试接单过滤掉），大厅只展示 `status==='matching'`（square.js:179-195 / home-action hallWhere:134-142）。非代码 bug，是冷启动缺 matching 数据。
- 已做（纯云端，未改代码/git）：用 demand-publish mock 发了 8 条 `matching` 需求（W1/W2/W3/W4/W7/W8/W10/W11），标题为业务示例，全部 `ok:true`；截图确认首页 10 分类全显示 ≥1 条。W9 需真机（verifySignatureFile 校验真实签名图）。
- 方位（重要，避免重复踩坑）：`mock_openid` 必须用真实 openid（编造的 seed_001 → publish_no_openid/publish_no_user）；mock 依赖 env=dev。

## 5. 待办清单（2026-09-28 更新，按优先级）
1. ~~[审计] 规则15 负向收尾~~ ✅ **已完成（2026-09-28，负向 9/9）**：N1(ORD...00001 S1→S6+释放需求)/N2(ORD...00002 S0→S6)/N4(ORD...00004 S3.5→S4) 实测通过；N6a 跳过（N6b 覆盖幂等）
2. ~~[提审阻塞·内容安全] 自由文本 msgSecCheck~~ ✅ **已完成（2026-09-28）**：6 入口补 msgSecCheck+降级词库，commit 3fd7679 已部署 order-action/safety-report，sr_text_unsafe 实测拦截
3. ~~[数据清理] N8b 测试污染~~ ✅ **已完成（2026-09-28，双证）**：zz-clean-n8b clean 软删 tip 流水+回滚 tip_total_fen 1250→0+软删通知；CLI 直读订单 a9defcfd6aa20230011cfea075899ac6 确认 tip_total_fen=0；audit_log 保留（保链）
4. ~~[备份补全]~~ ✅ **已完成（2026-09-28）**：GitHub push 同步（9 commit `a822e8c..dbbbd48`，ahead=0）；bundle 新建 `zhaoren_v0.10.7_20260928.bundle`（10.7MB，verify is okay，含全部 refs+旧 worktree HEAD）；旧 worktree `worktree_20260927_security` 位于旧机器路径（Administrator 账号），本机无实体 → **废弃 + git worktree prune**；L3 云端导出通道验证：order_main dump 164 条 0 失败（jobId 111487620，落 `C:\Users\DC\Desktop\zhaoren_backup_20260928_verify\`）
5. ~~[审计] 终审报告 8/8~~ ✅ **已收官（2026-09-28）**，见 §6 审计进度快照
6. ~~[安全] admin_web_key / idcard_aes_key 轮换~~ ✅ **已完成（2026-09-28）**：新密钥已写入 admin_config（idcard 无存量加密数据零迁移；test_partner_001 明文 idcard 已清）；admin-web 重新部署（serveStatic 版，公网可访问 `https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com`）；**新 key 已确认公网+本机双登成功**。**遗留 4 项 → 已由会话 P0-2 完成（见 §5.6）**
7. ~~[功能长尾] order-action get_confirmation 的 ORD 反查 bug~~ ✅ **已修复（2026-09-28，commit 4ad1cc5 已部署）**：17 个 action 内层 `const { order_id }=event` 遮蔽外层 ORD 反查 → 改为从解构中移除 order_id（保留 reason/note/location 等字段），改用外层已反查变量；ORD 单号调用不再 oa_not_found
8. ~~[独立阻塞] W9 宠物陪伴真机发布~~ ✅ **已完成（2026-09-28）**：真机发布成功（需求 `3d00e15d...ab4` status=matching，pet_auth_signed=true）；留证落库 kind=pet_authorization + agree_type=handwritten + verify_method=handwritten + signature_hash+SHA-256+size 18260（verifySignatureFile 真实校验通过）；旧「测试」需求云端已无活跃项（历史单均 expired/cancelled）——待办7 子项全清
9. ~~[长尾] F10 dev-only 打赏入口~~ ✅ **已完成（2026-09-28，commit 9a647f7 已部署 admin-action）**：前端打赏入口已实现（config_public 下发 `payment.tip_enabled`(env===dev fail-closed)+order-detail S5/S8 打赏按钮+mock_tip 调用），云端实测 `tip_enabled:true`；**W1 提审挂类目资质 / 种子需求演示数据 / dispute 真机联调 / wallet 极速提现刷新 / backup.ps1 AdminKey 仍为长尾**
10. [交接后新交付·2026-09-29] ①订单列表双身份分页倒序+加载更多（7b91c85）②打赏多条目按序展示+时间戳（221f9ab）③工作台改造：耍伴状态名全量中文+用户「最近发布3需求」（9ce8ee5）④backup.ps1 PROJECT_DIR 修 PSScriptRoot（99fbca1）⑤订单详情信息卡改消息页同款三行概要（6d9b648）⑥耍伴详情「动态 N 条·最新更新」入口→TA动态流 author 模式（16b909f）——均经云端实测，commit 16b909f 已 push（2026-09-29）
11. **三重备份基线（2026-09-29）✅**：GitHub push 同步至 `16b909f`（ahead=0）✅；bundle `zhaoren_v0.11.0_20260929.bundle`（verify is okay + clone 501 文件 + HEAD/tag 35 一致）✅；robocopy 热备 `zhaoren_backup_20260929`（SHA256 509 文件 diff=0）✅；云端 DB 用 tcb CLI 直导 7 集合（admin_config 3 / user_account 4 / partner_profile 5 / demand 276 / order_main 167 / system_notice 413 / evaluation 45，NDJSON 逐行合法）✅——**backup.ps1 的 AdminKey 通道待用户用密钥补跑**
12. 【2026-09-28 产品拍板·公益冻结基线】公益（公益需求/公益单/公益补贴结算）整体暂缓：代码零实现保持，禁止按 PRD §1.5 公益章节开建；将来实现须满足 后台默认关闭(welfare_switch=false)+前端不显示公益入口+服务端 fail-closed 拒绝公益发布。已同步记入项目记忆「硬性约束」
13. 【提审后功能库·2026-09-28 已深化设计+专家复核】③耍伴技能维护 ④地图找周边(需求+耍伴,按场景/距离) ⑤到达履约点拍照打卡+发布者确认后开始履约——完整设计（含专家修正：③bio 依赖 msgSecCheck 基建、portfolio 限资质用途；④位置暴露审核高风险须隐私声明+home_location_public 可见性开关；⑤建议 arrival 并入 milestone step0 评估、order-timer 性能）见 `.trae/documents/features-post-launch.md`
14. ~~[P0 提审前配置回正]~~ ✅ **已完成（2026-09-28，commit 7a351f9/65d6d4e）**：①admin_config `auto_approve_partner: true→false`（硬规则 prod 必须 false）、`modify_config.confirmHours: 24→2`（与前端 MODIFY 对齐）；②前端 config/index.js `PARTNER_ACCEPT.rateMinFen/MaxFen 3000/10000→1000/50000`、`defaultSceneRateFen 5000→10000` 跟随云端；③云端实测确认（tcb CLI 直调 admin-action config_public，`tip_enabled:true`、rate_range 1000/50000、confirmHours 2 直出）。**遗留**：`city_enabled=['成都','重庆']` 保留（用户确认）、`scene_default_rate_fen` 保持 10000（用户确认）

## 5.6 P0-2 安全遗留 4 项 ✅（2026-09-28 完成，commit 267deb3 已部署）
- **① admin-web bootstrap 硬编码 openid 清除**：admin-web/index.js L208-217/L224 两处 `'oLDJ...'` 硬编码 → 改 `adminOpenid`（取 admin_openids[0]，空则拒 `no_admin_openid`）；不再留死兜底
- **② notice_read 归属校验**：order-action L1609-1615 单条 `doc(notice_id).update` 无条件 → 改 `where({_id, to_openid: openid, read:false})` 条件更新，不匹配静默 ok（防枚举）；批量不变
- **③ aa_record 防滥用上限（后台可配）**：admin-action CONFIG_SCHEMA 新增 `aa_record_max_fen`(def 100000=1000元)/`aa_ledger_max_fen`(def 300000=3000元)/`aa_ledger_max_records`(def 50)，自动走 intFields 区间校验+config_public 不外泄；payment-mock L531-546 读取 3 上限，超限返 `aa_over_*`
- **④ isMockAdmin 保留**（用户拍板：保留代码，dev 云端测试需 mock 身份）：仅提审核查项——上线前确认 `admin_config.env=='prod'`（openid.js 已证 fail-closed：读失败/非 dev → prod，mock 旁路自动关闭）

## 5.5 工作计划总览（2026-09-28 新增 · 5 条需求立项跟踪，随实施滚动更新状态）

| # | 需求 | 立项状态 | 承载 | 备注 |
|---|------|----------|------|------|
| ① | 公益需求前端显示/后台控制 | 🔒 冻结 | HANDOFF #10 + 项目记忆硬性约束 | 已拍板落实：后台 welfare_switch=false、前端不显示、服务端 fail-closed；防未来误开发 |
| ② | 公益结算模式（营销转账/补贴） | 🔒 冻结 | 随①冻结 | 不再设计/实现 |
| ③ | 耍伴资料维护·技能设计（skills/bio/portfolio） | ⏳ 仅设计未实现 | features-post-launch.md §③ | 提审后功能库；依赖 msgSecCheck 基建 |
| ④ | 地图找周边（场景/距离） | ⏳ 仅设计未实现 | features-post-launch.md §④ | 提审后功能库；nearby 扩展+partner_nearby+map 页；含位置暴露合规修正 |
| ⑤ | 到达拍照打卡+确认后履约 | ⏳ 仅设计未实现 | features-post-launch.md §⑤ | 提审后功能库；arrival_checkin/confirm 门禁；触 accepted-20260927-rule15 需先 diff 同计划 |

> 状态标记：🔒=冻结（禁止开发）｜ ⏳=设计完待排期 ｜ 🚧=实施中 ｜ ✅=已验收。实施顺序见 features-post-launch.md「实施顺序建议」。

## 6. 下阶段主线：提审就绪度全量审计（沿用既有审计报告）

### 审计进度快照（2026-09-28 更新 · 8/8 收官）
- **Phase0 合规红线：✅**（check-nightmask 17/17 挂载点 bind:reserve；check-ssot 可疑硬编码 0）
- **Phase1 安全：✅**——规则10 白名单非空 + 规则11 云端越权回归 4/4；高危 #1 admin-web 代理旁路已修复（36daa77 security-fix tag）
- **Phase2 静态：✅**（node --check 全量、scan-miniprogram.ps1、predeploy.ps1）
- **Phase3 终检：✅ 8/8 收官**
  - **规则15 正向 ✅ + 负向 9/9 全过**（2026-09-28）：N1 四确认超时15min→S6+需求释放（ORD20260928000001 ✅）、N2 支付超时30min→S6（ORD20260928000002 ✅）、N4 S3.5 中断24h→S4（ORD20260928000004 ✅）；N3/N5/N6b/N7/N8/N9 此前已过；N6a 跳过（N6b 已覆盖幂等）
  - 规则13 安全扫描：#1 已修复打 tag；#2-#5 列待办
  - 规则14 审核7项：#4 内容安全缺口 **已闭环**——自由文本 6 入口（milestone_note/modify/extend/complaint/sos/checkin）补 msgSecCheck+降级词库（commit 3fd7679，已部署 order-action/safety-report，sr_text_unsafe 实测拦截 ✅）
  - 规则16 三重备份验证通过（bundle v0.10.6 含全部 refs；robocopy 快照待办4）
- **审计只报告不修码**（例外：高危安全修复经用户确认后可改）；测试数据下线走云数据库手工 is_deleted=true

> 剩余待跑项以「上方审计进度快照」为准（Phase1 云端越权回归、Phase3 负向路径 N1-N9 / 安全扫描 / 审核7项 / 三重备份 GitHub push）。以下旧清单已废弃，勿再参考：
- ~~Phase1 安全：admin_openids 非空（admin-action config_get）；云端越权回归（init-db/order-timer 匿名必须 forbidden）~~
- ~~Phase2 静态：`node --check` 所有 cloudfunctions + miniprogramjs、`.trae/scripts/scan-miniprogram.ps1`、`.trae/predeploy.ps1`（已通过）~~
- ~~Phase3 终检：TRAE-security-review / mp-pre-release-audit / 真机双身份全链路 / 三重备份（GitHub+bundle+robocopy，校验:robocopy用报表Copied/Skipped/FAILED为准）~~
- ~~审计只报告不修码（audit skill 明确 "Do not use for writing code"）~~

## 7. 铁律速查（改动必守）
- 所有云函数用 resolveOpenid；mock_openid 仅 env=dev 放行，prod fail-closed
- `wx.getStorageSync('v2_login_ok')` 是登录态唯一来源
- 金额整数分存储、总价服务端重算、前端不可信；禁前端直写业务库
- 集合权限「仅创建者可读写」，跨用户读走云函数
- 手机号/身份证掩码返回；用户自由文本入库存前必须走 msgSecCheck
- 仅 rpx；button 用外层 view 定宽 + 内 layer button 透明（内置 min-width 坑）
- 样式 SSOT = `miniprogram/styles/tokens.wxss`（绿），页面 wxss 禁硬编码色值，工具类挂 .v2
- commit 格式 `feat(模块名): [Phase X] ...`，禁词：砍场景/MVP/精简
- 备份命名：bundle `zhaoren_v<版本>_<YYYYMMDD>.bundle` / 热备 `zhaoren_backup_<YYYYMMDD>`，桌面上

## 8. 记忆文件位置（新任务可读，但依赖账号/磁盘环境)
`c:\Users\Administrator\.trae-cn\memory\projects\-c-Users-Administrator-Desktop-zhaoren--p2-2cb386612f3f3552a9c6\project_memory.md`（含全部硬性约束/经验教训/2026-09-27 里程碑总结）

## 9. 多轮任务经验沉淀（2026-09-27 里程碑）

### 9.1 同类 bug 根治闭环（可复用方法论）
现象复现（真机稳定复现）→ 定位根因（不猜，看证据）→ 通用化方案（治本不治标）→ 全量排查同类（一处改处处查）→ 回归验证（复跑真机链路）→ 打 accepted tag 保护（验收成果锁定）。已根治 3 轮「提示不跳出」同类 bug（接单引导 / S0 待付款 / S2 履约 / S5 评价）。

### 9.2 状态提示铁律（catch-up 模式）
- 状态引导弹窗一律「当前 status + __shownStatus Set 标记」检测（每次轮询/首次加载都查，未展示过即弹），禁止依赖 prevStatus 跳变 / 瞬时窗口 / !firstLoad
- 轮询 5 秒可能跳过瞬时状态（如 S0 快速跳 S2），catch-up 在 partner 首次加载时若 status 已是 S0 补弹
- 顶部横幅按状态常驻展示兜底（如 S2「💰 对方已支付，请依约履约 ›」）
- 状态弹窗链：S0 对方已确认(partner) / S0 订单支付(user) / S2 对方已支付去履约(partner) / S5 履约完成去评价(user)

### 9.3 导航与反馈
- 导航先行、toast 后置（放 success 回调）；禁用「toast→setTimeout→导航」与 700/800ms 魔法延迟
- 导航必带 fail 回调并 console.error(errMsg)；灰度基础库 3.17.2 有 toast+导航竞态（redirectTo 被静默吞且不触发 fail）
- 支付成功 redirectTo 订单详情（履约界面）而非 navigateBack；接单成功 redirectTo 聊天页

### 9.4 通知与订单概要
- 双向同步：im-send / order-action 成功时给对端写 system_notice
- 去重合并防刷屏：同收件人+订单+type 未读则覆盖更新；confirm_item 用 confirm:{item} 区分四项
- 订单概要统一 9 字段三行：{单号·场景(子场景 content_options 全量)·金额·时长·人数 / 发布时间 / 📍地址不截断·AA}；order-action/im-conv 两处 buildOrderSummary 保持一致

### 9.5 工程纪律
- 先读后动、改前给计划；accepted tag 保护（改动已验收内容先 git diff 列计划等用户明确同意）
- 云函数改走 .trae/predeploy.ps1 单个部署（--remote-npm-install），禁串行
- 改完附文件路径+改前/改后+复检项；node --check + scan-miniprogram.ps1 静态验证 + 真机复测
- 备份三通道：GitHub push + git bundle + robocopy（robocopy 以报表 Copied/Skipped/FAILED 为准）

### 9.6 高频避坑
- 微信 `<button>` 内置 min-width → 外层 view 定宽 + 内层 min/max-width:100%
- emoji 颜色不受 CSS color 控制 → 白色 SVG data-URI 背景 + font-size:0
- 解包铁律：doc(id).get() 单对象 / where().get() 数组取 [0]
- 云函数变量作用域越界 → ReferenceError 被外层 catch 吞成通用错误
- 弱网发布重复提交：接单用 CAS 原子抢占（where({_id,status:'matching'}).update({status:'matched'})）
- mock_openid 仅 admin_config.env==='dev' 放行（prod fail-closed）
- tokens 里 warning 类是 --func-warning（非 --func-warn）
- PowerShell 5 不支持 &&（用 ;）；git -c http.proxy= push 绕过失效代理

### 9.7 防遗漏保障机制：衔接提示词完整性检查清单
- 根因：遗漏反复出现 = 「凭记忆写提示词」而非「凭清单逐项核对」——事实源在 HANDOFF.md/rules.md/项目记忆里，但生成提示词时未逐条映射验证（两轮专家复核先后查出：文档未入库/§6矛盾/tag未打、云端约束漏在提示词外/W9未单列/未显式指向§9）
- 强制动作：每次生成/更新衔接提示词前后必跑「7 维度逐项核对 + 10 关键术语反向 Grep 校验 + 出包前三处一致/git 入库自检」，检查结果流出给用户看
- 清单全文见项目记忆「衔接提示词完整性检查清单」章节

### 9.8 2026-09-27 晚间增量（审计收官 + 安全修复）
- **安全高危修复**：admin-action `__admin_web_proxy` 旁路（无条件信任 event 可伪造管理员）→ 加 `admin_web_key` 共享密钥校验（openid.js _readProxyKey + admin-web 透传 `_admin_web_proxy_key`），不匹配 fall-through fail-closed；commit 36daa77 已部署 admin-action/admin-web 并验证（伪造身份→admin_no_openid）；该旁路仅存在于 admin-action/openid.js
- **状态机实证**：S2 已支付不可取消（cancel 仅 S1/S0，oa_cancel_status）；打赏校验按分区间 100-50000（12.5 元合法、0/501 元被拒）；get_confirmation 的 ORD 反查 bug（:217 遮蔽）→ 云端测试一律用 32 位 _id
- **云端操作避坑**：云开发控制台多实例，必须用微信开发者工具内置控制台（cloud1-d9gkefwcp5c777088），判断标准=order_main 含 status/scene/total_fen/content_options
- **功能改动**：pay/order-detail 页显示子场景（content_options），commit 5c1ad92
- **安全提醒**：admin_web_key/idcard_aes_key 曾明文暴露会话 → 需轮换；勿再粘贴完整 admin_config

### 9.9 2026-09-28 提审冲刺日经验（待办 1-8 全完成 · 与项目记忆同步）
- **tcb CLI 打通 cloud1 直读直写**（重大能力）：`tcb login` 用 cloud1 所属账号扫码后 `tcb env list` 可见 cloud1-d9gkefwcp5c777088；**调用必须 `node "C:\Users\DC\AppData\Roaming\npm\node_modules\@cloudbase\cli\bin\tcb" <cmd>`**（.ps1 包装器被 PS 执行策略挡，直接 `tcb` 报 UnauthorizedAccess）；NoSQL 命令 JSON 在 PS5 传参必炸 → **统一用 node 脚本 execSync 跑**；`db nosql execute` 支持 QUERY/UPDATE/INSERT/DELETE/COMMAND
- **负向超时测试秒级化**：不必真等 15min/30min/24h——造好数据后以管理员身份（Vl openid 在 admin_openids 内）手动触发 `order-timer {"action":"run"}`，返回 counts 直接判定（本会话 N1/N2/N4 一次通过）
- **zz- 临时函数三坑**：① 目录必须含 package.json（否则云端 Cannot find module 'wx-server-sdk'）② 首次部署遇「函数处于 Creating 状态」失败 → 等 15s 重试 ③ 微信开发者工具 CLI 的 `--remote-npm-install` 对新建函数不可靠 → **本地 npm install 后不带 -r 上传 node_modules**（6.7MB/5820 文件）
- **order_id 遮蔽 bug 模式（修复纪律）**：外层预检已把 ORD 反查为 _id，内层 action 又 `const { order_id }=event` 覆盖 → 修复时**不能删整行**（多字段解构含 reason/note/location 等），先逐行核实解构内容、仅摘除被覆盖的 order_id 字段；本次 17 处全改（4ad1cc5）
- **密钥轮换三查**：① 查存量加密数据（idcard_aes_key 轮换前先查 user_account.idcard 非空数，有则需迁移脚本）② 查前端 Key 存储方式（admin-web 是运行时登录输入+localStorage，**非编译期硬编码** → 轮换无需 rebuild 前端）③ 查后端读取方式（admin-web/index.js 运行时读 admin_config → 写库即生效）；密钥由用户生成（node -e randomBytes），AI 不生成不落会话
- **运维环境误入识别**：腾讯云官网 SCF 控制台的 order-timer 是其他环境同名函数（返回 `st_forbidden`，本项目无此码）→ 出现即看错控制台，cloud1 一律走微信开发者工具内置控制台或 tcb CLI
- **W9 真机验收四证**：cloud1 查 demand.pet_auth_signed=true + disclaimer_signature.kind=pet_authorization + agree_type/verify_method=handwritten + signature_hash(SHA-256)/signature_size
- **openid 反向核对**：交接单曾把 Vl 誊写成 VF（F/l 混淆）→ 首次使用任何 openid 先用 quick_check/order-timer 实测放行再依赖
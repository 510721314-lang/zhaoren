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
- 路径 `C:\zhaoren`（**唯一工作目录，用户拍板 2026-09-29**；旧 c:\Users\DC\Desktop\zhaoren 为废弃副本，勿操作）；云环境 ID 唯一常量在 `miniprogram/envList.js`
- 业务：同城功能性陪伴服务撮合（非社交），成都首发；PRD V15 正式版
- 21 个云函数 + 19 业务集合；9 个场景 W1/W2/W3/W4/W7/W8/W9/W10/W11 全开

## 2. 环境事实（本次已核验）
- **DevTools 项目路径 = C:\zhaoren**（与 git 仓库路径一致；发现双目录事故后统一——见 §9.11）
- `admin_config.env === 'prod'`（2026-09-29 已切换 ✅）→ mock_openid 全面 fail-closed；提审前最终复核一次
- 云端测试面板 mock 发布者身份：发单人 A=`oLDJ73Yz_Yy_6yN5MrxhVFDTw9c`（真实存在于 user_account）
- **tcb CLI 已打通（2026-09-29 验证）**：`node "C:\Users\DC\AppData\Roaming\npm\node_modules\@cloudbase\cli\bin\tcb" <cmd>` 可直调云端（fn invoke 用 `--env-id` + `-d @file`；db nosql execute 用 `--env-id` + `--command` 数组，spawnSync 传参避 shell 转义）
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
15. ~~[2026-09-29 本会话新交付]~~ ✅ ①测试动态发布（blog-post `d83520e2...`）②点赞/评论链路云端 6/6（like 幂等/comment_add/list/delete/unlike）③动态入口 author_home 核实（真实 openid 返 post_count=5）④信用分修复（0c2655b，detail 改读 user_account.partner_credit_score + creditLevelOf 推导；3 账号实测 820/L2、746/L1、806/L2）⑤V1 种子需求补造（软删 8 条 expired 旧 seed 后重发 8 场景业务示例，9 场景 matching 全覆盖）⑥订单列表三行概况对齐消息页（fb03ee6/a5b9c34，my_orders 补 order_summary 复用 buildOrderSummary；PENDING 补 aa_tier）⑦env 切 prod + mock fail-closed 实测 ✅⑧W4 场景中文映射全仓修复（fb6317c，order/im-conv/im-send/payment-mock/home-action 五处 SCENE_NAME 补 W4）⑨双目录事故诊断与同步（bundle 通道同步 C:\zhaoren → a5b9c34，见 §9.11）
16. 【待推】GitHub push 补推 `fb6317c`（2026-09-29 网络代理重置未成功；网络恢复后 `git -C c:\zhaoren -c http.proxy= push origin master`）
17. ~~[长尾] dispute/wallet 真机联调~~ ✅ **已完成（2026-09-29，双身份全链路通过）**：临时 force_set_env dev（4h 自动回 prod 兜底）→ dispute S10.5 售后视图/钱包极速提现(T+0)/普通提现(T+1)/余额核对全过 → 已主动切回 prod（DB 直读 env=prod 确认）。dev 窗口产生的提现单为 mock 数据，无真实资金
18. 【长尾】DevTools 真机调试冲突 `remote debug instance already exists`（多种常规方法无效，挂起后续处理；可用模拟器/预览替代验证）
19. 【提审前 P0-P1 清单见 §10】
20. 【2026-09-30 早场新交付·已部署+真机通过】①耍伴资料维护展示（partner-profile-edit 页+bio/技能/亮点+审核快照 fail-closed，a22b426）②审核结果 system_notice 推送（submitted/approved/rejected 三链，2e5ca26）③init-db 越权修复（种子分支管理员鉴权，cf2c3c6，匿名越权回归 5/5 PASS）④前端添加按钮 button→view（92fb437）——详细见 §9.15
21. 【待推】GitHub push `2e5ca26`（2026-09-30 早场 network 波动未推；网络恢复后 `git -C C:\zhaoren -c http.proxy= push origin master`）
22. 【2026-09-30 早场新交付·后台审核】⑤后台耍伴资料审核界面（admin-web 独立菜单「资料审核」：左右对比快照+通过/驳回+通知；后端 admin-action 两 action + 前端 PartnerProfileReview.vue，commit 5089fb6 已部署+push，云端回归通过）——详 §9.16

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
- 备份命名：bundle `zhaoren_v<版本>_<YYYYMMDD>.bundle` / 热备 `zhaoren_backup_<YYYYMMDD>`，**统一存 `c:\zhaoren-bak\`（用户 2026-09-29 拍板；backup.ps1 默认目标已改）**
- AI 应用强化：AI 应用趋势纳入工作，新开任务先做 AI 可用性评估（详见 §10 P4+）

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

### 9.10 2026-09-29 经验（配置回正 + P0-2 安全 + 6 项功能交付 + 三重备份 · 与项目记忆同步）
- **提审前配置回正**（7a351f9/65d6d4e）：①admin_config `auto_approve_partner:true→false`（硬规则 prod 必须 false）、`modify_config.confirmHours:24→2`（与前端 MODIFY 对齐）②前端 `PARTNER_ACCEPT.rateMinFen/MaxFen 3000/10000→1000/50000`、`defaultSceneRateFen 5000→10000` 跟随云端——**改动前先云端实测 config_public 直出再落地**；rate 边界/默认时薪/城市口径均用户拍板
- **P0-2 安全遗留 4 项**（267deb3）：①admin-web bootstrap 硬编码 openid → `adminOpenid`（取 admin_openids[0]，空则拒 no_admin_openid）②order-action notice_read 单条归属校验（`where({_id,to_openid,read:false})`，不匹配静默 ok 防枚举）③aa_record 防滥用上限（admin-action CONFIG_SCHEMA 3 字段后台可配 + payment-mock 读取校验）④isMockAdmin 保留（dev 云端测试需要；仅提审核查 env=prod）
- **6 项功能交付**（16b909f 已 push）：①订单列表双身份分页倒序（my_orders 加 filter/page/page_size/created_at desc/has_more；**云端 status 字面量点号 S3.5/S10.5** 7b91c85）②打赏多条目按序+时间戳（notice_poll 返 list + tipNotices[] 递增去重 221f9ab）③工作台改造（耍伴状态名全量中文复用 ORDER_STATUS + 用户工作台改 my_demands 最近3需求，**my_demands 需补 scene_name/location 字段** 9ce8ee5）④backup.ps1 PROJECT_DIR 改 PSScriptRoot 推导（99fbca1）⑤订单详情信息卡改消息页同款三行概要（detail 补 order_summary 复用 buildOrderSummary → 与 my_convs 同源 6d9b648）⑥耍伴详情「动态 N 条·最新更新」入口→blog author 模式（author_home 补 last_post_at + blog.js scope=author 透传 author_openid 16b909f）
- **前端无 env 感知的通用解法**：能力开关（如打赏 dev-only）由 config_public 下发**派生布尔**（`payment.tip_enabled = env==='dev'`）经 bootstrap CLOUD_MAP 写入 CONFIG——不暴露 env 原值（config_public 白名单红线），fail-closed 兜底 false
- **tcb CLI 云端备份语法**：`tcb db nosql dump`（**不是** `tcb db dump`）参数 `--file-type json --output-dir <dir> --envId`，产物 **NDJSON 行格式**（每行一条文档，文件名 `database_export-{env}-{col}-{ts}.json`）；`fn invoke` 用 `-e`（db nosql execute 用 `--envId`）——**两命令参数风格不同**
- **三重备份基线（2026-09-29 全过）**：GitHub push 至 `16b909f`（ahead=0）✅ + bundle `zhaoren_v0.11.0_20260929.bundle`（verify is okay + clone 501 文件 + HEAD/tag 35 一致）✅ + robocopy 热备 `zhaoren_backup_20260929`（SHA256 509 文件 diff=0）✅ + 云端 DB tcb 直导 7 集合 ✅；**backup.ps1 的 AdminKey 通道待用户用密钥补跑**（密钥不硬编码符合红线）
- **backup.ps1 修复**：`$PROJECT_DIR` 必须从 `$PSScriptRoot` 推导（.predeploy/ 上级=项目根），不硬编码绝对路径（跨机器/账号迁移即失效）；restore.ps1 已为 DC 路径正常

### 9.11 2026-09-29 双目录陷阱经验（专家审核后沉淀 · 重要）
- **根因链条**：HANDOFF 记载路径（c:\Users\DC\Desktop\zhaoren）与开发者工具实际打开路径（C:\zhaoren）不一致 → 所有代码改在「非 DevTools 编译目录」→ 前端样式修复假性失败多轮后方被发现。同一 GitHub 仓库**双克隆**（不同路径），git 状态相似（同 remote/近 HEAD）常规检查无法发现差异。
- **保障机制（新会话硬性执行）**：
  ① 方向校准自检新增**第 0 步「工作目录验证」**：读取 `project.config.json` 的 appid/miniprogramRoot，确认与 DevTools 实际打开项目一致；不一致立即向用户确认实际路径后再动工
  ② 每会话首条 Shell 命令执行「`Test-Path` + `git remote -v` + project.config.json appid」三合一校验，三要素全过才继续
  ③ HANDOFF §2 环境事实新增「DevTools 项目路径」字段（与 git 仓库路径分离记录——两者可能不同）
  ④ 衔接提示词中路径改为「以方向校准第 0 步实测结果为准」，不硬编码绝对路径
  ⑤ **唯一工作目录 = C:\zhaoren**（用户拍板 2026-09-29）；Desktop 版为废弃副本不再操作
- **用户确认环节（2026-09-29 拍板强化）**：新开任务方向校准第 0 步校验完成后，**必须把校验结果（目录路径/git remote/HEAD/appid）展示给用户并要求确认**，用户明确同意后才动工——不只自检，还要人工确认
- **运行时一致性 ≠ git 一致性**：同一仓库多克隆时必须以 DevTools 实际打开路径为 SSOT；改动生效验证 = 「改的目录 = IDE 打开目录 = 部署 env」三元一致

### 9.12 2026-09-29 场景中文映射散落遗漏经验（专家审核后沉淀）
- **现象**：订单列表 W4 场景显示原始码而非「游玩陪伴」；全仓 grep `W11: '线上陪伴'` 发现 **SCENE_NAME 常量散落 5+ 云函数**（order-action ×3/im-conv/im-send/payment-mock/home-action），多数缺 W4
- **教训**：同义常量各自硬编码 → 遗漏必然；本次按「一处改处处查」（grep 全仓同模式）批量修复（commit fb6317c 已部署）。提审后建议重构为共享模块或 init-db 下发（专家建议 P4 项）
- **同源风险**：`partner_profile.credit_score`（静态 800）与 `user_account.partner_credit_score`（动态）双源分裂——本次仅修 partner-action detail；admin-action/home-action 等仍读旧源，属同类待重构项

### 9.13 2026-09-29 用户 4 项拍板（需长期执行）+ 补充决策
1. **AI 应用强化**：AI 应用趋势建议纳入工作，新开任务先做 AI 可用性评估（近程内容安全预审/文案润色 → 中程撮合/争议初筛 → 远程履约质量/AI 助手），详见 §10 P5
2. **工作目录确认环节**：凡是新开任务均需检查确认当前工作目录，**校验结果展示给用户并获明确确认后才动工**（不只自检）
3. **弱点逐步改善**：技术架构/安全/性能评价中列出的弱点需逐步改善（SCENE_NAME 重构/credit_score 双源统一/深分页/轮询/防刷），见 §10 P4
4. **备份根目录**：所有备份文件统一存 `c:\zhaoren-bak\`（bundle/robocopy/backup.ps1 默认目标已改）
5. 【补充 2026-09-29】**提审演示支付 = 方案 A（临时回 dev）**：演示窗口 force_set_env dev → mock 支付/打赏恢复 → 演示完立即回 prod；见 §10 P3

### 9.14 2026-09-29 晚场经验（备份导出白名单同步缺口 + 距离口径）
- **备份导出白名单缺口**：`withdraw_record`（钱包功能后加的表）不在 admin-action `EXPORT_COLLECTIONS` 白名单 → 收工 DB 导出 32/33 失败 1 表。已修（commit 5777100 部署）。**教训**：新增 collection 必须同步两处白名单——admin-action `EXPORT_COLLECTIONS` + .predeploy/backup.ps1 `$COLLECTIONS`（与 §9.12 场景映射同源问题：「一处改处处查」）
- **耍伴推荐距离口径**：`distance_km` = 观看者(耍伴) home_location ↔ 目标耍伴 home_location（haversine 1 位小数，与 nearby/广场需求同口径）；普通用户无 home_location **不显示距离**（前端 wx:if 兜底），如需支持需首页 GPS 授权（隐私面扩大，提审后再议）。数据前提：耍伴须在接单配置设 home_location，否则该卡片无距离
- **今日晚场交付**：①耍伴推荐距离（home-action square/overview 回填 + partner-card 占位修复，已部署，真机通过）②10 条附近可接测试需求（creator=seed_nearby_pub_01，盐道街周边 10 场景，下线走 is_deleted=true）③HANDOFF-PROMPT 新电脑终版入库 ④blog 图片不显示闭环（旧编译包同源问题，清缓存重编译恢复）
- **测试数据登记**：seed_nearby_pub_01（user_account+emergency_contact）+ 其名下 10 条 demand；测试耍伴 oLDJ73W5XZjGD1SmlQ5Ierxy5kEo / test_partner_001 已补 home_location（春熙路/东门大街）

### 9.15 2026-09-30 早场经验（耍伴资料维护 + 审核通知推送 + 越权修复 · 真机通过）
- **耍伴资料维护展示（P-B 实施，commit a22b426 部署，真机通过）**：`partner_profile` 增 bio/skills/highlights（全可选）；展示端**只读 `profile_audited_snapshot` 双缓冲**（未过审不上线），编辑区写 `*_pending` + `profile_audit_status=pending`；新增 `update_partner_profile`（内容安全=硬拦联系方式正则→msgSecCheck→词库降级 + 限频 + 幂等）/ `audit_partner_profile`（approve 覆盖新快照并留 `profile_audited_snapshot_prev` 可回滚，reject 留原因）；home-action 的 square/overview partnerList 与 detail 只读快照；partner-card 一行 bio（wx:if 空不渲染）；前端口 0 实现：partner-profile-edit 编辑页（表单+防抖）+ 我的→耍伴工作台「资料维护」入口。专家审核 5 必补全落实：UGC 举报（safety-report 新增 `report_user`，10min 幂等）、并发幂等、联系方式硬拦、冷启动快照 seed、快照可回滚
- **审核结果以 system_notice 推送（commit 2e5ca26，实测 reject/approve 到达）**：写入 partner-action 复用项目 `writeNotice`（去重合并：同收件人+order_id('')+type 未读覆盖正文）；三条通知链：`partner_profile_submitted`(提交后) / `_approved`(通过) / `_rejected`(驳回带原因)。提交通知因限频未单独实测，但与 reject 同函数可信
- **init-db 越权修复（提审阻塞级，commit cf2c3c6，匿名越权回归 5/5 PASS）**：根因=种子分支（无 action/'seed'/未知 action）完全无鉴权，匿名可触发建集合/索引/补 config 管理面。修复=种子分支前加鉴权闸：`admin_config.global` 已存在（非首部署）即需管理员白名单命中，否则 `idb_seed_forbidden`；global 不存在（首部署）放行保鸡生蛋；admin_openids 为空也拒绝（防暴露）。管理员 seed 仍可达已实测。**方法论**：匿名越权回归 = 无 mock_openid 调敏感函数(init-db/order-timer/payment-mock/admin-action) 逐个断言拒绝
- **限频/幂等双闸**：`pa_submit_frequent`（30min 禁重复提交，清理 pending 后设 profile_submit_at=0 可绕过）+ `pa_audit_pending`（并发双击防产多条 audit）——正规防御，测试触发属预期非 bug
- **重启 PATH 丢失（新电脑/重启风险）**：重启后 `node`/`git` 不在系统 PATH，`node --check`/`git` 直接 CommandNotFound → 用全路径 `C:\Program Files\nodejs\node.exe`、`C:\Program Files\Git\bin\git.exe`；建议把两者补入系统 PATH。**IDE 仍可能打开旧的 Desktop\zhaoren 克隆**（停在 a5b9c34，无新功能）——开发工具/编辑操作一律用唯一工作目录 `C:\zhaoren`（§9.11 防复发）
- **测试数据登记**：Vl 自己资料（openid oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c，昵称「找个人帮忙」）已走完整审核闭环 → approved（快照为测试内容，含「技能标签增加测试」「服务亮点增加测试」）；如需真实展示请重新维护资料再审核覆盖。审核用临时 reject/approve 验证，dev 窗口已回 prod

### 9.16 2026-09-30 后台资料审核界面（admin-web 独立菜单页 · 云端回归通过）
- **需求**：耍伴资料维护后，运营需在后台开设审核功能（采纳专家「先控制台人工→P-C 界面化」的 P-C 本批提前实施）。
- **架构关键**：admin-web 网关仅代理 **admin-action**（`/api POST→cloud.callFunction admin-action`，带 `_admin_web_proxy_key` 白名单），**够不到 partner-action**；跨函数转发在 prod 会因 mock 旁路关闭被判失效 → 后台审核写操作必须放 **admin-action**（网关已鉴权），不得走 partner-action。
- **后端 admin-action（commit 5089fb6 部分，已部署 43.7KB）**：新增 `partner_profile_pending_list`（查 `profile_audit_status='pending'`，返回待审 pending{bio/skills/highlights} + 当前快照 current 供左对比，join user 取昵称）+ `partner_profile_review`（approve 覆盖快照+留 `profile_audited_snapshot_prev` 可回滚 / reject 留 `profile_reject_reason`；写 `system_notice` 通知：type `partner_profile_approved/rejected`）。沿用 `ok/fail/pager/isOpenid/maskDoc/logEvent` 工具。
- **前端 admin-web-frontend（Vite+Vue3+ElementPlus）**：新建 `PartnerProfileReview.vue`（独立菜单「用户与耍伴→资料审核」；el-table 展开行左右对比「当前已展示快照 vs 待审新内容」+ 通过/驳回弹窗）；路由 index.js + Layout.vue 加菜单项。构建产物入库惯例（admin-web/public 非 gitignore）。
- **部署链路**：①vite build 需 `node` 在 PATH（重启后不在 → `$env:PATH="C:\Program Files\nodejs;"+$env:PATH`）②dist → `cloudfunctions/admin-web/public`（robocopy 不在 PATH，用 Copy-Item）③部署 admin-web 云函数（507KB，含新 chunk）。admin-web 首次部署偶发 `access_token expired`，重试即过。
- **回归（dev 窗口，全通过）**：mock 耍伴提交→pending → 后台列表命中(对比数据正确) → `partner_profile_review pass:false`→rejected+待审清空 → 驳回通知到达。env 已回 prod。
- **测试数据登记**：「耍伴测试1」资料被后台回归驳回置为 rejected（认证仍 approved）；如需真实展示该耍伴在小程序重提即可。
- **双通道并存**：审核入口=云端 `audit_partner_profile`(partner-action，测试面板/我代跑) + 后台页 `partner_profile_*`(admin-action，正式运营)，逻辑一致。

## 10. 上线提交前工作清单（2026-09-29 专家审核后版本，按优先级）

### P0 阻塞提审（必须完成）
- [x] GitHub push 补推（2026-09-29 晚已同步至 d276ecf；P0 勾选收尾 2 笔 docs 待网络恢复补推，本地+bundle 不丢）
- [x] 订单列表 W4 场景名真机确认（2026-09-29 真机通过，广场卡显示「游玩陪伴」，commit fb6317c 部署）
- [x] 耍伴推荐距离真机确认（2026-09-29 真机通过，卡片显示「距你 X.Xkm」，§9.14）
- [x] `admin_config.env === 'prod'` 提审前最终复核（2026-09-29 23:45 nosql 直读 global.env=prod，P0 清零）

### P1 上线前必须
- [x] dispute / wallet 真机联调（2026-09-29 完成）
- [x] 新功能双身份回归收尾（订单三行概况、信用分显示，2026-09-29 完成）
- [ ] backup.ps1 AdminKey 通道补跑（需用户密钥；dev+mock 导出通道已验证可用，见 §9.14）
- [x] 三重备份基线刷新（2026-09-29 晚：GitHub 5777100 + bundle 20260929-2314 + robocopy 20260929-2256 + DB 导出 33 表，c:\zhaoren-bak）

### P2 提审前复检（rules.md 第 9-16 条）
- [ ] scan-miniprogram.ps1 全量
- [ ] check-nightmask.js exit 0
- [ ] admin_openids 含产品负责人 openid 最终确认
- [x] 云端越权回归（匿名调 init-db/order-timer/payment-mock/admin-action，prod 下 5/5 拒绝；init-db 种子越权已修复+管理员路径仍可达，commit cf2c3c6，2026-09-30 完成，见 §9.15）
- [ ] 真机双身份核心链路（发布→接单→四确认→支付→履约→评价，prod 环境）

### P3 运营/配置动作
- [ ] W1 提审挂类目资质（运营动作，AI 不可代做）
- [ ] 隐私保护指引更新（位置 nearby 用 home_location 的声明；实名/信用功能）
- [ ] **提审演示支付链路策略 = 临时回 dev（用户 2026-09-29 拍板，方案 A）**：提审演示/截图期间用 `init-db force_set_env {env:'dev', reason:'提审演示临时'}`（管理员 mock_openid=Vl 通过；prod→dev 需 force 加 reason）→ 支付/打赏 mock 恢复可走 → **演示完立即切回 prod**（set_env prod）。提审后正式态 = prod。已实测：prod 下 payment-mock 模拟支付 fail-closed（真机弹「模拟支付已关闭」属预期）

### P4 提审后功能库
- [ ] 公益①②冻结维持（welfare_switch=false+fail-closed 复核）
- [ ] features-post-launch ③④⑤按序排期
- [ ] SCENE_NAME 重构为共享模块（消除散落硬编码）
- [ ] partner_profile.credit_score 全仓统一改读 user_account（消除双源）
- [ ] 性能：order 深分页 cursor 化 / notice_poll 长连接评估 / blog view_count 防刷

### P5 AI 应用强化（用户 2026-09-29 拍板 · 逐步落地）
- [ ] AI 可用性评估：新开任务在方案阶段先过一遍「可否用 AI 增强」清单（内容安全预审 / 撮合推荐 / dispute 初筛分类 / 文案润色 / 情感分析）
- [ ] 近程（提审后第一批）：内容安全 AI 预审（语义理解+风险评分，前置拦截）、需求/简介文案润色
- [ ] 中程：接单撮合（embedding 技能×需求 cosine 相似度）、争议初筛（LLM 分类+证据摘要+调解草案，人工终裁）
- [ ] 远程：履约质量评估（评价情感分析+异常检测）、AI 陪伴助手（ASR/摘要）
- [ ] 基建：评估云开发 AI 能力接入成本（微信对话开放平台等，免自建服务器）
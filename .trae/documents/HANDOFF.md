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
参考 tag（12 个）：accepted-20260925-detail-link / flow / bugfix / weaknet / nearby / nearby-loc、accepted-20260926-batch456 / fenzhang(12b729f 分账mock)、accepted-20260927-chat-confirm / order-notice / chat-status-notify / rule15。
最新 HEAD：`5c1ad92`（pay/order-detail 子场景显示）；其下 `36daa77`（admin-web 代理旁路安全修复）。
改动触及任一 accepted tag 内文件/功能 → 先 `git diff <tag>..HEAD -- <文件>` 列改动计划，**等用户明确说同意才动**。

## 4. 本次会话（索引数据填充）已完成的成果
- 起因：首页/广场各场景显示 0 条。根因 = 云端仅 5 条需求且全 `matched`（被旧测试接单过滤掉），大厅只展示 `status==='matching'`（square.js:179-195 / home-action hallWhere:134-142）。非代码 bug，是冷启动缺 matching 数据。
- 已做（纯云端，未改代码/git）：用 demand-publish mock 发了 8 条 `matching` 需求（W1/W2/W3/W4/W7/W8/W10/W11），标题为业务示例，全部 `ok:true`；截图确认首页 10 分类全显示 ≥1 条。W9 需真机（verifySignatureFile 校验真实签名图）。
- 方位（重要，避免重复踩坑）：`mock_openid` 必须用真实 openid（编造的 seed_001 → publish_no_openid/publish_no_user）；mock 依赖 env=dev。

## 5. 待办清单（2026-09-27 晚间更新，按优先级）
1. [审计] 规则15 负向路径收尾：N1（四确认超时15min）/ N2（支付超时30min）/ N4（履约中断，需S3订单）/ N6a（可选，N6b 已覆盖幂等）——其余 N3/N5/N6b/N7/N8/N9 已通过
2. [审计] 终审报告 8/8 收官（负向完成后；已过：Phase0/10/11/12/13/14/16 + 15正向）
3. [安全] 轮换 admin_web_key 与 idcard_aes_key（曾明文出现在会话，需用户配合改 admin_config）
4. [安全长尾] admin-web bootstrap 硬编码 openid 抢先风险 / notice_read 归属校验 / complaint_reason 等自由文本 msgSecCheck / aa_record 金额上限 / isMockAdmin dev-only 分支上线前删除
5. [功能长尾] order-action get_confirmation 的 ORD 反查 bug（index.js:217 const {order_id}=event 遮蔽反查，ORD 单号该 action 下必 oa_not_found）
6. [独立阻塞] W9 宠物陪伴真机发布（verifySignatureFile 真实手写签名 PNG）+ 旧「测试」需求 is_deleted=true 下线
7. [长尾] F10 dev-only 打赏入口、W1 提审挂类目资质、种子需求演示数据、admin-action dispute 真机联调、wallet 极速提现刷新、backup.ps1 AdminKey

## 6. 下阶段主线：提审就绪度全量审计（沿用既有审计报告）

### 审计进度快照（2026-09-27 晚间更新）
- **Phase0 合规红线：✅ 已通过**（check-nightmask 17/17 挂载点 bind:reserve；check-ssot 可疑硬编码 0）
- **Phase1 安全：✅ 已通过**——规则10 白名单非空（admin_list 返回 1 管理员）+ 规则11 云端越权回归 4/4（init-db 匿名 forbidden / order-timer 匿名 forbidden / admin-action 匿名 admin_no_openid / 代理伪造身份无密钥被拒）；同时完成高危 #1 admin-web 代理旁路修复（commit 36daa77，已部署 admin-action+admin-web）
- **Phase2 静态：✅ 已通过**（node --check 全量、scan-miniprogram.ps1、predeploy.ps1）
- **Phase3 终检：⏳ 进行中**——规则15 正向已通过；负向 6/9 通过（N3/N5/N6b/N7/N8/N9），剩 N1/N2/N4/N6a；规则13 安全扫描 5 项发现（#1 已修复、#2-#5 列长尾）；规则14 审核7项复核通过；规则16 三重备份验证通过（HEAD 已 push，bundle v0.10.5 含全部 refs，快照 worktree_20260927_security@36daa77 落后 1 commit 待补）
- 审计只报告不修码（例外：高危 #1 经用户确认后修复）；测试数据下线走云数据库手工 is_deleted=true

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
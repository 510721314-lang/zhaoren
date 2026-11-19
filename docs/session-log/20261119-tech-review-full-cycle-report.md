# 会话执行报告 · 2026-11-19 综合技术评审全周期（评审 → 修复 → 审核 → 部署 → 推送）

> 按 §9 会话存档纪律落盘（本会话为代码/部署/台账改动类，六段结构）。基线：HANDOFF-20261119 回执通过后开工。
> 会话 HEAD 演进：`172b5ccc`（开工）→ `3c14af6c`（收工，已推送实证）。

## 一、目标

用户指令链：①对本项目技术作综合评审 → ②按方案 A 执行全部 5 项 P3 修复 → ③同步专家审核执行结果 → ④按方案 C 修复 N1/N2 并提交部署 → ⑤启动代理后重推 commit → ⑥生成完整执行报告（本文件）。

## 二、结论

- **评审**：双代理交叉评审（A 结构猎手 / B 定点抽查 22 核对点：19 通过 / 1 不符 / 2 存疑）+ 主对话逐项读码复核，立项 **5 项 P3**（无一涉及资金或登录主链路）+ 5 项 P4 存疑登记。
- **修复**：5 项 P3 全部落地；同步专家审核（A 放行 / B 有条件放行）新发现 **N1/N2**，按用户方案 C 补修。
- **验证**：`verify:offline` EXIT=0（A/B 455 EQUIVALENT）、entry 契约测试 22/22、`SHARED SYNC ALL OK`、manifest 86 文件/1165 用例。
- **部署**：5 云函数串行部署 success 5/5，`tcb fn code download` 回读逐文件 SHA256 **90/90 MATCH**，标记串实证（login_locked:35 / invalidateEnvCache / action_lifecycle.js:282 守卫上云）。
- **推送**：直连绕代理 push `172b5ccc..3c14af6c`，ls-remote 实证远程 SHA == 本地 HEAD（逐字节），`rev-list origin/master..HEAD` = 0。

## 三、证据（命令与实测值）

| 证据项 | 实测值 |
|---|---|
| 开工自检 | HEAD=`172b5ccc`（≠稿内 `21c1b9b4`，+2 docs commit 属正常演进）；技能 30 / 云函数 22 / sync 20 / baseline 11 / REGISTRY 195 行待验证严格=0 |
| heal 漂移实证 | MD5：`_shared/heal.js`=`1D795FF6` vs 两旧副本=`0A6FA59F`；order-create/demand-match 无 partner_audit.js；sync-heal.ps1 缺失 |
| 修复后同步 | sync-heal + sync-partner-audit ALL SYNCED；heal 四副本 SHA=`3C6AF510…`、partner_audit 五副本 SHA 一致；`SHARED SYNC ALL OK` |
| 测试 | admin-web.entry 16/16 →（N1/N2 后）**22/22 PASS**；manifest 1155→1159→**1165** |
| 全量门禁 | `npm run verify:offline` EXIT=0（SUMMARY 49/49 PASS、fail 0、A/B 455 EQUIVALENT） |
| 提交 | `96f209fc`（14 文件 +436/−27 代码+测试+脚本）→ `5221868d`（docs 台账）→ `3c14af6c`（部署登记） |
| predeploy | EXIT=0（WARN：zz-*/admin-web openid.js 缺失=已知豁免；uncommitted=用户 .docx） |
| 部署 | DevTools CLI `cloud functions deploy --remote-npm-install` 串行 demand-match→order-create→order-action→admin-action→admin-web，success 5/5 |
| SHA 回读 | `tcb fn code download` 逐文件 SHA256 比对 **MATCH=90 / MISMATCH=0**；标记串 admin-login.js:35 `login_locked`、openid.js `invalidateEnvCache`、action_lifecycle.js:282 `oa_ms_status_invalid` |
| bundle | `C:\zhaoren-bak\zhaoren-deploy-20261119-134924.bundle`（25.3MB，全量 --all） |
| push | 直连 `-c http.proxy=` 成功 `172b5ccc..3c14af6c`；`ls-remote` = `3c14af6cf407…89fa` == 本地 HEAD；REV_LIST=0 |
| ps1 BOM | 新写两脚本首 3 字节 `35,32,83`（'# S'，无 BOM，E-6.46 口径） |

## 四、改动与提交

### 4.1 评审立项（5 P3 + 审核新增 2 项）

| # | 级别 | 问题 | 位置 |
|---|---|---|---|
| 1 | P3 | heal.js 多副本漂移 + 同步陷阱（无 sync 脚本，按规范源同步会 require 崩溃） | `_shared/heal.js:6` vs demand-match/order-create 旧副本 |
| 2 | P3 | milestone_confirm 缺 status/isFrozen 守卫（离开 S3/冻结期仍可补写 confirmed 位） | order-action/action_lifecycle.js:271-293 |
| 3 | P3 | admin-web 网关直查/直写 action 零测试覆盖（fn_migrate_tip_partner 批量写无防线） | admin-web/index.js:296-475 |
| 4 | P3 | question_bulk_status 循环逐条 await（≤100 次必超网关 2.5s 窗口致 504 错位） | admin-action/action_question.js:252-254 |
| 5 | P3 | 网关 CORS `*` + bad-key 写库无频控（公网可刷 platform_event 放大用量/探测 key） | admin-web/index.js:19,181-190,234 |
| N1 | P3（审核新增） | admin_login 免 key 端点失败逐次写 P1 `admin_login_fail` 可刷（主对话读码实证） | _shared/admin-login.js:26,33,45 |
| N2 | P3（审核新增） | 网关零覆盖清单扩容：order_probe_tip / home_probe_square / home_probe_modify_audit / init_db / seed_* 群 12，合计 16 action | admin-web/index.js:301-475 |

P4 登记不修：科目统计逐科目拉题、milestone location 未归一化、sms_code 明文短时效、computeNextStep 缺 S2_5/S4 分支、acquireTakeLock 无账户兜底放行、限频 x-forwarded-for 尽力而为语义。

### 4.2 修复落点（关键代码）

1. **milestone_confirm 守卫**：ctx 解构补 isFrozen + `status!=='S3'`→`oa_ms_status_invalid` + `isFrozen`→`oa_order_frozen` + CAS 条件补 `status:'S3'`（竞态兜底）。不影响 order-timer 独立自动确认链；e2e 黄金路径仅调 milestone_submit 不受影响；前端零调用入口（E-6.49）。
2. **question_bulk_status**：循环 → 单次 `where({subject, is_deleted:_.neq(true), _id:_.in(ids)}).update`；updated 口径改 stats.updated 实证；返回体字段名不变；前端消费方（QuestionsPanel.vue toast 计数）兼容。
3. **网关双限频**：`makeRateLimiter` 工厂（5 条/10min·key，Map 超 1000 清空防内存放大）+ `clientIpOf`；bad-key 与 admin_login 失败（`gatedLogEvent` 仅拦 P1 admin_login_fail 写库，登录响应码不变）两实例。**CORS 维持 `*`**（远程联调通道依赖 + 无 cookie 凭据，裁剪自评审建议，已向用户说明）。
4. **heal 同步链**：新建 `_shared/sync-heal.ps1`（heal.js→3 消费方）；sync-partner-audit.ps1 扩 demand-match/order-create；check-shared-sync.js SYNC_MAP 扩登记 + **KNOWN_DRIFT heal.js 豁免撤销**（§10 只登记不手修登记项销账）；副本同步齐（单函数部署自包含，无 require 崩溃窗口）。
5. **测试**：admin-web.entry.test.js +10 例（fn_migrate 回填留痕 / fn_probe_tip_list 参数门 / home_probe_system_notice 鉴权直查 / bad-key 限频封顶 / admin_login 限频封顶 / order_probe_tip / home_probe_square limit 钳制 / home_probe_modify_audit / init_db 透传 / seed_* 12 全量映射）；admin-action.question.test.js bulk 用例改批量语义断言。

### 4.3 提交清单

| commit | 内容 | 文件 |
|---|---|---|
| `96f209fc` | fix(综合技术评审): 5 项 P3 + N1/N2 补修 | 14 文件 +436/−27（业务代码 3 / _shared 同步 4 / 测试 2 / 脚本与门禁 5） |
| `5221868d` | docs(台账): REGISTRY #182 + CHANGELOG | 2 文件 |
| `3c14af6c` | docs(deploy-log): 部署登记 + #182 部分已验证 | 2 文件 |

### 4.4 台账落盘

- `docs/FUNCTION-REGISTRY.md` **#182**（待验证 → 部分已验证：部署收口，云端行为实测项挂下轮抽验）
- `docs/CHANGELOG.md` 首行 2026-11-19 综合行（含 N1/N2）
- `docs/deploy-log.md` 2026-11-19 行（回滚点 `172b5ccc`）

## 五、未决项

| 项 | 状态 | 入口 |
|---|---|---|
| 云端行为实测（守卫拒绝码 / 双限频封顶 / question 批量 / 审核死锁治愈） | 挂 REGISTRY #182「下轮云端测试或后台操作抽验」 | 云端测试面板 mock_openid 或 CLI invoke |
| 后台题库批量发布（不再 504） | 待用户下次进后台顺带验证 | admin-web 题库管理页 |
| 后台登录限频体感（错 7 次→前 5 次落 P1 事件） | 同上，可 nosql 查 platform_event | admin-web 登录页 |
| P4 存疑 6 项 | 登记不修 | tech-debt 择机 |
| **bundle 补归档偏差** | deploy-log 已注记（铁律要求部署前归档，本批部署后补建） | 下批部署恢复先归档后部署 |
| CORS `*` 维持决策 | 裁剪自评审建议，已向用户说明理由；如需收紧另行立项 | — |
| KNOWN_DRIFT 清零后水位 | check-shared-sync.js 空豁免表，后续新增豁免须按 F6 声明性质 | scripts/check-shared-sync.js:77 |

## 六、下次入口

1. 每轮开工照常：读现行 HANDOFF「下一步」→ `npm run verify:offline` 基线（预期 EXIT=0 / A/B 455 / entry 22 / manifest 1165）。
2. 提审唯一阻塞仍为 **T-7.3**（隐私指引 11 项填报，待人脸类目资质），本轮改动不改变提审面。
3. 下轮可顺手项：REGISTRY #182 云端行为实测（CLI mock_openid 打 milestone_confirm 非法态 + 连续错 key）。
4. 规则水位：inject 17047B/17408B，L0-HEADROOM 余量仅 361B —— 新增规则前须先淘汰/下沉。

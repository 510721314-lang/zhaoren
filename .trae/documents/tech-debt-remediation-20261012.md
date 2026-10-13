# 技术负债整改实施方案（v2 · 2026-10-12，含专家审核修订）

## Context（为什么做）

用户明确「对提审没有时间紧迫性，希望交付一个比较完善的系统」。本方案把审计出的 31 项技术负债组织成 **6 个可独立发布、可独立验证的批次**，按「数据一致性 → 可观测性 → 配置单一源 → 安全加固 → 测试与工程质量 → 服务端推送」推进。

**本次逐文件核实的关键事实**（方案据此设计）：
- 账号停用**仅靠登录惰性恢复**（`user-login/index.js:210-230` `maybeRestoreSuspend`），无定时兜底。
- `complaint.status` 仅 2 个写入点（`action_dispute.js:61` / `:119`），`admin-action/action_dispute_handle.js` **不回写**。
- 场景中文名常量在 **8 个文件**各有副本（见批 3）。
- 入口契约测试已有 6 文件 / **60 用例**（admin-action、evaluation-submit、order-action、order-timer、payment-mock、zz-seed-orders）。
- `order-detail.js` **1452 行**；`admin-action/index.js` 611 行。
- admin-web 网关只比对静态 `admin_web_key`；会话令牌在 `admin-action`（`admin_web_sessions`，12h）。
- 「前 3 个服务项」硬编码 3 处 + `enums.js` 数据层约束。
- `action_config_public.js` 是**逐键手写**（`no_show` 组显式列 9 键）⇒ 新增配置键必须显式加进去，否则前端永远读不到。

## 已拍板（3 项，方案按其取值）

| 决策 | 结论 |
|---|---|
| 隐藏场景的**存量需求** | **保持现状**：仅隐藏前端入口，存量需求仍在广场 all 流水 / 附近 / 详情可见 ⇒ 批 1 **不动数据层查询** |
| 爽约**赔付 10%** | **本期不做**：订正 `order_state.js` no.21 与设计文档，标注「一期零赔付」，后台与对外文案不承诺赔付 |
| 服务端**推送通道** | **做**（批 6）：定时器改走 HTTPS 换 token 发订阅消息，失败降级站内信 |

## 专家审核意见采纳（8 条 → 已落进批次）

| 审核意见 | 落点 |
|---|---|
| ① 批 1.3 一次改 9 段扫描面过大 | 改为**逐段迁移**：先用「加时超时段」验证分页模式（该段刚实现、有对照数据），通过后再逐段推广，每段独立部署验证 |
| ② 批 3.1 场景元数据统一 blast radius 大 | 明确**逐函数迁移**，每次只换 1 个云函数并部署验证；`scene_meta.js` 只放纯常量映射，不含任何业务逻辑 |
| ③ 批 4.1 改 `_shared/openid.js` 风险最高 | 标注 **最高 blast radius**：先补入口契约测试，再在 `env=dev` 验证，最后才上线；保留旧逻辑回滚开关 |
| ④ 新增配置键必须同步透出前端 | 批 2 / 批 3 各加显式步骤：改 `action_config_public.js` 手写键；顺手补 `extend_confirm_h`（当前未透出，前端暂无依赖） |
| ⑤ 切会话令牌后集合会膨胀 | 批 4.2 补 `admin_web_sessions` 过期清理（`order-timer` 扫删过期 session） |
| ⑥ `order-detail.js` 拆分应排最后 | 批 5.4 移到**本方案最末**（避免与后续功能改动冲突） |
| ⑦ swr 缓存 key 未版本化是系统性问题 | 批 2 增一条规范：**所有 swr/本地缓存 key 带版本号**，并复查现存 key（本次场景显隐已踩过 v1→v2） |
| ⑧ 拍板点必须先定 | 已定（见上表），批 1 无需数据层改动 |

---

## 批 1 · 数据一致性闭环（先做）

| # | 负债 | 改动 | 验证 |
|---|---|---|---|
| 1.1 | 投诉裁定不回写 `complaint` | `admin-action/action_dispute_handle.js`：裁定 patch 同步 `col('complaint').where({order_id, status:'pending'}).update({status:'resolved', verdict, decided_reason, handled_at, handled_by})`（与爽约侧同款） | 面板调 `dispute_handle` → `complaint.status='resolved'`；只读探针对账 `order_main.dispute_state=resolved` ↔ `complaint.status` 一致 |
| 1.2 | 停用到期无定时恢复 | `order-timer` 新增「停用到期恢复」段：扫 `user_account.status='suspended'` 且 `suspend_until < now` → 写回 `normal` + 清 `suspend_until` + 发 `account_restored`；字段口径复用 `user-login/index.js:210-230`（保留登录惰性路径作双保险） | 造已过期 suspended → 跑定时器 → 回 `normal` |
| 1.3 | `order-timer` 各扫描 `limit(BATCH)` 无分页 | 抽 `scanAll(whereFn, mapFn)`：`orderBy('updated_at','asc')` + 游标分页 + 单轮硬上限（防 3s 超时）。**先只替换「3.7 加时超时」段**（有对照数据），验证通过后逐段推广到 S1/S0/S2.5/里程碑/S3.5/S4/S5/S8 | 加时段造 60 笔 → 一轮处理 60（原为 50）；逐段上线每段独立验证 |
| 1.4 | 加时乐观锁用 `updated_at` 相等（易假阴性） | `action_modify_extend.js` 申请时写顶层 `pending_extend_token:<now>`；`order-timer` 3.7 条件改 `where({_id, status:'S3', pending_extend_token: pe.token})` | 模拟「对方刚确认」→ token 变更 → 跳过；正常到期 → 命中 |

## 批 2 · 可观测与运维加固

| # | 负债 | 改动 | 验证 |
|---|---|---|---|
| 2.1 | 巡检豁免硬编码 | 提到 `admin_config.error_scan_exempt_types`（数组，缺省内置默认兜底）；`errorScan` 读配置；**同步加进 `action_config_public.js`（若前端要用）并在后台加说明项** | 改配置即时生效；默认值=现状 |
| 2.2 | 巡检无分级/收敛 | `errorScan` 输出加 `severity`（P0 立即推、P1 合并计数）；同一批事件连续两轮无变化则静默 | 连续两轮同批事件只推一次 |
| 2.3 | swr/本地缓存 key 无版本规范 | 制定并落一条规范：所有缓存 key 带 `_v{n}`；复查现存 key（`home_square_v1`、`home_scene_groups_v2` 等）并在页面 `onShow` 迁移旧 key | 改缓存结构时旧数据不再污染 |
| 2.4 | 部署配置漂移（CLI 不应用 config.json 的 timeout/triggers） | 新增 `scripts/check-deploy-config.js`：读各 `config.json` 期望值 → `cli cloud functions info` 读回 → diff 报告 | 故意调错 timeout → 报差异 |
| 2.5 | 索引台账可能漂移 | 把已有 `scripts/tcb-scan-indexes.js` 与 `init-db/index.js` 声明 + `index_ledger.json` 做 diff，纳入门禁 | 人为删索引 → 报缺失 |
| 2.6 | 无 CI 串联 | 根 `package.json` 加 `verify`：`check-syntax / check-ssot / check-shared-sync / check-handlers / check-deploy-config / npm test` | `npm run verify` 一条命令全绿 |

## 批 3 · 配置单一源

| # | 负债 | 改动 | 验证 |
|---|---|---|---|
| 3.1 | 场景中文名 8 副本：`order-action/index.js:34`、`order-action/action_query.js:12`+`:190`、`demand-publish:1104`、`im-send:17`、`im-conv:17`、`payment-mock:19`、`admin-action:89`、`home-action:20` | 抽 `_shared/scene_meta.js`（**纯常量映射**，无业务逻辑）+ `sync-scene-meta.ps1` + `check-shared-sync` 守护；**逐函数迁移**（一次只换 1 个函数 + 部署验证） | 每个函数迁移后跑该链路真机路径；门禁 SHA 全绿 |
| 3.2 | 前端只暴露前 3 个服务项（3 处硬编码 + `enums.js` 约束） | 新增后台配置 `scene_option_display_max`（默认 3，1-8）→ `home-action.loadSceneList` 读它；**必须同步加进 `action_config_public.js`** 供 publish/后台读取；`publish.js:199`、`Operations.vue:602` 改读配置值；`enums.js` 兜底数据补足到 8 项 | 后台改 5 → 前端场景卡展示 5 项；勾选上限仍受 `content_options_max` 约束 |
| 3.3 | 状态机/文档与实现口径漂移 | 订正 `_shared/order_state.js` no.6/no.11 timeout 文案为「confirmHours / extend_confirm_h（后台可配）」；**并按已拍板在 no.21 标注「一期零赔付」**，同步设计文档 | 门禁 + 人工复核文案 |
| 3.4 | `extend_confirm_h` 未透出前端（本次遗留） | `action_config_public.js` 补该键（当前前端无依赖，属顺手补齐避免以后再踩） | 前端 `bootstrap` 可取到值 |

## 批 4 · 安全加固

| # | 负债 | 改动 | 验证 |
|---|---|---|---|
| 4.1 | `env=dev` 即放开 `mock_openid` 身份旁路 | 新增 `admin_config.dev_until`：`set_env dev` 必带（≤24h）；`_shared/openid.js` 判 dev 时校验未过期，过期 fail-closed 回 prod；`order-timer` 每轮把过期 env 自动回写 prod 并告警。**⚠️ 最高 blast radius：`resolveOpenid` 被所有云函数 require，先补入口契约测试 → `env=dev` 验证 → 才上线；保留回滚开关** | 设 dev 带 1h → 1h 后 mock 被拒；定时器回写 prod |
| 4.2 | 网关只用长期静态密钥 | `admin-web/index.js` 增会话令牌校验（复用 `admin_web_sessions`，12h），`admin_web_key` 降级为「换取会话的一次性凭据」；**补 `admin_web_sessions` 过期清理**（`order-timer` 扫删） | 令牌过期 → 401；密钥可换取新令牌；过期记录被清 |
| 4.3 | 密钥无轮换流程 | 新增 `scripts/rotate-admin-key.js`（生成 AWK-64hex + `config_set` 轮换 + 提示重新登录）与 `idcard/phone` 密钥轮换演练脚本（离线回填，需停机窗口） | 轮换后旧密钥失效；演练脚本 dry-run 通过 |

## 批 5 · 测试与工程质量（拆分项排最末）

| # | 负债 | 改动 | 验证 |
|---|---|---|---|
| 5.1 | A/B 基线缺失 → `ab_equivalence` 恒 SKIP | 生成 `order-action`/`admin-action` 的 `_orig_baseline.js`（`git show <改造前 commit>:...`）；脚本改为基线缺失即 **fail** 而非 SKIP | `npm test` 出现真实 A/B 比对 |
| 5.2 | 契约测试缺 6 个函数 | 按 `cloud-entry-contract-test` skill 补 `order-create`、`demand-publish`、`im-conv`、`im-send`、`safety-report`、`partner-action`（优先鉴权/越权/幂等早期 return）；爽约/加时 action 优先 | 用例 60 → 100+；每条断言 event→code |
| 5.3 | mock SDK 只匹配顶层字段 | `_shared/_mock_sdk.js` 支持点路径（`'a.b'`）匹配 | 嵌套条件写的用例可读回数据 |
| 5.4 | `order-detail.js` 1452 行 | **排在全部功能改动之后**：拆 `utils/order-view.js`（纯映射函数，可单测）+ 卡片抽组件（投诉卡/资金卡/爽约卡/争议卡），页面只留生命周期与拉数编排 | 映射函数有单测；页面行为回归一致 |
| 5.5 | admin-web 构建产物入库 | `cloudfunctions/admin-web/public/**` 出库（留 `.gitkeep`），改由部署脚本 build+copy；`.gitignore` 加规则 | 仓库 diff 不再出现 chunk 哈希 |

## 批 6 · 服务端推送与体验收尾

| # | 负债 | 改动 | 验证 |
|---|---|---|---|
| 6.1 | 定时器发不出订阅消息 | 新增 HTTPS 推送：`cgi-bin/stable_token` 换 access_token + `subscribeMessage/send`；AppSecret 存 `admin_config` 加密字段；失败静默降级站内信；结果落 `sub_msg_send_logs`；`order-timer` 与 `sendDemandSub` 同源改造 | 真机订阅后，定时器触发的到点提醒可在微信收到；结果可读回 |
| 6.2 | 配置生效延迟无提示 | 后台保存场景/活动/配置后统一提示「约 5 分钟内生效」；运营文档补「缓存与生效时延」一节 | 人工确认 |
| 6.3 | 图片无服务端校验 | `upload_image` 加服务端尺寸/体积/格式校验（封面 1:1 或 750 宽、≤2MB），不合规返明确错误码 | 传错比例图 → 被拒并给出规格提示 |
| 6.4 | 占位/未接通区块 | ①保险卡：`detail` 回传 `insurance`（接通 mock 数据源）或前端彻底隐藏；②里程碑证据图片渲染 + 预览；③补齐 `pay_expire_at/service_started_at/service_completed_at/evaluated_at` 时间戳 | 逐区块走查，无"永远空"卡片 |

## 验收口径（每批结束必跑）

1. `npm run verify`（批 2 落地后）= check-syntax(167 files) / check-ssot / check-shared-sync / check-handlers / check-deploy-config / npm test（当前 241 pass）。
2. 涉及函数**串行**部署（DevTools CLI 桌面路径），部署后等 90-120s + `functions info` 读回。
3. 真机：`cli upload` 上传体验版（版本号顺推 1.6.x），按批内「验证」列逐条走查。
4. 含数据库写回的批次，先用 `.tmp-tcb/` 只读探针比对，再上真机。
5. 每批完成后补一次备份（git bundle + robocopy + 云 DB 导出）。

## 明确不做（务实妥协，已在项目记忆确认）

- `_shared/*` 多副本机制（云开发不支持跨目录 require）——保持规范源 + `check-shared-sync` 门禁。
- 不引入 TypeScript / 不引入前端构建体系（原生小程序 + 零构建是既定选择）。
- `admin-web` 的 serveStatic 托管方式不变（批 5.5 只改"是否入库"）。
- 爽约资金赔付（本期不做，仅订正文档）。
- 隐藏场景的存量需求不排除（保持「仅隐藏入口」语义）。

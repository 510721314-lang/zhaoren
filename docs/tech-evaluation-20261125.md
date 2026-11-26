# 找人帮忙小程序 · 技术评价报告

> **生成日期**：2026-11-25
> **基线**：HEAD `769ad721`（== origin/master，`git rev-list --count origin/master..HEAD`=0），`verify:offline` EXIT=0
> **评价范围**：微信小程序主端（`miniprogram/`）+ 云开发后端（`cloudfunctions/`）+ 管理后台（`admin-web-frontend/`）+ 工程基建（`scripts/` / `.trae/` / `docs/`）
> **评价方法**：以本仓库**实测数据**为唯一依据（静态扫描、门禁输出、台账真值、代码阅读），每条结论标注证据出处；未实际验证的项标注「未验证」。不臆造行号、不引用未读文件。
> **证据采集命令**：`git status --short` / `node scripts/check-rules-size.js` / `npm run verify:offline` / `Get-Content scripts/test-manifest.json` / `Get-ChildItem cloudfunctions -Recurse` 等（2026-11-25 23:08 实测）。

---

## 一、项目概览与规模（实测）

| 维度 | 实测值 | 证据 |
|---|---|---|
| 主端 | 微信原生小程序（无前端构建链），**305 文件 / 28,159 行**（`.js/.wxml/.wxss/.json`） | `Get-ChildItem miniprogram -Recurse` |
| 管理后台 | admin-web（Vite+Vue），`src/` 下 **43 文件** | `Get-ChildItem admin-web-frontend/src` |
| 云函数 | **21 个**含 `index.js` 的目录（含 `zz-seed-orders` / `zz-warmup` / `zz-openapi-probe` 3 个临时目录，禁部署） | `Get-ChildItem cloudfunctions -Directory | Test-Path index.js` |
| 云函数基线 | `cloudfunctions_baseline/*.js` **11 个**（禁删禁改：admin-action / demand-publish / home-action / init-db / order-action / order-create / order-timer / partner-action / payment-mock / user-login / zz-seed-orders） | `Get-ChildItem cloudfunctions_baseline -Filter *.js` |
| 共享规范源 | `cloudfunctions/_shared/` **120 文件**，含约 21 个 `sync-*.ps1` 同步脚本 | `Get-ChildItem cloudfunctions/_shared -File` |
| 测试 | `scripts/test-manifest.json` 注册 **1,247 用例 / 89 文件**；A/B 等价 **473 例** | manifest 解析 + `verify:offline` 输出 |
| 门禁基建 | `scripts/` 下 **72 个** `.js` 脚本；`.trae/skills/` 下 **33 个**项目技能 | 目录计数 |
| 规则 | core 规则 `project-rules-core.md` §0–§45（max§=45），inject **17405B/17408B** | `node scripts/check-rules-size.js` |

**定性**：这是一个**业务复杂度高、工程纪律严、质量投入重**的中型项目。复杂度核心在订单履约域（13 态 + 中间态 S2_5/S2_6/S3_6、S2 协商取消链、争议裁决、分段结算、信用分、四确认、催办链路），项目在该域投入了大量规则化与测试化工作。

---

## 二、架构与代码组织

### 2.1 云函数巨型文件拆分治理：彻底且有纪律 ✅

**结论**：所有云函数 `index.js` 实测**全部 < 700 行**，巨型入口拆分已覆盖全量，且有 A/B 等价验证背书，不是粗暴切文件。

**证据**（`Get-ChildItem cloudfunctions -Directory | index.js 行数`，2026-11-25 实测，降序）：

| 云函数 | index.js 行数 |
|---|---|
| order-timer | 683 |
| safety-report | 627 |
| order-action | 560 |
| demand-match | 538 |
| admin-action | 501 |
| admin-web | 498 |
| blog-action | 471 |
| demand-publish | 433 |
| 其余 13 个 | 72–400 |

对比项目记忆记载的历史负债：`order-create` 曾 804 行、`home-action` 曾 828 行、`admin-action` 曾拆出 30+ action 文件——当前状态表明拆分已完成并收敛。

**采用模式**：`action_*.js + HANDLERS 分发 + ctx 注入`（防缓存分叉），拆分验收标准为「拆分前后 action 输入输出逐字节等价」（见 §3.1）。

### 2.2 共享模块规范化同步 ✅

**结论**：建立了「规范源 → 多副本 → SHA 门禁」的三副本同步机制，对跨云函数复制代码这一高发漂移点有制度性约束。

**证据**：
- `cloudfunctions/_shared/` 下 21 个 `sync-*.ps1`（`sync-order-state.ps1` / `sync-urge-rules.ps1` / `sync-money-rules.ps1` / `sync-openid.ps1` / `sync-phone-crypt.ps1` 等），从规范源同步到各消费者云函数目录。
- `verify:offline` 中 `check-shared-sync.js` 实测输出 `SHARED SYNC ALL OK`（100+ 项逐份 OK）。
- 核心规则 `order_state.js` / `urge_rules.js` / `money_rules.js` / `openid.js` / `phone_crypt.js` / `security_policy.js` 均有单测（`_shared/*.test.js`）。

**教训沉淀**：E-6.60（`writeNotice` 4 副本漂移近一个月）已沉淀为 C-4.29「改跨函数复制工具函数必须 `grep -n "function <name>" cloudfunctions` 全量核对 + 同批部署」。

### 2.3 待改进：前端巨页隐患临近 ⚠️

**结论**：`confirm-flow.js` 545 非空行逼近巨页阈值，登记不修但存在复发风险。

**证据**：[tech-debt-inventory-20261123.md](tech-debt-inventory-20261123.md) P3-38：「`confirm-flow.js` 545 非空行（总 566 行）≈ chat.js 670 的 81%，逼近巨页阈值」，触发条件「文件膨胀至 700+ 行 / 阶段 B 前评估」，当前状态「登记不动作」。

---

## 三、质量保障体系（项目最大亮点）

### 3.1 A/B 等价验证：拆分安全的硬保障 ✅

**结论**：473 例 A/B 等价验证（237 显式 + 236 自动种子，110 例登记为「有意演进」known-evolution）是巨型云函数拆分的验收硬指标，且有反向假设验证防夹具过度拟合。

**证据**：
- `npm run verify:offline` 串行重跑输出：`A/B EQUIVALENT: 473 cases (237 explicit + 236 auto; 110 known-evolution)`，EXIT=0。
- 测试覆盖聚焦高风险路径：`order-action.entry.test.js` 94 例、`take_rules.test.js` 48 例、`order-view.test.js` 41 例、`money_rules.test.js` 37 例、`cert_state.test.js` 35 例（来自 `test-manifest.json` 实测）。
- 项目记忆记载：拆分时配「反向假设抽 ctx 依赖后用例应 FAIL」验证，避免夹具对代码改动不敏感。

### 3.2 门禁链完整，开工有硬前提 ✅

**结论**：`verify:offline` 串联 26 道静态检查 + 单测 + A/B 等价，EXIT=0 是开工硬前提（AGENTS.md 明文「失败即停，不得绕过」）。

**证据**（`verify:offline` 命令链实测，2026-11-25）：
```
check-syntax → check-miniprogram-syntax → check-ssot → check-collections-consistency
→ check-config-defaults → check-shared-sync → check-sub-msg-consistency
→ check-no-desktop-injection → check-require-scope → check-handlers
→ check-index-ledger → check-cloud-timeout-policy → check-location-timeout-policy
→ check-deploy-config --offline → check-rules-size → check-rule-refs → check-secrets
→ check-manual-links → check-doc-links → check-ledger-placeholders → check-once-prompts
→ check-nightmask → check-test-globs → check-test-manifest → check-gate-mounts
→ auto-test-s2-change → check-silent-catch → npm test
```
关键检查实测结果：
- `SYNTAX ALL OK (315 files)` / `MINIPROGRAM SYNTAX ALL OK (103 files)`
- `COLLECTIONS CONSISTENCY OK: 38 集合 × 5 处全部一致`
- `SHARED SYNC ALL OK`
- `check-rules-size` EXIT=0（inject 17405/17408B）

### 3.3 已知摩擦：并行竞态假红 ⚠️

**结论**：`verify:offline` 与 `ab_equivalence` 并行时曾存在竞态假失败（2026-11-26 已根治，见 tech-evaluation-20261126 §3.3），不影响基线正确性但拖慢效率。

**证据**：2026-11-25 实测，并行触发两次 `verify:offline` 时，前台一次被 `check-sub-msg-consistency` 扫到后台 `ab_equivalence` 生成的 `__baseline_tmp_*` 临时文件，报 2 个 `[SUBMSG-DIRECT]` 误报致 EXIT=1；后台权威跑 EXIT=0，串行重跑 EXIT=0，残留 `__baseline_tmp_*`=0。已登记为 E-6.50，判失败前须先查残留（2026-11-26 已根治：6 门禁加 `__baseline_tmp_` 前缀豁免 + ab spawn 重试，并发复现全绿）。

---

## 四、安全工程

### 4.1 fail-closed 原则贯穿 ✅

**结论**：安全设计以「失败即关闭」为默认，覆盖 AI、环境、身份、内容多个维度。

**证据**（来自 project_memory Hard Constraints，实测存在于代码与配置）：
- AI 失败按开关降级，不影响主流程；AI 请求不携带全量订单/位置/联系方式。
- `mock_openid` 生产环境全部失效；`tip_enabled` 生产自动关闭。
- 环境判定依赖 `admin_config.global.env` 云端运行值，读取失败按 prod 兜底（不隐式放开 mock）。
- 耍伴展示端只读 `profile_audited_snapshot`，未过审内容不上线（双缓冲 fail-closed）。
- dev 环境切换有 4 小时自动回 prod 兜底。

### 4.2 鉴权与防滥用有方法论 ✅

**结论**：匿名越权回归、防爆破、密钥管理、并发防护均有制度与测试。

**证据**：
- 匿名越权回归方法论（project_memory Engineering Conventions）：不带 `mock_openid` 调敏感函数（init-db/order-timer/payment-mock/admin-action）逐个断言拒绝。
- admin 防爆破锁定：连续失败 5 次锁 10 分钟（`login_locked`），P1 `admin_login_fail` 事件入 `platform_event` 供 errorScan 巡检。
- 密钥轮换提供合规生成脚本 + 演练脚本，`phone_hash` 随密钥同步重算。
- 客服会话 `im_conversation` 表 `uk_order_id` 唯一索引，用 `kefu_<openid>` 占位防多用户并发撞键。
- 订阅消息 opt-in + `defaultPostJson` 8s 超时显式销毁，防接口挂起致云函数被强杀后重复推送。

---

## 五、工程纪律与可维护性

### 5.1 真值优先级与证据纪律 ✅

**结论**：「结论必须带文件:行号」「云端回读 > 现行台账 > CHANGELOG > 助手记忆」已制度化，部署有回读自证。

**证据**：
- [AGENTS.md](AGENTS.md) §5 证据纪律：结论必须带 `文件:行号`；云端结论以回读为准（`tcb fn detail` / `tcb fn code download`）；不臆造页面路由/接口字段/集合字段。
- 部署后回读自证：`cli cloud functions deploy` 成功后用 `tcb fn code download` 到 `%TEMP%` 做 SHA256 核验（project_memory 记载，E-6.63 事故后强化为四件套）。
- B2 门禁 `scripts/check-admin-web-live.js`（TOOL 类，`check-gate-mounts` 已登记）防 admin-web 前端漏部署，部署后线上回读指纹 + SHA256 逐字节对比。

### 5.2 提交隔离与最小改动 ✅

**结论**：三提交隔离（业务代码 / docs 台账 / 测试基建）、最小改动 ≤3 文件 ≤30 行、`@VERIFIED` 代码禁擅改、禁假修复——纪律明确。

**证据**：[AGENTS.md](AGENTS.md) §3 硬边界 + core 规则 §1/§2/§7/§9。

### 5.3 事故复盘 → 机制闭环的能力 ✅

**结论**：团队有「真实事故 → 制度/门禁 → 防复发」的沉淀能力。

**证据**：E-6.63（admin-web 整合上线漏 build+deploy，台账误记「已部署上线」，用户报看不到界面才暴露）→ 复盘后落地 `check-admin-web-live.js` 门禁 + REGISTRY #215 验收列补「必须线上 URL 验证」+ deploy-log 补登 + project_memory 沉淀「admin-web 部署闭环四件套」。同类闭环还包括：IDE 白屏（E-6.x → 重启终解）、时区 bug（E-6.60 → 云端实证法）、台账脱节（E-6.59 → 真值对齐纪律）。

---

## 六、不足与风险（客观指出，均带证据）

### 6.1 【结构性约束】规则配额余量几乎耗尽 🔴

**结论**：core 规则 inject 余量仅 **3B**，规则体系扩容能力触顶，近期经验被迫外流到 HANDOFF/记忆/技能，跨会话交接可靠性下降。

**证据**：
- `node scripts/check-rules-size.js` 实测：`[L0-HEADROOM] inject 距目标位仅 3B（<512B）` / `RULES-SIZE OK inject 17405B/17408B (硬顶 30720B) | max§ 45`，EXIT=0。
- HANDOFF-20261125 T-0.6 明文：「余量仅 3B，[L0-HEADROOM] 告警。新增 core 规则前必须先精简/下沉等量旧条（规则配额纪律）；本轮 11-25 未加 core 规则（inject 水位零变化）」。
- E-6.59~6.65 七条经验全部落到 HANDOFF §6 + project_memory，未进 core——因配额不够。
- 影响：新会话若未正确读到 HANDOFF，会漏掉这些经验；core 规则本身成了需持续「腾挪」的负债而非稳定基线。

### 6.2 【执行缺口】技术债台账自身口径脱节 🟠

**结论**：负责「真值对齐」的台账自身头部残留陈旧指针与计数，与文件正文真值矛盾，E-6.59 纪律要求订正却未闭环（T-22.5）。

**证据**（[tech-debt-inventory-20261123.md](tech-debt-inventory-20261123.md)，2026-11-25 实测行号）：
- **L4** 自称「现行唯一台账：tech-debt-inventory-20261105.md」——但 HANDOFF-20261125 §5 明确 1123 才是真值所在，1105 内容已过时（P3-1=200/P3-38=549）。
- **L13** 关键计数写 `A/B 466 EQUIVALENT / 1192 用例 / 103 known-evolution`——实测为 473 / 1247 / 110。
- **L15** 写「空 catch 基线 **200 处**」——2026-11-25 实测基线 `total`=**204**（`generated_at`=2026-11-21）与正文矛盾；2026-11-26 已刷新基线为 200，头部已对齐。
- **L77** 映射 P3-44/45 → 悬空编号 `T-22.6`（HANDOFF-20261125 仅定义到 T-22.4）+ 余量 **328B**（实测 3B）。
- 这是 E-6.59「台账真值必须与代码实测对齐」纪律的直接违反对象，且是**真值管理工具自身的失准**，性质比普通数字过时更值得关注。（✅ 2026-11-26 已全部订正）

### 6.3 【可观测性负债】空 catch 存量 200 处 🟠

**结论**：虽已分级，但 190 处「C 类有意设计不修」的静默容错仍是可观测性负债，生产出问题时可能吞掉关键错误信号。

**证据**：
- `scripts/silent-catch-baseline.json` 实测 `total`=200，`generated_at`=2026-11-26（2026-11-25 实测活水位已降至 200，原基线 204 为 2026-11-21 冻结值未刷新，现已对齐）。
- [tech-debt-inventory-20261123.md](tech-debt-inventory-20261123.md) P3-1：「A 高危 4 已修 / B 批 1/2/3 共 50 已修 / C 有意设计 190 不修 / B 剩余 10 维持不修」。
- `verify:offline` 的 `check-silent-catch.js` 是**增量门**（只增不追溯），防新增但不清存量。

### 6.4 【流程漏洞】前端上线闭环曾失效 🟡

**结论**：源码提交 + `@VERIFIED` + localhost 测通 ≠ 线上已更新，曾因漏 build+deploy 致线上仍旧版、台账误记上线，靠用户反馈才暴露。虽已加门禁，但「源码提交≠线上发布」的流程心智仍需加固。

**证据**：E-6.63（HANDOFF-20261125 §6）：Operations.vue 整合 11:10 提交、11:42 `@VERIFIED`，但漏 build+hosting deploy，线上仍旧构建，台账 commit 误记「已部署上线」；用户报看不到整合界面才暴露。修复靠重建发布 + `check-admin-web-live.js` 线上回读自证 + 用户 `Ctrl+Shift+R` 验证。

### 6.5 【非技术阻塞】提审硬阻塞未解 🟡

**结论**：人脸类目资质未解除，冻结上线节奏，大量已完成工程投入无法转化为线上价值。

**证据**：HANDOFF-20261125 §2「提审阻塞：唯一硬阻塞 = T-7.3 人脸类目资质（未解除，与 11-22 一致）」。涉及隐私指引 11 项填报 + 实名 mock→wx 切换（T-19.1）。

### 6.6 【工具链摩擦】环境/工具类消耗 🟡

**结论**：PS5 中文脚本 BOM 丢失、IDE 模拟器白屏/陈旧编译产物、verify 并行假红等环境类问题虽不阻塞，但反复消耗排查精力。

**证据**：
- PS5 BOM 事故（project_memory）：中文 `.ps1` UTF-8 BOM 被后续编辑静默丢失致 ParserError，需复检前 3 字节 = `EF BB BF`。
- IDE 模拟器白屏/陈旧产物（project_memory）：真机预览正常但模拟器渲染旧代码，定性需先确认云端是否已部署，属 IDE 侧非代码侧。
- E-6.50 verify 并行竞态假红（见 §3.3）。

---

## 七、评分汇总

| 维度 | 评分（5 分制） | 依据 |
|---|---|---|
| 架构合理性 | 4.0 | 云函数分层拆分到位，_shared 规范源模式清晰；但 core 规则配额顶满是架构级约束 |
| 代码质量 | 3.5 | 核心域质量高、有等价验证背书；空 catch 存量 200 处拉低可观测性 |
| 测试与质量保障 | 4.5 | A/B 等价 473 例 + 26 道门禁 + 1247 用例，远超同体量平均；最大亮点 |
| 安全工程 | 4.0 | fail-closed 与鉴权体系扎实；密钥/越权有方法论与测试 |
| 工程纪律 | 4.0 | 真值优先级、提交隔离、事故复盘闭环都制度化；但台账自身脱节暴露执行缺口 |
| 可维护性 | 3.5 | 规则/经验沉淀体系完整，但 core 配额耗尽 + 经验被迫外流 HANDOFF，长期维护成本上升 |
| 交付就绪度 | 2.5 | 工程完成度高，但人脸资质硬阻塞未解，无法提审上线 |

**综合**：工程素养与质量保障 **4.0+**，交付就绪度受非技术因素拖累至 **2.5**。

---

## 八、结论

这是一个**工程素养明显高于平均、质量保障体系出色**的项目——把「拆分等价性、共享同步、门禁回读、事故复盘」都做成了可执行机制，这在中小型项目里难得。测试投入（1247 用例 + 473 A/B 等价 + 26 道门禁）和安全设计（fail-closed 贯穿）是其最突出的技术资产。

当前面临两个真实瓶颈：

1. **规则配额 3B 余量**（工程体系自身的扩容天花板）——core 规则无法新增，经验被迫外流，长期看会侵蚀跨会话交接的可靠性；
2. **人脸类目资质**（非技术但卡住上线）——使已完成的工程投入无法转化为线上价值。

技术债本身并不重（未闭合 7 项多数已闭环或登记不修），真正需要警惕的是**「真值管理」和「上线闭环」这两个流程的执行一致性**：技术债台账自身头部失准（§6.2）、admin-web 前端曾漏部署误记上线（§6.4），说明制度已有，但落地的最后一公里仍有偶发失守。建议优先订正台账口径（T-22.5，低风险 docs 类），并持续强化「源码提交≠线上发布」的强制卡点。

---

*本报告所有数据均采集自 2026-11-25 23:08 仓库实测（HEAD `769ad721`），未验证项未列入结论。*

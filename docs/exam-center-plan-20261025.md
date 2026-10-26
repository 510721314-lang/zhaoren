# 学习考试中心 · 完整实施方案（2026-10-25）

> 状态：**已审核通过（D1–D7 拍板，2026-10-26）；S1–S4 已完成并部署（2026-10-26），S5 待开工**
> 结论来源：双专家同步评估 + 2026-10-26 只读实测复核（5 个 partner_profile / 26 个集合 / 33 条索引）
> 决策基线：不考虑提审时间、无上线压力、**地基优先**（数据模型与状态机返工最贵，UI 返工最便宜）
> 关联：原型蓝本 `C:\tmp\gen_md.py`（陪伴服务岗前学习考试系统）；现状基线见 `docs/dev-manual/03-data-model.md`

---

## 0. 已确认结论（评审锚点）

1. **排序**：地基优先——纸面设计 → 迁移路径 → 内容（并行启动）→ 导入后台 → UI → 反作弊/闭环。
2. **状态机**：不迁 `partner_profile.status`；新增独立 `cert_status` 派生态（`_shared/cert_state.js` 单点流转），组合门禁收敛进共享函数。
3. **红线**：不建原型的 `redline_reports` 集合（与本方案 5 个新集合无关）；作弊走 `exam_sessions.cheat_flags` + audit + admin 复核；**「自动停岗」修正为「标记待复核」**。
4. **云函数拆分时序（2026-10-26 修订）**：按调用方迁移再拆——S2 不新建函数，S4 建 **exam-admin-action**，S5 建 **exam-action**；禁止 `cloud.callFunction` 函数间转发。
5. **内容**：灰度 base+W1 → W11 → W4/W10 → 其余；医疗表述合规审前置；内容不进代码包。
6. **cert 门禁**：S2 落状态、先纯展示跑通闭环，接单门禁后置开闸（配置开关）。
7. **存量与安全（2026-10-26 拍板）**：D2 改为按服务端 `exam_at` 留痕回填；S2 首项修复 `partner-apply` 信任客户端 `exam_scores` 的 P0。

---

## 1. 目标与非目标

### 目标
- 将现有极简考试（1 集合 / 2 科目 / 10 题单选 / 2 页面）升级为完整学习考试中心。
- 支持：多题型、考试留痕、证书生命周期（发证/过期/复训）、学习模块与进度、Markdown 题库导入、考务后台、作弊复核。
- 覆盖场景灰度：base + W1 首发同步落地内容，其余场景按内容产能开放。

### 非目标（本期不做）
- 不替换现有 `partner_profile.status`（approved/pending_review）经营准入体系。
- 不建原型的 `redline_reports` 集合（与服务过程红线 safety-report 属不同域，作弊域并入 exam_sessions）。
- 不做真实支付 / 证书电子签章 / 第三方课程对接。
- 不动 `zz-*` 云函数、不动 5 份用户 SOP untracked 文档。

---

## 2. 总体架构

### 2.1 云函数拆分

| 新函数 | 职责 | action 清单 |
|---|---|---|
| **exam-action**（C 端） | 学员侧考试与学习 | `exam_subjects`（科目列表）· `get_exam_questions`（拉题，剥答案）· `submit_exam`（判分+session+发证）· `study_progress_get` / `study_progress_upsert`（S5）· `my_certs`（证书与派生态）· `daily_practice`（S6） |
| **exam-admin-action**（管理端） | 考务与内容管理 | 新增考务 action：`question_list/upsert/delete`（S4）· `import_questions_markdown`（S4）· `exam_session_list/detail`（S4）· `cheat_review`（S6）· `cert_list/revoke`（S6）· `exam_dashboard`（S4）· `export_exam`（S6）· `content_upsert`（学习内容管理，S4）。旧 6 个科目 action 不迁移，保留在 `admin-action` |

- 两函数最终均接入现有 `_shared` 体系：本地副本 + `sync-*.ps1` + SHA 门禁。
- **落地时序（2026-10-26 修订）**：S2 不新建 `exam-action` / `exam-admin-action`，新逻辑先落 `partner-action` / `admin-action`；S4 管理端迁移时建 `exam-admin-action`，S5 小程序切换时建 `exam-action`。
- **过渡策略**：旧 3 个 C 端考试 action、旧 6 个科目 action 在各自调用方迁移前**维持原实现**；禁止用 `cloud.callFunction` 做函数间转发（会叠加冷启动与 2.5s 网关超时风险）。

### 2.2 数据模型（5 个新集合 schema 终稿）

通用约定：沿用项目软删 `is_deleted`、epoch ms 时间戳、openid 身份锚点、platform_event 审计。

> **集合/索引口径（2026-10-26 修订）**：新增 `questions` / `exam_sessions` / `certificates` / `study_records` / `study_content` 共 **5 个集合**，`init-db COLLECTIONS` 由 26 → **31**；新增索引 **7 条**（与原方案内联索引清单一致），由 33 → **40**，不额外建冗余索引。

**① questions（题目 SSOT，一题一文档）**

| 字段 | 类型 | 说明 |
|---|---|---|
| subject | string | `base` / `W1` / `W11`…（沿用 exam_bank 科目编码） |
| paper | string | `A`（S2 仅 A 卷；`B/C/random/daily/wrong` S5+ 扩展） |
| module | string | `M1`–`M12` |
| qid | string | 业务题号（如 `A-01`），人读 + 错题定位 |
| type | string | `single` / `multi` |
| stem | string | 题干 ≤500 字 |
| options | string[] | 2–6 项，每项 ≤50 字 |
| answer_idx | number \| number[] | single 单值；multi 升序去重数组 |
| score | number | S2 统一 1 分/题，字段预留 |
| difficulty | string | `easy` / `medium` / `hard` |
| knowledge | string | 知识点标注 |
| analysis | string | 解析 ≤500 字（成绩单展示） |
| status | string | `draft` / `published`（草稿不被拉题命中） |
| version | string | 题目版本 V1.1（改题=复制新版本草稿，S4 导入时启用） |
| is_deleted / created_at / updated_at / created_by / updated_by | — | 通用 |

索引：`subject + status + paper`；`qid` 唯一（同 subject 内）。

**② exam_sessions（考试留痕）**

| 字段 | 类型 | 说明 |
|---|---|---|
| openid / subject / bank_ver | — | bank_ver 快照（题库更新拒判沿用现有防护） |
| answers | array | 与题目顺序一一对应；multi 为数组 |
| score / passed / pass_line | — | 判分快照 |
| duration_ms | number | 用时 |
| screen_switch_count | number | S2 先记 0，S6 启用 |
| auto_submit / cheat_flags | — | S6 启用 |
| status | string | `submitted`（S5 增 `draft`） |
| is_deleted / created_at / submitted_at | — | 通用 |

索引：`openid + submitted_at↓`；`subject + submitted_at↓`。

**③ certificates（证书）**

| 字段 | 类型 | 说明 |
|---|---|---|
| openid / subject | — | — |
| score | number | 取证分数快照 |
| session_id | string | 来源考试（反查不冗余） |
| issued_at / expires_at | number | **expires_at=0 表示永久**（base 默认永久） |
| content_version | string | 取证时题库内容版本快照（D1：base 永久，但支持按版本清退） |
| backfilled | boolean | 存量回填标记（D2；仅 `exam_at` 留痕者置 true） |
| source_exam_at | number | 回填来源的原考试时间（D2，保留原始留痕） |
| status | string | `active` / `revoked`（**过期不落库**，由派生态计算） |
| revoked_by / revoke_reason | string | 管理员吊销 |
| is_deleted / created_at | — | 通用 |

索引：`openid + subject + issued_at↓`；有效证书 = 最新一张且未吊销未过期（复训重发产生多张历史）。

**④ study_records（学习进度）**

| 字段 | 说明 |
|---|---|
| openid / subject / module_id / chapter_id | upsert 键：openid+subject+chapter_id |
| progress 0–100 / is_completed / last_read_at | 本地缓存 + 会话结束批量上云（R6 对策） |

**⑤ study_content（学习内容，D4 建议采纳）**

| 字段 | 说明 |
|---|---|
| subject / module_id / chapter_id / sort | 章节定位 |
| title / body_md | 正文 Markdown（存集合，不进代码包） |
| status | `draft` / `published` |

**新增索引清单（7 条，33→40）**

| # | 集合 | 索引名 | 键 | 唯一 |
|---|---|---|---|---|
| 1 | questions | idx_subject_status_paper | subject+status+paper | 否 |
| 2 | questions | uk_subject_qid | subject+qid | 是 |
| 3 | exam_sessions | idx_openid_submitted | openid+submitted_at↓ | 否 |
| 4 | exam_sessions | idx_subject_submitted | subject+submitted_at↓ | 否 |
| 5 | certificates | idx_openid_subject_issued | openid+subject+issued_at↓ | 否 |
| 6 | study_records | uk_openid_subject_chapter | openid+subject+chapter_id | 是 |
| 7 | study_content | idx_subject_module_chapter_sort | subject+module_id+chapter_id+sort | 否 |

> `exam_bank` 保留为科目 meta；`certificates` 必须独立集合（不内嵌 `partner_profile`），以支持多张历史证书、吊销与按科目查询。

### 2.3 cert_status 派生状态机（`_shared/cert_state.js`）

不新增存储字段，状态由 `exam_scores` + `certificates` + `study_records` **实时推导**：

```
UNTRAINED    无该科目 session 且学习进度 <100%
TRAINED      有 session 或学习 100%，但无有效证书
CERTIFIED    存在 active 证书且未过期
EXPIRED      最近证书 expires_at>0 且已过期
CHEAT_SUSPENDED   存在未复核/已确认作弊标记且未解除（S2 预留，S6 启用）
```

- `cert_state.js` 导出：`computeCertState({scores, certs, subject, now})` + `requireCertForApply(profile, scenes)` + `requireCertForTake(profile, scenes, baseSubject)`。
- **两种门禁语义（2026-10-26 修订）**：`apply` 只校场景证书（W1 → W1 证书有效，与现入驻阈值对齐）；`take` 校 base + 场景证书（与现 `order-create` 的 base+场景双门禁对齐）。证书发放阈值统一为科目 `pass_line`（现为 100）。
- **接单门禁接入点**：`partner-apply/index.js`（`exam_scores.W1>=80` 切换为 `requireCertForApply`）与 `order-create/action_take.js`（切换为 `requireCertForTake`，后置开闸）。
- **响应码兼容**：`cert_gate_enabled=false` 时逐字保留旧码；开闸后优先复用 `apply_w1_exam_failed` / `order_base_exam_required` / `order_scene_exam_required`，过期同码加文案，避免前端改映射。
- 流转与消费方清单：exam-status 页、我的页角标、首页入口禁用矩阵（S5 接入）。

### 2.4 admin_config 新增键（走 config_set 留痕，禁 nosql 直改）

| 键 | 默认 | 说明 |
|---|---|---|
| `cert_gate_enabled` | `false` | 证书接单门禁总开关（S2 落状态、后置开闸） |
| `w1_cert_valid_days` | `365` | W1 证书有效期 |
| `base_cert_permanent` | `true` | base 证书永久有效 |

新增键需同步登记 CONFIG_SCHEMA（init-db 契约 + 台账）。`init-db` 种子只补缺失键、不覆盖已有值；S2 必须用 `config_set` 显式确认 `cert_gate_enabled=false` 并留 `config_history`。

### 2.5 判分口径（D7，2026-10-26 拍板）

- 单选：选项索引全等。
- 多选：答案数组升序去重后**全等才得分**；漏选、错选、多选均 0 分。
- S2 统一 1 分/题，`pass_line` 保持 **100** 不变（base/W1 各 10 题 = 必须全对）；S3 扩题量后再评估是否下调，本阶段不改认证标准。

---

## 3. 迁移与退役计划（cutover）

```
第 1 步  S2 建 questions 集合与索引；S3 灌题，判分仍读 exam_bank（双写准备期）
第 2 步  迁移脚本：exam_bank 两科目 20 题 + exam-fallback 兜底题 → 灌入 questions（idempotent，按 qid 幂等）
第 3 步  读切换：拉题/判分改读 questions（灰度核对分数一致性）
第 4 步  核验：双源题目逐条 diff + 线上 mock 交卷回归
第 5 步  退役：exam_bank.questions 字段清空（科目 meta 保留）→ exam-fallback.js 删除
         → sync-exam-fallback.ps1 删除 → 两函数移除本地副本 → 门禁基线更新
```

- **第 5 步执行口径（2026-10-26 定稿，方案 A）**：阶段 1 已执行 = 备份（`C:\zhaoren-bak\exam_bank-backup-20261026-s3-step5.json`）+ 清空 base/W1 的 `exam_bank.questions`（meta 与 `updated_at` 不变）；
  **阶段 2（删 fallback / 同步脚本 / 本地副本 / 读降级）并入 S4**——前置条件是 admin 题库写入口迁至 questions（旧 `exam_subject_create/update/delete` 与 `exam_bank_seed` 停用），
  否则会出现「后台写 exam_bank、C 端读 questions」的静默分裂；同时保留 fallback 作 questions 读取异常时的最后兜底，避免考试全停。

- **存量成绩**：`partner_profile.exam_scores` 保留作历史展示；按 D2 **仅对有 `exam_at.<subject>` 服务端留痕且分数 ≥ pass_line 者**回填 certificates（实测：base 2 张 + W1 1 张；2 名 W1≥80 无留痕者重考）。
- **bank_ver 来源（S3 定稿 2026-10-26）**：questions 路径取该科目 `max(updated_at)`；降级 exam_bank 路径沿用 `exam_bank.updated_at`。灌题时 `questions.updated_at` 基线沿用源 `exam_bank.updated_at`，使切换瞬间 `bank_ver` 与旧实现一致，避免在途考试被 `pa_exam_bank_changed` 误杀。
- **阶段 2 收尾（2026-10-26 已完成）**：旧写 `exam_subject_create/update/delete` + `exam_bank_seed` 返回 `exam_write_retired`；`_shared/exam-fallback.js` + `sync-exam-fallback.ps1` + partner-action/admin-action 本地副本已删除、`SYNC_MAP` 条目移除；`partner-action` 读题改单源 `questions`（无题/读失败 → `{}` 不缓存 → `pa_exam_bad_subject`）。
- **相邻缺陷同步修复（2026-10-26）**：`order-create/action_take.js` 接单门禁原以 `exam_bank.questions.length>0` 判断科目是否活跃，questions 清空后恒回退硬编码 `base/W1=100`（W1 实际 `pass_line=90` 与新增科目均不生效）→ 改为按 `enabled` 科目 meta 的 `pass_line/requires` 校验，与 `take_readiness` 同口径。
- **单源纪律**：cutover 完成前禁止新增题目双写入口；cutover 后 questions 为唯一题目 SSOT。

---

## 4. 分阶段实施（S1–S6）

### S1 · 地基纸面设计（docs-only，0 代码）

| 交付物 | 说明 |
|---|---|
| 本方案文档审核通过 | 含 D1–D7 拍板（2026-10-26） |
| schema 终稿冻结 | §2.2 五集合 + 7 条索引预案 |
| cert_state 状态机稿 | §2.3 消费方清单确认 + apply/take 双语义 |
| cutover 计划确认 | §3 五步回滚点标注 + D2 留痕回填口径 |

验收：用户书面确认 D1–D7 + 本文档（已于 2026-10-26 拍板）。风险：无（纯文档）。

### S2 · 后端落地（第一批业务代码）

**范围修订（2026-10-26）：S2 不新建云函数。** 新逻辑先落现有入口，避免“新建后没人调”和函数间转发。

改动面：
- 新建 `_shared/cert_state.js` + `sync-cert-state.ps1` + `cert_state.test.js`；副本：`partner-apply`、`order-create`（S5 再同步到 `exam-action`）；同步更新 `scripts/check-shared-sync.js` SYNC_MAP。
- `partner-apply/index.js`：**先修 P0**——只读服务端 `profile.exam_scores`，忽略 `event.exam_scores`，不覆盖/清空档案分数；再接入 `cert_gate_enabled` 分支（默认 false 走旧 `exam_scores.W1>=80`，true 走 `requireCertForApply`）。
- `partner-action/action_exam.js`：多选判分、`exam_sessions` 写入、通过后证书 upsert、保留 `bank_ver` 防护、审计补 session_id。
- `order-create/action_take.js`：`cert_gate_enabled` 分支（默认 false 走旧 base+场景 `pass_line`，true 走 `requireCertForTake`）。
- `init-db`：5 集合注册（26→31）+ CONFIG_SCHEMA 三新键 + 7 条索引声明（33→40）；索引仍须控制台手工创建，部署后用 `tcb-scan-indexes.js` 复核 40/40。
- 存量回填：先 dry-run 输出“base 2 + W1 1”，用户确认后再 apply；证书 `issued_at=cutover`，W1 `expires_at=+365d`，base=0，`backfilled=true`。

门禁：`npm test` 实跑只增不减（新增 cert_state 测试、多选判分、session/发证、P0 回归）+ check-syntax/ssot/shared-sync 全绿。
部署：git bundle 备份 → CLI 串行部署 `partner-action` / `partner-apply` / `order-create` / `init-db` → deploy-log 登记 → 云端测试走查（mock_openid + 交卷/发证/幂等重交/P0）。
验收：`cert_gate_enabled=false` 时旧路径行为逐字一致（P0 为有意安全修复，单独 A/B）；新链路云端测试全绿；索引扫描 40/40。

### S3 · 内容工程（与 S2 并行启动，真长杆）

| 事项 | 说明 |
|---|---|
| base + W1 课程内容 | 原型 M1–M12 框架移植；W1 十二项红线清单校准 |
| **合规审（第一件事）** | 医疗表述中性化清单：不出现指令式「给药/执行医嘱/诊断」措辞，改「陪同/提示/上报医护人员」口径；产出 docs 合规审记录 |
| 内容入库 | study_content 集合 draft → admin 端预览 → published |
| 速查卡数据 | 从 questions.knowledge/analysis 派生，不单独维护 |

验收：base+W1 全模块 published；合规审记录归档；其余场景内容缺口不阻塞功能（认证要求与场景可用性解耦）。

### S4 · 导入后台 + 考务看板（admin-web 域）

**2026-10-26 执行口径修订（用户拍板）**：S4 不新建 `exam-admin-action`，管理端动作落 `admin-action`（新增 `action_question.js` / `action_study.js`），复用既有 `X-Admin-Token` + `__admin_web_proxy` 密钥 + RBAC + 审计，避免复制整套鉴权链与新增代理分流；S5 仍按 §2.1 新建 C 端 `exam-action`。本轮范围收敛为**核心闭环**（课程预览 / 题库写入口 / 旧写入口退役 / 删 fallback），考务看板（`exam_session_list/detail` + `exam_dashboard`）顺延。

旧 6 个科目 action 中 `exam_subject_list/detail` 保留只读兼容，`exam_subject_create/update/delete` 与 `exam_bank_seed` 在新题目写入口上线并**生产验证通过后**停用（返回退役错误），admin-web 移除「一键初始化题库」按钮；不迁移、不做薄别名。科目元数据改由 `exam_subject_meta_update` 维护（仅标题/说明/通过线/前置/启停，不写 questions）。

改动面：
- `admin-action` 新增 `action_question.js`（`question_list/detail/upsert/delete/bulk_status/import_markdown` + `exam_subject_overview` + `exam_subject_meta_update`）与 `action_study.js`（`content_list/content_detail` 只读）；题目写入口以自然键 `subject+qid` 定位，直接写 `questions`，`bank_ver` 由该科目 `max(questions.updated_at)` 自然变化
- `import_questions_markdown`（`<!-- q:start -->` 块解析、逐条校验、部分成功明细，≤200 题，分片并行写入规避 2.5s 网关）
- admin-web：`Exam.vue` 三 Tab（科目与规则 / 题库管理 / 课程预览），子组件 `views/exam/*`；课程预览只读渲染 `study_content.body_md`；构建前清 dist + node_modules/.vite
- 旧写入口退役顺序：新动作部署 + admin-web 发布 → 生产验证 → 旧写返回 `exam_write_retired` → 二次部署
- **S3 第 5 步阶段 2（本阶段收尾执行）**：题目写入口迁至 questions 且旧写 action 停用后，删除 `_shared/exam-fallback.js` + `sync-exam-fallback.ps1` + partner-action/admin-action 本地副本，移除 partner-action 读降级的 fallback 分支（questions 为空/读失败 → `pa_exam_bad_subject` fail-closed），更新 `scripts/check-shared-sync.js` SYNC_MAP、相关测试与门禁基线，重新部署 partner-action/admin-action

验收：导入样例（含非法条目）→ 合法条目入库 + 错误明细逐条回报；旧后台写入口全部返回退役错误、admin-web 无 seed 入口；课程预览 18 条 published 正文可读；仓库无 exam-fallback 残留且门禁全绿。

**S4 实测结果（2026-10-26，已部署）**：`verify:offline` EXIT=0（tests **677 pass / 0 fail**、A/B **454 EQUIVALENT / 63 known evolution**、SYNTAX 260 / SSOT 0 / SHARED SYNC / REQUIRE SCOPE / HANDLERS / INDEX LEDGER / DEPLOY-CONFIG 全绿）；三函数 CLI 部署 `success=true`（admin-action 48 files/144.8 KB、partner-action 15 files/55.8 KB、order-create 14 files/45.3 KB），`cloud functions download` 关键文件 **SHA256 3/3 MATCH**、云端包内 `exam-fallback.js` **0 个**；网关实测 `exam_subject_overview` base **9/9** published（1 题验证期软删）、W1 **10/10**（`pass_line=90`、`requires:["base"]`）、`question_list total=19`、`content_list` 18 条、4 个旧写入口全部 `{"code":"exam_write_retired"}`。**遗留**：`partner-action` 生产拉题/交卷回归需真机（prod 环境 `mock_openid` fail-closed）。

### S5 · C 端体验（miniprogram 域）

**本阶段才创建 `exam-action`**；小程序从 `partner-action` 切到 `exam-action` 后，旧 3 个考试 action 保留只读兼容，S6 移除；禁止 `cloud.callFunction` 转发。

改动面：
- 新建 `cloudfunctions/exam-action/` + 小程序 `wx.cloud.callFunction({name:'exam-action'})` 切换；`_shared/cert_state.js` 同步副本
- 新分包页 `pages-v2/pkg-low/study/`：学习中心 + 章节正文（滚动 90% 记录 + 标记已读）
- `pkg-low/exam` 升级：跳题宫格 + 计时器 + 草稿本地保存（10s 定时 + toggle 即存）+ 断网暂存 `_pending`
- 成绩单页：逐模块正确率 + 错题解析 + 去复习
- exam-status 页接 cert_state 派生态展示 + profile 证书卡
- app.json 分包注册 + 主包体积复核（内容不进包，预期增量 <30KB）

验收：真机走查清单（学习→考试→发证→证书展示全链）；断网交卷暂存恢复；草稿续考；包体 ≤ 预算。

### S6 · 闭环与收尾

| 事项 | 说明 |
|---|---|
| 复训机制 | EXPIRED 派生态 + 证书页/工作台到期提醒（≤30 天橙条）；复训=重考 W1 → 新证书 |
| 作弊复核 | 切屏检测（onHide/onShow 计数）+ 秒交/全同选项标记 → `cheat_flags` → admin `cheat_review`（CONFIRMED=停考 CHEAT_SUSPENDED / DISMISSED=恢复）；**无自动停岗** |
| 证书展示合规 | C 端证书卡挂 disclaimer 签署体系（沿用现有合规双签链路） |
| `cert_gate_enabled` 开闸 | 云端 mock 回归 → 真机验证 W1 无证拦截 → config_set 开启留痕 |
| daily_practice / 导出 | 每日 5 题 + 错题卷（基于 sessions 聚合）+ xlsx 导出 |
| 退役清理 | 移除 partner-action/admin-action 旧考试 action（只读兼容）+ 门禁基线订正（exam-fallback 残留已在 S4 阶段 2 清理） |

---

## 5. 决策点清单（D1–D7，2026-10-26 拍板）

| # | 决策 | 拍板结论 | 备选/边界 |
|---|---|---|---|
| D1 | base 证书是否永久有效 | ✅ 永久（expires_at=0）；证书加 content_version 快照，不设到期强制复训 | 同 W1 设 365d 复训 |
| D2 | 存量 `exam_scores.W1>=80` 用户回填策略 | ✅ **仅按服务端 `exam_at` 留痕回填**：base 2 张 + W1 1 张；2 名无留痕者重考；`issued_at=cutover`，W1 365d、base 0、`backfilled=true` | 按分数全量回填（会多发无留痕证书，不采用）；不回填（体验差） |
| D3 | cert 门禁接入时序 | ✅ S2 落状态+开关默认关；S6 验证后开闸。补：apply 只校场景证书、take 校 base+场景；gate off 旧码逐字不变；W1 入驻门槛 80→100 | S2 即开闸（回归面大，不推荐） |
| D4 | 学习内容存储 | ✅ study_content 集合（draft/published，不进代码包） | 云存储 JSON 文件（无事务/检索弱） |
| D5 | exam-action 身份语义 | ✅ 保持现行为：需 partner_profile 存在（沿用 `pa_no_profile`） | 放宽到登录即可（语义变化需重审入驻链） |
| D6 | 学习进度上云频率 | ✅ 本地缓存 + 会话结束批量写；page hide/章节完成 flush；幂等 upsert | 每次心跳上云（配额风险） |
| D7 | 多选题判分 | ✅ 全对才得分，1 分/题，pass_line 100 不变；S2 仅 A 卷 | 部分给分（降低认证标准，本阶段不采用） |

**审核实测依据（2026-10-26，只读）**：`partner_profile` 5；W1≥80 3（均≥100）；base≥100 2；`exam_at.W1` 1；`exam_at.base` 2；双留痕双过线 1；`audit_log submit_exam` 3 条。故 D2 只发 base 2 + W1 1。

---

## 6. 风险台账

| # | 风险 | 级别 | 对策 | 落点 |
|---|---|---|---|---|
| R1 | cert 门禁若只做展示则无意义；接入门禁波及 partner-apply/order-create | 🔴 | 组合门禁收敛进 cert_state.js + 配置开关灰度 + S6 才开闸；apply/take 双语义分开 | S2/S6 |
| R2 | exam_bank→questions 迁移丢生产数据 | 🟡 | 幂等迁移脚本 + 双源 diff 核验 + 明确 cutover 五步 | §3 |
| R3 | W1 内容医疗表述触碰类目红线 | 🟡 | 合规审前置 S3 第一件事 + 审记录归档 | S3 |
| R4 | 切屏检测可绕过 + 误杀 | 🟡 | 标记待复核而非自动停岗 + admin 人工复核 | S6 |
| R5 | 证书展示构成「资质暗示」法律边界 | 🟡 | 挂 disclaimer_signature 签署体系 | S6 |
| R6 | 学习进度高频写爆云开发配额 | 🟢 | 本地缓存 + 批量上云（D6） | S5 |
| R7 | 新 _shared 模块触发 sync + 门禁流程成本 | 🟢 | 仅 cert_state.js 一个新模块，禁止碎片化 | S2 |
| R8 | 主包体积超限 | 🟢 | 内容全走集合/云存储；S5 包体复核 | S5 |
| R9 | 拆分时序错位：S2 建新函数但调用方未迁移，导致新逻辑不生效或函数间转发超时 | 🟡 | 按调用方迁移再拆；S2 不新建函数；禁止 cloud.callFunction 转发 | S2/S4/S5 |
| R10 | `partner-apply` 信任客户端 `exam_scores`，可伪造分数/清空档案 | 🔴 | S2 首项修复：只读服务端 profile；A/B 覆盖无分数/有分数/首次申请 | S2 |
| R11 | admin-web 只代理 admin-action，exam-admin-action 不可达；双层代理触发 2.5s 504 | 🟡 | S4 再建函数；admin-web 按前缀直连路由，单层代理 | S4 |
| R12 | 索引只能控制台手工建，台账易漂移 | 🟡 | init-db 7 条声明 + 手工创建 + `tcb-scan-indexes.js` 复核 40/40 | S2 |

---

## 7. 工程纪律（每阶段强制）

1. **commit 三类隔离**：①业务代码+规则 ②docs/台账 ③测试基础设施，禁止混批。
2. **门禁基线取实跑**：`npm run test` 实跑 + `node --check` + check-ssot + check-shared-sync；基线只增不减。
3. **_shared 改规范源必跑 sync**，副本 SHA 一致过门禁。
4. **部署**：先 git bundle 归档 + manual-backup.ps1 → CLI 串行部署 → 绝对路径 download 核验 → deploy-log 登记（含回滚点）。
5. **接口契约**：先服务端部署、后前端上传；旧客户端保留兼容兜底。
6. **配置变更**：admin_config 一律走 config_set 留 config_history，禁 nosql 直改。
7. **AI 不主动 commit/push**，等用户确认；push 绕代理。
8. 云端测试入参：完整可直接粘贴（含 mock_openid），测试面板保留上次入参、幂等/状态拒绝属正常。
9. 提审冻结纪律切换按 `zhaoren-frequent-flows` 流程执行；v1.6.39 体验版为已上传快照，本方案实施不影响其有效性。
10. **审核结论先落文档再开工**：D1–D7 与实测数据写回本方案；S2 代码以本修订版为唯一基线。

---

## 8. 附录 · 原型取舍清单

| 原型设计 | 处置 | 说明 |
|---|---|---|
| 12 学习模块 + 学习中心/章节 | ✅ 采纳 | S3/S5，内容存 study_content |
| 速查卡翻面 | 🟡 降级为 S5 可选 | 数据从 questions 派生；性价比待验证 |
| A/B/C/随机/每日一练/错题卷 | ✅ 分期 | S2 仅 A 卷；daily/wrong S6；B/C 视需求 |
| 答题宫格/计时/草稿/断网暂存 | ✅ 采纳 | S5 |
| 切屏≥2 警告 ≥5 标记 | ✅ 采纳但改语义 | 记 cheat_flags，人工复核，不自动停岗 |
| 证书 +365d/过期/复训 | ✅ 采纳 | base 永久（D1）、W1 365d |
| 5 态状态机 | ✅ 采纳（派生实现） | SUSPENDED 更名 CHEAT_SUSPENDED，语义收窄到考试域 |
| 红线上报 + redline_reports 集合 | ❌ 废弃 | 服务过程红线已有 safety-report；考试作弊并入 exam_sessions |
| 8 个后台页 | ✅ 分期 | S4 看板/题库/导入，S6 复核/导出；用户管理复用现有 |
| 15 错误码体系 | ❌ 不引入 | 沿用项目 `ok/code/msg` 三字段约定 |
| 独立云函数群（10+ 函数） | 🟡 折中 | 收敛为 exam-action + exam-admin-action 两函数；S4/S5 随调用方迁移再建 |
| 逐题用时快照 | 🟡 S6 可选 | exam_sessions 预留字段，先不做 |

# 学习考试中心 · 完整实施方案（2026-10-25）

> 状态：**待审核**
> 结论来源：双专家同步评估（本会话，独立专家代理已读码核实）
> 决策基线：不考虑提审时间、无上线压力、**地基优先**（数据模型与状态机返工最贵，UI 返工最便宜）
> 关联：原型蓝本 `C:\tmp\gen_md.py`（陪伴服务岗前学习考试系统）；现状基线见 `docs/dev-manual/03-data-model.md`

---

## 0. 已确认结论（评审锚点）

1. **排序**：地基优先——纸面设计 → 迁移路径 → 内容（并行启动）→ 导入后台 → UI → 反作弊/闭环。
2. **状态机**：不迁 `partner_profile.status`；新增独立 `cert_status` 派生态（`_shared/cert_state.js` 单点流转），组合门禁收敛进共享函数。
3. **红线**：原型考试域红线不建第 5 集合；作弊走 `exam_sessions.cheat_flags` + audit + admin 复核；**「自动停岗」修正为「标记待复核」**。
4. **云函数**：借零存量时机拆 **exam-action**（C 端）+ **exam-admin-action**（管理端）。
5. **内容**：灰度 base+W1 → W11 → W4/W10 → 其余；医疗表述合规审前置；内容不进代码包。
6. **cert 门禁**：S2 落状态、先纯展示跑通闭环，接单门禁后置开闸（配置开关）。

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
| **exam-admin-action**（管理端） | 考务与内容管理 | 迁移自 admin-action：`exam_subject_list/detail/create/update/delete` + `exam_bank_seed`；新增：`question_list/upsert/delete`（S4）· `import_questions_markdown`（S4）· `exam_session_list/detail`（S4）· `cheat_review`（S6）· `cert_list/revoke`（S6）· `exam_dashboard`（S4）· `export_exam`（S6）· `content_upsert`（学习内容管理，S4） |

- 两函数均接入现有 `_shared` 体系：本地副本 + `sync-*.ps1` + SHA 门禁。
- **过渡策略**：S2 起 partner-action 旧 3 个考试 action、admin-action 旧 6 个科目 action 保留为**薄别名**（内部转发新函数逻辑或维持原实现），S6 收尾时统一移除；接口契约变更遵循「先服务端部署、后前端上传」顺序。

### 2.2 数据模型（4 个新集合 schema 终稿）

通用约定：沿用项目软删 `is_deleted`、epoch ms 时间戳、openid 身份锚点、platform_event 审计。

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

### 2.3 cert_status 派生状态机（`_shared/cert_state.js`）

不新增存储字段，状态由 `exam_scores` + `certificates` + `study_records` **实时推导**：

```
UNTRAINED    无该科目 session 且学习进度 <100%
TRAINED      有 session 或学习 100%，但无有效证书
CERTIFIED    存在 active 证书且未过期
EXPIRED      最近证书 expires_at>0 且已过期
CHEAT_SUSPENDED   存在未复核/已确认作弊标记且未解除（S2 预留，S6 启用）
```

- `cert_state.js` 导出：`computeCertState({scores, certs, subject, now})` + 组合门禁 `requireCertForScene(profile, scenes)`（W1 场景 → W1 证书有效）。
- **接单门禁接入点**：`partner-apply/index.js`（入驻校验 `exam_scores.W1>=80` 切换为证书态校验）与 `order-create`（接单校验，后置开闸）。
- 流转与消费方清单：exam-status 页、我的页角标、首页入口禁用矩阵（S5 接入）。

### 2.4 admin_config 新增键（走 config_set 留痕，禁 nosql 直改）

| 键 | 默认 | 说明 |
|---|---|---|
| `cert_gate_enabled` | `false` | 证书接单门禁总开关（S2 落状态、后置开闸） |
| `w1_cert_valid_days` | `365` | W1 证书有效期 |
| `base_cert_permanent` | `true` | base 证书永久有效 |

新增键需同步登记 CONFIG_SCHEMA（init-db 契约 + 台账）。

---

## 3. 迁移与退役计划（cutover）

```
第 1 步  questions 落库，判分仍读 exam_bank（双写准备期）
第 2 步  迁移脚本：exam_bank 两科目 20 题 + exam-fallback 兜底题 → 灌入 questions（idempotent，按 qid 幂等）
第 3 步  读切换：拉题/判分改读 questions（灰度核对分数一致性）
第 4 步  核验：双源题目逐条 diff + 线上 mock 交卷回归
第 5 步  退役：exam_bank.questions 字段清空（科目 meta 保留）→ exam-fallback.js 删除
         → sync-exam-fallback.ps1 删除 → 两函数移除本地副本 → 门禁基线更新
```

- **存量成绩**：`partner_profile.exam_scores` 保留作历史展示；按 D2 决策回填 certificates。
- **单源纪律**：cutover 完成前禁止新增题目双写入口；cutover 后 questions 为唯一题目 SSOT。

---

## 4. 分阶段实施（S1–S6）

### S1 · 地基纸面设计（docs-only，0 代码）

| 交付物 | 说明 |
|---|---|
| 本方案文档审核通过 | 含 D1–D6 拍板 |
| schema 终稿冻结 | §2.2 四集合 + 索引台账更新预案 |
| cert_state 状态机稿 | §2.3 消费方清单确认 |
| cutover 计划确认 | §3 五步回滚点标注 |

验收：用户书面确认 D1–D6 + 本文档。风险：无（纯文档）。

### S2 · 后端落地（第一批业务代码）

改动面：
- 新建 `cloudfunctions/exam-action/`、`exam-admin-action/`（含 package.json/config.json，_shared 本地副本清单：openid/logger/audit/cert_state 等）
- 新建 `_shared/cert_state.js` + `sync-cert-state.ps1`（副本：exam-action/exam-admin-action/partner-apply）+ `cert_state.test.js`
- `partner-action/action_exam.js` 改薄别名；`admin-action` 6 个科目 action 改别名
- `partner-apply/index.js`：W1 校验切换 `requireCertForScene`（受 `cert_gate_enabled` 控制，默认 false=走旧分数校验，行为不变）
- `init-db`：4 集合注册 + CONFIG_SCHEMA 三新键 + 索引登记（meta/index_ledger.json）
- 多选题判分 + exam_sessions 写入 + bank_ver 防护迁移 + 发证逻辑（submit_exam 内事务：写 session → passed 则 upsert 证书）

门禁：`npm test` 实跑只增不减（新增 cert_state 测试、判分多选用例、session 审计用例）+ check-syntax/ssot/shared-sync 全绿。
部署：git bundle 备份 → CLI 串行部署 exam-action/exam-admin-action/partner-apply/init-db → deploy-log 登记 → 云端测试入参走查（mock_openid + 交卷/发证/幂等重交）。
验收：旧路径行为逐字不变（别名核对）+ 新链路云端测试全绿 + `cert_gate_enabled=false` 时入驻链回归无差异。

### S3 · 内容工程（与 S2 并行启动，真长杆）

| 事项 | 说明 |
|---|---|
| base + W1 课程内容 | 原型 M1–M12 框架移植；W1 十二项红线清单校准 |
| **合规审（第一件事）** | 医疗表述中性化清单：不出现指令式「给药/执行医嘱/诊断」措辞，改「陪同/提示/上报医护人员」口径；产出 docs 合规审记录 |
| 内容入库 | study_content 集合 draft → admin 端预览 → published |
| 速查卡数据 | 从 questions.knowledge/analysis 派生，不单独维护 |

验收：base+W1 全模块 published；合规审记录归档；其余场景内容缺口不阻塞功能（认证要求与场景可用性解耦）。

### S4 · 导入后台 + 考务看板（admin-web 域）

改动面：
- `import_questions_markdown`（解析/校验/部分成功 206 语义，沿用原型契约）+ 题目版本化（改题=复制新版本草稿）
- `exam_session_list/detail` + `exam_dashboard`（科目通过率、高频错题、最近考务）
- admin-web：导入页 + 题库管理页 + 考务看板页（复用现有 Exam chunk 演进）；构建前清 dist + node_modules/.vite

验收：导入 30 题样例（含 2 条非法行）→ 28 入库 + 2 错误明细；看板数字与 exam_sessions 聚合一致。

### S5 · C 端体验（miniprogram 域）

改动面：
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
| 退役清理 | 移除 partner-action/admin-action 薄别名 + exam-fallback 残留 + 门禁基线订正 |

---

## 5. 决策点清单（D1–D6，供拍板）

| # | 决策 | 推荐 | 备选 |
|---|---|---|---|
| D1 | base 证书是否永久有效 | ✅ 永久（expires_at=0） | 同 W1 设 365d 复训 |
| D2 | 存量 `exam_scores.W1>=80` 用户回填策略 | ✅ cutover 日回填 active 证书，365d 起算 | 不回填，要求重考（体验差） |
| D3 | cert 门禁接入时序 | ✅ S2 落状态+开关默认关；S6 验证后开闸 | S2 即开闸（回归面大，不推荐） |
| D4 | 学习内容存储 | ✅ study_content 集合 | 云存储 JSON 文件（无事务/检索弱） |
| D5 | exam-action 身份语义 | ✅ 保持现行为：需 partner_profile 存在（入驻链内考试） | 放宽到登录即可（语义变化需重审入驻链） |
| D6 | 学习进度上云频率 | ✅ 本地缓存 + 会话结束批量写 | 每次心跳上云（配额风险） |

---

## 6. 风险台账

| # | 风险 | 级别 | 对策 | 落点 |
|---|---|---|---|---|
| R1 | cert 门禁若只做展示则无意义；接入门禁波及 partner-apply/order-create | 🔴 | 组合门禁收敛进 cert_state.js + 配置开关灰度 + S6 才开闸 | S2/S6 |
| R2 | exam_bank→questions 迁移丢生产数据 | 🟡 | 幂等迁移脚本 + 双源 diff 核验 + 明确 cutover 五步 | §3 |
| R3 | W1 内容医疗表述触碰类目红线 | 🟡 | 合规审前置 S3 第一件事 + 审记录归档 | S3 |
| R4 | 切屏检测可绕过 + 误杀 | 🟡 | 标记待复核而非自动停岗 + admin 人工复核 | S6 |
| R5 | 证书展示构成「资质暗示」法律边界 | 🟡 | 挂 disclaimer_signature 签署体系 | S6 |
| R6 | 学习进度高频写爆云开发配额 | 🟢 | 本地缓存 + 批量上云（D6） | S5 |
| R7 | 新 _shared 模块触发 sync + 门禁流程成本 | 🟢 | 仅 cert_state.js 一个新模块，禁止碎片化 | S2 |
| R8 | 主包体积超限 | 🟢 | 内容全走集合/云存储；S5 包体复核 | S5 |
| R9 | 双函数拆分后旧调用方遗漏 | 🟡 | 薄别名过渡至 S6 + 全局 grep 调用点清单 | S2/S6 |

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
| 独立云函数群（10+ 函数） | 🟡 折中 | 收敛为 exam-action + exam-admin-action 两函数 |
| 逐题用时快照 | 🟡 S6 可选 | exam_sessions 预留字段，先不做 |

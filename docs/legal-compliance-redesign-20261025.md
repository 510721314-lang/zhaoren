# 后台「法律合规」模块重设计方案（v2 · 已过双专家评审）

> 状态：**设计稿，未实施**。今天处于提审冻结期（miniprogram/ + cloudfunctions/ 业务代码零改动），本方案全部实施动作排在**解冻后**。admin-web 虽不在冻结面，但依赖新增云端接口，随批实施。
> v1 起草 2026-10-25 → 双专家评审（A 事实核验 / B 完整性）修正 2 处事实错误、补齐遗漏域 → v2 定稿待用户拍板决策点（§7）。评审结论见附录。

---

## 1. 现状与问题定性（证据链）

现有模块：admin-web 菜单「法律合规」（`/legal` → `admin-web-frontend/src/views/Legal.vue`），本质是 **6 个文本框的 CRUD**，读写 `admin_config.legal` 块（`action_config_read.js:67-73` 读 / `action_config_set.js:367-392` 写并校验长度）。管理字段：通用免责声明 / 服务协议 / 隐私政策 / AA承诺书 / 宠物授权书 / 场景免责声明。

对照合规三支柱，**分发与治理断裂、取证部分存在**（v1 修正：专家 A + 主对话读码证实）：

| 支柱 | 现状 | 证据 |
|---|---|---|
| ① 文本分发 | **部分通、关键缺口**。实名签署链路已通：服务协议+AA承诺书走云端 `admin_config.legal_*`、内置 DEFAULT 兜底、签名时服务端全文 SHA-256 留证（`user-login/index.js:126-143`）。**断裂部分**：a) `privacy_policy` 全链路无分发——展示页静态写死、config_public 不含、无动态入口；b) agreement 页静态；c) 通用免责声明 miniprogram 零消费 | `user-login/index.js:126-143`；`admin-action/action_config_public.js:75-79`（仅吐 service_agreement/aa_promise/pet_authorization 三项）；`pages-v2/agreement/agreement.wxml:2-56`（硬编码）；`pages-v2/publish/publish.js:150`（场景免责唯一活链路）；`pages-v2/login/login.js:12-16`（勾选纯前端） |
| ② 同意取证 | **实名签署已有**（手写签名+服务端 SHA-256 全文哈希入库）。**缺**：登录勾选取证、版本化（改版后老用户重签机制）、发布免责确认取证 | `user-login/index.js:127` 注释「以服务端读取到的全文计算 SHA-256 并随记录入库」；全仓无 `agree_version`/`consent_record` |
| ③ 变更治理 | **无**。config_set 直接覆盖写，无版本史、无生效时间、无发布留痕；改错无法回滚 | `action_config_set.js:367-393` |

## 2. 重设计原则

1. **合规三支柱闭环**优先于编辑体验——先把「分发→取证→治理」打通，UI 改造其次
2. **复用现有基建**：审计走 writeAudit（consent category）；公开分发走 config_public；场景免责维持现有 SSOT 链路**不动**
3. **fail-closed**：云端文本拉取失败时 C 端用硬编码兜底版本渲染，并在页面标注版本号；同意上报失败**不阻断**登录（取证尽力而为 + 本地缓存补报），避免把登录可用性押在合规取证上
4. **协议版本化最小模型**：不引入工作流引擎，draft→published 两态 + 不可变历史

## 3. 目标态功能设计

### 3.1 数据模型（新增 1 集合 + 复用 audit_log）

**`legal_doc`（版本化协议库）**
```
{ doc_type, version, content, title, status: 'published'|'archived',
  effective_at, created_at, created_by, remark }
doc_type ∈ { service_agreement | privacy_policy | disclaimer | aa_promise | pet_authorization }
```
- 每类文档：published 仅一条（当前生效），其余 archived（历史留档，审计可回溯）
- admin_config.legal 的 6 个文本字段**保留**为「草稿区/兼容读」，发布动作 = 写 legal_doc 新版本 + 同步回 config（兼容期双写，防旧客户端断粮）
- 兼容期内 config_set 直改旧字段视为**紧急热修通道**：允许，但热修不产生版本，下次正式发布时收编进 legal_doc

**consent 取证（复用 audit_log，D1 已拍板 2026-10-25）**
- 不新增独立集合：同意记录经 `writeAudit(category:'consent')` 落 audit_log
- detail 字段携带：`{ doc_type, doc_version, content_sha256, scene: 'login'|'publish'|'migration_baseline', agreed_at }`
- content_sha256 由**服务端**对生效文本全文计算（与实名签署既有留证同构，防客户端伪造）
- 重签策略（D2 已拍板）：**仅登录时重签**——token 有效期内不校验版本，协议变更下次登录生效；关键动作前不校验

### 3.2 接口（admin-action 扩展，解冻后实施）

| action | 说明 |
|---|---|
| `legal_doc_list` | 按 doc_type 列版本史（published+archived） |
| `legal_doc_publish` | 草稿→发布（生成新 version、写 effective_at、旧版本转 archived、写审计） |
| `legal_doc_rollback` | 回滚到历史版本（生成新版本指向旧内容，不删历史） |
| `legal_consent_query` | 按 openid 查同意记录（纠纷举证用） |
| `config_public` 扩展 | `legal_public` **补齐 privacy_policy + disclaimer_text**（现状仅吐三项，隐私政策全链路无分发——批 1 最尖锐缺口）+ 各 doc_type 附 version 号（v2 修正：专家 B） |

### 3.3 C 端改造（miniprogram，解冻后）

1. **agreement/privacy 页动态化**：读 config_public 渲染 + 硬编码兜底，页脚显示「版本 vX 生效于 YYYY-MM-DD」
2. **登录页重签机制**：user-login 返回各 doc 当前 version；本地存「已同意版本」，版本不一致 → 重新弹勾选 → 同意后上报 consent_record（含服务端计算 content_sha256，与实名签署留证同构）。已登录 token 有效期内不强制踢出，**下次登录强制重签**
3. **发布页通用免责**：`legal_disclaimer_text`（现状 miniprogram 零消费，属断链修复）接通发布前弹窗 + consent 上报；场景免责 SSOT 链路**不动**

### 3.4 admin-web「法律合规」页改造（可先行，依赖 §3.2 接口）

- 从 6 个 textarea 改为**文档卡片列表**：每类文档一张卡（当前生效版本号/生效时间/更新人）→ 点入编辑器 → 预览 → 发布
- 新增「版本历史」抽屉（查看/回滚）与「同意记录查询」入口
- 场景免责声明保持现有编辑方式不动（链路已闭环）

## 4. 与现有基建/在途事项的衔接

| 事项 | 关系 |
|---|---|
| writeAudit 审计基建 | consent 取证复用其 category 体系 |
| config_public | C 端协议分发复用该端点（已存在，扩展字段） |
| 场景免责 SSOT（publish.js） | **不动**，本方案仅补通用免责断链 |
| P1-7 auto_approve_partner 提审后回 false | 届时需要人工审核工作台——属批 2 范围 |
| P3-3 手机号明文 | 独立立项，本方案不含 |
| P3-8 系统转争议不写 complaint | 独立修复，本方案不含 |
| mp 后台 F1 隐私指引 / F2 位置权限 / F4 域名 | 平台侧合规，不属于本后台模块，边界注明 |

### 4.5 合规域覆盖清单（专家 B 完整性维度补齐）

| 域 | 现状 | 归属 |
|---|---|---|
| 隐私政策分发 | **全链路无分发（尖锐缺口）** | **批 1** |
| 服务协议版本化+重签 | 签署链路已通，缺版本化 | **批 1** |
| 登录/发布勾选取证 | 缺 | **批 1** |
| 通用免责分发 | 零消费断链 | **批 1** |
| 账号注销与数据删除（个保法） | 待核验（user_account 是否已有注销入口，实施前查） | **批 2** |
| 未成年人保护声明 + 接单年龄门槛 | 实名认证隐含年龄信息，无显式声明 | 批 2 |
| 医疗行为边界（陪诊≠医疗）声明 | 场景免责部分覆盖，无显式条款 | 批 2 |
| 平台/中介/雇佣关系声明 | 服务协议默认文案 L130 已含「信息撮合平台」表述，正式化即可 | 批 2（随批 1 文本正式化顺带） |
| 投诉渠道公示 | agreement 页有反馈渠道，后台无管理入口 | 批 3 |
| 数据出境 / 算法推荐声明 | 不适用（无出境、无算法推荐） | — |

## 5. 分批实施路线（全部解冻后）

| 批次 | 内容 | 理由 |
|---|---|---|
| **批 1（合规底线）** | legal_doc 集合 + legal_doc_publish/rollback/list + config_public 扩展 + C 端 agreement/privacy 动态化 + 登录重签 + consent 取证 + admin-web 页改造 | 三支柱闭环，合规风险最大项 |
| **批 2（治理面）** | 举报处理工作台（safety_report 后台处理流+结论归档）+ 实名/人脸授权同意取证 + 人工审核工作台（配合 P1-7 关闸） | 运营治理，依赖提审结果 |
| **批 3（增强面）** | 纠纷处理结论归档、内容审核台、平台资质展示页、投诉渠道公示 | 商业化批次 |

> **实施状态（2026-10-25 更新）**：批 1 实际按审核可见面拆为两段执行。
> - **1a（已完成）**：`legal_doc` 集合 + `legal_doc_list/publish/rollback/seed` + `config_public` 补 privacy_policy/disclaimer_text/versions + admin-web 版本化管理页（保留紧急热修通道）+ 存量五类迁移为 v1 + 六处备份名单同步。生产实测：list count=5 / versions 快照五类=1 / export_collection total=5。授权与风险知悉见 [legal-compliance-1a-authorization-20261025.md](legal-compliance-1a-authorization-20261025.md)。
> - **1b（待提审通过后）**：`user-login` 版本下发 + 重签机制、C 端 agreement/privacy 动态化、通用免责接通 —— 会改变审核员可见行为，须递增小程序版本号（v1.6.38）。

### 5.1 批 1 存量迁移与兼容步骤（v2 新增 · 自含性修复）

1. **存量文本初始化**：上线脚本从 `admin_config.legal` 当前 6 字段各生成一条 `legal_doc` v1（status=published，effective_at=上线时刻，remark='存量迁移'）
2. **存量用户基线**：已注册用户首次登录时统一按「已同意 v1」处理——补一条 consent（doc_version=v1，scene='migration_baseline'，备注非主动勾选），此后版本变更正常走重签
3. **config 双写兼容期**：发布动作同时写 legal_doc + 回写 admin_config.legal_*（防旧客户端/实名签署链路断粮）；收口条件 = 小程序最低版本要求 ≥ 本方案发布版本后，D3 拍板移除
4. **顺序纪律**：先服务端（新 action + config_public 扩展）部署，后前端上传——遵守接口契约变更顺序惯例

## 6. 验收口径（批 1）

> 前提核查：「30s 可见」依赖 config_public 无缓存/短缓存——实施第一步先查该端点缓存逻辑（专家 B 提示），若有缓存则验收窗口改为「缓存过期后可见」。

1. 后台改服务协议→发布→C 端协议页可见新版本号+新内容（断网兜底显示旧硬编码版本）
2. 新用户登录→勾选→audit_log 可查到 consent 记录 {openid, doc_type, version, content_sha256}（category='consent'）
3. 已同意 vN 的老用户，协议升 vN+1 后**下次登录**强制重签；token 有效期内不强制踢出
4. 发布页通用免责弹窗出现且确认有取证
5. 隐私政策页从云端渲染出真实内容（现状全链路无分发的缺口闭合）
6. 存量迁移：上线后 legal_doc 各 doc_type 有 v1 published 记录；老用户登录不触发重签（v1 基线）
7. 全门禁绿（npm test + A/B + 三静态）；新增集合入三处名单（raw-export/manual-backup/admin-action EXPORT_COLLECTIONS）——B-3 纪律

## 7. 决策点（2026-10-25 用户已拍板）

- **D1 ✅** consent 取证**复用 audit_log**（writeAudit category='consent'，不新增集合）——用户拍板
- **D2 ✅** 重签策略**仅登录时**（token 有效期内不校验，下次登录生效）——用户拍板
- **D3** 双写兼容期收口：默认条件已写入 §5.1.3（小程序最低版本要求提升后移除），届时再拍板
- **D4** 批 2 举报工作台：默认独立立项，届时再拍板

---

## 附录：双专家评审结论（v1 → v2 修正记录）

**专家 A（事实核验）——2 处事实修正，均经主对话读码 2/2 证实：**

| # | v1 声明 | 修正后 |
|---|---|---|
| A1 | 「legal_service_agreement/privacy 在小程序零消费」 | **过重**。实名签署链路已消费服务协议+AA承诺书（云端优先+DEFAULT 兜底+签名时服务端全文 SHA-256 留证），见 `user-login/index.js:126-143`；真实零消费的是 privacy_policy 展示分发与通用免责声明 |
| A2 | 「同意取证无」 | **过重**。实名签署已有签名+SHA-256 留证；缺失的是登录勾选取证、版本化重签、发布免责取证 |

**专家 B（完整性/偏离）——采纳 3 项：**

| # | 发现 | v2 处置 |
|---|---|---|
| B1 | config_public 仅吐 legal_public 三项（service_agreement/aa_promise/pet_authorization），不含 privacy_policy/disclaimer，且无版本号 | §3.2 扩展项明确「补齐两项+version」；privacy_policy 无分发升格为批 1 最尖锐缺口 |
| B2 | 验收「30s 可见」未核查 config_public 缓存逻辑，可能空想 | §6 增前提核查；新增验收 #5（隐私分发闭合）、#6（存量迁移） |
| B3 | 自含性不足：缺存量迁移步骤 | 新增 §5.1（文本初始化 v1 / 存量用户基线 / 双写收口 / 先服务端后前端顺序） |

**反向假设处置：** ①config_set 直改旧字段绕过版本化 → 兼容期视为「紧急热修通道」，允许但热修不产生版本，下次正式发布收编进 legal_doc（记录于 §3.1）；②用户清缓存拒上报 → consent 尽力而为+下次登录重签兜底（§2 原则 3）；③超长文本 → config_set 既有 20KB/8KB 上限沿用，C 端渲染兼容留实施时验证。

**未竟事项：** 专家 B 四类审查（遗漏/矛盾/误导/自含）完整结论未返回（子代理输出截断），遗漏维度由主对话按合规域清单补齐为 §4.5；本方案定稿后欢迎用户对 §4.5 再挑错。

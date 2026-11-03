# 技术评审报告 · 找人帮忙（2026-11-03）

> 评审性质：纯评审类会话（零代码改动）。按 `project-rules-core.md` §9 会话存档纪律落盘。
> 评审方式：`zhaoren-tech-review` 双代理交叉评审 + 主审实测裁决（2/2 才立项，1/1 由主审读码裁定）。

---

## 一、目标

对「找人帮忙」微信小程序（原生 miniprogram + 微信云开发 CloudBase）**整体技术状况**作独立专家评价，覆盖：架构合理性、代码质量、数据与安全、运维与工程治理、提审风险；并给出按投入产出排序的处置建议。

**边界**：只读评审。不修改业务代码、不部署、不提交代码（本报告本身为 docs 制品）。

---

## 二、结论

**总评：可提审 MVP，接近生产级。** 工程治理体系（规则 / 台账 / 门禁 / 部署核验链）明显强于同规模个人项目；主要短板是结构性债而非可用性缺陷：

1. **共享代码多副本 + 靠 SHA 门禁防漂移**，门禁只拦「已登记文件被改动」，拦不住「未登记/改名副本」；
2. **静默吞错（空 catch）密度高**（台账在册 163 处），资金与审计路径上存在跳过预检的写法；
3. **少数巨型文件**（`admin-action/index.js` 同时承载鉴权、RBAC、schema、分发表）；
4. **管理后台共享密钥是单点**（`admin_web_key`），泄露即可伪造代理 openid —— 属设计取舍，非逻辑缺口。

**专家 A 与主审对成熟度定位一致；A 有 2 条初判被主审证伪（见第五节）。**

---

## 三、证据（命令与实测值）

| # | 取证动作 | 实测值 |
|---|---|---|
| 1 | `npm.cmd run verify:offline`（本日 docs 提交前基线） | **EXITCODE=0**；`A/B EQUIVALENT: 452 cases (237 explicit + 215 auto; 74 known-evolution)` |
| 2 | 云端回读 `order_main` / `partner_profile`（dump → NDJSON → 本地解析，仅只读） | `order_main` 286 条；目标单 `20261103889552403266` 状态 `S2` |
| 3 | `confirm_comm` 订阅消息日志 | **2 条 `{channel:'cloud', status:'ok', errCode:''}`**（北京 21:50:34 / 21:51:09），全库无失败 |
| 4 | 订阅额度计数（`partner_profile` `oL…V2LPA4`） | `granted_count=5 → sent_count=2`，与日志条数一一对应 |
| 5 | 微信端实收（用户真机截图 2026-11-03 21:51） | 「服务通知」中出现「上门时间变更通知」（服务名称「对方修改了「时间」」/ 原上门时间 `2026-11-03 21:51`） |
| 6 | 主审实读 `payment-mock/action_pay.js` | 金额全程 `*_fen` 整数（`fund.paid_fen`），无浮点；`S0→S2` CAS 抢占 + `pay_transaction` 幂等 + `is_mock` 审计 |
| 7 | 主审实读 `admin-action/index.js` L96-105 / L555-565 | 代理 key 不匹配 → 回落 `resolveOpenid`（fail-closed）；会话读取失败 → `bad_token` 拒绝；账号非 `active` → 拒绝 |
| 8 | 主审实读 `miniprogram/utils/cloud.js` 头部 + `app.js` L58-66 | 注释写「单次超时 6s」，实际 `timeout = opts.timeout \|\| 12000`（2026-10-27 6s→12s）→ **注释过时，非代码缺陷** |
| 9 | `git log` / 反查工作区 | 评审起点 HEAD `58f925b`（= origin/master，ahead 0，工作区干净） |

> 注：本轮未做 `tcb fn log` 通道取证（该通道历史上对该项目不可用，对照组同样为空），订阅链路改为「库内日志 + 微信端实收」双向实证。

---

## 四、专家评审正文

### 4.1 专家 A（结构性问题猎手）

**问题表**（置信度为 A 的原判，修正见第五节）：

| # | 类别 | 问题 | 证据 file:line | 影响面 | 置信度 |
|---|---|---|---|---|---|
| 1 | 安全 | 后台两级鉴权已收敛（网关 `X-Admin-Key` + 代理 key 透传 + `admin_openids` 白名单 + 会话 token），但**共享密钥是单点**：key 泄露即可伪造代理 openid | `cloudfunctions/admin-web/index.js` L114-118、L216-230；`cloudfunctions/admin-action/index.js` L96-104；`cloudfunctions/init-db/index.js` L181-198 | 管理后台入口、代理链路 | 高（**主审修正为「中」**） |
| 2 | 安全 | RBAC 依赖 `ROLE_GRANTS` 白名单，未声明的敏感 action（`export_*` / `config_set` / 账号管理 / force 类）默认仅 R1；角色解析依赖 `__admin_token` 会话 | `cloudfunctions/admin-action/index.js` L18-62、L549-573 | 越权执行、敏感配置与导出 | 高（**主审部分证伪**） |
| 3 | 可靠性 | 多处错误被空 catch 吞掉：登录/登出的内部审计或告警写失败不影响主流程；配置读取失败走默认值 | `cloudfunctions/admin-web/index.js` L240-255；`cloudfunctions/payment-mock/action_pay.js` L58-67 | 故障掩盖、排障成本 | 中 |
| 4 | 性能/额度 | `admin_config.global` 读取曾占 DB 请求 23.6%，现由 `_shared/config_cache.js` 进程内 30s TTL 缓存缓解；代价是配置变更最晚 30s 生效、读失败走默认值 | `cloudfunctions/_shared/config_cache.js` L2-45；`cloudfunctions/partner-action/index.js`、`cloudfunctions/order-timer/index.js` | CloudBase 配额、配置时效、兜底行为 | 高 |
| 5 | 门禁盲区 | `check-shared-sync.js` 用 SHA 校验 `_shared` 规范源与各函数副本，并检测未登记共享文件/改名副本；但依赖「副本目录存在 `index.js`」来识别消费方，未登记副本仍可能逃逸 | `scripts/check-shared-sync.js` L12-64、L104-133 | 共享规则/工具漂移、A/B 覆盖可信度 | 高 |
| 6 | 架构 | 云函数入口「巨型 `if (action===...)` 分发」与 `action_*.js` 拆分并存；`admin-action/index.js` 同时含鉴权、RBAC、配置 schema、分发表与 handler 注入 | `cloudfunctions/admin-action/index.js` L1-5、L507-580 | 可维护性、新增 action 权限一致性 | 中 |

**A 的「值得肯定」**：管理面鉴权收敛为多层校验并记 `gateway_bad_key` 事件；`check-shared-sync.js` SHA 同步门禁；`config_cache.js` 用量治理；`check-cloud-timeout-policy.js` 强制超时与错误态顺序；`_shared/sub_msg.js` 统一一次性订阅计数与入口。

### 4.2 专家 B（定点抽查）

> **如实说明**：B 两轮输出均只返回「相关代码位置清单」，未成文抽取结论，其抽查表未形成；改由主审对同类对象逐项实读补位（下表「主审补位」列）。

| 抽查对象 | 结论 | 证据 |
|---|---|---|
| `payment-mock` 金额单位 / 幂等 / mock 标记 | **好** | `action_pay.js` L57-96：`S0` 校验、超时、AA 承诺书、`S0→S2` CAS、`fund.paid_fen` 整数、`pay_transaction` 幂等、`is_mock` |
| `_shared/order_state.js` 状态机 | **好**（A + 片段双重证据） | L112-147 迁移表、L154-180 `transitionFor/canTransition/transitionAllowed` 白名单拦截，与规则附录 A 的 13 态/合法流转一致 |
| `admin-action` 鉴权与写操作 | **好** | L18-62 `ROLE_GRANTS`；L529-573 统一鉴权（openid、白名单、mock admin、token 会话、账号状态、角色门控）|
| `user-login` 手机号链路 | **好** | `index.js` L98-124：`_shared/phone_crypt.js` 加密 + `phone_hash`，写库前移除明文 `phone` |
| `miniprogram/utils/cloud.js` 调用封装 | **中**（仅注释） | L1 注释「6s 超时」与实际 `app.js` L66 `timeout=12000` 不符 |

**工程治理抽查**：`scripts/gate.ps1` 串联 8 道门禁（nightmask / SSOT / 语法 / shared sync / 单测 / index ledger / smoke / heartbeat），`scripts/check-cloud-timeout-policy.js` 校验默认读超时 ≥12s 与错误态顺序 —— 两者均有可失败判据，**非「永远通过」的假门禁**。

---

## 五、验证者修正（评审初判被证伪项）

| 原判 | 主审实测 | 修正后口径 |
|---|---|---|
| 代理链路「key 未正确传递即可绕过审计」（高） | `admin-action/index.js` L96-105：`__admin_web_proxy` 分支要求 `proxyKey === storedKey`，不匹配/为空即回落规范 `resolveOpenid` | **降级为「中」**：仅剩共享密钥泄露这一固有单点风险，非逻辑缺口 |
| 会话「过期/禁用判断 catch 后继续」是脆弱点（高） | L555-565：`catch(() => null)` → 判 `bad_token` 拒绝；账号读取失败 → `acc=null` → 拒绝 | **证伪**：fail-closed，写法正确 |
| B 侧「`cloud.js` 6s 超时」疑似配置缺陷 | 实际委托 `app.cloudCall`（12000ms），仅文件头注释未同步 | **降级为 P4 注释问题**，不影响运行时 |

> 记录目的：单轮评审（含 AI 评审）的初判会出错；影响面描述错会直接导致错误定级，故本报告保留修正前后口径。

---

## 六、处置建议（按投入产出排序，仅建议，未经批准不动手）

| 优先 | 项 | 成本 | 建议时机 | 风险 |
|---|---|---|---|---|
| 1 | `miniprogram/utils/cloud.js` 文件头「6s」更正为 12s（**纯注释，位于 `// @VERIFIED` 区**，须用户书面批准） | 1 行 / 1 文件 | 解冻后首批 | 极低 |
| 2 | 共享副本漂移：把 `check-shared-sync.js` 的「未登记副本」由告警升为失败（与 §35 门禁精神一致） | 小 / 1 文件 | 解冻后 | 低（可能立刻暴露存量漂移，需预留清理窗口） |
| 3 | 空 catch 分级治理：资金/审计相关 catch 至少 `log.w`，其余保持不动 | 中 / 多处 | 分批 | 中（触碰面较广，须逐个评审） |
| 4 | `admin-action` 继续按 action 物理拆分（`cloud-function-split` skill，零行为变更） | 中 | 提审后 | 中（重构类，避开冻结期） |

**不建议现在做的**：`config_cache` TTL 调整（当前 30s 已是有意的配额取舍，且配置变更有时效说明）、支付链路任何"优化"（mock 期间无收益、触碰资金红线）。

---

## 七、改动与提交

| 项 | 内容 |
|---|---|
| 业务代码改动 | **无**（本轮评审零代码） |
| 新增文档 | 本文件 `docs/session-log/20261103-tech-review.md` |
| 关联已提交（同日早前） | `b0e5c6c`（`confirm_comm` 早退留痕）、`55dc79d`（取证回填）、`58f925b`（P0-5②-B 结案台账） |
| 是否已提交 | 提交前需用户单独授权（冻结期 §3 纪律：commit / push 单会话、不继承） |

---

## 八、未决项

1. **评审建议 1-4 均未立项** —— 等你选择（①只做 1 / ②1+2 / ③全部排期 / ④一项不做只留档）。
2. **REGISTRY 真机待验**：#141（P3-23① 北京时间 +8）、#142（P3-23② S2 到点文案）——承载于体验版 **v1.6.80**，故 P0-1 的「待真机 0 条」口径**已不成立**，下次核对按 2 条计（本报告未擅自改动该台账行）。
3. **专家 B 未成文**：如需补齐其独立抽查表，可再次派单（耗时一轮）。
4. **提审冻结期约束**：建议 2/3/4 均属代码或门禁改动，只能落在「解冻后首批」窗口。

---

## 九、下次入口

- 待办主线：`docs/HANDOFF-20261103.md`（T-8.1~T-8.8、T-7.x）；配额恢复（11-05）后的 T-7.30 触发器恢复、P3-12 / P3-15 索引与清理。
- 若批准本报告建议：先出「先说后做」改动清单（根因 file:line + 影响面 + 风险等级），再动手。
- 本报告可被后续评审直接引用；如与代码现状不符，以「云端回读 > 仓库台账 > 本报告」真值优先级裁决。

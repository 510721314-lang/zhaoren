# 找人帮忙项目技术负债清单（现行台账 · 2026-11-23 建立，2026-11-26 订正）

> **盘点日期**：2026-11-23（HEAD `f126bb76`，verify:offline EXIT=0）；计数 2026-11-26 就地刷新
> **现行唯一台账**：本文件（tech-debt-inventory-20261123.md，真值所在）；[tech-debt-inventory-20261105.md](tech-debt-inventory-20261105.md) 已降为历史归档（内容已过时 P3-1=200/P3-38=549，勿以其为真值）
> **本文件性质**：现行唯一台账（未闭合项全貌 + 关键计数 + 真值所在）

---

## 关键计数（2026-11-26 实测）

| 项 | 值 |
|---|---|
| `verify:offline` | EXIT=0 / A/B **473 EQUIVALENT** / 1263 用例 0 fail / 110 known-evolution |
| `_shared` 同步门禁 | ALL OK |
| 空 catch 基线 | **200 处**（C 类有意设计 190 / B 类 10 维持不修；2026-11-26 刷新对齐活水位，baseline generated_at=2026-11-25，原基线 204） |
| 体验版 | **v1.6.25**（HEAD `966f009b`，已推送，deploy-log 实证；包体 891.6KB / 主包 680.5KB < 2MB） |
| 规则配额 | inject 17733B / 余量 1723B / max§ 46（check-rules-size 实测；targetBytes 19456，P3-47 三期门禁守护） |

旧值（2026-11-05 已过时）：A/B 456 / 79 known / 67/67 / 155 处空 catch。

---

## 未闭合 9 项全貌（HANDOFF-20261122-b §7 确认口径，+P3-47/P3-48 于 2026-11-26 登记）

| # | 负债 | 分类 | 证据 | 影响 | 状态 | 触发条件 |
|---|---|---|---|---|---|---|
| **P3-1** | 空 catch 基线 200 处（A 高危 4 已修 / B 批 1/2/3 共 50 已修 / C 有意设计 190 不修 / B 剩余 10 维持不修） | 卫生/安全余量 | `scripts/silent-catch-baseline.json`（路径已从 _shared 迁至 scripts）；基线 254→200（2026-11-26 刷新对齐活水位：generated_at=2026-11-26，增量门只增不减） | 资金链/通知链已收口；前端批 4（~190 处容错类）2026-11-17 裁定不修 | 已分级维持 | B 类剩余 10 处「触碰对应函数时顺带修」 |
| **P3-14b** | `bootstrap.js` take 链 `navigateTo` 的 `fail: () => {}` 静默 | UI/跳转兜底 | `miniprogram/utils/bootstrap.js` take 链内 | 栈满仅丢一次跳转 | **已批准零代码豁免** | 触碰该文件时同修 |
| **P3-26** | 单号/流水号日期前缀旧 UTC getter | 时区 | 原 `payment-mock/index.js:46` / `order-create/index.js:123` / `demand-publish/index.js:187` / `admin-action/index.js:237` | 北京 00:00–07:59 建单前缀为前一日 | **✅ 已修并部署（2026-11-09）**；云端实证 2026-11-13 凌晨 3 条 + **2026-11-25 复测 order_main 修复后（≥11-09）凌晨建单 5/5 前缀全部匹配北京时间**（修复前 14 条仅 8 条匹配，旧 bug 对照） | **已验证（云端实证）**；真机抽验可选（低优先级） |
| **P3-38** | `confirm-flow.js` 545 非空行（总 566 行）≈ chat.js 670 的 81%，逼近巨页阈值 | 结构性 | `miniprogram/utils/confirm-flow.js` 545 非空行（2026-11-25 实测，原台账 549 已过时） | 继续堆叠会重现巨页问题（换文件） | **登记不动作（2026-11-12 双代理 B#4）** | 文件膨胀至 700+ 行 / 阶段 B 前评估 |
| **P3-44** | 规则配额门禁无 §-级字节预算 | 配额治理 | `scripts/check-rules-size.js` 加单节字节门禁（2026-11-25） | 单章节可无界膨胀 | **✅ 已实现（2026-11-25）**：单节 >targetBytes 50% warn / >80% fail；当前最大节 §9=7504B < 水位 8704B，0 误报 | 单节超水位时下沉归档 |
| **P3-45** | 规则降级为技能的规避路径未登记 | 配额治理 | 技能/记忆/docs 不计量 | 紧急变更可能被「降级」规避配额 | **已加下沉登记表（2026-11-25，见下方附表）** | 新增规则下沉必须登记；发现未登记下沉视为规避 |
| **P3-46** | 「支付提醒」订阅链仅 Android 单端真机验证 | 真机补验 | REGISTRY #171 | iOS 锁屏通知/点击路由未实证 | **有 iOS 条件时补验** | 待 iOS 测试设备 |
| **P3-47** | 台账头部指针可指向过时归档 + 关键计数可与真值脱节（专家评审 6.2） | 台账治理 | 头部声明行首个匹配的台账文件名 ≠ 自身（6.2 同类：1105 已降归档曾被头部引用致口径脱节）；或头部「关键计数」表数值与实测不一致 | 读者/脚本以过时台账为真值，计数与处置全错 | **✅ 已实现（2026-11-26）**：`check-tech-debt-header.js`（verify + verify:offline 双挂）；一期指针 [NO-DECL]/[STALE-POINTER] FAIL；二期计数对齐 [COUNT-DRIFT]/[MISSING-COUNT]/[UNPARSEABLE]/[TRUTH-MEASURE-FAILED] FAIL | 9 项自测全过 + verify:offline 全链绿；二期守护 A/B 总数+known（spawn ab_equivalence 解析 stdout）/ 用例总数（test-manifest 求和）/ 空 catch 总数+generated_at（silent-catch-baseline）/ 体验版版本号（deploy-log 最后一条）；A/B spawn 使 verify 每次 +约 7s；未守（截至二期）：配额余量（check-rules-size 已守，但台账内部声明值无门禁守护——2026-11-26 二次实测发现漂移 2110B→1723B 未拦截，实证见台账 L79）、体验版 HEAD 哈希；**三期已实现（2026-11-26）**：扩展守护 ⑦体验版 HEAD 哈希（deploy-log 最后一条体验版行 col3）+ ⑧规则配额余量/max§（spawn check-rules-size 解析 stdout），漂移/缺行/测量失败均 FAIL；5 项三期自测全过 + verify:offline 全链绿；**HANDOFF 快照不回改**：历史 HANDOFF 中 inject/余量/HEAD/max§ 等计数为生成当时实测快照，不作现行真值，不予回改；现行真值以 tech-debt 台账头部「关键计数」表 / CHANGELOG 为准 |
| **P3-48** | 含中文 .ps1 缺 UTF-8 BOM 致 PS5 ParserError（专家评审 6.6） | 编码/部署 | `scripts/check-ps1-bom.js`；全仓 40 .ps1 dry-run 实测 6 处违规 | PS5 下含中文脚本静默解析失败，sync/backup 链路中断 | **✅ 已实现门禁 + 修 6 处存量（2026-11-26）**：缺 BOM 且含非 ASCII → FAIL [BOM-MISSING]（纯 ASCII 缺 BOM 不强制，避免 15 个生成型 sync-*.ps1 误报）；已修 backup.ps1 + sync-{audit,credit-rules,heal,money-rules,partner-audit}.ps1 | 生成型 sync-*.ps1 源头补 BOM（待 sync 生成脚本改造） |

### P3-45 规则下沉登记表（配额腾挪可审计，2026-11-25 建立）

> 配额腾挪 SOP 允许将规则细则「下沉」到技能/项目记忆/归档（不占 INJECT 注入桶），但**必须登记**：core 留指针、归档正文被引用（防 `[ORPHAN]`）、配专项门禁。未登记的下沉视为规避配额。

| 规则章节 | 核心摘要（占注入桶） | 正文/细则落点（不计量） | 专项门禁 | 登记日 |
|---|---|---|---|---|
| §37 桌面控制纪律 | core 仅留指针 | archive `project-rules-full-20261029.md` §37 + 技能 `zhaoren-desktop-control` | `check-no-desktop-injection.js`（verify + verify:offline 双挂载） | 2026-11-02 |
| admin-web 前端上线闭环四件套（E-6.63） | core 不进（inject 余量 3B，零净增） | HANDOFF-20261125 §6 E-6.63 + project_memory「admin-web 部署闭环四件套」+ 技能 `powershell-windows-traps` 陷阱 17/20 | `check-admin-web-live.js`（TOOL 类，check-gate-mounts 已登记，部署后手动跑，不进 verify/offline/predeploy 链） | 2026-11-25 |

---

## 已决策/有意保留（不属技术债）

| 分类 | 项数 | 关键 |
|---|---|---|
| P1 有意保留 | 3 | P1-3 `start_photo`（零调用）、P1-4 `hall_list`（下线留提审后）、P1-5 MVP 禁做项（短信/人脸/mock 现金 → 2026-11-15 移入后期） |
| P1 决策保持 | 1 | P1-6 `realname_face_mode=mock`（提审期临时放宽，真实核身提审后立项） |
| P2 决策关闭不拆 | 2 | P2-4 `_shared` 多副本（门禁已守）、P2-14 三大巨页（1386/1081/1078，2026-11-08 用户裁定） |
| M 区登记不修 | 2 | M7 admin-action 裸浮点 total_yuan（无实害）、M8 baseline 冻结旧 Math.round（禁止据此回滚） |
| B 备份有意接受 | 3 | B-1 加固后未实跑、B-2 lark 异地、B-4 飞书远端清理人工月度 |

---

## 已偿还/已结案（清零计数）

| 分类 | 项数 |
|---|---|
| P0 提审阻断类 | 5 全部结案（P0-3 触发器额度 112 次/24h，2026-11-06） |
| P1 | 4 已偿还/核实 |
| P2 | 12 已偿还/自动化 |
| P3 | **56/63 已结案/已偿还**（A 类高危 4 + B 类批 1/2/3 共 50 空 catch；P3-3 手机号加密三批次；P3-8 系统超时补 complaint；P3-26~36/B 扫描全修；P3-51~63 全仓扫描 11 项全修；金额 M1~M5 已修） |
| N 本会话 | 5 全偿还 |
| C/D/F 专家核验 | 11 已修/已裁 |

---

## 与 HANDOFF §7 待办对应

| 技术债 | HANDOFF | 说明 |
|---|---|---|
| P3-1 前端批 4 不修 | T-9.7 | 空 catch 分类治理（提审后建议） |
| P3-26 / P3-46 | T-14.2 | iOS 真机补验挂账 |
| P3-38 | T-9.12 | 真实支付上线前 extend_confirm 资金位 |
| P3-44/45 | X-14/X-15（已关闭） | 规则配额余量见头部「关键计数」表（P3-47 三期已守护，单一真值源，本处不再重复声明数值；targetBytes 已上调 17408→19456，原 3B 告警已消除） |
| P1-6 | T-19.1 | 实名 mock→wx 切换（依赖 T-7.3 资质） |
| P1-5 青少年限额 age 缺失 | T-7.3 | 随真实核身回填 age 一并处理 |

---

## 台账维护纪律

- **现行唯一**：`tech-debt-inventory-20261123.md`（本文件），头部计数就地刷新
- **历史归档**：`tech-debt-inventory-20261015.md`、`tech-debt-inventory-20261105.md`（口径已过时，勿作真值）
- **快照归档**：无（本文件即现行台账，不再另设快照）
- **真值优先级**：云端回读 > 现行台账 > CHANGELOG > 助手记忆
- **处置后**：更新现行台账状态 + 日期 + 证据，同步 CHANGELOG / REGISTRY / deploy-log
- **新增编号前**：grep 现行台账全文防复用（2026-11-17 曾复用 P3-37/38/39 致歧义）

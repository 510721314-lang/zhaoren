# 需求「标题 / 详细描述」字数上限：后台可配 + 服务端分别校验

## Context（为什么做）

用户新需求：**发布需求时「需求标题」与「详细描述」的字数上限要能在后台管理配置**。

现状与冲突：
- 上一轮（今日）刚把「**整串** `remark = 标题｜描述` ≤ **200**」这一个总闸做成后台可配（`publish_remark_max_len`，REGISTRY #95，已部署 + 前端 1.6.18 已上传）。
- 但**服务端并无独立的标题/描述字段**：发布只收 `remark` 整串，标题是展示时按全角「｜」拆出来的（`action_query.js:67` 的 `remarkParts[0]`）。因此「标题、描述各自可配并各自校验」**必须先让服务端拿到这两段**。
- 用户已裁定三点：① 前端**新增分别上报** `title` / `description`（**保留 `remark`** 兼容旧客户端与落库）；② **改为两键、废弃总闸** `publish_remark_max_len`；③ 默认值/范围：标题 **20**（5–60）、描述 **200**（50–1000）。

目标：后台可分别配置标题/描述上限；服务端**分别校验**；落库与展示口径**保持不变**（仍存 `remark = 标题｜描述`）。

---

## 改动清单

### A. 服务端（云函数 demand-publish）
| 文件 | 改动 |
|---|---|
| `cloudfunctions/demand-publish/index.js` | 删除 `REMARK_MAX_LEN` 兜底常量与 `remarkMaxLen(config)`，改为两个读取函数（仿既有 `contentOptionsMax(config)` 写法）：`titleMaxLen(config)`（`>=5` 才取用，否则回落 **20**）、`descMaxLen(config)`（`>=50` 才取用，否则回落 **200**） |
| `cloudfunctions/demand-publish/index.js`（ctx 注入处，`REMARK_MAX_LEN→remarkMaxLen` 所在行） | ctx 注入改为 `titleMaxLen, descMaxLen` |
| `cloudfunctions/demand-publish/action_publish.js:5` / `action_update.js:5` | 解构 `remarkMaxLen` → `titleMaxLen, descMaxLen` |
| `action_publish.js:8` / `action_update.js:7`（event 解构块） | 新增接收 `title`、`description`（可选） |
| `action_publish.js:325-334` / `action_update.js:164-172`（校验块） | 改为：<br>① `titleStr`/`descStr` 非空 → 分别判 `publish_title_long`「需求标题最长 {t} 字」/ `publish_desc_long`「详细描述最长 {d} 字」；**服务端拼回** `remarkStr = titleStr + '｜' + descStr`；<br>② 两者皆空（**旧客户端**）→ 沿用 `remark` 整串，判**派生总上限** `titleMax+1+descMax`，错误码沿用 `publish_remark_long`「备注最长 {total} 字」；<br>③ `remarkStr` 非空 → `checkText` 保留不变 |
| `action_publish.js:409` / `action_update.js:218` | 落库仍是 `remark: remarkStr`（**零变化**，展示/检索口径不变） |
| `_orig_baseline.js` | **禁改**（§10 / C-3.5） |

> 错误码：新增 `publish_title_long` / `publish_desc_long`（旧码 `publish_remark_long` 专留兼容路径），前端一律显示服务端原文案。

### B. 后台配置（云函数 admin-action）
| 文件 | 改动 |
|---|---|
| `cloudfunctions/admin-action/index.js` `CONFIG_SCHEMA`（「发布与展示」组） | **删** `publish_remark_max_len` 一项；**增**两项：`publish_title_max_len`（int/min **5**/max **60**/def **20**/label「需求标题字数上限」）、`publish_desc_max_len`（int/min **50**/max **1000**/def **200**/label「详细描述字数上限」）；`config_set` 的通用 int 校验与 `resolveOperations` **自动纳入**，无需另改代码 |
| `cloudfunctions/admin-action/action_config_public.js`（`publish` 组） | `remark_max_len` → 改为 `title_max_len` + `desc_max_len` |

> 存量 `admin_config.global` 从未写入 `publish_remark_max_len`（一直走默认），**无需数据清理**；`config_public` 不再下发该键即可。

### C. 前端
| 文件 | 改动 |
|---|---|
| `miniprogram/config/index.js` | 删 `REMARK_MAX: 200`；保留 `TITLE_MAX: 20`；**恢复** `DESC_MAX: 200`（标题/描述各自兜底） |
| `miniprogram/utils/bootstrap.js`（CLOUD_MAP） | `'publish.remark_max_len': 'REMARK_MAX'` → 改为 `'publish.title_max_len': 'TITLE_MAX'` + `'publish.desc_max_len': 'DESC_MAX'` |
| `miniprogram/pages-v2/publish/publish.js` data | `titleMax: CONFIG.TITLE_MAX`、`descMax: Number(CONFIG.DESC_MAX) \|\| 200` |
| `publish.js` `_remarkBudget`/`_clampRemark`/`onTitleInput`/`onDescInput` | **撤掉整串耦合预算**，改回各自独立上限：`onTitleInput` slice `CONFIG.TITLE_MAX`、`onDescInput` slice `CONFIG.DESC_MAX`；保留一个薄 `_clampText()`（按各自上限夹紧 title+desc）供**草稿恢复**调用（旧草稿描述可能达 500 > 新默认 200，仍须夹紧） |
| `publish.js` 提交 payload（`:947` `remark:` 行） | 保留 `remark: ${title}｜${description}`；**新增** `title: f.title`、`description: f.description` |
| `miniprogram/pages-v2/publish/publish.wxml` | **零改**（计数已绑 `{{titleCount}}/{{titleMax}}`、`{{descCount}}/{{descMax}}`） |

### D. 测试（`cloudfunctions/_shared/demand-publish.entry.test.js`）
改写上一轮新增的 4 例为**本模型**，并按 §10 补齐成功路径与兼容路径：
1. 标题超默认上限（21 字）→ `publish_title_long`「需求标题最长 20 字」
2. 描述超默认上限（201 字）→ `publish_desc_long`「详细描述最长 200 字」
3. 后台覆盖：`publish_title_max_len=5` → 6 字标题拒；`publish_desc_max_len=50` → 51 字描述拒（**证明可配**）
4. **限内 → publish 成功穿透落库**，断言 `writes.demand[0].data.remark === '标题｜描述'`（服务端拼回口径）
5. **旧客户端兼容**：只传 `remark`（≤221）→ 成功；222 字 → `publish_remark_long`
6. update 侧（`publish_title_long`/`publish_desc_long` 之一）

`ab_equivalence.js`：预期**仍无需** `KNOWN_EVOLUTION`（A/B 夹具 `dp_publish_ok` 既无 `remark` 也无 `title/description` → 两侧同走分支；默认值不变）——以实跑为准。

### E. 台账/文档
- `docs/FUNCTION-REGISTRY.md`：**新增 #96**（本次两键模型）；并在 **#95 行追加标记**「→ 2026-10-18 被 #96 取代（总闸 `publish_remark_max_len` 废弃）」、#95 状态改「已废弃」→ 待验证计数仍为 **30**（29 + #96，#95 移出）。
- `docs/CHANGELOG.md`、`docs/deploy-log.md`：登记变更与部署证据。
- `docs/dev-manual/03-data-model.md` 配置键表：「发布与展示」组 `publish_remark_max_len` → 换为 `publish_title_max_len, publish_desc_max_len`。
- `tests/full-link-cases.md`：TC-10a / n08 口径再订正（现为「标题/描述各自可配」，`publish_remark_long` 仅用于旧客户端整串兜底）。
- `docs/HANDOFF-20261018.md`：T-0.6.4 的 ID 全集追加 `96`（计数不变），并在 T-7.x 记录本次取代 #95。

---

## 不做 / 边界
- 不改落库结构（仍 `remark` 整串），不改展示/检索逻辑，不做历史数据回填。
- 不删 `_orig_baseline.js` 中的 `REMARK_MAX_LEN`（冻结）。
- 不改 `publish.wxml`；不改其他页面。
- 已知影响：旧客户端（1.6.18）产出上限仍 200 < 派生总上限 221 → 兼容路径永不误拒。

## 风险与合规
- 风险**中高**：改**接口契约**（新增两个上报字段）+ 废弃上一轮刚上线的键 + 前端需再上传一次。
- **部署顺序（与 E-6.1 反向，必须遵守）**：**先部署云函数（新），再上传前端**——否则新前端可产出「标题20+描述200=221」而被**旧服务端 200 总闸**拒（短暂窗口）。旧前端在**新服务端**下走兼容路径（≤221），不会被拒。
- §14：前后端**两个 commit 分离**；错误码语义变化需在 CHANGELOG 写明（`publish_remark_long` 降级为兼容路径专用）。
- §10：A/B 锚点不刷新；如实跑出现差异必须登记 `KNOWN_EVOLUTION` 并配独立断言（预期不出现）。
- 高危区自检：不碰 app.json / project.config.json / 状态机 / 资金 / 集合结构。

## 部署与回归验证

**工程侧（按序）**
1. `node --check` 各改动文件 → `npm run verify:offline`（含 519+ 单测、A/B）→ 期望 EXIT=0、A/B EQUIVALENT。
2. 服务端先 commit → `predeploy.ps1 -Deploy`（逐个）→ CLI **逐函数单独** `--names <fn> --remote-npm-install`（`demand-publish`、`admin-action`）→ **各自独立目录 download** SHA256 本地==云端（§12/§16）。
3. 前端 commit → `cli preview` 须 `EXIT=0 + ✔ preview`（C-4.4）→ **上传新版本（1.6.18 → 1.6.19）**。
4. 台账三件 + CHANGELOG + dev-manual + full-link-cases。

**需你人工/真机/后台**
| 序号 | 项 | 步骤 | 预期 |
|---|---|---|---|
| 1 | 后台两键可见可存 | admin-web「运营配置」 | 「需求标题字数上限」「详细描述字数上限」出现，默认 20 / 200，可存可读 |
| 2 | 标题上限随动 | 发布页标题填到上限 | 计数 `x/20` 到顶自动截断 |
| 3 | 描述上限随动 | 描述粘贴 400 字 | 截到 200，提交成功（不再弹「备注最长 200 字」） |
| 4 | 后台改值生效 | 把标题改 5 / 描述改 50 → 重进发布页 | 两计数分母随动 |
| 5 | 服务端分别校验 | 云端测试传 `title`=21 字 | `publish_title_long`「需求标题最长 20 字」；传 `description`=201 字 → `publish_desc_long` |
| 6 | 旧客户端兼容 | 云端测试只传 `remark`=222 字 | `publish_remark_long`「备注最长 221 字」 |
| 7 | 落库口径不变 | 云端测试传 title/desc | 落库 `remark = 标题｜描述`（展示拆分不变） |
| 8 | 编辑/草稿回归 | 编辑存量单、恢复旧草稿 | 回填正常；超新手限的旧草稿被夹紧 |

**回滚**：服务端重部署上一版；前端重传上一已上传版本；`_orig_baseline` 始终未动。

## 关键实现注意
- ctx 键完整性（§10）：`index.js` 提供键 ⊇ 两 handler 解构且实际使用的键——本次为 `remarkMaxLen → titleMaxLen + descMaxLen` 的**改名+换义**，两侧同步改，改后全仓 grep `remarkMaxLen` 应仅剩 `_orig_baseline.js`。
- 服务端**拼回** remark（而非信任前端传来的 `remark`），保证落库串与两字段一致、防不一致上报。
- 前端 `remark` 字段继续上报（兼容旧服务端），但**服务端以 title/description 为准**。

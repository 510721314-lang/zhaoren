# 需求备注字数上限：前后端口径对齐 + 后台可配

## Context（为什么做）

现象：发布需求时被弹「备注最长 200 字」（截图为用户实测）。

根因：**前后端对该字段的上限不同口径**——
- 服务端 `cloudfunctions/demand-publish/index.js:155` 硬编码 `REMARK_MAX_LEN = 200`，校验对象是**拼接后的整串** `remark = 标题＋全角「｜」＋描述`（`action_publish.js:327-329` / `action_update.js:165-167`）。
- 前端「详细说明」上限是 `miniprogram/config/index.js:19` 的 `DESC_MAX = 500`，界面右下角计数显示 `/500`，用户在 180–500 字区间输入时前端不拦、提交必被服务端拒。
- 即：**界面承诺 500，实际可用 ≈179**（200 − 标题 20 − 分隔符 1）。

目标（用户已拍板）：
1. **口径对齐**：采用「整串 ≤ N」语义（服务端校验对象不变，前端同步按整串卡）。
2. **后台化可配**：新增 admin_config 键 `publish_remark_max_len`，默认 200、可调范围 50–500。
3. 保持默认行为不变（默认 200 = 现网值），不改接口契约（仍上报 `remark` 整串）。

---

## 改动清单

### A. 服务端（云函数 demand-publish）
| 文件 | 改动 |
|---|---|
| `cloudfunctions/demand-publish/index.js:155` | `const REMARK_MAX_LEN = 200;` → 改为兜底常量 + 读取函数：仿 `contentOptionsMax(config)`（同文件 `:221-225`）新增 `remarkMaxLen(config)`：`Number(config.publish_remark_max_len)` 有限且 `>= 50` 则取用，否则回落 200 |
| `cloudfunctions/demand-publish/index.js:417` | ctx 注入把 `REMARK_MAX_LEN` 换成 `remarkMaxLen`（供 handler 解构） |
| `cloudfunctions/demand-publish/action_publish.js:5` | 解构 `REMARK_MAX_LEN` → `remarkMaxLen` |
| `cloudfunctions/demand-publish/action_publish.js:327-329` | `const limit = remarkMaxLen(config); if (remarkStr.length > limit) return { ok:false, code:'publish_remark_long', msg:`备注最长 ${limit} 字` }`（`config` 已在同作用域，见 `:316/:330`） |
| `cloudfunctions/demand-publish/action_update.js:5` | 同上解构替换 |
| `cloudfunctions/demand-publish/action_update.js:165-167` | 同上改为 `remarkMaxLen(config)`，错误码 `update_remark_long` 与文案保持 |
| `cloudfunctions/demand-publish/_orig_baseline.js` | **禁改**（§10 / C-3.5 冻结基线）|

> 错误码名 `publish_remark_long` / `update_remark_long` **保持不变**（§14：只收紧/放宽判定，不改码名，避免前端/文档断链）。

### B. 后台配置（云函数 admin-action）
| 文件 | 改动 |
|---|---|
| `cloudfunctions/admin-action/index.js:132` `CONFIG_SCHEMA` | 在「发布与展示」组（`:219-220` 附近）追加一条：`{ f:'publish_remark_max_len', t:'int', g:'发布与展示', label:'需求备注字数上限', unit:'字', min:50, max:500, def:200, d:'需求备注(标题＋描述)总字数上限' }` |
| `cloudfunctions/admin-action/action_config_public.js:94-105` | `publish` 组追加 `remark_max_len: cfgRaw.publish_remark_max_len !== undefined ? cfgRaw.publish_remark_max_len : 200` |
| `cloudfunctions/admin-action/action_config_set.js` | **无需改**：`:130-139` 对 `CONFIG_SCHEMA` 里所有 `t==='int'` 项统一做 min/max 校验与写入，新字段自动纳入 |
| `cloudfunctions/admin-action/index.js:248-258` `resolveOperations()` | **无需改**：按 schema 组装，新字段自动进 `config_get` 与后台表单 |

### C. 前端
| 文件 | 改动 |
|---|---|
| `miniprogram/config/index.js:18-19` | `DESC_MAX: 500` → `REMARK_MAX: 200`（整串上限；注释标明由后台 `publish_remark_max_len` 覆盖）。`TITLE_MAX: 20` 不变。全仓仅 publish.js 引用 DESC_MAX（已 grep 确认），一并改 |
| `miniprogram/utils/bootstrap.js`（`CLOUD_MAP` `:50-56` 区） | 追加 `'publish.remark_max_len': 'REMARK_MAX'`（与既有 `publish.share_title_max` 同批） |
| `miniprogram/pages-v2/publish/publish.js:122-123` | data 初始化：`titleMax: CONFIG.TITLE_MAX`、`remarkMax: CONFIG.REMARK_MAX`、`descMax` 改为按当前标题算出的**描述预算**（见下） |
| `miniprogram/pages-v2/publish/publish.js:624-631` | `onTitleInput` / `onDescInput`：以 `_descBudget(title) = max(0, CONFIG.REMARK_MAX - title.length - 1)` 为描述可输入上限；标题变长后**回压已填描述**并同步 `descCount`/`descMax`，保证 `标题＋1＋描述 ≤ N` |
| `miniprogram/pages-v2/publish/publish.wxml:60-66` | 计数绑 `{{titleCount}}/{{titleMax}}`、`{{descCount}}/{{descMax}}` 均为 data 驱动 → **wxml 无需改** |
| `miniprogram/utils/publish-validate.js` | **不改**（前端已在输入层卡死；服务端为最终兜底）|

> 交互保持**静默截断**（与标题输入现状一致），仅靠计数 `descCount/descMax` 反馈；不新增 toast（避免 §14 文案长度与新增提示面）。

### D. 测试
| 文件 | 改动 |
|---|---|
| `cloudfunctions/_shared/demand-publish.entry.test.js` | 新增 4 例（§10 要求覆盖成功路径）：①默认 200 下 201 字 → `publish_remark_long`；②config 设 `publish_remark_max_len=50` 时 51 字被拒（**证明可配**）；③**限内 remark → publish 成功穿透到落库**（断言 `ok` + `demand` 写入）；④update 侧超限 → `update_remark_long` |
| `cloudfunctions/_shared/ab_equivalence.js` | 预期**无需** `KNOWN_EVOLUTION`：`dp_publish_ok`（`:209-216`）未带 `remark`，该分支两侧同跳过；默认值仍 200 → 行为等价。以实跑结果为准 |
| `tests/full-link-cases.md:41,129` | 口径订正：`备注最长 200 字` → 标注「默认 200、后台 `publish_remark_max_len` 可配」；同时订正 TC-10a 里已过期的「真机键盘 maxlength=200 物理截断」表述 |

### E. 台账/文档
- `docs/FUNCTION-REGISTRY.md`、`docs/CHANGELOG.md`、`docs/deploy-log.md`：登记本次变更与部署证据。
- `docs/dev-manual/03-data-model.md:151`（发布与展示配置键表）追加 `publish_remark_max_len`。

---

## 不做 / 边界
- 不改接口契约（不拆 `title`/`description` 上报）。
- 不改 `TITLE_MAX`（20 字，保持现网）。
- 不改 `_orig_baseline.js`（§10）。
- 不做历史数据回填（存量 remark 均 ≤200，本就合规）。
- 已知影响：若后台把 N 下调到低于某存量需求长度，该单在**编辑**时会被拒（登记为预期行为，不做兼容分支）。

---

## 风险与合规
- 风险**中**：触云函数 + 接口口径；但**默认值不变**，未改变既有成功/失败判定，属「放宽可调 + 前端收紧」。
- §14：前后端同改、错误码名不变、**两个 commit 分离**（①服务端 ②前端）。
- §10：A/B 锚点不刷新；若实跑出现差异必须登记 `KNOWN_EVOLUTION` 并另配独立断言（预期不出现）。
- E-6.1 时序：本次服务端默认不变、前端由 500 收紧到 ≤199 → **无「服务端先收紧」窗口**；旧客户端（仍 500）提交超限仍被服务端拒，属预期 fail-closed。
- 高危区自检：不碰 app.json / project.config.json / 状态机 / 资金 / 集合结构。

---

## 部署与回归验证

**工程侧（我可执行，按序）**
1. `node --check` 改动的每个 js。
2. `npm run verify:offline`（含 `test:unit` 515 例）全绿。
3. `node cloudfunctions/_shared/ab_equivalence.js` → 期望 EQUIVALENT、exit 0。
4. `node scripts/check-syntax.js`。
5. 服务端：`commit`（先）→ `.trae\predeploy.ps1 -Deploy demand-publish` / `-Deploy admin-action`（逐个）→ CLI **逐函数单独** `--names <fn> --remote-npm-install` → **各自独立 `-p` 目录** download 核验 SHA256 本地==云端（§12/§16）。
6. 前端：`cli preview` 须 `EXIT=0` + `✔ preview`（C-4.4）；上传版本号递增（1.6.14 → 1.6.15）。
7. 台账三件 + CHANGELOG + dev-manual。

**需你人工/真机验证**
| 序号 | 项 | 步骤 | 预期 |
|---|---|---|---|
| 1 | 前端上限随动 | 发布页：标题填 20 字 → 看描述计数分母 | 分母 = 179（=200−20−1）；标题改 5 字 → 分母 = 194 |
| 2 | 超限被卡 | 描述粘贴 400 字 | 自动截到当前预算，提交成功（不再弹「备注最长 200 字」） |
| 3 | 后台可配 | admin-web 运营配置把「需求备注字数上限」改 100 → 重进发布页 | 计数分母随动（标题 20 字 → 79） |
| 4 | 服务端兜底 | 云端测试直接调 `publish` 传 201 字 remark | 返回 `publish_remark_long`「备注最长 200 字」（N=100 时应为「备注最长 100 字」） |
| 5 | 编辑态回归 | 编辑一条存量需求 | 回填与保存正常；remark 拼接不变 |
| 6 | 后台表单回归 | admin-web 进「运营配置」保存/读取 | 新字段可见、可存、config_get 回读一致 |

**回滚**：服务端 `_orig_baseline` 不动；如需回滚，重新部署上一版函数（或把 `publish_remark_max_len` 设回 200），前端重传上一已上传版本。

---

## 关键实现注意
- ctx 键完整性（§10）：`index.js` 的 ctx 提供键必须 ⊇ `action_publish.js:5` / `action_update.js:5` 解构并在体内真实使用的键——本次为 `REMARK_MAX_LEN → remarkMaxLen` 的**改名**，两侧同步改，改后逐一核对无残留引用（全仓 grep `REMARK_MAX_LEN` 应只剩 `_orig_baseline.js`）。
- 前端编辑态/草稿恢复属**程序化 setData**，不经输入层截断；因存量数据本就 ≤200 且 N 默认不变，无需额外夹紧（若后台调低 N，属已知影响）。

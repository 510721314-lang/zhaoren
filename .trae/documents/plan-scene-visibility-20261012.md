# 场景 / 子服务项「前端显示 / 不显示」开关 — 实施方案

## Context（为什么做）

运营需要一个**不删数据**的临时下架手段：现在后台「运营配置 → 场景管理」只能对场景做增 / 删、对服务项（options）做加 / 减，场景一旦被「不显示」只能删除（存量需求随之失去场景定义），服务项删了也找不回。本次给**场景**与**子服务项**各加一个显示开关，此后运营可随时隐藏 / 恢复。

**已拍板语义（本次不变）**

1. **仅前端隐藏入口** — 不新增后端拦截。用户直接调云函数仍可发布被隐藏的场景；该场景的存量需求照常展示、可编辑。`demand-publish` 白名单、`home-action` 的 `nearby` 白名单**均不动**。
2. **服务项「先取前 3 项，再过滤隐藏项」** — 沿用云端现有 `s.options.slice(0,3)`，隐藏只减不增，第 4 项不会补位。不放开 3 项上限。

## 数据模型（零迁移）

存储位置不变：`admin_config` 唯一文档 `_id:'global'` → `scene_list[]`。

| 层级 | 字段 | 语义 |
|---|---|---|
| 场景 | `visible: false` | 隐藏。读时 `visible !== false`（含字段缺省）= 可见；恢复显示时删除该字段 |
| 服务项 | `hidden_options: string[]` | 隐藏项文本列表。缺省 / `[]` = 全部可见 |

采用 deny 语义（缺省即可见）⇒ 线上 9 个场景与现有 options **无需任何回填**，`init-db` 种子也不用加字段。
不采用「把 `options` 改成对象数组」：会连锁波及存量数据、`loadSceneList` / `buildSceneGroups` 映射、`publish.js` / `enums.js` / `accept-config.js`、`scene_option_add/remove` 与入口契约测试，成本高而收益为零。

## 改动清单

### 1) 后端写入 — `cloudfunctions/admin-action/action_config_set.js`
- L163 深拷贝补 `hidden_options: (s.hidden_options || []).slice()`（否则原地改数组会污染 `before` 审计快照）。
- L180 之后、`if (scenesTouched)` 之前新增两个事件分支（沿用该文件现有 `fail()` / `scenesTouched` 风格）：
  - `scene_visibility_set: { scene, visible }` — 场景不存在 → `config_scene_not_found`；`visible` 非布尔 → `config_bad_scene_visible`；`false` 置 `sc.visible = false`，`true` 时 `delete sc.visible`。
  - `scene_option_visibility_set: { scene, option, visible }` — 场景或服务项不存在（服务项须在 `sc.options` 内）→ `config_option_not_found`；非布尔 → `config_bad_option_visible`；`false` 时去重 push 进 `hidden_options`，`true` 时移出。
- L177-179 `scene_option_remove` 同步执行 `sc.hidden_options = (sc.hidden_options || []).filter((x) => x !== opt)`（避免残留）。
- L190-196 `scene_add` 显式写入 `visible: true, hidden_options: []`（不带也符合 deny，显式更利于后台展示）。
- 权限无需改：两个分支挂在既有 `config_set` 下（仅 R1 超管）。
- **读侧 `action_config_read.js` 不改**：`config_get` 整体返回 `scene_list`，新字段自动透传。

### 2) 后台 UI — `admin-web-frontend/src/views/Operations.vue`
- 表格（L67-90）在「免责声明类型」后插入「前端显示」列：`el-switch`，`:model-value="row.visible !== false"`，`active-text="显示" / inactive-text="隐藏"`。
- 服务项列（L75-81）的 `el-tag` 改为「tag + 小号 switch」行内块；隐藏项 `type="info"` + 删除线区分。
- 交互：**即时保存**（与同页 `doAddScene` / `doOptSubmit` 风格一致），仅在**关闭**时用 `ElMessageBox.confirm` 提示「隐藏后仅不再展示入口，该场景存量需求在广场 / 附近仍可见」；新增 `visBusy = ref('')`（值为 `code` 或 `code::option`）做 `:loading`；成功 `await load()` 重取，失败 `ElMessage.error`。
- 因开关是受控绑定云端数据、失败时不改本地 state，**无需手动回滚显示**。

### 3) 云端展示过滤 — `cloudfunctions/home-action/index.js`
- `scene_groups`（L570-583）：`const { scenes } = await loadSceneList()` 后 `const shown = scenes.filter((s) => s.visible !== false)`，再用 `shown` 调 `buildSceneGroups`。
- `buildSceneGroups`（L172）：`scene_options: (sceneDef.options || []).filter((o) => !(sceneDef.hidden_options || []).includes(o))`。`sceneDef.options` 已在 L134 完成 `slice(0,3)` ⇒ 天然满足「先取前 3 再过滤」。
- **`loadSceneList`（L120-148）保持全量、不过滤**，因此以下行为不变（这正是「仅前端隐藏入口」的关键）：
  - `scene_list` 单场景分页（L587-594）仍能翻隐藏场景的需求（已隐藏的场景码不会报 `home_bad_scene`）；
  - `nearby` 白名单（L655-657）仍含隐藏场景 ⇒ 存量需求在附近可见；
  - `demand-publish` 白名单不动 ⇒ 直发仍成功。

### 4) 小程序 3 处必改（否则隐藏会泄漏或被兜底吞掉）
- `miniprogram/pages-v2/publish/publish.js:197-199`：把 `Array.isArray(g.scene_options) && g.scene_options.length ? … : hc.options` 改为**按存在性判断**（`Array.isArray(g.scene_options) ? g.scene_options.slice(0,3) : (hc ? (hc.options||[]).slice(0,3) : [])`）。否则 3 项被全部隐藏、`scene_options` 为空数组时会回落 enums 硬编码选项，隐藏项泄漏。
- `miniprogram/pages-v2/pkg-low/accept-config/accept-config.js:196`：`SCENES.forEach(...)` 目前**无条件**合并，会把隐藏场景塞回接单配置；改为仅在 `dynCodes` 为空时才用 enums 兜底（enums 只用于补 icon/color 元数据）。
- `miniprogram/pages-v2/index/index.js`：swr 缓存 key `home_scene_groups_v1` → `home_scene_groups_v2`，清掉含隐藏场景的旧缓存。
- `square.js buildChips`（L50-61）：chips 取自 `app.globalData.availableScenes`（由 `scene_groups` 派生，已过滤）；仅当冷启动 / 离线拿不到该全局值时才回落 enums（此时会漏出隐藏场景）。**本次接受该兜底泄漏**，不额外加请求。

### 5) 明确不改
`pkg-low/partner-apply/partner-apply.js:29`（硬编码 `SCENES`，不在四个入口内）、`demand-publish` 场景白名单、`nearby` 白名单、`init-db` 种子、`miniprogram/config/enums.js`、`scripts/check-ssot.js`（只比对 code 集合，不受新字段影响）。

## 显式副作用（请确认可接受）

- **首页「按场景分组」区会整块移除被隐藏场景**（含其存量需求卡片）；这些存量需求仍可在**广场 `all` 流水、附近列表、需求详情**看到 —— 即「入口消失、数据不消失」。
- **生效有延迟**：`loadSceneList` 的 5 分钟 memo + `scene_groups` 访客维度 60s 缓存 + 小程序 swr 10 分钟。已用 swr key 升版规避历史缓存，云函数侧最长约 5 分钟。上线后需告知运营「切开关后约 5 分钟内生效」。
- `init-db` 的 `force_migrate_scenes`（`init-db/index.js:337-346`）会用种子整体覆盖 `scene_list` ⇒ **清空所有显隐标记**。需在 runbook 注明「执行前先 `config_get` 备份，执行后重做显隐」。

## 验证

1. 静态：`node scripts/check-syntax.js`、`node scripts/check-ssot.js`、`npm test`（期望 tests 240 / pass 240）。
2. 后台本地：`admin-web-frontend` 跑 `npm run dev` → 切开关 → 断言返回 `{ ok:true, updated:['scene_list'] }` → 刷新页面开关状态保持；再切回可见，确认字段被移除。
3. 小程序模拟器：清缓存 → 复核四个入口（首页宫格 / 广场 chips / 发布页场景卡 / 接单配置）不再出现隐藏场景与隐藏服务项；同时反向验证「仅前端」语义：`home-action { action:'scene_list', scene_code:'W1' }` 仍可翻页、直接发布该隐藏场景仍返回成功。
4. 边界：把某场景 3 个服务项全部隐藏 → 发布页该场景应显示「无服务项可选」而不是回落硬编码选项。
5. 部署：`admin-web-frontend` `npm run build` → 清空 `cloudfunctions/admin-web/public/*` → 拷入 `dist/*` → 部署 `admin-web`；单独部署 `home-action`；等待 90-120s（参考 `docs/runbooks/deploy.md:69-84`）。

## 风险清单

1. **未知字段静默忽略**：`config_set` 只按已知键拼 `patch`，key 名写错会返回 `ok` 但「开关点了没反应」——验证必须断言 `updated` 含 `scene_list`。
2. **fail-open 兜底**：`admin_config` 读失败会走 `SCENE_FALLBACK`（无显隐字段，9 场景全可见）；enums 兜底同理。属可接受降级，但会造成「隐藏后又冒出来」的错觉。
3. **缓存延迟**（见上）是运营最容易误判为「坏了」的点。
4. `hidden_options` 可能残留已删除的服务项文本（读侧 `includes` 判定无实际危害，已由 `scene_option_remove` 同步清理规避）。
5. 3 项全隐藏时该场景在前端无可选服务项，后台 UI 建议给一句提示（可选项，非必须）。

## 不在本次范围

- 客服会话加载失败（`im_conversation.order_id` 的空串与 `uk_order_id` unique 索引冲突）为独立 bug，另行处理。

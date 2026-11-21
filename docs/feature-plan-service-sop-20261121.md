# 功能方案：「服务」入口与服务 SOP 体系（v1.1 · 待审）

> 状态：**方案已批准（2026-11-21 用户批准 v1.0 + 默认值），按 v1.1 修订待审后开工**｜本文件为审批载体，未动任何代码
> 需求来源：用户 2026-11-21 口述四点（tabBar 服务按钮 / 场景-子场景-SOP 浏览 / 后台增删改 / 与场景管理整合）
> 审批状态：v1.0 已批；v1.1 新增发现（custom tabBar 布局）见 §D6，**待用户确认 D6 后开工批1**

## 一、决策点（v1.0 已批准）

| # | 决策 | 采用 |
|---|---|---|
| D1 | tabBar 位置 | 第 3 位（首页/广场/**服务**/消息/我的） |
| D2 | 数据载体 | 新增集合 `service_sop`（已批） |
| D3 | 初始内容 | 先建结构、内容后补（后台自填） |
| D4 | SOP 形态 | 纯文字段落 + 可选单张头图（字段预留） |
| D5 | 入口联动 | SOP 页带「去预约」按钮（跳发布页带 scene 参数） |

## 二、v1.1 新增发现与修订（2026-11-21 实测取证）

### D6【新决策点·待确认】custom tabBar 布局
**实测**（[app.json L84-96](file:///c:/zhaoren/miniprogram/app.json#L84-L96) / [custom-tab-bar/index.js](file:///c:/zhaoren/miniprogram/custom-tab-bar/index.js)）：
- `tabBar.custom = true`，**图标为 emoji 字符**（首页🏠/广场🧭/消息💬/我的👤），无 PNG 资源 → 原计划「生成图标图片」作废，改为 **emoji 选型：推荐 🛎️（服务铃）**，备选 🧰/📋
- 现有布局为 **5 位设计**：首页(0)/广场(1)/**中央发布大钮**（绝对定位居中，非 switchTab）/消息(2)/我的(3)；`app.json list` 仅注册 4 个真实 tab 页

**插入「服务」后的布局影响**：真实 tab 变 5 个（首页/广场/服务/消息/我的）+ 中央发布钮 = 6 视觉位。中央发布钮 `left:50%` 绝对定位在 5-tab 布局下将压住服务|消息之间的间隙，需配合微调（tab 区加让位 padding 或钮位偏移），批2 模拟器验证视觉。

| D6 选项 | 内容 | 推荐 |
|---|---|---|
| a | 5 真实 tab + 中央发布钮保持凸起大钮（tab 项变窄，wxss 微调让位） | ⭐ 推荐（保持发布核心动作的视觉权重） |
| b | 中央发布钮降为平面按钮与 tab 同排（5 tab + 平面钮，视觉更均匀但弱化发布） | 备选 |

**D6 + emoji 选型（🛎️）确认后即可开工批1。**

### 其他修订
- 服务首页为 **tabBar 页 → 必须主包**（不能入 pkg-low 分包）；服务详情页入 `pkg-low`（分包）不变
- 「图标生成」任务取消（emoji 方案），无需图片资产
- 中央发布钮的 redline 登录守卫逻辑（index.js L21-31）不受影响，仅布局调整

## 三、数据结构（新集合 `service_sop`，D2 已批）

```js
{
  _id, scene_code: 'W1',          // 关联 scene_list 白名单（服务端校验）
  name: '全程陪诊',               // 服务项目名
  brief: '一句话简介',            // 列表卡片摘要
  sop_content: '富文本段落…',     // SOP 正文（纯文字，\n 分段渲染）
  cover_fileid: '',               // 可选头图（云存储 fileID，可空）
  sort: 1,                        // 排序
  status: 'online',               // online / offline（上下架）
  created_at, updated_at, is_deleted: false
}
```
- 一篇 SOP 内嵌于服务项目文档；删除 = 软删（is_deleted，§24 口径）
- init-db 台账 + 索引台账登记（索引：`scene_code+sort`）

## 四、改动清单（3 批，先云端后客户端）

| 批 | 内容 | 文件 | 规模 |
|---|---|---|---|
| **批1 后端+后台** | ①admin-action 加 4 个 action：`sop_project_list / save / delete / status`（写操作 gatedLog 留痕）②Operations.vue 场景管理扩展「服务项目」管理区（列表+增删改+上下架，admin-web-write-ui-pattern 标准模式）③init-db 台账登记 | admin-action、Operations.vue、init-db | ~4 文件 |
| **批2 小程序端** | ①app.json：tabBar list 追加服务页注册（第 3 位）②custom-tab-bar：list 加服务项（🛎️）+ 布局微调（D6a）③新主包页面 `pages-v2/service/service`（场景卡片列表）④pkg-low 新增 `service-detail` 页（项目列表+SOP 正文+「去预约」带 scene）⑤home-action 加只读 action `service_list / service_detail` | app.json、custom-tab-bar、service×4、pkg-low/service-detail×4、home-action | ~11 文件 |
| **批3 验证收口** | verify 门禁 + 模拟器 UI 验证 + 串行部署（admin-action/home-action/init-db）+ 体验版上传（tabBar/custom-tab-bar 改动必须体验版真机）+ REGISTRY/CHANGELOG 登记 | 台账 | — |

## 五、关键风险与防线

| 风险 | 级别 | 防线 |
|---|---|---|
| tabBar/custom-tab-bar 改动（§4 高危） | 中 | app.json 仅追加不删改；custom-tab-bar 改动走最小增量；真机 iOS/Android 各验；中央钮视觉模拟器先行验证 |
| 新集合（§3 触发点） | 中 | 本方案 schema 已列明，D2 已批即视为集合授权；走 init-db 台账 + 索引实证 |
| 主包体积 | 低 | 服务首页轻量卡片列表；详情页入 pkg-low；包体批3 实测（当前 780KB 余量大） |
| 孤儿页/入口可达性 | 低 | 「去预约」直达发布页带 scene 参数（D5）；§40 入口纪律 |
| 场景白名单联动 | 低 | 服务页只展示 scene_list 白名单内场景（§附录A-11，zhaoren-config-sync 口径） |
| 配额 | 低 | 只读接口走 home-action 缓存口径；服务页无轮询 |

## 六、回归验证清单（批3 执行）

| # | 项 | 方式 | 预期 | 谁验 |
|---|---|---|---|---|
| 1 | tabBar 5 tab + 中央发布钮跳转 | 模拟器+真机 | 既有 4 tab 与发布钮行为不变，「服务」可进 | 我+你真机 |
| 2 | 服务页三级浏览（场景→项目→SOP） | 模拟器 | 白名单 9 场景 → 项目 → SOP 与后台配置一致 | 我 |
| 3 | 后台 CRUD 全链路 | 后台+小程序 | 增/改/删/上下架实时同步，写留痕 | 我+你 |
| 4 | Operations 原功能 | 后台 | 场景配置/日志原功能正常 | 我 |
| 5 | 「去预约」跳发布页带 scene | 模拟器 | 发布页场景预选中 | 我 |
| 6 | 真机 UI（iOS/Android） | 真机 | 新页、tabBar 布局、中央钮显示正常 | **你** |

## 七、审批记录
- 2026-11-21：用户批准 v1.0 方案 + 全部默认值 + 「图标由你生成」；v1.1 因 custom tabBar 发现修订（图标改 emoji 选型 + 新增 D6 布局决策），**待确认 D6=a 与 🛎️ 后开工批1**

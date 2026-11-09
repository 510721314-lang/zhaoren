# COMPONENTS.md · 自定义组件手册（v1.0 · 2026-11-08）

> 范围：`miniprogram/components/` **25 个**组件（实测目录枚举）。数据来源＝组件源码 `properties` / `triggerEvent` / `usingComponents` 反查，**不含推断**；未实测到的写「未声明」。
> 页面清单见 `PAGE_SPEC.md`，文档索引见 `README.md`。

---

## 0. 共同约定

| 项 | 约定 | 依据 |
|---|---|---|
| 注册方式 | **3 个全局**（`app.json:125-129`）：`night-mask` / `empty-state` / `bottom-sheet`；其余 **22 个按页 `usingComponents`** 局部注册 | [app.json](../miniprogram/app.json) |
| 目录与命名 | 目录名 = 标签名（`nav-bar/nav-bar.js`）；`ui-*` 四个例外，文件名为 `<name>.js` 而非 `index.js` | 目录实测 |
| 数据边界 | 组件**只做展示与出事件**：禁 `wx.cloud.callFunction`、禁写业务状态、禁 `wx.cloud.uploadFile`；业务编排一律留页面 | 各组件响应头注释 |
| 样式隔离 | 订单详情拆出的 6 张卡用 `styleIsolation: apply-shared` 复用页面 `.od__card` 等原语；**专属样式随卡迁入组件 `wxss`**，共用原语留页面 | `timeline-card` / `dispute-card` / `evidence-card` / `finance-card` / `no-show-card` / `safety-card` |
| 颜色/文案单一源 | 状态色与文案取 `config/enums.js` 的 `ORDER_STATUS`；场景取 `utils/redline.js` 的 `getScene`；组件内**禁止再写映射** | `order-progress` / `status-tag` / `tag-chip` |
| 命令式方法 | 通过 `this.selectComponent('#id')` 调用：`auth-sign-sheet.openDoc()`、`signature-canvas.clear()/isEmpty()/exportPNG()/recognize()` | 组件源码 |

---

## 1. 一览（25 个）

| # | 组件 | 作用 | props（类型/默认） | 事件 | 引用页面数 |
|---|---|---|---|---|---|
| 1 | `nav-bar` | 通用导航（返回/标题/右侧插槽，高 92rpx） | `title:String=''`、`showBack:Boolean=true`、`fixed:Boolean=true`、`bg:String='var(--bg-card)'` | `back`；slot `right` | **25** |
| 2 | `night-mask` | R1 夜间红线提示弹窗（窗口取自 `CONFIG.TIME_REDLINE`） | `visible:Boolean=false` | `dismiss`、`reserve` | 11 + 全局 |
| 3 | `empty-state` | 空状态（图标+主/副文案+按钮） | `icon:String='📭'`、`title:String='暂无内容'`、`desc:String=''`、`btnText:String=''` | `btntap` | 5 + 全局 |
| 4 | `bottom-sheet` | 底部弹窗（遮罩/圆角/拖拽条/双插槽） | `visible:Boolean=false`、`title:String=''`、`closeOnMask:Boolean=true`、`hasFooter:Boolean=false` | `close`；slot `footer` | 3 + 全局 |
| 5 | `demand-card` | 需求卡（抢单/查看） | `demand:Object={}`、`role:String='partner'`、`certified:Boolean=false`、`grabbed:Boolean=false`、`actionText:String='⚡ 抢单'` | `action`、`cardtap` | 3 |
| 6 | `partner-card` | 耍伴卡 | `partner:Object={}` | `invite`、`cardtap`、`more` | 1 |
| 7 | `order-progress` | 13 态进度轴 | `status:String='S0'` | — | 1 |
| 8 | `status-tag` | 订单状态标签（色取 `ORDER_STATUS`） | `code:String=''` | — | 1 |
| 9 | `tag-chip` | 万能标签（scene/gongyi/aa/status） | `type:String='scene'`、`text:String=''`、`sceneCode:String=''`、`statusCode:String=''` | — | 6 |
| 10 | `confirm-progress` | 四确认进度条（时间/地点/内容/费用） | `progress:Object={time,location,content,fee:false}` | — | 1 |
| 11 | `scene-picker` | 发布页场景选择块 | `scenes:Array=[]` | `scene`、`open-sheet` | 1 |
| 12 | `safe-sell-bar` | 首页安全卖点条 | 无 | — | 1 |
| 13 | `signature-canvas` | 手写签名板（canvas 2d，白底 PNG 导出） | `tip:String='请在此处手写签名'` | `verify-change` | 1 |
| 14 | `auth-sign-sheet` | 授权书弹窗 + 签字窗（宠物照料 W9 / 代发委托） | `kind:String=''`、`docTitle:String=''`、`docText:String=''`、`signTip:String=''` | `check-change`、`sign-confirm` | 1（页面实例化 2 次） |
| 15 | `tm-template-card` | IM 模板消息卡 | `msg:Object={tm_id,question,picked,status,direction}` | `optiontap` | 1 |
| 16 | `timeline-card` | 订单动态时间线卡 | `list:Array=[]`（`{key,type,icon,label,time,who,detail}`） | — | 1 |
| 17 | `dispute-card` | 投诉详情/争议处理中/保险保障 三卡 | `complaint:Object=null` | — | 1 |
| 18 | `evidence-card` | 履约留痕 + 履约凭证 两卡 | `start:Object=null` | `preview` | 1 |
| 19 | `finance-card` | 资金明细 + 费用明细卡 | `money:Object=null` | — | 1 |
| 20 | `no-show-card` | 爽约申诉卡 | `reports:Array=[]` | `preview`、`defense`、`withdraw` | 1 |
| 21 | `safety-card` | 安全中心卡（签到/SOS/报备） | `checkins:Array=[]` | `sos`、`safety` | 1 |
| 22 | `ui-card` | 分区卡壳（标题+副标题） | `title:String=''`、`subtitle:String=''` | — | 1 |
| 23 | `ui-cell` | 列表单元（可带 `button open-type`） | `icon:String=''`、`title:String=''`、`badge:String=''`、`openType:String=''` | `tap`、`error` | 1 |
| 24 | `ui-empty` | 新版空态（带 CTA） | `icon:String=''`、`title:String=''`、`desc:String=''`、`cta:String=''` | `ctap` | 1 |
| 25 | `ui-skeleton` | 骨架屏 | `type:String='list'`、`avatar:Boolean=false` | — | 5 |

---

## 2. 分组详情

### 2.1 布局壳（3 个）

**`nav-bar`** — 全站最高复用（25 页）。`showBack=false` 用于 tabBar 页；`fixed` 默认吸顶；右侧内容走 slot `right`。返回逻辑由页面在 `back` 事件里自行 `navigateBack`（组件不直接调路由，便于页面加 `fail` 兜底）。
**`bottom-sheet`** — 受控组件：`visible` 由页面持有；`closeOnMask` 控制点遮罩是否关闭；`hasFooter` 时渲染 `footer` 插槽。`auth-sign-sheet` 内部也复用它。
**`night-mask`** — 全局注册，页面只需 `<night-mask visible="{{...}}"/>`；是否弹由 `redline.shouldShowNightMask` 守门，同一夜间段不重复弹；**弹窗本身不阻塞背景操作**，预约/接单/履约的拦截由各页 `checkEntryLocked`/`isRedline` 独立负责。

### 2.2 订单详情拆卡（6 个，2026-10-16/17 用户批准）

拆分原则：结构从 `pages-v2/order-detail/order-detail.wxml` **逐字迁入**，数据由页面切片传入，`callCloud`/写操作**全部留页面**。

| 组件 | 数据来源（页面切片） | 交互边界 |
|---|---|---|
| `timeline-card` | `fetchTimeline` 拉取后映射为 `list` | 零 bind |
| `finance-card` | `order.money` / `order.refund_view` / `order.fees_view` | 零 bind，页面零计算 |
| `evidence-card` | `order.start_evidence` / `order.finish_evidence` | 仅 `preview` → 页面 `onPreviewEvidence` |
| `dispute-card` | `order.complaint` / `order.dispute_view` / `order.insurance` | 零 bind |
| `no-show-card` | `noShowReports` | `preview`/`defense`/`withdraw` → 页面处理跳转与撤回 |
| `safety-card` | `safety.checkins` | `sos` → 页面二次确认→定位→`safety-report.sos`→拨号弹层；`safety` → 跳安全报备页 |

### 2.3 业务输入（4 个）

**`scene-picker`** — 场景网格 + 已选服务行；`scene` 事件回页面走「免责声明 modal → 清空服务项 → 开选择窗」；「选择服务内容」弹层按既有口径**留在页面**未迁。
**`auth-sign-sheet`** — 同一组件实例化两次（`#pet-auth` / `#proxy-auth`），`kind` 随事件 detail 透传；授权书全文由页面经 `docText` 传入（宠物来自 `admin-action config_public`，委托为页面本地文案）。
**`signature-canvas`** — 白底 PNG 导出，签名图上传云存储后由服务端复算 SHA-256 留证；2026-10-28 增 `recognize()` 质量闸门（空签/单点/笔画过少/过小）。
**`confirm-progress`** — 只吃 `progress` 对象，内部按「已完成/当前/未完成」三态渲染，不做业务判断。

### 2.4 通用 UI（`ui-*` 4 个 + 标签 3 个）

`ui-card` / `ui-cell` / `ui-empty` / `ui-skeleton` 是**新版设计语言**的基础件，目前仅 `profile`、`nearby-list`、`admin`、`admin/config`、`activity-detail`、`notices` 使用；与 `empty-state` 功能重叠（后者是旧版，全局注册、5 处使用）。
`status-tag` / `tag-chip` / `order-progress` 的状态色与文案**一律取 `config/enums.js`**，改色只改 enums。

---

## 3. 已知偏差与文档债

| # | 现象 | 代码事实 | 处置 |
|---|---|---|---|
| 1 | `partner-card` 头注释写 4 个事件（含 `consult`），实际只 `triggerEvent` 3 个 | [partner-card/index.js:34-40](../miniprogram/components/partner-card/index.js) 仅 `invite`/`cardtap`/`more` | 本文以代码为准；注释与实现二者留待后续统一（**不改代码**，不在本轮范围） |
| 2 | `safe-sell-bar` 4 条卖点硬编码在 `data.items` | [safe-sell-bar/index.js](../miniprogram/components/safe-sell-bar/index.js) | 无后台配置入口；如需运营可配需另立项 |
| 3 | `status-tag` 仅 `message` 页使用，`order-detail` 走 `tag-chip` + `order-progress` | `usingComponents` 反查 | 非缺陷，属页面选择差异 |
| 4 | `empty-state` 与 `ui-empty` 并存（两套空态） | 前者全局、5 处；后者局部、1 处 | 新增页面**统一用 `ui-empty`**；老页面不迁移（最小改动） |
| 5 | 25 个组件中 15 个只被 1 个页面引用 | 反查表 | 属「订单详情拆卡」与「发布页抽块」的正常结果，不视为冗余 |

---

## 4. 待确认

1. `auth-sign-sheet` 的 `docText` 宠物版来自云端配置，若运营改文案，前端无需发版——需在 `PAGE_SPEC.md` 发布页章节标注该配置键（当前未取到键名，标记为**待后端确认**）。
2. `ui-*` 四件套是否定为后续新页面的强制基础件，需产品侧确认后再写入 `AGENTS.md` 约定。

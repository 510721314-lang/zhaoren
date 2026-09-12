# 找人帮忙小程序 · 收工交接与商用化指引

> 更新：2026-09-12　环境：`cloud1-d9gkefwcp5c777088`　AppID：`wxbc4a4afacdf234f5`
> 项目根：`c:\Users\DC\Desktop\zhaoren`（2026-09-11 从 H 盘迁出，H 盘已不存在）
> 备份：git tag `backup-2026-09-12`（=提交 e208e01）；全量归档 `C:\Users\DC\Desktop\临时备份文件\zhaoren-backup-2026-09-12.zip`
> IDE：`c:\Users\DC\Desktop\微信WEB开发者工具\cli.bat`，服务端口 11841；最新代码提交 `092e6b7`

---

## ★ 上线前阻断项（2026-09-12 登记）

1. **隐私指引未闭环（最高优先）**：真机 `wx.getLocation` 被微信拦截（后台《用户隐私保护指引》的"位置信息"声明未审核通过/未找到添加入口）。
   - 代码侧已定稿：直接调 API，由**微信官方自动弹窗**接管（自定义 privacy-popup 组件已在 `092e6b7` 删除）；后台声明生效后无需再改代码。
   - 商用前必做：① mp.weixin.qq.com → 账号设置 → 服务内容声明 → 用户隐私保护指引，添加 位置信息(wx.getLocation)/选中的位置信息(wx.chooseLocation)/选中的照片或视频信息(wx.chooseMedia)/手机号(getPhoneNumber)，等审核通过；② 真机验证官方弹窗→同意→真实 GPS 成功；③ **删除自测模式**：`miniprogram/utils/testmode.js`、mine.js 的 `onVersionLongPress`、mine.wxml 的 `bindlongpress`（自测模式：我的页长按版本号开启，storage key `dev_test_mode`，开启后真机定位降级成都坐标，仅供测试）。
2. **云函数超时锁死 3 秒**：控制台统一调超时或升级套餐（详见阶段 A 第 1 条），改完用 `cli cloud functions info` 读回。
3. **order-timer 超时流转未验收**：自驱链新版只存在于 git `cf138e0`（zz-selftest-timer），本地/云端均已删除且从未跑通 all_pass；商用前需在测试环境重建验收 S1/S0/S3.5/S5 四个超时流转。
4. **全链路实测未完成**：发布→匹配→四确认→S0→模拟支付→S3→S5→评价→打赏（含时间冲突拦截、50km 校验）。当前可用模拟器或真机自测模式走查。

### 2026-09-12 完成项
- 环境迁移收尾：IDE 新路径验证、部署 skill 更新、端口 11841 联通；9-09～9-11 全部工作入库（4 提交）；PRD 三文件从 git 恢复
- zz-selftest-timer 本地删除 + 云端删除（用户手动），云端 17 个正式函数
- 定位问题修复链：模拟器/系统定位误判修复(e208e01) → 真机隐私拦截修复尝试(51344c1) → 重试熔断(b0d0285) → 自测模式(2fdad32) → 移除自定义弹窗回归官方机制(092e6b7)
- 三层备份（git tag / .backup-2026-09-12 / zip 全量归档，含 SHA256 校验）

---

## 2026-09-10 测试反馈六项整改（云函数均已部署 success，待编译实测）

| # | 反馈 | 改动 |
|---|---|---|
| 1 | 首页选场景后发布页焦点不在该场景 | 根因：草稿恢复 `Object.assign(patch, draft)` 覆盖了带入场景；草稿功能已整体移除（见#2），场景预选恢复正常 |
| 2 | 进发布页无需恢复草稿 | demand-publish.js 删除草稿自动存/恢复/定时器，onLoad 清旧 `demand_publish_draft_v1` |
| 3 | 服务时间距发布≤30天 | 前端日期 picker 加 `end=今天+30` + 提交校验；云端 demand-publish 加 `publish_time_too_far` |
| 4 | 接单时耍伴实际位置距履约地址≤50km | order-create 加 Haversine 距离校验（`order_too_far`/`order_location_required`，真实客户端必传 `partner_location`，mock 自测链路豁免）；hall.js 接单前先 `wx.getLocation`；订单落 `take_distance_km` |
| 5 | 发布者位置=发布时实际定位不可改 | 发布页删 `wx.chooseLocation`，改为进页自动 GPS 定位 + 提交瞬间重新取点；地点卡仅显示/可重新定位不可手选；app.json 权限描述更新、requiredPrivateInfos 去掉 chooseLocation |
| 6 | 已履约完成订单可打赏 | payment-mock 新增 `mock_tip`（S5/S8/S9/S10 发单人，1-500 元，可多次，is_mock=true，流水 type=tip，订单累计 `tip_total_fen`）；order-detail 加「🎁 打赏耍伴」按钮（5/10/20/50 元档，提示模拟支付不扣款）+ 费用卡累计打赏行 |

部署：demand-publish(104.6KB)、order-create(5.1KB)、payment-mock(3.9KB)、order-action(6.9KB)、zz-selftest-timer(7.5KB，补 partner_location 以适配 50km 校验)。

---

## 一、今日问题收口（状态与解法）

| # | 问题 | 根因 | 解法 / 状态 |
|---|---|---|---|
| 1 | 发布提示"当前城市未开通服务" | 前端正则 `/([\u4e00-\u9fa5]{2,4}?)市/` 对"四川省成都市"跨段误匹配成"川省成都"；云端对空数组白名单无兜底 | 前端改 `parseCity()`（先剥省/自治区再取段首市）；云端归一化 + 空数组兜底"成都" + 包含匹配容错。**已部署**，待"编译"后实测 |
| 2 | 发布后匹配页空白 | pages/match 原为占位 | 已实现：需求摘要卡 + top5 候选耍伴（头像/信用/时薪）+ 定向邀约（≤3）+ 广播大厅 + 空态 + 下拉刷新；demand-match top5 增返需求摘要/已邀约、排除自己。**已部署**，待编译实测 |
| 3 | 自测单不出 / order-timer 验证受阻 | ① 云函数被锁在 **3 秒超时**且定时触发器 CLI 不生效（不自动跑）；② take_a 无订单复用，超时建单后重跑被"该需求已不可接单"拒；③ error.step 记录错误；④ 手动 run 与定时器并发互相覆盖；⑤ 复用误捞历史 S5 残留单 | 全部已修并部署 zz 6.7KB（cleanup 关全量残留单+epoch、复用只认本轮、error.step、8s 锁）。**需手动连点 run 验收，步骤见下** |
| 4 | 云函数 3 秒超时 | **CLI 部署不应用 config.json 的 `timeout`；免费体验版控制台锁死 3 秒** | 见下文"商用化"。临时缓解：DB 读并行化（demand-publish 已示范）+ 每步落库断点续跑 |

### 挂起项（order-timer 自测验收，2026-09-10 决定暂不阻塞，后续处理）

背景：云函数被免费版锁死 3 秒、CLI 不应用 timeout/triggers，定时触发器不触发。
- 旧手动连点方案问题：reset 后连点 run 多次，report 长期停在 `phase:cleanup / steps:[]`——每次调用在 3s 内刚做完 cleanup 就被杀，步骤日志没来得及落库。
- **2026-09-10 已部署新版（7.5KB，success 已确认）**：① cleanup 两条查询+全部更新改 `Promise.all` 并行；② 新增自驱动链 `scheduleNext()`——每次 run 开始时发射后不管地 `cloud.callFunction` 预约下一次 run（500ms 超时不等结果，chain_gen 上限 40，done/重试耗尽不预约）；③ `reset` 返回 `auto_started:true` 并自动点火。
- **新版尚未验证通过**（用户决定先挂起）。下次续做：云端测试 `{"action":"reset"}` → 等 3～5 分钟（什么都不用点）→ `{"action":"report"}`。
  - 目标：`all_pass:true / phase:done / a_pass、b_pass、idempotent_pass 全 true`；steps 第一条为当天时间戳 `0-cleanup`（orders_closed≥1），随后全新 `A1-publish`（非 reuse）。
  - 若仍停在 cleanup/steps 为空：说明链式 callFunction 未真正发出（疑似免费版限制函数内 callFunction 或 500ms 内请求未发出），备选方案：scheduleNext 改为先 await 一次极快的状态写入再发、或放弃自驱动改回手动但把每步落库提前到阶段开头（先 log 占位再干活）。
  - 若报 error：看 `error.step` + `error.message`（已能精确定位）。
  - 通过 → **删除临时函数**（云端删除 + 本地删 `cloudfunctions/zz-selftest-timer/` 目录）。
- 不阻塞前端实测：自测链路用 test_partner_001 独立身份，与本人账号前端验证互不影响。

前端项（点开发者工具「编译」后实测，云函数均已部署）：
- 发布需求不再报城市未开通，成功跳匹配页；匹配页展示需求摘要/候选/邀约/广播/空态。
- 订单 tab 两笔自测单；S9 单详情显示 4 星"系统默认评价"。

---

## 二、商用化系统改造办法

按"先止血、再强筋骨、后合规上线"三阶段推进。每项都给了**改哪里**和**怎么验**。

### 阶段 A：环境与稳定性（1～2 天）

1. **超时配置（必做）**
   - 云开发控制台 → 云函数 → 点函数名 → 函数配置 → 超时时间：`zz/order-timer=60s`，`demand-publish/order-create/order-action/demand-match=20s`，`payment-mock=10s`。
   - 若输入框灰锁：升级云开发套餐（标准版）解锁；或坚持 3s 则所有云函数必须"DB 并行 + 每步落库 + 幂等续跑"（demand-publish、zz 已是范本）。
   - **注意：CLI 部署和 config.json 都不会改超时，只能控制台手动改；改完用 `cli cloud functions info` 读回校验。**

2. **冷启动/性能**
   - 高频云函数里多个无依赖的 DB 读用 `Promise.all` 并行（demand-publish 的 config/user/紧急联系人已改）。
   - 列表接口分页（`pageSize` + `skip`），禁 `where({})` 全表拉取（demand-match hall_list 里的 HALL_DEBUG 全表日志上线前删除）。

3. **数据库索引（控制台 → 数据库 → 索引）**
   - `demand`：`(status, created_at)`、`(creator_openid, status)`、`expire_at`。
   - `order_main`：`(partner_openid, status)`、`(user_openid, status)`、`demand_id`、`created_at`。
   - `evaluation`：`order_id`、`to_openid`；`credit_score_log`：`openid, created_at`；`im_message`：`conversation_id, created_at`。

4. **版本与备份**
   - `git init` 并按模块提交（当前仅 .gitignore）；每次上线打 tag。
   - 云开发控制台 → 数据库 → 定时导出备份（每日）；代码备份沿用本次 zip 方式，重要节点各备一份。

### 阶段 B：数据一致性与资金安全（核心，3～5 天）

5. **关键写操作改事务**
   - 接单（order-create）、支付回调、状态流转（order-action）用 `db.runTransaction`：在事务内"读 demand/order → 校验状态 → 写 order + 改 demand 状态 + 写流水"，杜绝"先查后写"竞态（重复接单、超卖、状态错乱）。
   - 状态迁移**单一入口**：所有 `status` 变更只允许 order-action/order-timer 用 **CAS 条件更新**（`where({_id, status: 旧态})` 更新，`stats.updated===0` 即并发冲突，返回幂等/重试）。禁止其它函数直接 `update({status})`。

6. **真实支付替换 payment-mock**
   - 接入微信支付（云开发 cloud.tencentCloud 或商户号）：服务端统一下单 → 前端 `wx.requestPayment` → **支付回调验签** → 回调内事务置 S2 + 写支付流水。
   - 金额一律"分"（整数），服务端重算总价，不信任前端；加对账（每日比对支付流水与 order_main）。
   - AA 费用保持"线下自理、平台不经手"，承诺书留痕（已具备）。

7. **幂等与重试**
   - 支付、接单、评价等写接口支持幂等：前置状态判断 + 唯一约束（如 order_id + action 唯一），重复请求返回 `idempotent:true`（部分已具备，统一覆盖全部写接口）。

### 阶段 C：安全合规与可观测（上线前，2～3 天）

8. **权限与鉴权**
   - 数据库集合权限全部设为"仅创建者可读写"或"仅管理端"，业务读写一律走云函数；云函数内统一 `openid → 角色(user/partner/admin)` 校验，越权直接拒绝。
   - 管理后台 admin-action 加管理员 openid 白名单。

9. **内容安全与合规**
   - 文本 msgSecCheck 覆盖：备注、IM 消息、评价、昵称（备注/IM 已做，补齐评价/昵称）；图片 imgSecCheck（头像、聊天图、安全报备图）。
   - 实名/紧急联系人/青少年金额限制：服务端强校验从"发布"延伸到"支付前"再校验一次。
   - 上线前配齐：用户协议、隐私政策、个人信息收集清单（小程序后台「用户隐私保护指引」）。

10. **可观测**
    - 统一错误码 + `platform_event` 记录关键事件（接单/支付/投诉/超时）；云函数控制台开超时/错误告警。
    - order-timer 等定时任务加"每次跑处理条数"日志与失败告警。
    - 灰度：先传体验版内测（含本自测链路）→ 修完 → 正式发布。

### 上线操作指引（checklist）
1. 控制台调好所有函数超时；建好索引；集合权限收口。
2. payment-mock → 真实支付（沙箱验签 → 小额真机）。
3. 关键写路径改事务 + CAS；跑通 zz 回归（迁到独立测试环境/测试号）。
4. 内容安全、隐私协议、管理员白名单到位。
5. 数据库定时备份 + git tag；体验版灰度 3～5 天无 S1/S2 异常单 → 提交审核上线。

---

## 三、借助大模型美化界面（操作指引）

> 踩坑教训（来自同类项目）：**不要让模型直接大范围覆写页面**。正确节奏是"先出设计稿/规范 → 人确认 → 最小差异改样式"，且保留所有数据字段与事件名；WXML 新增的每个绑定字段必须在 Page.data 有默认值；图标商用阶段用官方 iconfont/图片而非 emoji（跨机型渲染不一致）。

### 第 1 步：准备喂给模型的材料
- 全局：`miniprogram/app.wxss`（现有设计 token：主色 #D4875A 赭橙、辅 #1A2330 墨蓝）、`app.json`（页面清单 + tabBar）。
- 标杆页面：`pages/index`、`pages/hall` 的 wxml + wxss，外加模拟器截图。
- 风格要求：从 `PRD/PRD.md` 摘"同城陪伴、温暖可信、安全"的调性关键词。

### 第 2 步：让模型先产出"设计规范"（不碰代码）
要求输出：① 设计令牌（色板/字号阶/间距 8 的倍数/圆角/阴影/动效时长）；② 通用组件库（按钮、卡片、标签、空态、骨架屏、底部安全区、导航）；③ 页面清单与信息架构；④ 3～5 个关键页面的高保真描述。视觉稿可用 UI 类 AI（即时设计 AI、MasterGo AI、Figma AI、v0、Galileo）出图。

### 第 3 步：可直接复制的提示词模板
```
你是资深微信小程序视觉设计师。现有项目是"同城功能性陪伴撮合"小程序，主题色
赭橙 #D4875A、墨蓝 #1A2330，调性温暖、可信、强调安全。请只输出设计规范，不要改代码：
1) 设计令牌：色板(主/辅/语义色/中性色)、字号阶(rpx)、间距(8rpx 基准)、圆角、阴影、动效；
2) 通用组件：主按钮/幽灵按钮/卡片/标签/空态/骨架屏/列表项，给出 WXSS；
3) 针对【首页/需求发布/匹配页/订单详情/我的】5 个页面，给出布局与视觉层级建议。
约束：兼容微信原生 WXML/WXSS，不引入第三方 UI 库；图标用 iconfont，不用 emoji；
给出可直接放进 app.wxss 的 CSS 变量与通用类。
```

### 第 4 步：截图迭代法（最有效）
把模拟器/真机截图发给多模态模型，问："对照规范指出本页 5 个最影响质感的问题，并给最小改动的 WXSS"。逐页过：首页 → 大厅 → 匹配 → 订单详情 → 我的。

### 第 5 步：落地（一次一页，可回滚）
1. 先把令牌 + 通用类沉淀进 `app.wxss`（项目已有 .card/.btn-primary 等基础类，在此扩展）。
2. 逐页迁移：只改 class/样式与少量结构，**不改 data 字段名和 bindtap 事件名**；新增绑定字段先在 data 给默认值。
3. 每页改完「编译」自测 → git 提交 → 再下一页；出问题 `git checkout` 回滚该页。

### 模型分工建议
- 文本/代码（规范、WXSS、结构建议）：GPT / Claude / 豆包 / DeepSeek。
- 视觉稿/改版对比：即时设计 AI、MasterGo AI、Figma AI、v0。
- 截图"找茬"：任意多模态模型（GPT-4o/豆包视觉等）。

---

## 四、待办（下次）
- [ ] 全链路编译/真机实测（模拟器或自测模式）：发布→匹配页/广播→接单→四确认→模拟支付→履约→评价→打赏；时间冲突与 50km 校验
- [ ] 隐私指引后台声明审核通过 → 真机验证真实 GPS → 删除自测模式（阻断项 1）
- [ ] 控制台统一调超时（或升级套餐），`functions info` 读回校验（阻断项 2）
- [ ] 测试环境重建 zz-selftest-timer 完成 order-timer all_pass 验收（阻断项 3，代码在 git `cf138e0`）
- [x] zz-selftest-timer 已从本地与云端删除（2026-09-12）
- [x] git 初始化与全量入库、PRD 恢复、备份归档（2026-09-12）
- [x] demand-match hall_list 的 HALL_DEBUG 全表日志已删除（2026-09-09 已部署，3.6KB）。
- [x] 把"CLI 不应用 timeout/triggers、免费版锁 3s"补进 `.trae/skills/wx-cloud-deploy/SKILL.md`（2026-09-10 已完成，含排障速查 3 条；2026-09-12 更新 IDE 新路径）。

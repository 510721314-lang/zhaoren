# 四项需求实施计划（考试/实名/客服/简介提交）

## Context

用户（找个人帮忙小程序）提出 4 项需求，探索确认现状后确定范围：

1. **耍伴接单考试**：完整考试页+题库。基础科目=耍伴考试（通用，所有接单前置）、提升科目=陪诊考试（W1 专项）。判分必须云端做（防作弊），考后写 `partner_profile.exam_scores`，接单时 fail-closed 校验。
2. **实名认证模拟**：用户选择「保持 mock/wx 双通道」→ 现状已满足（mock 仅 dev 可用、wx 占位），**无代码改动**，仅确认。
3. **客服后台工作台**：admin-web 后台查看会话/回复/标记处理状态。
4. **简介独立提交**：资料维护页个人简介框下加「更改」「提交」按钮（走现有栏目审核链路）。

## 需求1：耍伴接单考试（核心，跨端）

### 数据流
考试页拉题（不含答案）→ 用户答题 → `submit_exam` 云端判分 → 写 `exam_scores.base`（基础）/ `exam_scores.W1`（提升）→ order-create 接单时校验。

### 新增/修改
**云端 `c:\zhaoren\cloudfunctions\partner-action\index.js`**
- 新增常量 `EXAM_BANK`：基础科目（base）10 题 + 提升科目（W1/陪诊）10 题，每题单选 4 选项，含答案。字段 `{ subject, question, options[], answer_idx }`。
- 新增 action `get_exam_questions`：`event.subject`（base|W1）→ 返回题目（**剥离 answer_idx**）+ 通过线。
- 新增 action `submit_exam`：`event.subject + answers[]` → 云端用 EXAM_BANK 判分 → 写 `profile.exam_scores[subject]` + `exam_at[subject]` → 返回分数/通过态。fail-closed：科目不存在/答案缺失/重复提交（已有分且>=通过线）拦截。
- 通过线：`EXAM_THRESHOLD = { base: 60, W1: 80 }`（集中常量，可调）。
- `my_profile`（L557 附近）已有 exam_scores 回传，无需改。

**云端 `c:\zhaoren\cloudfunctions\order-create\index.js`**（L366-373 改造）
- 接单前统一校验：`exam_scores.base >= 60`（基础科目，全员强制）→ 未过返回 `order_base_exam_required`「需先通过耍伴基础考试」；W1 场景额外 `exam_scores.W1 >= 80`（保留现有 `order_w1_exam_required`）。
- 存量兼容说明：已认证耍伴若 exam_scores 无 base → 视为未考，接单被拦并提示去考试（符合需求本意；测试账号需先考试）。

**前端新增页面 `c:\zhaoren\miniprogram\pages-v2\pkg-low\exam\`**（4 件套）
- `exam.wxml/js/wxss/json`：支持 `?subject=base|W1`；拉题渲染（单选题、4 选项、逐题 or 一页多题）、提交 → `submit_exam` → 结果页（分数/通过/失败可重考）。
- 注册进 `app.json` pkgLow 分包 pages。
- json 用 `nav-bar` 组件（navigationStyle custom 与其他低频页一致）。

**前端 `c:\zhaoren\miniprogram\pages-v2\pkg-low\accept-config\accept-config.js + .wxml`**
- 现有「✓已通过/需考核」标签改为按真实分数（base 全场景通用标签 + 各场景标签），未过场景行加「去考试」跳转（`navigateTo /pages-v2/pkg-low/exam/exam?subject=base|W1`）。

**部署**：`partner-action`、`order-create` 两个云函数（全路径 cli.bat + `--remote-npm-install`）。

## 需求2：实名认证模拟 — 确认现状，无改动

mock 通道（dev-only）+ wx 占位双通道已具备（`realname.js` faceMode 双源读取、`user-login submit_realname` L437-441 双条件 fail-closed）。**不开发**，仅在本计划存档。

## 需求3：客服后台工作台

### 数据流
后台会话列表（分页+状态）→ 选会话读脱敏消息 → 客服回复（`from_role='kefu'` 写 im_message，内容安全/频控复用 im-send 逻辑，写 notice 定向通知用户）→ 置 `kefu_status` 处理状态。

### 新增/修改
**云端 `c:\zhaoren\cloudfunctions\admin-action\index.js`**
- 新增 action `kefu_conv_list`：按 `im_conversation` 倒序分页（复用 pager + 脱敏惯例），返回 `order_no/order_id/scene_name/双方昵称/最后消息/未读/kefu_status`，支持 `kefu_status` 筛选。
- 新增 action `kefu_conv_reply`：校验会话存在 → 写 `im_message`（`from_role:'kefu'`、`from_openid: 管理员openid`、type='text'，复用内容安全/违禁词降级）→ 置 `im_conversation.kefu_status='handled'` + `handled_at` → 复用 `order-action writeNotice`（或同构实现）通知 user/partner 两侧 → 返回 ok。
- `ROLE_GRANTS`（L15-43）：`kefu_conv_list` / `kefu_conv_reply` 授权 R3（管理员）。

**集合字段**：`im_conversation` 增加 `kefu_status`('unhandled'|'handled'，默认 'unhandled')、`handled_at`。注：集合是懒创建 + 自动加字段无需迁移脚本，缺省按 unhandled 处理。

**前端 `c:\zhaoren\admin-web-frontend\`**
- `src/views/Conversation.vue` 扩展为工作台：会话列表 + 选中查看消息 + 回复输入框 + 「标记已处理」按钮；或新增 `Kefu.vue` 独立工作台（推荐独立，避免污染只读监管页）。路由注册 `src/router/index.js`。
- 部署流程：npm run build → dist 清空重拷至 `cloudfunctions/admin-web/public` → 部署 admin-web。

**可选 P1（本轮可先不做）**：`chat.js` askKefu()（L641-667）接云函数落库「客服介入申请」+ 消息页 `entries.kefu` 联动。**默认本轮跳过**，避免范围膨胀，若用户要再做。

## 需求4：简介独立提交（纯前端）

### 改动 `c:\zhaoren\miniprogram\pages-v2\pkg-low\partner-profile-edit\`
- `partner-profile-edit.js`：data 加 `isBioEditing:false`（默认只读展示生效 bio）、`currentBio`；「更改」置 `isBioEditing:true`；「提交」调既有 `onSubmitField`（`data-which="bio"`，L274 已实现 bio 分支）→ 成功后退出编辑态。
- `partner-profile-edit.wxml`（L11-13 简介卡）：默认只读显示 `currentBio`（空态显示「暂无简介，点击更改填写」），编辑态显示现有 textarea；按钮区加「更改」（编辑态隐藏）/「提交」（`onSubmitField data-which="bio"`，pending/空 bio 禁用）。
- 云函数零改动（`update_partner_profile` → bio_pending → 栏目审核链路已通）。

## 关键文件

| 需求 | 文件 |
|---|---|
| 1 考试 | `cloudfunctions/partner-action/index.js`、`cloudfunctions/order-create/index.js`、`miniprogram/pages-v2/pkg-low/exam/*`（新建）、`miniprogram/pages-v2/pkg-low/accept-config/*`、`miniprogram/app.json` |
| 3 客服 | `cloudfunctions/admin-action/index.js`、`admin-web-frontend/src/views/`（Kefu.vue 新建或 Conversation.vue 扩展）、`admin-web-frontend/src/router/index.js` |
| 4 简介 | `miniprogram/pages-v2/pkg-low/partner-profile-edit/partner-profile-edit.js + .wxml` |

## 验证

1. **考试**：部署后 → 云端测试面板 mock_openid 调 `get_exam_questions(subject='base')` 确认题目无答案 → 调 `submit_exam` 传对答案得 60+/错答案 <60 → 再调 `order-create` 未过 base 返回 `order_base_exam_required`，过 base 后 W1 未过返回 `order_w1_exam_required`。
2. **客服**：部署 admin-action → 云测 `kefu_conv_list` 返回会话 → `kefu_conv_reply` 回复 → 查 im_message 有 `from_role:'kefu'` 记录 + 用户端 notice 出现。
3. **简介**：编译小程序 → 资料维护页点「更改」编辑 → 「提交」→ 后台资料审核出现 bio_pending → 通过后详情页生效。
4. 三项云函数改动均需全路径 cli.bat 部署（一次一个函数）。

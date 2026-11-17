# BUG 定位与分诊 SOP（G6）

> 覆盖**非报错类** BUG 的前端/云端分层定位方法论。
> 报错文案类（showToast/showModal 弹窗）走 [error-message-tracing](file:///c:/zhaoren/.trae/skills/error-message-tracing/SKILL.md) 技能（5 步溯源法）。
> 自动化失败归因走 [miniprogram-automation-test](file:///c:/zhaoren/.trae/skills/miniprogram-automation-test/SKILL.md)（脚本缺陷 vs 产品缺陷 5 步）。

## 0. 先分层：前端还是云端

| 判定信号 | 前端 BUG | 云端 BUG |
|---|---|---|
| 弹窗形态 | `wx.showModal`（白色居中=前端） | `wx.showToast`（深色顶部=云函数 msg） |
| Network | 无请求 / 请求未发 | 请求发出但返回 errCode/非 0 |
| 数据来源 | 页面 `data`/`setData`/storage | 云数据库 / 云函数返回 |
| 复现环境 | 模拟器 + 真机均现 | 换账号/换数据仍现 |

> 弹窗形态反推法来自 error-message-tracing：**showModal=前端代码主动弹，showToast=云函数返回 msg**。

## 1. UI 渲染异常（白屏/错位/样式失效/列表不渲染）

1. **Console 报错**：开发者工具 Console 是否有 `TypeError`/`Cannot read property`/`setData` 警告 → 定位文件:行号
2. **数据绑定**：`AppData` 面板看目标页面 `data` 是否有值 → 无值=上游 setData 漏传；有值但不渲染=WXML 绑定路径错
3. **样式隔离**：组件内样式不生效 → 检查 `styleIsolation`（组件默认 `isolated`，全局样式不穿透）→ 改 `apply-shared` 或在组件内补样式，**禁止直接搬进 app.wxss**
4. **条件渲染**：`wx:if` 条件为假 → 用 `wx:else` 占位验证
5. **真机差异**：模拟器正常但真机异常 → 通常是 rpx 适配/基础库版本/隐私授权差异，用 `vConsole` 看真机 Console

## 2. 逻辑错误（按钮无效/跳转错/状态不对/流程卡住）

1. **事件绑定**：WXML 的 `bindtap`/`catchtap` 方法名与 JS 的 methods 名是否一致（拼写、大小写）
2. **生命周期**：初始化逻辑放 `onLoad`（只执行一次）还是 `onShow`（每次进入）→ 数据需刷新的放 onShow
3. **页面栈**：`navigateTo` 最多 10 层；`switchTab` 不能带参数；`redirectTo` 销毁当前页 → 改动跳转须列受影响的返回路径
4. **状态机**：订单 13 态（S0–S10.5）流转非法 → 查 [PRD 附录G] 合法流转表 + 云函数 `order-action` 状态守卫
5. **并发/时序**：`wx.cloud.callFunction` 回调 vs async/await 混用 → 统一 async/await，禁止回调内再 await

## 3. 数据不一致（前端显示与云端不符/列表缺项/金额错）

1. **缓存**：前端读了 `wx.getStorageSync` 旧值 → 清 storage 后复现；涉及登录态须双通道清（`removeStorageSync('userInfo')` + `getApp().clearLoginUser()`）
2. **解包错误**：`where().get()` 返回**数组**，`doc().get()` 返回**对象** → 错用会导致 `.data` 取不到（error-message-tracing 高频坑）
3. **字段名漂移**：云函数返回字段改名但前端未跟 → grep 全仓字段名 + 查 `order_main` 实测字段
4. **金额**：一律「分」为单位整数，前端展示 `/100` → 浮点运算必错
5. **分页/limit**：列表只显示 20 条 → 检查 `limit()` 默认 20 上限与分页加载

## 4. BUG 分诊与定级

| 级别 | 判定 | 处理时限 |
|---|---|---|
| P0 | 登录/支付/下单/履约核心链路不可用、数据丢失、安全漏洞 | 立即修，修完即部署 |
| P1 | 主要功能不可用但有 workaround、影响提审 | 24h 内 |
| P2 | 次要功能异常、UI 错位不影响操作 | 按版本排期 |
| P3 | 文案、体验优化 | 积压处理 |

## 5. 标准化 BUG 报告

提 BUG 必须含（模板见 [`.github/ISSUE_TEMPLATE/bug-report.yml`](../../.github/ISSUE_TEMPLATE/bug-report.yml)）：

- **现象**：一句话描述
- **复现步骤**：1/2/3 可复现
- **期望**：应该怎样
- **实际**：实际怎样（截图 + Console 报错原文 + Network 请求/响应）
- **分层判定**：前端 or 云端（按 §0 表）
- **环境**：基础库版本 / 机型 / 账号
- **首次出现时间**：是否最近改动引入（查 git blame）

## 6. 修复纪律

- 一次只验证一个假设，禁止扫射式修改
- 连续两次未解决 → 停手，上报需用户提供报错原文/复现步骤/真机截图
- 禁止假修复：try/catch 吞异常 / setTimeout 掩盖时序 / 注释代码 / wx:if 改 hidden
- 修完必出回归验证清单（开发者工具可自证的 vs 需真机的分开列）

---
name: miniprogram-automation-test
description: 用 miniprogram-automator 在微信开发者工具模拟器里跑小程序 UI 自动化测试，定位 BUG 并辅助修复。Use when 用户要求对找人帮忙小程序做冒烟/回归/UI 交互测试，或需要复现某个 UI BUG、验证修复效果、产出测试报告时。Do not use for 云函数入口契约测试（走 cloud-entry-contract-test）、纯代码静态审查（走 zhaoren-audit/miniprogram-audit）、或真机支付/定位/推送验证（模拟器不可达，需人工真机）。
---

# 小程序 UI 自动化测试（miniprogram-automator）

基于 `miniprogram-automator ^0.13.0` 驱动微信开发者工具模拟器，对找人帮忙小程序做 UI 层冒烟/回归/交互测试，产出可追溯报告并辅助 BUG 定位。

## 项目环境（已就绪）

- CLI 路径：`C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`（见 `.mcp.json`）
- 依赖：`miniprogram-automator ^0.13.0`（`package.json` devDependency）
- 配置加载：`scripts/load-env.cjs` 导出 `devtools`（cliPath/projectPath/autoPort/servicePort）与 `validateDevtools()`
- 环境自检：`npm run check:devtools`

## 关键约束（先读）

- **模拟器 ≠ 真机**：支付、定位、推送、蓝牙、订阅消息等能力链路在模拟器上不可用或行为不一致，这类 BUG 仍需人工真机验证。
- **不改业务代码**：测试脚本放 `tests/e2e/`（首次使用时创建），禁止在 `miniprogram/` 源码里加测试桩。
- **失败二分法**：用例失败时先区分「产品缺陷」还是「脚本缺陷」（见下文「失败归因」），禁止直接把失败用例等同于 BUG。
- **PowerShell 语法**：Windows 环境禁止用 `&&` 链式命令，用 `;` 或分多行。

## 标准启动序列（Windows，已实证 2026-11-16）

经验教训：
1. `automator.launch()` 在 Windows+Node24 下 `spawn EINVAL` 失效（`.bat` + `stdio:['ignore']`）。
2. `cli.bat auto` 退出时会杀掉 DevTools 子进程，导致自动化端口 9420 释放。
3. 正确做法：**独立启动 DevTools GUI（detached）→ 等 IDE server 33306 → spawn `cli.bat auto`（shell:true）→ 等端口 9420 → connect → 轮询 currentPage 等编译**。

### 推荐：直接用共享启动模块

项目已封装 `tests/e2e/devtools-launcher.js`，导出 `startDevTools()` 和 `waitForReady(mp, maxSec)`：

```js
const automator = require('miniprogram-automator');
const { PORT, startDevTools, waitForReady } = require('./devtools-launcher');

await startDevTools();                              // 启动 DevTools + 开端口
const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
await waitForReady(mp, 30);                          // 轮询 currentPage 等编译
// 跑测试...
await mp.disconnect();
```

### 手动启动（不用模块时）

```powershell
# 1. 独立启动 DevTools GUI（detached，不随命令退出）
Start-Process "C:\Program Files (x86)\Tencent\微信web开发者工具\微信开发者工具.exe"
# 等 33306 监听（约 3-10s）
while (-not (Test-NetConnection 127.0.0.1 -Port 33306).TcpTestSucceeded) { Start-Sleep 1 }

# 2. cli.bat auto 开自动化端口（shell:true，等退出）
& "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto --project C:\zhaoren --auto-port 9420
# 等 9420 监听
while (-not (Test-NetConnection 127.0.0.1 -Port 9420).TcpTestSucceeded) { Start-Sleep 1 }
```

### 一键跑全部测试

```powershell
npm run test:e2e:all    # P0(45页) + P1(6链路)，产出 Markdown 报告
npm run test:e2e        # 仅 P0 页面冒烟
npm run test:e2e:flows  # 仅 P1 链路冒烟
```

### 跑最简测试 + 收尾

```js
const page = await mp.reLaunch('/pages-v2/index/index');
if (!page) throw new Error('reLaunch returned undefined');
console.log(page.path);  // path 是属性(string)，不是方法
const data = await page.data();  // data() 是异步方法
await mp.disconnect();
```

> **不要**用 `automator.launch({ cliPath, projectPath })`——Windows 上 spawn `.bat` 的兼容性问题会导致无法启动或连接超时。

## 常用 API 坑（已实证）

| API | 正确用法 | 易错点 |
|---|---|---|
| `page.data()` | `const data = await page.data()` | **异步方法**，不是属性。写成 `page.data` 拿到函数对象，断言全错 |
| `page.path` | `console.log(page.path)` | **属性**(string)，不是方法。写 `page.path()` 报 "is not a function" |
| `pageStack()` | `const pages = await miniProgram.pageStack()` | 获取页面栈。**没有** `currentPages` 方法 |
| `currentPage()` | `const p = await miniProgram.currentPage()` | 获取当前页，返回 `Page \| undefined` |
| `reLaunch(url)` | `const page = await miniProgram.reLaunch(url)` | 返回 `Page \| undefined`，需判空 |
| `page.$(selector)` | `const el = await page.$('.btn')` | 返回元素句柄，需 await |
| `element.text()` | `const t = await el.text()` | 异步 |
| `page.setData({k:v})` | `await page.setData({k:v})` | 异步 |
| `page.waitFor(selector)` | `await page.waitFor('.toast', 5000)` | 第二个参数是超时 ms |
| 导航 | `miniProgram.reLaunch('/pages/x/x')` | 不要用 `navigateTo` 测 tabBar 页 |

完整 API 见 `node_modules/miniprogram-automator/out/MiniProgram.d.ts` 和 `Page.d.ts`。

## 失败归因（核心纪律）

用例失败时，按此顺序排查，**先排除脚本缺陷再报产品 BUG**：

1. **API 误用**（最常见）：`page.data` 写成属性、忘记 await、选择器写错。对照 `automator.d.ts` 核对。
2. **时序问题**：页面还没渲染完就断言。加 `page.waitFor(selector, 5000)` 或 `page.waitFor(500)`。
3. **数据未加载**：页面依赖云函数返回，模拟器冷启动慢。加 `await page.waitFor(2000)` 或轮询 `page.data()`。
4. **环境问题**：开发者工具未登录、项目未编译、网络不通。看开发者工具 Console 报错。
5. **产品缺陷**：以上都排除后，断言仍失败 → 记录为 BUG，附：页面路径、复现步骤、期望/实际、截图。

## 超时陷阱与假通过防护（2026-11-16 实证）

### spawnSync 超时假通过

- **现象**：`spawnSync` 子进程被 `timeout` 杀掉时 `result.status === null`，stdout 可能不完整
- **陷阱**：编排器靠解析 stdout 的 `SUMMARY` 行统计 pass/fail；超时后无 SUMMARY → pass/fail 全 0 → 汇总 `exit 0` **假通过**（51 用例静默缩水成 6 用例，门禁绿灯）
- **修复**：
  1. `timeout` 留足余量（覆盖 DevTools 冷启动 ~22s 编译），不要贴着实测耗时
  2. `result.status === null` 时显式 `fail += 1`，禁止按"解析不到=通过"处理
- **实证**：`run-all.js` P0 偶发超时（云函数冷启动波动），旧代码假通过 exit 0；修复后正确判败 exit 1

### 单页无超时保护

- `smoke-pages.js` 每页 `reLaunch`/`data()` 无单页超时，某页卡住会拖死全进程直到 spawnSync `timeout`
- 偶发超时多为**云函数冷启动波动**，非代码缺陷；频繁出现再立项加单页超时保护

## 报告模板

测试完成后输出 Markdown 报告，**必须区分产品缺陷与脚本缺陷**：

```markdown
# 小程序 UI 自动化测试报告

## 概览
- 测试时间：YYYY-MM-DD HH:mm
- 用例总数：N
- 通过：X / 失败：Y / 脚本缺陷：Z

## 产品缺陷（需修复）
| # | 页面 | 复现步骤 | 期望 | 实际 | 严重度 | 截图 |
|---|---|---|---|---|---|---|

## 脚本缺陷（需修测试，非产品问题）
| # | 用例名 | 根因 | 修复方式 |
|---|---|---|---|

## 冒烟结论
L1 冒烟：通过 / 不通过（P0 用例是否全绿）
```

## 与其他技能的边界

| 场景 | 走哪个 |
|---|---|
| 云函数入口输入→返回码契约 | `cloud-entry-contract-test` |
| 小程序 UI 交互/页面流转/渲染 | 本技能 |
| 提审前静态扫描（无 BUG 运行时行为） | `miniprogram-audit` / `mp-pre-release-audit` |
| 报错文案溯源（前端 toast vs 云函数 msg） | `error-message-tracing` |
| 运行时插桩采证（复杂 BUG） | `TRAE-debugger` |

## 首次使用检查清单

1. `npm install` 已装 miniprogram-automator
2. `npm run check:devtools` 通过
3. 开发者工具已登录（否则 auto 命令会弹登录框）
4. 创建 `tests/e2e/` 目录放测试脚本
5. 跑一个最简冒烟（reLaunch 首页 + 断言 page.data 非空）验证链路

## L3 全链路云函数调用链 e2e（2026-11-17 实证）

> 适用：验证「发布→接单→四确认→支付→履约→评价」等跨多云函数的端到端业务流。不碰 UI 交互，纯靠 `mp.evaluate(fn)` 在 AppService 调 `wx.cloud.callFunction`。

### 核心机制

| 机制 | 说明 |
|---|---|
| `mock_openid` 切换身份 | env=dev 时，`cloudfunctions/_shared/openid.js` 用 `event.mock_openid` 覆盖真实 OPENID。user 传 admin openid，partner 传 `test_partner_001` |
| `force_set_env` | 调 `init-db {action:'force_set_env', env:'dev', reason, confirm:true}`，4h 自动回 prod。只清 init-db 本进程缓存，其他函数 5min 短缓存自然过期 |
| `isMockCall` 逻辑 | `isMockCall = (wxCtx && !wxCtx.OPENID) && mock_openid`。**DevTools 有真实 OPENID → isMockCall=false → 定位/照片校验全部生效**，必须传真实格式数据 |

### 脚本骨架（17 步）

```
[0] 启动 DevTools（复用 devtools-launcher.js）
[1] force_set_env(dev) → sleep(60s 等缓存过期)
[1.5] 前置 purge_test_data(scope:'all_istest') 清上次残留
[2] simulate_realname(partner)
[3] sign_disclaimer W8 (partner)
[4] publish(user) → demand_id
[5] create_from_take(partner) → order_id, status=S1
[6] confirm_all(partner) → 4/8
[7] confirm_all(user) → status=S0
[8] mock_pay(user) → status=S2
[9] start_apply(partner) → status=S2_6
[10] start_confirm(user) → status=S3
[11] milestone_submit×3 (partner)
[12] finish_apply(partner) → status=S3_6
[13] finish_confirm(user) → status=S5
[14] evaluation(user) → status=S8
[15] order detail 断言 status=S8, milestone=3/3
[16] purge_test_data 清理
[17] force_set_env(prod)
```

### 已实证的 4 个坑（必避）

1. **字段路径逐 action 核对**：禁止假设相似 action 字段一致。`start_apply` 读顶层 `start_location`，但 `finish_apply` 读 `finish_evidence.partner_location`（action_lifecycle.js:621）。传顶层 `finish_location` 被静默丢弃 → `oa_finish_apply_location_required`。
2. **前置 purge**：上次失败残留 is_test demand → 同场景同时段发布返 `publish_time_conflict`。force_set_env 后必须先 purge 再 publish。
3. **purge dry-run 取值**：dry-run 返回 `{stats:{order_main:N}}`，取 `raw.stats.order_main`；`actual_orders` 仅在 expect_orders 不匹配的错误返回里出现，dry-run 取不到。
4. **env 缓存**：`force_set_env` 只清 init-db 缓存，order-action/demand-publish 等热容器仍缓存 prod 最长 5min。冷启动 60s 足够；热容器需等 5min 或多调几次触发冷启动。

### 调用封装

```js
async function callCloud(mp, name, event, mockOpenid) {
  return await mp.evaluate(async ({ name, event, mockOpenid }) => {
    const res = await wx.cloud.callFunction({ name, data: { ...event, mock_openid: mockOpenid } });
    return res.result;
  }, { name, event, mockOpenid });
}
```

### 异常兜底

catch 块必须 `force_set_env(prod)` 切回生产环境，防止 env 永久留在 dev。残留数据靠下次运行的前置 purge 清理。

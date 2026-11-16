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

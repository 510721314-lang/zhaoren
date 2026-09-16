---
name: miniprogram-audit
description: 微信小程序提审前 7 项静态对齐审计. Use when the user asks for pre-release audit, 提审前检查, 代码审查, v2 页面对齐, 或者上线前跑一遍全链路静态扫描.
---

# Miniprogram Audit — v2 提审前静态对齐审计

冻结项目根: `<workspaceFolder>/miniprogram`. 不碰 `pages/`、`mock/` 等已排除目录.

## 执行顺序 (必须按顺序)

每个 C 步骤输出一行 `[Cn] PASS 简述` 或 `[Cn] FAIL 简述 + 定位行号`. 遇到 FAIL 立即停, 不跳步.

### C1 — IDE 编译 + 诊断 (人工 + GetDiagnostics)
1. 让用户在微信开发者工具点编译, 确认 16 个 tab/v2 页无白屏无红线.
2. `GetDiagnostics` 全扫, 零错误 = PASS.

### C2 — 路由对齐 (Grep)
```powershell
# 前端所有跳转
grep -rn "url:.*'/pages/" pages-v2/ components/ | grep -v "switchTab.*index\|pages-v2"
```
零命中 = PASS. 任何 `/pages/xxx` (v1 路径) 都是死链 — 改成 v2 路径或用 modal 占位.

同时核对 profile.js 的动态拼接 (如 `` `/pages-v2/${key}/${key}` ``) — 所有可能的 key 值都必须在 app.json 里注册.

### C3 — WXML bind 事件 vs JS 方法 (脚本)
```powershell
powershell -ExecutionPolicy Bypass -File .trae/skills/miniprogram-audit/scripts/c3-bind-handler-alignment.ps1
```

**坑位记忆**:
- 不要 `Match` 单次, 必须用 `[regex]::Matches` + `Groups[1]` 收集所有名.
- 正则必须接受 `(?:async\s+)?` 前缀, 否则 `async onSave()` 会被漏报.
- 组件事件 (如 bottom-sheet 的 `bind:close`) 也要扫.

### C4 — 云函数 action 契约 (脚本)
```powershell
powershell -ExecutionPolicy Bypass -File .trae/skills/miniprogram-audit/scripts/c4-cloud-contract.ps1
```

**坑位记忆**:
- 前端 `callCloud('fn', { action: 'xxx' })` 同文件多函数交叉 require, 禁止全局配对 — 脚本用"调用点往后 300 字符内、下一个 callCloud 之前"就近配对.
- 后端 **两种写法** 都要匹配:
  - `case 'x':` (switch)
  - `if (action === 'x')` / `if (action !== 'x')` (守卫子句) — 守卫里的 `!==` 也必须算, 因为它隐含接受 `!==` 以外的全部 case.

### C5 — 本地资源引用 (Grep)
```powershell
grep -rn "\.(png|jpg|svg|gif|webp)" pages-v2/ components/ custom-tab-bar/
```
零本地图片引用 = PASS (v2 用 emoji + CSS, 不需要资源文件). 任何命中都要确认文件存在.

### C6 — 工程合规 (Read + GetDiagnostics)
依次 Read 并确认:
1. `miniprogram/app.json` — `__usePrivacyCheck__: true`, `requiredPrivateInfos` 声明 getLocation/chooseLocation, tabBar 4 tab 全 v2, `pages[]` 只有 v2 的 16 页.
2. `miniprogram/sitemap.json` — 存在且 parseable JSON.
3. `project.config.json` — `packOptions.ignore` 含 `pages`(v1)/`mock`/`utils/testmode.js` 三排, `lazyCodeLoading: 'requiredComponents'`(可选优化).
4. `miniprogram/app.js` — `globalData` 里没有 mock flag / v1 开关.
5. 全局扫 `DEV|dev_|testmode|V2_MOCK|模拟支付` — 零命中.
6. 全局扫 openid 直接渲染 — 零命中 (`{{xxx.openid}}` / `"{{xxx}}"` 而该字段实际是 openid 字符串).

### C7 — 备份 (Shell)
```powershell
git add -A
git commit -m "chore(release): vX.Y.Z audit done"
git tag vX.Y.Z
git archive --format=zip --output "$env:USERPROFILE\Desktop\zhaoren-vX.Y.Z-release.zip" HEAD
```
验证 zip 存在且 > 10 MB (完整项目).

## 已踩过的坑 (不要重犯)

| # | 坑 | 根因 | 正确做法 |
|---|---|---|---|
| 1 | 误信 Glob「文件不存在」 | Glob 有 bug, 某些相对路径返回空 | 永远先 Grep 确认再删 require |
| 2 | 同文件多 callCloud 交叉 require | 正则全局配对会串 | 就近配对: 调用点 300 字符内、下一个调用点之前 |
| 3 | 守卫写法漏匹配 `!==` | 只写 `===` | 正则必须 `===?|!==?` 四运算符 |
| 4 | async 方法被漏报 | 正则只写 `name\(` | 必须 `(?:async\s+)?name\(` |
| 5 | 内联代码漏原始步骤 | takeOrder 内联错写云函数名 order-action (正确 order-create) 且漏 sign_disclaimer | 能不内联就不内联, 复用 `utils/` 模块 |
| 6 | C3 改了事件名忘记 WXML | WXML `bindtap="onAlarm"` 但 JS 叫 `onAlarmTap` | 改名脚本会抓出, 但改代码时同步改两边 |
| 7 | openid 作 avatar 字段 | 后端 user_account.avatar 存 openid 字符串 | 前端正则 `/^https?:/.test(avatar)` 防御 |

## 交付格式

每步 PASS 一行. 任何 FAIL 输出:
```
[Cn] FAIL
  文件: path/to/file.js:line
  问题: 一句话
  修: 一句话
```
全部 PASS 后给最终结论 + git tag + zip 路径.

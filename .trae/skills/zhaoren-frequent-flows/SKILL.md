---
name: zhaoren-frequent-flows
description: 找人帮忙项目高频开发运维流程固化。Use when 需要门禁验证、体验版上传、nosql 查询/更新、Git push 绕代理、admin_config 配置变更、提审冻结期切换、或 admin-web 构建发布与后台登录 401 排障。Do not use for 云函数部署（wx-cloud-deploy）、提审审计（zhaoren-audit/mp-pre-release-audit）、经验沉淀（zhaoren-experience-sedimentation）。
---

# Zhaoren 高频流程固化

找人帮忙项目日常开发运维反复执行的 7 条高频链路。每条含触发时机、可复制命令、前置条件、验证方法、踩过的坑。

## 全局常量（勿再探测）

| 常量 | 值 |
|---|---|
| 项目根 | `C:\zhaoren` |
| 工作目录 | `C:\zhaoren`（cwd 默认） |
| 云环境 ID | `cloud1-d9gkefwcp5c777088` |
| AppID | `wxbc4a4afacdf234f5` |
| 开发者工具 CLI（主用） | `C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`（2026-10-26 实测；桌面旧路径已失效） |
| 云开发 CLI | `C:\Users\DC\AppData\Roaming\npm\cloudbase.cmd`（2026-10-26 实测；`Administrator` 旧路径已不存在） |
| 当前 HEAD | 实跑 `git -C C:\zhaoren rev-parse HEAD` |
| origin/master | 实跑 `git -C C:\zhaoren rev-parse origin/master` |
| 工作区状态 | 实跑 `git -C C:\zhaoren status --short` |
| 提审冻结期（T0.8） | 体验版 v1.6.42 已上传 → 提审选 1.6.42（下一版 1.6.43）；冻结 miniprogram/+cloudfunctions/ 业务代码 |

---

## 流程 1：门禁验证全链（每次 commit 前必跑）

### 触发时机

- 业务代码改动后
- docs-only commit 后（可选，门禁通常不敏感）
- 部署云函数前
- 体验版上传前

### 命令（一键跑）

```powershell
cd C:\zhaoren
npm.cmd test                       # node --test cloudfunctions/_shared/*.test.js + ab_equivalence.js
node scripts/check-syntax.js       # 语法检查（约 250 files）
node scripts/check-ssot.js         # 硬编码检查（期望 0）
node scripts/check-shared-sync.js  # 场景配置跨端一致性
```

### 验证口径

```
tests 581 / pass 581 / fail 0      ← 基线取实跑，不取 HANDOFF 里可能的旧数字
A/B EQUIVALENT: 439 cases
SYNTAX ALL OK
SSOT 硬编码 0
SHARED SYNC ALL OK
```

### 踩过的坑

- `npm` 在 PowerShell 5 里默认 alias 到 `npm.cmd` 不可靠 → **用 `npm.cmd`**
- HANDOFF 里记的 pass 数字可能是子集（v8 写 44 实际全量 521；本次 581）→ **每次实跑**
- SSOT 若报新增硬编码 → 定位文件 + 改为引用 config/index.js

---

## 流程 2：体验版上传 vX.Y.Z

### 触发时机

- 代码冻结、门禁全绿、准备上传体验版
- 用户批准版本号递增

### 前置条件

- 门禁全绿（流程 1 刚跑完）
- 版本号经用户确认（T0.8）
- 开发者工具 CLI 已登录、IDE 可启动

### 命令

```powershell
& "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" `
  upload --project "C:\zhaoren" `
  -v X.Y.Z `
  -d "上传描述文本"
```

### 验证口径

```
✔ IDE server has started
✔ Using AppID: wxbc4a4afacdf234f5
✔ upload
TOTAL XXX.X KB (main XXX.X KB / admin / agreement / pkg-low / privacy)
```

### 登记（docs-only commit + push）

在 `docs/deploy-log.md` 追加一行：

```markdown
| YYYY-MM-DD | 小程序（体验版上传） | `<前一HEAD>` | `<当前HEAD>` | 未归档 | `<当前HEAD>` | 体验版 **vX.Y.Z** 上传：CLI EXIT=0 / ✔ upload / TOTAL XXX.X KB；描述「xxx」；门禁 EXIT=0（tests N/0, A/B N EQUIVALENT） |
```

然后：
```powershell
git -C C:\zhaoren add docs/deploy-log.md
git -C C:\zhaoren commit -m "docs: deploy-log 追加 vX.Y.Z 体验版上传记录"
git -C C:\zhaoren -c http.proxy= -c https.proxy= push origin master
```

### 踩过的坑

- `project.config.json` **没有** version 字段——上传版本号由 CLI `-v` 参数控制，不要去改受保护文件
- v1.6.31/1.6.32 曾出现同号冲突——CLI 上传成功后用户手动上传规避同号，版本号必须每次递增
- CLI upload 前必须先登录（`cli login`），否则报 credential 失效

---

## 流程 3：nosql execute 正确姿势（查 / 改 集合）

### 触发时机

- 查 admin_config.global 最新值
- 验证集合索引 / 文档存在性
- 批量数据修复 / 迁移

### 绝对铁律

**PowerShell 引号无法可靠包裹双层 JSON**。必须用 `.cjs` 脚本 `spawnSync(cliPath, argsArray, {shell:true})`。

### 模板脚本（存 C:\zhaoren\.tmp-tcb\_action.cjs）

```js
const { spawnSync } = require('child_process');
const cli = 'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\cloudbase.cmd';
const envId = 'cloud1-d9gkefwcp5c777088';

// ===== 按需改这一段 =====
const cmd = JSON.stringify([{
  TableName: 'admin_config',
  CommandType: 'QUERY',
  Command: JSON.stringify({ find: 'admin_config', filter: { _id: 'global' }, limit: 1 })
}]);
// =========================

const r = spawnSync(cli, ['db', 'nosql', 'execute', '--env-id', envId, '--command', cmd, '--json'], {
  encoding: 'utf8',
  shell: true,
  timeout: 30000
});
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
process.exit(r.status ?? 0);
```

```bash
node C:\zhaoren\.tmp-tcb\_action.cjs
```

### QUERY / UPDATE / COMMAND 模板（照抄）

#### 查单文档

```js
Command: JSON.stringify({ find: 'admin_config', filter: { _id: 'global' }, limit: 1 })
```

#### 更新（update 必须带 q，禁止 q:{} 全量匹配）

```js
Command: JSON.stringify({ update: 'admin_config', updates: [{
  q: { _id: 'global' },
  u: { '$set': { realname_face_mode: 'wx', updated_at: Date.now() } }
}]})
```

#### 尝试 MongoDB 原生命令（如 listIndexes）

```js
CommandType: 'COMMAND',
Command: JSON.stringify({ listIndexes: 'order_main' })
// 注意：CLI 可能不支持，返回 CommandNotFound 属正常
```

### 替代方案：dump + 本地解析（更稳）

```powershell
& cloudbase.cmd db nosql dump --env-id cloud1-d9gkefwcp5c777088 admin_config --output-dir C:\zhaoren\.tmp-tcb --json
# 下载 NDJSON，按 \n split 逐行 parse
```

### 踩过的坑（P6/P7/P18）

- `cloudbase.cmd` + PowerShell 引号 → **必炸**（嵌套 JSON 引号被 PowerShell 吃掉）
- `shell:false` → cloudbase.cmd 报 `EINVAL`；**必须 `shell:true`**
- nosql execute 报错 `INVALID_PARAM ... Expected property name or '}'` → 99% 是引号被 PowerShell 破坏了，改用 .cjs
- dump 返回 **NDJSON**（每行一个 JSON），不能 `JSON.parse(content)`，必须按 `\n` split 逐行 parse
- wx-server-sdk 本地无凭据，不能直接在 js 里 require；**必须用 CLI**

---

## 流程 4：Git push 绕代理（每次 commit 后）

### 触发时机

- commit 完成需要推送
- HANDOFF 或 deploy-log 更新后推送

### 命令（必加 `-c http.proxy= -c https.proxy=`）

```powershell
git -C C:\zhaoren -c http.proxy= -c https.proxy= push origin master
```

### 验证（推送前后都要跑）

```powershell
git -C C:\zhaoren rev-parse HEAD              # 当前
git -C C:\zhaoren rev-parse origin/master     # 远端
git -C C:\zhaoren rev-list --count origin/master..HEAD   # 应 = 0
```

### GitHub 断连排障（P17）

```powershell
# 测连通性
try { (Invoke-WebRequest -Uri https://github.com -UseBasicParsing -TimeoutSec 10).StatusCode } catch { "NET_FAIL" }
# → 失败 = 网络问题，不是代理/凭据；等几秒再试
```

### 踩过的坑

- **本机默认代理死在 7890 端口**——每次 push 必须绕开，漏一次就卡 21 秒超时
- push 是 `[git.exe]` 子进程，不继承 PowerShell 会话里的代理变量，必须 `-c` 参数显式传

---

## 流程 5：admin_config 配置变更链

### 触发时机

- 提审期临时开闸：`realname_face_mode` → `mock`（审核员走通全链）
- 提审通过后关闸：`realname_face_mode` → `wx`
- 支付 mock 开关：`mock_payment_enabled`
- 自动审核开关：`auto_approve_partner`

### 五步链（不能跳步）

```
① dump 读当前值   →  留底
② execute 改值    →  用 update 带 q: { _id: 'global' }
③ dump 重读       →  验证变更已生效
④ config_history  →  确认有审计记录
⑤ docs-only commit →  deploy-log + HANDOFF 同步
```

### dump 读当前值（流程 3 模板）

```js
// QUERY 模板查 admin_config.global
```

### execute 改值（流程 3 模板，update 带 q）

```js
Command: JSON.stringify({ update: 'admin_config', updates: [{
  q: { _id: 'global' },
  u: { '$set': { realname_face_mode: 'wx', updated_at: Date.now() } }
}]})
```

### config_history 验证（QUERY 模板）

```js
Command: JSON.stringify({ find: 'config_history', filter: { key: 'realname_face_mode' }, limit: 5, sort: { _id: -1 } })
```

### 配置速查（当前正常值）

| 键 | 提审期值 | 提审通过后 | 说明 |
|---|---|---|---|
| `env` | `prod` | 不变 | |
| `realname_face_mode` | `wx`（审核员需走通全链） | 不变 | |
| `mock_payment_enabled` | `true`（真实支付未上线） | **立项时改 `false`** | P1-6 关闸 |
| `auto_approve_partner` | `true`（审核员自助入驻即可通过） | **提审通过后回 `false` + 清理自动通过档案** | P1-7 关闸 |
| `admin_openids` | 2 个管理员 openid | 不变 | |

---

## 流程 6：提审冻结期纪律切换

### 冻结期红线（R4 · 用户硬约束）

冻结期 = 提审前代码零改动，以下动作**禁止**：

1. **miniprogram/** 业务代码改动 → 禁止
2. **cloudfunctions/** 业务代码改动 → 禁止（已部署函数）
3. 点击 mp 后台「提交审核」→ 禁止（用户手动操作）
4. 真实微信支付接入 / SMS SDK → 禁止（需资质）
5. 删业务代码 → 禁止

### 冻结期**允许**的动作

1. docs-only commit（CHANGELOG / deploy-log / HANDOFF / tech-debt）
2. admin_config 运营配置变更（realname_face_mode / mock_payment_enabled）
3. tcb CLI 索引只读查询（listIndexes）
4. 门禁验证（不改代码，只跑）
5. Git push / pull / rebase
6. 新增测试文件 / 测试 mock（不改变业务逻辑）
7. MCP / Jest / E2E 测试基础设施完善

### 冻结期切解冻触发条件

- mp 后台审核驳回（驳回即解冻，需重新立项）
- 用户手动批准解冻（书面授权 + 递增版本号）

### 冻结期 checklist（开工前跑一遍）

```powershell
git -C C:\zhaoren status --short          # 必须 0 M；?? 仅为 5 份用户 SOP
git -C C:\zhaoren rev-list --count origin/master..HEAD   # 应 = 0（完全同步）
npm.cmd test 2>&1 | Select-String "pass|fail"   # 全绿
node scripts/check-syntax.js              # ALL OK
node scripts/check-ssot.js                # 硬编码 0
```

---

## 流程 7：后台（admin-web）构建发布与登录排障

### 触发时机

- 改完 `admin-web-frontend/` 后要让真实地址生效
- 后台登录报 401 / 页面看不到新改动

### 两个域名别混用

| 用途 | 地址 |
|---|---|
| **静态托管（SPA，测试/使用走这个）** | `https://cloud1-d9gkefwcp5c777088-1482004365.tcloudbaseapp.com/` |
| **HTTP 网关（云函数 /api）** | `https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api` |

网关域的 `/` 也返回 SPA HTML，但**走 CDN 缓存**，部署后仍是旧构建（实测托管域 `index-CNRxHc88.js` vs 网关域 `index-DG37DiD9.js`）。

### 命令

```powershell
# 构建 + 发布（默认单行写法：先 build 再 deploy）
npm.cmd run build
& "C:\Users\DC\AppData\Roaming\npm\cloudbase.cmd" hosting deploy ./dist -e cloud1-d9gkefwcp5c777088 --safe
# 验证生效（比对 assets/index-*.js 哈希）
(Invoke-WebRequest "https://cloud1-d9gkefwcp5c777088-1482004365.tcloudbaseapp.com/?v=$((Get-Random))" -Headers @{'Cache-Control'='no-cache'} -UseBasicParsing).Content -match 'assets/index-[A-Za-z0-9_\-]+\.js'
```

### 纪律

- **禁用 `--prune`**：会删除云端既有 `__auth/*`、`cloud-admin/index.html`
- 回滚口径 = 按指定 commit 重建 dist 再发布（dist 可由源码重建，不单独备份）
- 登录 401 排查顺序：先看 `platform_event` 是否有 `gateway_bad_key`（有 = 密钥值不符；`admin_login` 免 key 不产生该事件，可据此排除账号密码错）

```powershell
# 取证：带有效 key 读最近事件
Invoke-RestMethod -Uri ".../api" -Method Post -Headers @{'X-Admin-Key'=$k;'Content-Type'='application/json'} -Body '{"action":"event_list","limit":15}'
```

- 密钥文件 `C:\zhaoren-bak\admin-key-*.txt` 首行是 `AWK_KEY=<68位>`。**实测口径**（2026-10-25）：整行粘贴 `AWK_KEY=<key>` → **HTTP 401 `bad_key`**（真凶）；`key+' '` 或 `'\t'+key` → **200**（首尾半角空白被 HTTP 头剥离）；全角空格 U+3000 → 浏览器抛非法头字符异常。已实现 `normalizeKey`（trim + 剥离 `AWK_KEY=` 前缀），整行粘贴也能登录；仍建议只填本体。

---

## 错误速查表

| 现象 | 根因 | 正确姿势 |
|---|---|---|
| push 超时 21s | 本机默认代理 7890 死端口 | `-c http.proxy= -c https.proxy= push` |
| nosql execute 报 `INVALID_PARAM ... Expected property name` | PowerShell 引号破坏 JSON | .cjs + spawnSync + shell:true |
| nosql execute 报 `EINVAL` | cloudbase.cmd 在 spawnSync 里 shell:false | 改 `shell: true` |
| dump 后 JSON.parse 报 Unexpected token | dump 返回 NDJSON | 按 `\n` split 逐行 parse |
| CLI upload 报 `credential invalid` | 开发者工具登录态过期 | `cli login -f image` 扫码重新登录 |
| npm 报 CommandNotFoundException | PowerShell 默认 alias 指向 `.cmd` 但 exit code 传递不稳 | 显式 `npm.cmd test` |
| GitHub 测连通 `NET_FAIL` | 网络层断连，不是代理/凭据 | 等几秒重测，勿改代码 |
| push 报 `Connection was reset` 且代理端口 7890 在监听 | 代理端口活着但**路由不通**（与「死端口」不同形态） | 仍用 `-c http.proxy= -c https.proxy=` 直连重试；先 `Test-NetConnection github.com -Port 443/22` 判层 |
| 后台登录 `401 Request failed with status code 401` | **整行粘贴带 `AWK_KEY=` 前缀**（实测必 401；半角首尾空白会被 HTTP 剥离、不是真凶；全角空格会在浏览器抛非法头异常） | 已实现 `normalizeKey` 自动剥前缀+trim；仍失败则查 `gateway_bad_key` 事件 |
| 后台页面看不到新改动 | 开的是网关域（CDN 旧构建） | 换托管域 `tcloudbaseapp.com` + Ctrl+F5 |

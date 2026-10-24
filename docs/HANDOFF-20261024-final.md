# 【衔接提示词 · 自包含终版】找人帮忙小程序 · 2026-10-24

> ⚠️ **直接粘贴本文件全文到新会话首条消息即可开工**。本文件已经合并 v7 → v8 → v9 全部有效条目，是**唯一现行版**，无需再链式读取其他 HANDOFF 文件。
> 基线 = HEAD `d1a5320`；ahead origin = 1（v9 HANDOFF 待推，网络恢复后一次 push）。

---

## 0. 开场回执（开工前立刻填）

| 编号 | 校验项 | 期望值 | 实测 |
|---|---|---|---|
| T0.0 | 工作目录 | `C:\zhaoren` | |
| T0.1 | HEAD | `git rev-parse HEAD` = **`d1a5320`** | |
| T0.2 | origin/master | `git rev-parse origin/master` = **`19b8d98`** | |
| T0.3 | ahead | `git rev-list --count origin/master..HEAD` ∈ **{0, 1}**（0 = v9 已推；1 = 待推） | |
| T0.4 | 工作区 | 0 M + 5 ?? 用户 SOP 文档；**禁 git add 5 份用户 SOP** | |
| T0.5 | 门禁 | `npm run test` → **521/521 全绿**；A/B **439**；SYNTAX 250 全过；SSOT 硬编码 0 | |
| T0.6 | appID/env | `wxbc4a4afacdf234f5` / `cloud1-d9gkefwcp5c777088` | |
| T0.7 | admin_config.global | `env=prod` / `mock_payment_enabled=true` / **`realname_face_mode=wx`** / `admin_openids=[2]` | |
| T0.8 | 当前上传版本 | 体验版 **v1.6.36**；下一版 **v1.6.37** 待上传 | |
| T0.9 | 必读文件 | `.trae/rules/project_rules-20261013.md` / `.trae/rules.md` / `docs/tech-debt-inventory-20261015.md` / `docs/pre-release-filing-checklist.md` | |

回执格式：
```text
| 编号 | 原文要点(≤20字) | 我的实测 | 状态(接收/存疑/不符/缺失) |
```

---

## 1. 项目身份

- **产品**：微信小程序「找人帮忙」——生活服务信息撮合（发布需求 / 耍伴接单 / 四确认 / 支付 / 纠纷）。
- **栈**：小程序原生（WXML/JS/WXSS）+ 微信云开发；后台 `admin-web-frontend/`（Vue）+ 云函数 `admin-web`。
- **仓库**：`https://github.com/510721314-lang/zhaoren`（主分支 master）。
- **规模**：云函数 21 目录（含 _shared + zz-warmup）；`_orig_baseline.js` 9 份（冻结，只读）；`_shared/*.test.js` 44 文件。
- **造数/探针函数**用 `zz-` 前缀；`X-Admin-Key` 值禁止写入任何文档、代码、日志。

---

## 2. 红线 & 硬约束（绝对不能碰）

### 2.1 代码红线

- **受保护文件禁止擅自改**：`app.json` / `app.js` / `app.wxss` / `project.config.json` / `project.private.config.json` / `sitemap.json`；禁止创建 `ext.json`；禁止擅自改 `__usePrivacyCheck__` / `requiredPrivateInfos`。
- **订单金额/状态机改动必须先读码再改、不臆造字段**。
- **不自动点「提交审核」；不真跑支付、不真发短信**。
- **不删业务代码，只加测试文件、测试 mock、必要标识**。
- **禁止 `rm -rf` / `git push --force` / 强制终端命令**（危险命令先问人）。

### 2.2 Git 红线

- **git push 必须绕代理**：`git -C C:\zhaoren -c http.proxy= -c https.proxy= push origin master`（本机默认代理死在 7890）。
- **三类严格隔离**（T0.16）：
  1. **业务代码 + 规则改动**（order-detail.js 分区注释 / `.trae/rules.md` / project_rules）→ 独立代码 commit
  2. **docs / 台账**（CHANGELOG / REGISTRY / deploy-log / tech-debt）→ docs-only commit，禁含代码
  3. **测试基础设施**（MCP / Jest / e2e）→ test-infra commit，禁混业务代码
  4. **5 份用户 SOP docx/md** → **永远禁 git add / commit / delete**（T0.16）

### 2.3 备份红线

- 所有备份文件 → `C:\zhaoren-bak`。
- 三重备份 = git bundle + robocopy 热备 + 云端 DB 导出。
- 异地同步 → 飞书云空间 zhaoren-backup（folder_token=RCsff3kGUlKhpud1KVFckJOhnGc），`+push` 默认 `--if-exists=skip`，反复追加文件须 `overwrite`。
- **数据库索引无法通过 API 备份实际值**（wx-server-sdk 无 listIndexes API），只能备份 init-db 设计台账 → 恢复时人工重建。

---

## 3. 项目经验库（所有踩过的坑 & 实证）

### 3.1 业务铁律（从代码 + 测试 + 线上 bug 提炼）

| 编号 | 铁律 | 可操作结论 |
|---|---|---|
| R1 | 退出登录必须双通道 | `wx.removeStorageSync('userInfo')` 后必须补 `getApp().clearLoginUser()` 同步 globalData（profile.js L469/L504 已示范） |
| R2 | navigateTo/redirectTo 必须含 fail 兜底 | 动态 url（运营位配置）可能指向旧版遗留路径 |
| R3 | 唯一索引不能靠代码推断 | `init-db` 里声明 `{unique:true}` 只是设计意图 ≠ 线上已建；必须 tcb CLI `listIndexes` 引擎回执实证 |
| R4 | 提审冻结期业务零改动 | miniprogram/ + cloudfunctions/ 代码冻结；缺陷修复须新立项 + 用户批准 + 递增版本号；docs 改动留统一提交 |
| R5 | 提审冻结期 admin_config 可动 | C-3.32 仅约束代码文件；admin_config 云端配置不属于业务代码范围（realname_face_mode mock → wx 是必要动作） |
| R6 | 代码等价不代表索引等价 | 本地 init-db 改 ≠ 云端已生效，必须实测 |
| R7 | order-detail.js 大文件不强行拆分 | 62% 业务编排同时依赖 data 2-12 字段 + setData + callCloud，强耦合不可抽；提审前只补分区注释 |

### 3.2 测试实证

| 编号 | 实证 | 可操作结论 |
|---|---|---|
| E1 | 门禁 521/521 全绿（实跑） | 基线取实跑结果，不取旧 HANDOFF 数字 |
| E2 | A/B equivalence 439 case（不变） | 本轮只加测试基础设施，业务零改动 → 无漂移 |
| E3 | E2E 6 核心页 MCP navigate 全通 | ①首页 switchTab ②广场 switchTab ③消息 switchTab ④我的 switchTab ⑤发布 navigateTo ⑥工作台 navigateTo |
| E4 | workbench 不是 tabBar | 误判用 switchTab 报 `Uncaught [object Object]`，必须 navigateTo |
| E5 | 合规扫描无硬泄漏 | 无 appSecret / AKIA / sk_live / 硬编码 localhost / console.log（15 处 console.error/warn 全在 error handler） |
| E6 | 云端 admin_config 实证 | `_id:"global"` → `realname_face_mode:"wx"` / `env:"prod"` / `mock_payment_enabled:true` |
| E7 | uk_order_no 索引实证 UNIQUE | tcb listIndexes 回执 7 个索引，uk_order_no = UNIQUE |
| E8 | profile 退出双通道实证 | L469 + L504 两处都调 `getApp().clearLoginUser()` |
| E9 | publish VIP 文案清零实证 | L792 toast `'智能派单为高信用耍伴专属'`，无 VIP 字样 |

### 3.3 工具链铁律（PowerShell5 / Windows / Trae / MCP / tcb）

| 编号 | 铁律 | 正确姿势 |
|---|---|---|
| P1 | Windows 下 miniprogram_launch 启动失败 | 两步走：先 `cli.bat auto --project ... --auto-port 9420` → 再 `miniprogram_connect({port:9420})` |
| P2 | miniapp-mcp 入口文件选错 | `dist/index.js` 是纯导出模块（直接跑立刻 exit）；**真正 bin 入口是 `dist/cli.js`** |
| P3 | Trae MCP 自动加 mcp_ 前缀 | GUI 注册 `"weapp-test"` → `run_mcp` server_name 必须写 **`mcp_weapp-test`** |
| P4 | Trae .trae/mcp.json 是受限文件 | Agent 不能 Write/Edit 写入 → 用户在 GUI（设置 → MCP → 手动添加）粘贴 JSON |
| P5 | Trae MCP command 不能含空格 | `"node"` ✅；`"C:\Program Files\nodejs\node.exe"` ❌ |
| P6 | nosql execute 绕 PowerShell 引号铁律 | **在 .cjs 脚本里 `spawnSync(cliFullPath, argsArray, {shell:false})`**，args 数组直接放 JSON 字符串 |
| P7 | nosql dump 返回 NDJSON | 每行一个 JSON 对象 → 按 `\n` split 后每行 parse；直接 `JSON.parse(content)` 必炸 |
| P8 | wx-server-sdk 本地装后无凭据 | `cloud.init()` 后抛 `missing secretId or secretKey`；**CLI 自带凭据**，用 dump/nosql execute 绕开 |
| P9 | cloudbase CLI 3.8.5 用 `--env-id`（带连字符） | 旧 `--envId` 打 warning 但还能跑 |
| P10 | PowerShell 5 没有 `&&` / `||` / `head` / `grep` | 用分号串联、`Select-Object -First N`、`Select-String` |
| P11 | git push 本机默认代理死 7890 | `-c http.proxy= -c https.proxy=` 绕开 |
| P12 | deploy-cloud.ps1 deploy 后 SHA256 核验 | 必须比本地 dist hash |
| P13 | npm publish / 运行 node 脚本 / git push 终端挂起 | **避免交互式命令**；不调用 Read-Host / git rebase -i |

---

## 4. 工具链配置（换机器/新会话时按此重建）

### 4.1 MCP Server（`mcp_weapp-test`）

GUI 粘贴（设置 → MCP → 手动添加）：
```json
{
  "mcpServers": {
    "weapp-test": {
      "command": "node",
      "args": [
        "${workspaceFolder}/node_modules/@creatoria/miniapp-mcp/dist/cli.js",
        "--config",
        "${workspaceFolder}/.mcp.json"
      ],
      "env": {
        "START_MCP_TIMEOUT_MS": "60000",
        "RUN_MCP_TIMEOUT_MS": "120000"
      }
    }
  }
}
```
server_name = `mcp_weapp-test`（Trae 自动加前缀）。65 工具，核心：`miniprogram_connect` / `miniprogram_navigate` / `miniprogram_screenshot` / `assert_*` / `page_wait_for`。

### 4.2 .mcp.json（本机私有，.gitignore 忽略）

```json
{
  "cliPath": "C:\\Users\\Administrator\\Desktop\\微信WEB开发者工具\\cli.bat",
  "projectPath": "C:\\zhaoren",
  "port": 9420,
  "capabilities": ["core","assert","snapshot","record","network"],
  "timeout": 30000
}
```

### 4.3 依赖

```bash
npm i -D jest miniprogram-simulate miniprogram-automator @creatoria/miniapp-mcp @modelcontextprotocol/sdk wx-server-sdk
```

### 4.4 CLI auto → MCP connect 工作流

```
Step 1: 清残留  Get-Process wechatdevtools -ErrorAction SilentlyContinue | Stop-Process -Force
Step 2: 启动   & cli.bat auto --project C:\zhaoren --auto-port 9420
Step 3: 连接   run_mcp server_name=mcp_weapp-test tool=miniprogram_connect args={port:9420}
Step 4: 操作   navigate → assert → screenshot → close
```

---

## 5. 提审 Checklist（当前阻塞倒计时）

| # | 事项 | 谁做 | 状态 | 阻塞 |
|---|---|---|---|---|
| 1 | 逻辑单测 521/521 全绿 | AI | ✅ 已通过 | — |
| 2 | A/B 等价 439 case | AI | ✅ 已通过 | — |
| 3 | 静态门禁（语法 250 / SSOT 0 / shared-sync） | AI | ✅ 已通过 | — |
| 4 | E2E 6 核心页 MCP navigate 通过 | AI | ✅ 已通过 | — |
| 5 | 合规扫描（无硬泄漏） | AI | ✅ 已通过 | — |
| 6 | admin_config realname_face_mode mock → wx | AI（cloudbase nosql） | ✅ 已生效 | — |
| 7 | **开发者工具代码质量扫描 0 红码** | user（GUI） | ⚠️ 待做 | P1 阻塞 |
| 8 | **真机回归核心链路**（tabBar + 发布 → 支付mock → 订单 → 评价） | user（真机） | ⚠️ 待做 | P1 阻塞 |
| 9 | **mp 后台 F1：隐私保护指引 5 项 + 用途**（位置/相册/证件/OpenID，**不勾手机号**） | user | ⚠️ 待做 | P0 阻塞 |
| 10 | **mp 后台 F2：getLocation + chooseLocation 权限申请**（1-3 天审核） | user | ⚠️ **先提交抢时间** | P0 阻塞最长 |
| 11 | **mp 后台 F4：合法域名（apis.map.qq.com）+ lbs.qq.com AppID 白名单** | user | ⚠️ 待做 | P0 阻塞 |
| 12 | v1.6.37 上传 + 选版本提交审核 | user + AI | ⚠️ T-7.31 + T-7.35 | — |

**阻塞倒计时**：F2 位置权限 1-3 天最长 → **先提交 F2 → 同步配 F1+F4 → 等 F2 → 上传 1.6.37 → 选版本提审**。

---

## 6. 待办清单（按优先级）

### P0 — 提审必做（阻塞提审）

| 编号 | 任务 | 谁做 | 前置 |
|---|---|---|---|
| T1 | mp 后台 F2：提交 getLocation/chooseLocation 权限 | user | 无（**立即提交**） |
| T2 | mp 后台 F1：隐私保护指引 5 项 + 用途 | user | 无 |
| T3 | mp 后台 F4：合法域名 + 腾讯位置 AppID 白名单 | user | 无 |
| T4 | 开发者工具代码质量重新扫描（0 红码） | user | GUI 手动 |
| T5 | admin_config.realname_face_mode **提审后关闸** 回 mock + 接真实人脸 | AI | 真实支付上线前独立立项 |

### P1 — 上传 + 真机

| 编号 | 任务 | 谁做 | 前置 |
|---|---|---|---|
| T6 | v1.6.37 上传（`cli.bat upload -v 1.6.37`） | AI 或 user | user 确认版本号 |
| T7 | 真机验收 v1.6.36/37：首页/广场/banner → 发布/草稿箱 → 订单详情/四确认/证据 → 聊天/模板卡 → 我的/退出登录 | user | 上传完成 |

### P2 — 顺延/独立立项

| 编号 | 任务 | 风险 |
|---|---|---|
| T8 | 备份自动链收口核对（`backup-log.csv` 行含 `lark=OK`） | 低 |
| T9 | home_probe_square FAIL 根因定性（种子需求 8 vs 阈值 10） | 低 |
| T10 | index 索引 T-7.6 P3-12 大清理 | 独立立项 |
| T11 | **git push 待网络恢复**（当前 ahead origin = 1，v9 HANDOFF 未推） | GitHub 网络层 |

---

## 7. 关键文件速查

| 文件 | 用途 | 入库 |
|---|---|---|
| `.trae/rules/project_rules-20261013.md` | 项目级红线（§0-§28） | ✅ |
| `.trae/rules.md` | CloudBase 实战坑 + 大文件铁律 | ✅ |
| `docs/tech-debt-inventory-20261015.md` | 技术债台账 | ✅ |
| `docs/pre-release-filing-checklist.md` | 提审前清单 | ✅ |
| `docs/deploy-log.md` | 每次上传登记 | ✅ |
| `docs/CHANGELOG.md` | 版本变更 | ✅ |
| `docs/FUNCTION-REGISTRY.md` | 功能清单 + 验证状态 | ✅ |
| `docs/HANDOFF-20261024-v9.md` | 增量补丁（叠加 v8） | ✅ |
| `scripts/e2e-smoke.js` | CLI auto + automator 手动冒烟 | ✅ |
| `scripts/load-env.cjs` | 环境变量加载器 | ✅ |
| `jest.config.cjs` | Jest 基础配置 | ✅ |
| `.env.example` | CLI 路径模板（入库） | ✅ |
| `.mcp.example.json` | MCP 配置模板（入库） | ✅ |
| **`.env` / `.mcp.json`** | **本机私有**（.gitignore 忽略） | ❌ |

---

## 8. 云端 admin_config.global 当前值（prod，2026-10-24 下午实测）

```json
{
  "_id": "global",
  "env": "prod",
  "mock_payment_enabled": true,
  "realname_face_mode": "wx",
  "auto_approve_partner": true,
  "admin_openids": [2],
  "sub_msg_templates": ["demand_grab", "demand_urge", "confirm_comm"],
  "updated_at": 1792847448000
}
```

---

## 9. 立即可执行的命令片段

### 9.1 Gate

```powershell
npm run test                      # 521 tests
node scripts/check-syntax.js      # 250 files
node scripts/check-ssot.js        # 硬编码 0
node scripts/check-shared-sync.js # 场景一致
```

### 9.2 Git（push 绕代理）

```powershell
git -C C:\zhaoren -c http.proxy= -c https.proxy= push origin master
git -C C:\zhaoren --no-pager log --oneline -3
git -C C:\zhaoren rev-list --count origin/master..HEAD
```

### 9.3 nosql execute（PowerShell 引号绕不开 → 用 .cjs 脚本）

```js
// fix-admin-config.cjs
const { spawnSync } = require('child_process');
const envId = 'cloud1-d9gkefwcp5c777088';
const cli = 'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\cloudbase.cmd';
const updateCmd = JSON.stringify([{
  TableName:'admin_config', CommandType:'UPDATE',
  Command: JSON.stringify({update:'admin_config', updates:[{q:{}, u:{'$set':{realname_face_mode:'wx', updated_at:Date.now()}}} ]})
}]);
spawnSync(cli, ['db','nosql','execute','--env-id',envId,'--command',updateCmd,'--json'], {encoding:'utf8',shell:false});
```

### 9.4 E2E MCP 链路

```powershell
# CLI auto 起 IDE（Trae 会自动连 MCP）
& "C:\Users\Administrator\Desktop\微信WEB开发者工具\cli.bat" auto --project "C:\zhaoren" --auto-port 9420
# 然后 run_mcp: server_name=mcp_weapp-test tool=miniprogram_connect args={port:9420}
```

---

## 10. 检核确认（新会话开工前必须过一遍）

| 维度 | 覆盖条目数 | 状态 |
|---|---|---|
| §0 基线校验 | 10 条（所有实时数字） | ✅ 自包含 |
| §2 红线 + 硬约束 | 11 条 | ✅ 可执行 |
| §3 经验库（R1-R7 + E1-E9 + P1-P13） | 29 条实证 | ✅ 全是踩过的坑 |
| §4 工具链配置 | 4 段（可直接重建） | ✅ 含 JSON/shell/args |
| §5 提审 Checklist | 12 条（含阻塞倒计时） | ✅ AI6 + User6 分工 |
| §6 待办清单 | 11 条（P0/P1/P2 分级） | ✅ 清晰 |
| §7 文件速查 | 13 文件 | ✅ 含入库/忽略标记 |
| §8 admin_config 实测 | JSON 全值 | ✅ 可比对 |
| §9 命令片段 | 4 段可复制 | ✅ 含 PowerShell/.cjs/JSON |

**检核结论**：本文件自包含，无需链式读取其他 HANDOFF。所有过时数字已更新到 2026-10-24 下午实测值。

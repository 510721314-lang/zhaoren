# RELEASE.md · 发布、灰度与回滚（v1.0 · 2026-11-08）

> 适用：发云函数、发小程序（体验版 → 提审 → 正式）、发 admin-web、出事故回滚、值班巡检。
> 本文件合并原 `docs/runbooks/deploy.md`（部署 SOP）并补齐**分支策略 / 灰度 / 代码回滚 / 监控值班**四块。
> 真值优先级（冲突按此裁决）：**云端回读 > 台账（`deploy-log.md` / `release-zero-checklist.md`）> 本文 > 记忆**。本文所有路径与命令均实测于 2026-11-08。

---

## 0. 一页速查

| 我要做什么 | 命令 / 入口 | 完成判据 |
|---|---|---|
| 发布前自检 | `npm.cmd run verify:offline` | **EXIT=0**（28 步门禁 + 全量测试 + A/B） |
| 发一个云函数 | `& $cli cloud functions deploy --env <env> --names <fn> --project c:\zhaoren --remote-npm-install` | 表格行 `success │ true` + packSize |
| 发多个云函数 | `foreach` **串行**循环（禁并发、禁并行任务） | 每个函数逐个 success |
| 发小程序体验版 | `& $cli upload --project "C:\zhaoren" -v <ver> -d "<desc>"` | mp 后台「版本管理」出现该版本 |
| 把体验版设为体验版 | **mp 后台手工**（AI 不代点） | 二维码可扫 |
| 发 admin-web | `npm run build` → 拷 `dist` 到 `cloudfunctions/admin-web/public` → 部署 `admin-web` | 网关 `/` 返回 `<!doctype html>` |
| 回滚云函数 | `git checkout <回滚点> -- cloudfunctions/<fn>` → 重新部署 | `tcb fn code download` 逐文件 SHA256 MATCH |
| 回滚小程序 | mp 后台「版本管理 → 版本回退」 | 线上版本号回退 |
| 记一笔 | `docs/deploy-log.md` 追加一行 | 日期/函数/前后 commit/回滚点 |

---

## 1. 环境与发布物

| 项 | 值 | 来源 |
|---|---|---|
| 云环境 | `cloud1-d9gkefwcp5c777088` | `miniprogram/envList.js`（唯一来源，勿改） |
| AppID | `wxbc4a4afacdf234f5` | `project.config.json` |
| 项目根 | `c:\zhaoren`，`cloudfunctionRoot = cloudfunctions/` | `project.config.json` |
| 云函数 | **21 个目录**（20 业务 + `_shared`） | 目录枚举 |
| DevTools CLI | `C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`（实测存在；`C:\Users\Administrator\Desktop\微信WEB开发者工具\cli.bat` 亦存在，为旧副本） | `Test-Path` 实测 |
| 运行时 | Node.js **16.13**（禁用 17+ 语法） | 云端配置 |
| 后台前端 | `admin-web-frontend`（Vue3 + Vite）→ 构建产物由 `admin-web` 云函数 `serveStatic` 托管 | — |

**三条发布通道，互不自动联动**（改一端不会带动另一端）：

1. **云函数**（`cloudfunctions/*`）：必须逐个部署才生效；改了不部署 = 线上没变。
2. **小程序端**（`miniprogram/*`）：必须上传体验版 → 后台设体验版 → 提审 → 发布。
3. **admin-web**：必须 `build` + 部署 `admin-web`（含 `public/`），否则页面仍是旧 chunk。

---

## 2. 分支策略与提交纪律

**现状（2026-11-08 实测）**：只有 `master` 一条分支（`origin/master` 同源），无长期 develop/release 分支；tag 停留在 `v0.9.0`，**当前版本标识以「commit + `deploy-log.md` + 小程序版本号」三件套为准，不依赖 tag**。

| 规则 | 内容 |
|---|---|
| 分支模型 | 单 trunk（`master`）。临时分支仅在需要隔离一批改动时开，合并后即删；**禁止 force push / reset --hard / clean -f** |
| 提交粒度 | 一次改动一个 commit；**代码与文档分开**（docs 单独 commit）；**同一批文档等全部写完再一次性入库**，避免半套文档 |
| 提交前 | `npm.cmd run verify:offline` **EXIT=0**；`git status --short` 逐项确认 |
| 提交与推送 | **两步走**：先 commit，再 push；`commit` / `push` **每次单独书面授权，不继承、不跨会话** |
| push 通道 | 默认代理 `http://127.0.0.1:7890` + `http.sslBackend=openssl` + `http.version=HTTP/1.1`；实测 GitHub 443 直连 200 时可用 `git -c http.proxy= -c https.proxy= push origin master`。三通道各试一次即停 |
| 提交信息 | 写清「新增/修复了什么」+ 影响面，能一句话说清为什么改 |
| 冻结期 | 提审冻结期规则见 `.trae/rules/zhaoren-release-freeze.md`；**2026-11-04 已裁定不设提审冻结期**，其余条款（授权纪律、真值优先级）继续有效 |

---

## 3. 发布前门禁（缺一项不许发）

1. **离线门禁**：`npm.cmd run verify:offline` → EXIT=0。含 28 步：语法（`check-syntax` / `check-miniprogram-syntax`）、单一源（`check-ssot`）、集合一致性、配置默认值、`_shared` 同步、订阅消息、桌面注入、`require` 作用域、handler、索引台账、超时策略、部署配置、规则体量、密钥、手册链接、文档链接、台账占位符、一次性提示、夜间红线、测试 glob、门禁挂载、S2 改期自测、全量测试 + A/B 等价。
2. **部署前归档**（铁律）：每次部署前先 `git bundle create "C:\zhaoren-bak\zhaoren-deploy-<YYYYMMDD>-<HHMMSS>.bundle" master --tags`，SHA 记入 `C:\zhaoren-bak\CHECKSUMS.txt`；**归档必须在部署命令之前**，且工作区干净。
3. **部署门禁脚本**：`.trae/predeploy.ps1 -Deploy <fn>`（实测存在；`.predeploy/predeploy.ps1` 不存在，勿混）。
4. **`_shared` 变更**：任一字节变化 → 跑对应 `sync-*.ps1`（20 个）→ `node scripts/check-shared-sync.js` 必须 `SHARED SYNC ALL OK`。
5. **配额门控**：基础套餐 20 万次/月。🟢 `<4,000`/日 正常推进；🟡 `4,000–5,500`/日 收紧（禁批量造数）；🔴 `>5,500`/日 或余量 `<4 万` 仅只读核查。与冻结期规则「余量不足 1 万禁并行」并存时取更严者。
6. **人工确认项**：隐私指引状态、提审材料（`docs/runbooks/pre-release-filing-checklist.md`）、真机回归结论——**AI 不得代点提审 / 加购 / 支付**。

---

## 4. 云函数发布

```
前置：IDE 已启动并登录、服务端口开启（端口见 %LOCALAPPDATA%\微信开发者工具\User Data\<实例哈希>\Default\.ide）
```

```powershell
$cli  = "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"
$env_ = "cloud1-d9gkefwcp5c777088"
$proj = "c:\zhaoren"
# 单个
& $cli cloud functions deploy --env $env_ --names <fn> --project $proj --remote-npm-install
```

- **必须 `--remote-npm-install`**：本地打包 `node_modules` 会因 Windows 路径分隔符 `\` 导致云端 Linux `require` 找不到模块。
- **必须串行**：并发会报 `FailedOperation.UpdateFunctionCode 当前函数处于 Updating 状态`。多函数用 `foreach`，等上一个 success 再下一个；单次 Shell timeout 给足（600000ms）。
- **`config.json` 的 `timeout` / `triggers` 不经 CLI 生效**，必须控制台手工配 + `cloud functions info` 读回校验；`config.json` 仅作期望值记录，且必须 **UTF-8 无 BOM**。
- **部署后验证**：`tcb fn code download` 逐文件 **SHA256 回读 MATCH**；等 90–120 秒（云端 npm install）再调用。
- **登记**：`docs/deploy-log.md` 追加一行（日期 / 函数 / 前后 commit / 回滚点 / 验证结论）。

---

## 5. 小程序发布（体验版 → 提审 → 正式）

1. **门禁过**（§3）+ 真机回归结论齐（`docs/runbooks/regression-*.md`）。
2. **上传体验版**：
   ```powershell
   & "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" upload --project "C:\zhaoren" -v <ver> -d "<描述>"
   ```
3. **后台设体验版**：mp 后台「版本管理 → 开发版本 → 选为体验版」（**用户手工**）。
4. **真机回归**：iOS + Android 各一遍；能力链路（登录 / 授权 / 隐私 / 支付 / 上传下载 / 定位）列为第 1 项。
5. **提审**：材料见 `docs/runbooks/pre-release-filing-checklist.md`；隐私指引状态见 `docs/runbooks/release-zero-checklist.md` §4.2。**AI 不代点提审**。
6. **发布**：审核通过后在后台「发布」，**优先用分阶段发布**（见 §7）。

---

## 6. admin-web 发布

```powershell
Set-Location c:\zhaoren\admin-web-frontend; npm run build
Remove-Item c:\zhaoren\cloudfunctions\admin-web\public\* -Recurse -Force
Copy-Item c:\zhaoren\admin-web-frontend\dist\* c:\zhaoren\cloudfunctions\admin-web\public\ -Recurse -Force
& $cli cloud functions deploy --env cloud1-d9gkefwcp5c777088 --names admin-web --project c:\zhaoren --remote-npm-install
```

- 只改 `src/` 不 `build` + 不部署 = 不生效；每次 build 后 chunk 哈希变化，CDN 自然失效。
- 静态资源由 `admin-web` 云函数的 `serveStatic` 托管（**不是** hosting `deploy ./dist`）；若走 hosting 通道则**禁 `--prune`**。
- 验证：网关 `/` 返回 `<!doctype html>`；`/assets/index-*.js` 200 且体积正常。
- 写操作 UI 必须遵守「二次确认 + 原因 + 防双击 + 刷新列表」（技能 `admin-web-write-ui-pattern`）。

---

## 7. 灰度策略

| 通道 | 灰度手段 | 现状与做法 |
|---|---|---|
| 小程序 | **体验版 = 灰度环境** | 先给内部账号设体验版跑 1–2 天；正式发布用 mp 后台「分阶段发布」（按比例放量，可随时暂停/全量） |
| 云函数 | **无按比例灰度**（云开发不支持流量切分） | 替代手段：①先部署**非入口函数**（`order-timer`/`zz-warmup`）观察；②对写操作做「开关 + 白名单」灰度（如 `admin_config.mock_payment_enabled` 这类 fail-closed 开关）；③新增 action 先只加不改旧分支，旧调用方零感知 |
| admin-web | 无灰度 | 靠 `X-Admin-Key` 网关鉴权 + 线上单实例；发布窗口选低峰，发布后立即做「登录 → 列表 → 一次只读查询」三步冒烟 |
| 数据/配置 | 配置化灰度 | `admin_config` 键优先于硬编码（如 `scene_list`、`no_show_*`、`error_scan_exempt_types`）；改配置走 `admin-action config_set` 并留 `config_log` |

**禁止**：把「灰度」当作跳过门禁的理由；未过 `verify:offline` 的代码不得以灰度名义上线。

---

## 8. 代码回滚

### 8.1 云函数回滚（最常用）

```powershell
git log --oneline -5 -- cloudfunctions/<fn>      # 找上一版 commit
git checkout <回滚点> -- cloudfunctions/<fn>      # 只回滚该函数目录
& $cli cloud functions deploy --env <env> --names <fn> --project c:\zhaoren --remote-npm-install
tcb fn code download <fn> ...                    # 逐文件 SHA256 回读核对
```

- **回滚点来源**：`docs/deploy-log.md` 每行的「回滚点」列；部署前 bundle 归档亦可整体恢复。
- **只回滚单个函数目录**，禁止 `checkout -- .` / `reset --hard`（会连带吞掉其它在途改动）。
- 回滚后**必须重新走 §3 门禁**（只跑 `check-shared-sync` + 该函数语法检查不够）。

### 8.2 小程序回滚

- mp 后台「版本管理 → 版本回退」回到上一个线上版本（**用户手工**，AI 不代点）。
- 体验版可随时换成旧版本重新上传；注意**回退不撤回已写库的数据/配置**。

### 8.3 admin-web 回滚

- 重新 `git checkout <回滚点> -- admin-web-frontend` → `npm run build` → 覆盖 `public/` → 部署 `admin-web`。
- 已部署的 `public/` 是纯静态，回滚无数据风险；但**接口侧若已改字段**，需同步回滚对应云函数。

### 8.4 数据层（高风险，默认不回滚）

- 数据库**不做自动回滚**。写操作事故按 `docs/runbooks/backup-restore.md` 从备份恢复，且**必须先书面授权**。
- 状态机相关事故：优先用 `admin-action dispute_handle` / `order_force_cancel` 等既有受控入口纠正，**禁止直接改 `order_main.status`**（会绕过 `order_status_log` 留下断链）。
- 备份介质：`H:\zhaoren_bak_day` **实测不存在、计划任务未注册**（未决风险，见 `docs/HANDOFF-20261108.md` T-9.6）。

---

## 9. 监控与值班

### 9.1 已有监控（仓库内实现）

| 机制 | 位置 | 说明 |
|---|---|---|
| `error_scan` 巡检 | [order-timer/index.js:99](../cloudfunctions/order-timer/index.js) | 随 `order-timer` 触发器（`0 */30 * * * * *`，48 次/天）扫描窗口内 `platform_event` P0/P1、`audit_log` fail、卡死提现（>48h）、网关鉴权失败突增 → 推管理员 `system_notice`；游标 `admin_config.error_scan_last_at`，心跳 `error_scan_heartbeat_at`；豁免项 `error_scan_exempt_types` |
| 网关鉴权告警 | `admin-web` | `bad_key` / `missing_key` 拒绝时 **await** 写 `platform_event(P2, gateway_bad_key)`，密钥本身不入 payload |
| 事件账 | `platform_event` | P0（紧急求助/资金异常/**支付事务补偿失败 `pay_compensate_fail`**）/ P1（越权/非法流转）/ P2（一般） |
| 用量 | 云开发控制台 | 配额与调用量；🔴 阈值见 §3 第 5 条 |
| 巡检心跳判定 | `error_scan_heartbeat_at` | 超过 2 个周期（>60 分钟）未更新 = 定时链可能已断，立即查 `order-timer` 触发器 |

### 9.2 值班节奏（单人项目，最小可执行版）

| 时点 | 动作 | 判据 |
|---|---|---|
| 每次部署后 | 30 分钟内看 `error_scan` 心跳 + 一次业务冒烟 | 心跳更新、无新 P0/P1 |
| 每日 | 云开发控制台看调用量与错误率、`platform_event` P0/P1 新增、卡死提现 | 无未处置 P0 |
| 每周 | 核对 `deploy-log.md` 与云端 `functions list` 时间戳是否一致 | 无「本地改了云端没改」的漂移 |
| 事故中 | 先止损（停写/回滚/关开关），再定位；**禁止边查边改生产** | 有回滚点、有留痕 |

### 9.3 告警升级路径

P0（资金/安全/数据错乱）→ 立即回滚或关开关 → 记录 `platform_event` → 24h 内出根因；
P1（越权/非法流转）→ 当日处置 + 补门禁断言；
P2 → 进 `docs/tech-debt-inventory-20261105.md`，按周清理。

---

## 10. 常见坑（实测）

| 现象 | 根因 | 处置 |
|---|---|---|
| 改了代码线上没变 | 只改本地没部署 / 只部署了别的函数 | 按 §4 部署 + SHA256 回读 |
| `Cannot find module 'wx-server-sdk'` | 未 `--remote-npm-install` / 本地 `node_modules` 被打包 | 重部署，带 `--remote-npm-install` |
| 定时任务不跑 | `config.json` 的 `triggers` 未被 CLI 应用 | 控制台手工加触发器（§4） |
| 部署后立刻调用报错 | 云端 npm install 未完成 | 等 90–120 秒 |
| admin-web 首页 404、`/api` 正常 | `public/` 未随部署上传 | 单独补传静态资源后重部署 |
| 中文乱码 / 脚本解析失败 | PowerShell 5 无 heredoc、`.ps1` 带 BOM | 用 `[System.IO.File]::WriteAllText` + `UTF8Encoding($false)` |
| push 失败（443 重置） | 代理未监听 / DNS fake-IP | 按 §2 三通道各试一次即停 |

---

## 11. 未决与待确认

1. `H:\zhaoren_bak_day` 备份介质不存在、计划任务未注册（T-9.6）→ 备份链目前只有 `C:\zhaoren-bak` bundle。
2. `docs/runbooks/deploy.md` 与本文在 CLI 路径上并存两个写法（Desktop 副本 / Program Files 正本），发布前一律 `Test-Path` 实测后再用。
3. 分阶段发布比例与观察窗口尚无历史数据可依，首次使用时需现场记录实际放量节奏并回写本文。
4. `cloudfunctions/admin-action/index.js` 首行 `@VERIFIED` 注释已改、**未部署**，云端与仓库不一致（T-9.10）。

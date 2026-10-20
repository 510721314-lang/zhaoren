# 网关冒烟测试报告（2026-10-20）

> 被测脚本：`.predeploy/smoke-check.ps1`｜门禁位置：A1 合规静态门禁序列之「网关冒烟」步骤
> 执行时间：2026-10-20 16:50:01 +08:00｜HEAD：`fed24d4bb195ef49c568eb9da445cb2731c37fe3`（`master` = `origin/master`，已同步）
> **结论：6/6 PASS / exit 0** —— A1 门禁 smoke 步骤可判读、全绿。

## 1. 环境与基线

| 项 | 值 |
|---|---|
| 执行时间 | 2026-10-20 16:50:01 +08:00（Asia/Shanghai） |
| 代码基线 | HEAD = `fed24d4`；`master` 与 `origin/master` 同步 |
| 被测脚本 | `.predeploy/smoke-check.ps1`（PowerShell 5.1 / `-ExecutionPolicy Bypass`） |
| 网关 | `https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api` |
| 云环境 | `cloud1-d9gkefwcp5c777088` |
| 鉴权头 | `X-Admin-Key`（值 = `admin_config.global.admin_web_key`，取自本地密钥文件，**不在本文档/脚本内硬编码**） |
| 前置数据 | 广场种子 `sdm-*` matching 在位（本次 `seed_scene_demands` reseed 24 条，有效期 24h） |

## 2. 用例明细（6 项）

| # | 用例 | 判据 | 修复前 | 本次 |
|---|---|---|---|---|
| 1 | `config_public.ok` | 网关返回 `ok=true` | FAIL | **PASS** |
| 2 | `config_public.tip_enabled` | `data.payment.tip_enabled === true` | FAIL | **PASS** |
| 3 | `config_public.switch_access` | `data.switches.switch_access === true` | FAIL | **PASS** |
| 4 | `config_public.time_redline` | `open_min=360 ∧ close_min=1440` | FAIL | **PASS** |
| 5 | `home_probe_square` | `data.list` 条数 ≥ 10 | FAIL | **PASS** |
| 6 | `home_probe_system_notice` | `ok=true`（`type=modify_confirm`，720h） | FAIL | **PASS** |

> 全部探针为**只读 / 幂等**，不写库、不改配置。
> 脚本退出码语义：`0` = ALL PASS；`1` = 有 FAIL 项；`2` = 未设置 `AWK_KEY`。

## 3. 缺陷与修复（本轮唯一变更）

- **缺陷**：`Invoke-Gw` 用 `$raw = curl.exe …` **直接捕获原生命令 stdout** → PS5.1 按 `[Console]::OutputEncoding`（中文机 GB2312/936）解码网关 UTF-8 中文 JSON → 乱码**吞闭合引号** → `ConvertFrom-Json` 抛错 → `$r = $null` → 6 项判据全 false → **6/6 恒 FAIL**（fail-closed，只误挡不误放，**非**网关/密钥故障）。
- **铁证**：失败期的 `[RAW] {…}` dump 首部为 `"ok":true` —— 网关与密钥均正常，故障纯在**解码层**。
- **修复**：`curl -o` 把响应字节原样落临时文件 ＋ `Get-Content -Raw -Encoding UTF8` 读回（绕开控制台解码）。
- **落地**：代码 commit `7e39f94`；规则/台账登记 commit `fed24d4`（`§25-J6` + tech-debt `P3-9` + CHANGELOG），均已推送。

## 4. 执行证据（三阶段，同一脚本 / 同一密钥）

```
阶段① 修复前（用户截图）:        6/6 FAIL   ← 含 [RAW] dump 首部 "ok":true
阶段② 修复后·reseed 前:          5/6 PASS   ← 仅 home_probe_square FAIL（count=1，种子缺失）
阶段③ 修复后·reseed 后（本次）:   6/6 PASS   ← SMOKE ALL PASS / SMOKE_EXIT=0
```

本次原始输出：

```
[PASS] config_public.ok
[PASS] config_public.tip_enabled
[PASS] config_public.switch_access
[PASS] config_public.time_redline
[PASS] home_probe_square
[PASS] home_probe_system_notice

SMOKE ALL PASS
SMOKE_EXIT=0
```

广场 reseed 返回（经网关 `admin-web` 入口）：

```json
{"ok":true,"data":{"created":24,"skipped":0,"per_scene":3,
 "targets":["W1","W8","W4","W7","W10","W11","W2","W3"],
 "hint":"每场景 matching 需求已生成(除排除场景), 广场/首页/附近刷新可见"}}
```

## 5. 残余与提示

1. **`home_probe_square` 依赖种子数据**：广场 `demand(status=matching)` 默认 `expire_at = now + 24h`，超时被清扫 → 广场空时该项会 FAIL。提审前若为空，按 `REFACTOR_ACCEPTANCE.md` §三 重跑：`seed_scene_demands` cleanup=true → per=3（**非**脚本缺陷）。
2. **密钥注入**：脚本读 `$env:AWK_KEY`；缺 key 时 `[FATAL]` + exit 2。运行前须注入（密钥文件：`C:\zhaoren-bak\admin-key-20261009.txt`，**值为凭据、不入库**）。
3. 本次 reseed 的 24 条 `sdm-*` 种子 24h 后自动过期，无需手工清理（如需并入测试数据清理口径可另行登记）。

## 6. 复现命令

```powershell
# 注入密钥（从本地密钥文件提取，勿硬编码明文）
$raw = Get-Content -Raw -Encoding UTF8 'C:\zhaoren-bak\admin-key-20261009.txt'
$env:AWK_KEY = ([regex]::Match($raw,'(?i)AWK-[0-9a-f]{64}')).Value

# 跑冒烟（expect: SMOKE ALL PASS / exit 0）
powershell -ExecutionPolicy Bypass -File C:\zhaoren\.predeploy\smoke-check.ps1
Write-Host "SMOKE_EXIT=$LASTEXITCODE"
```

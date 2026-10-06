# admin_web_key 轮换 SOP

> 适用场景：后台管理密钥泄露/可疑时轮换；安全审计后强制轮换；首次初始化后台密钥(首建)；轮换后 admin-web 需重新登录。

## 前置条件

- 网关调用端点与鉴权 Header：
  - URL：`POST https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api`
  - Header：`X-Admin-Key: <key>`
- 仓库脚本已**零硬编码**，统一读 `$env:AWK_KEY`（`smoke-check.ps1` 首步即校验 `AWK_KEY env not set`）；用户级 `setx AWK_KEY` 已配，新开终端自动生效
- 密钥存储于 `admin_config.global.admin_web_key`；`config_get/export` 均不透出明文（历史泄露只能靠轮换止血）

## 步骤

### 1. 本地生成新钥（轮换主路径）

新钥格式强校验 `^AWK-[a-f0-9]{64}$`（admin-action config_set 不满足即返回 `config_bad_key`）。用 node 的 crypto 生成（零依赖）：

```powershell
node -e "console.log('AWK-' + require('crypto').randomBytes(32).toString('hex'))"
```

> 首建/恢复场景（库中尚无 key 的 bootstrap）才走 init-db action `generate_admin_web_key`：需 `reason` + 管理员身份（真机 OPENID 或有效网关代理密钥），**必须走微信开发者工具云端测试面板**用真实 OPENID；返回的 key 仅一次明文。注意：init-db 该动作是「覆盖写 + 事务 CAS 白名单校验」，并非「仅库中无 key 放行」——旧记忆里「仅无 key 放行首建」的口径与代码不符，以代码为准。**正常轮换不要走 generate，走下面第 5 步 config_set。**

### 2. 只存仓库外

```powershell
# 新钥永不写入任何 git 内文件，仅落仓库外备份目录（唯一明文落点）
$new = node -e "console.log('AWK-' + require('crypto').randomBytes(32).toString('hex'))"
Set-Content -Path "C:\zhaoren-bak\admin-key-20261006.txt" -Value "AWK_KEY=$new" -NoNewline
```

### 3. 仓库脚本改读 $env:AWK_KEY（用户级 setx）

```powershell
setx AWK_KEY "$new"          # 用户级持久化，新开终端自动生效
$env:AWK_KEY = "$new"         # 当前会话立即生效
```

### 4. 干跑验证（轮换前，先证明新钥可用）

```powershell
powershell -File c:\zhaoren\.predeploy\smoke-check.ps1   # exit 0 = SMOKE ALL PASS（读新钥走通全链路）
```

### 5. 正式轮换（config_set 提交新钥，旧钥此刻起 401 作废）

```powershell
$gate = "https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api"
# 用**旧钥**发起（此时仍有效，证明管理员身份的连续性；提交后立即作废）
$body = '{"action":"config_set","admin_web_key":"' + $env:AWK_KEY + '","reason":"rotate_20261006"}'
Invoke-WebRequest -Method POST -Uri $gate -Headers @{ 'X-Admin-Key' = '<旧钥>' } -Body $body -ContentType 'application/json' -UseBasicParsing
```

- 注意：JSON 值不能含空格（PowerShell 参数截断坑），`reason` 必须用下划线串
- admin-web 前端重新登录：DevTools Console → `localStorage.clear(); location.reload();`，用新钥登录

### 6. 双向验证（旧钥 401 / 新钥 200）

```powershell
# 旧钥 → 预期 401 作废
Invoke-WebRequest -Method POST -Uri $gate -Headers @{ 'X-Admin-Key' = '<旧钥>' } -Body '{"action":"config_get"}' -ContentType 'application/json' -UseBasicParsing | Select-Object StatusCode
# 新钥 → 预期 200 {ok:true,...}
Invoke-WebRequest -Method POST -Uri $gate -Headers @{ 'X-Admin-Key' = $env:AWK_KEY } -Body '{"action":"config_get"}' -ContentType 'application/json' -UseBasicParsing | Select-Object StatusCode
```

## 验证

- 双向验证缺一不可：旧钥 401（真作废）+ 新钥 200 ok（真生效）
- 轮换后再跑一次 smoke：`powershell -File scripts/gate.ps1` 七步全绿

## 换机取证与失钥恢复

- **环境变量名口径**：规范名 `AWK_KEY`（smoke/gate/check-heartbeat 读它）；`.predeploy/backup.ps1`、`restore.ps1` 兼容旧名 `ADMIN_WEB_KEY`（两脚本都先读 AWK_KEY 再回退 ADMIN_WEB_KEY）
- **setx 继承注意**：部分 IDE / 既有会话不自动继承 User 级 setx——当前会话取不到就手工 `$env:AWK_KEY = "<新钥>"`（smoke/heartbeat 报 `AWK_KEY env not set` 即此现象，非配置错误）
- **换机取证**：key 只在本机（C:\zhaoren-bak 文件 + User 环境变量），换机前必须手工带走 key 文件；仓库与 GitHub 均无 key，这是设计如此
- **失钥恢复**（机器坏 + key 丢）：在**新的微信开发者工具**里登录管理员微信号 → 云开发控制台「云端测试」面板调 init-db `generate_admin_web_key`（`reason` 必填）——身份走 admin_openids 白名单（已补录 2 名管理员真实 OPENID），返回新钥仅一次明文，立即按第 2 步落盘；期间旧钥已失无验证价值，新钥生效后 admin-web 重新登录

## 坑

- **密钥永不入 git**（GitHub 仓库为 public，明文入仓即视为泄露必须再轮换）
- 网关层判定与云函数判定不同：**POST 不带 X-Admin-Key → 400 空 body**（网关拦截，函数没跑）；**错误 key → 200 + `{ok:false,code:'bad_key'}`**（函数跑了）
- config_set 轮换：新钥格式不符 → `config_bad_key`；缺 reason → `config_need_reason`
- `force_set_env` 切 env 需 `confirm:true` + reason 并写 `platform_event` 留痕；init-db 有 5 分钟进程内 env 缓存，动作里必须同步 `invalidateEnvCache()`，否则缓存期内外观无变化
- 轮换后 admin-web 必须用新钥重新登录，否则业务请求仍带旧钥被网关/云函数拦截
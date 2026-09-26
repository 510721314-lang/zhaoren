# zhaoren Cloud Backup Script L2+L3+L5
# Usage: .\backup.ps1 [-BackupDir C:\zhaoren_backup_YYYYMMDD] [-AdminKey AWK-...]
#        or set $env:ADMIN_WEB_KEY before running
param(
  [string]$BackupDir = '',
  [string]$AdminKey = ''
)
$ErrorActionPreference = 'Stop'

$CLOUD_ENV   = 'cloud1-d9gkefwcp5c777088'
$PROJECT_DIR = 'c:\Users\Administrator\Desktop\zhaoren'
$APPID       = 'wxbc4a4afacdf234f5'
# Key not hardcoded: pass -AdminKey or set $env:ADMIN_WEB_KEY (get from admin or init-db generate_admin_web_key)
if (-not $AdminKey) { $AdminKey = $env:ADMIN_WEB_KEY }
if (-not $AdminKey) { throw 'Admin key required: -AdminKey param or ADMIN_WEB_KEY env var' }
$GATEWAY_URL = "https://$CLOUD_ENV-1482004365.ap-shanghai.app.tcloudbase.com/api"

$COLLECTIONS = @(
  # ── 实际在用(2026-09-22 按云函数代码核实) ──
  'admin_config', 'admin_web_sessions',
  'user_account', 'partner_profile',
  'demand', 'demand_draft',
  'order_main', 'order_status_log', 'order_confirmations',
  'emergency_contact', 'credit_score_log', 'platform_event', 'audit_log',
  'system_notice', 'disclaimer_signature', 'evaluation',
  'blog_post', 'blog_like', 'blog_comment',
  'safety_report',
  'im_conversation', 'im_message',
  # ── 旧表/低频(不存在自动 SKIP) ──
  'user_profile', 'partner_exam', 'partner_apply',
  'dispute', 'withdraw_request', 'credit_log',
  'insurance_record', 'report', 'sms_log', 'device_bind'
)

# Find cli.bat (glob 桌面一级目录找 cli.bat, 避免中文字面量被 PS5 GBK 读取乱码 + 避免全盘扫描)
$cli = ''
$cliDir = Get-ChildItem -Path 'C:\Users\DC\Desktop' -Directory -ErrorAction SilentlyContinue |
  Where-Object { Test-Path (Join-Path $_.FullName 'cli.bat') } |
  Select-Object -First 1
if ($cliDir) { $cli = Join-Path $cliDir.FullName 'cli.bat' }
if (-not $cli) { Write-Host '[WARN] cli.bat not found, L5 skip' -ForegroundColor Magenta }
Write-Host "[INFO] CLI: $cli" -ForegroundColor Cyan

# Backup dir
if (-not $BackupDir) { $BackupDir = "C:\zhaoren_backup_$(Get-Date -Format 'yyyyMMdd-HHmm')" }
New-Item -ItemType Directory -Force -Path $BackupDir, "$BackupDir\admin_config", "$BackupDir\db", "$BackupDir\meta" | Out-Null
Write-Host "[INFO] BackupDir: $BackupDir" -ForegroundColor Cyan

function Invoke-AdminApi($Action, $Params = @{}) {
  $bodyObj = @{ action = $Action } + $Params
  $body = $bodyObj | ConvertTo-Json -Depth 20 -Compress
  try {
    $resp = Invoke-RestMethod -Uri $GATEWAY_URL -Method Post `
      -Headers @{ 'X-Admin-Key' = $AdminKey; 'Content-Type' = 'application/json' } `
      -Body $body -TimeoutSec 60
    return $resp
  } catch {
    Write-Host "[FAIL] $Action : $_" -ForegroundColor Red
    return $null
  }
}

function Save-JsonWithHash($Path, $Data) {
  $json = $Data | ConvertTo-Json -Depth 30 -Compress
  [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
  $sha = (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLower()
  [System.IO.File]::WriteAllText("$Path.sha256", $sha, [System.Text.Encoding]::ASCII)
  return $sha
}

$gitHead = (git -C $PROJECT_DIR rev-parse HEAD 2>$null).Trim()
$gitShort = (git -C $PROJECT_DIR log --oneline -1 2>$null).Trim()
Write-Host "[GIT] HEAD: $gitHead ($gitShort)" -ForegroundColor Cyan

# L2: admin_config snapshot
Write-Host "`n===== L2 admin_config =====" -ForegroundColor Yellow
$cfgResp = Invoke-AdminApi 'export_admin_config'
if ($cfgResp -and $cfgResp.ok) {
  $cfgData = @{
    config     = $cfgResp.data.config
    exported_at = $cfgResp.data.exported_at
    git_head   = $gitHead
    git_short  = $gitShort
  }
  $cfgPath = "$BackupDir\admin_config\$(Get-Date -Format 'yyyyMMdd-HHmm').json"
  $cfgSha = Save-JsonWithHash $cfgPath $cfgData
  Write-Host "[OK] admin_config: SHA=$($cfgSha.Substring(0,16))..." -ForegroundColor Green
} else {
  Write-Host '[SKIP] export_admin_config failed' -ForegroundColor Magenta
}

# L3: DB full export
Write-Host "`n===== L3 DB Export =====" -ForegroundColor Yellow
$exportedTables = @()
foreach ($col in $COLLECTIONS) {
  $page = 1; $allDocs = @(); $total = 0; $truncated = $false
  while ($true) {
    $resp = Invoke-AdminApi 'export_collection' @{ collection = $col; page = $page; page_size = 100 }
    if (-not $resp -or -not $resp.ok) { Write-Host "  [SKIP] $col" -ForegroundColor Magenta; break }
    $total = $resp.data.total
    $truncated = $resp.data.truncated
    $allDocs += $resp.data.list
    if (-not $resp.data.has_more) { break }
    $page++
    if ($page -gt 100) { Write-Host "  [WARN] $col >100 pages, force stop" -ForegroundColor Red; break }
  }
  $dbPath = "$BackupDir\db\$col.json"
  $dbData = @{
    collection = $col
    total      = $total
    exported_at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    truncated  = $truncated
    list       = $allDocs
  }
  $dbSha = Save-JsonWithHash $dbPath $dbData
  Write-Host "  [OK] $col : $($allDocs.Count)/$total $(if($truncated){'(TRUNC!)'})" -ForegroundColor Green
  $exportedTables += $col
}

# L5: function metadata
Write-Host "`n===== L5 Function Meta =====" -ForegroundColor Yellow
if ($cli) {
  # PS5 下 & $cli 2>&1 会把 cli.bat 的 stderr 输出包装成 NativeCommandError 中断脚本,
  # 改用 Start-Process 分文件重定向 stdout/stderr, 不产生 ErrorRecord
  # ⚠️ cloud functions info 必须带 --names, 否则只打印帮助(输出到 stderr) → stdout 为空
  $fnNames = @(Get-ChildItem (Join-Path $PROJECT_DIR 'cloudfunctions') -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'index.js') } | ForEach-Object { $_.Name })
  $fnOut = "$BackupDir\meta\functions_info.txt"
  $fnErr = "$BackupDir\meta\functions_info.err.txt"
  if ($fnNames.Count -gt 0) {
    $p = Start-Process -FilePath $cli -ArgumentList (@('cloud','functions','info','--env',$CLOUD_ENV,'--project',$PROJECT_DIR,'--names') + $fnNames) -RedirectStandardOutput $fnOut -RedirectStandardError $fnErr -NoNewWindow -Wait -PassThru
    Write-Host "[OK] functions_info.txt ($($fnNames.Count) funcs, cli exit=$($p.ExitCode), $((Get-Item $fnOut).Length)B)" -ForegroundColor Green
  } else {
    Write-Host '[SKIP] no cloudfunctions with index.js' -ForegroundColor Magenta
  }
} else {
  Write-Host '[SKIP] CLI missing' -ForegroundColor Magenta
}

# manifest
$manifest = @{
  backup_at   = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  git_head    = $gitHead
  git_short   = $gitShort
  cloud_env   = $CLOUD_ENV
  appid       = $APPID
  collections = $exportedTables
  total_tables = $exportedTables.Count
}
$manifestJson = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText("$BackupDir\manifest.json", $manifestJson, [System.Text.UTF8Encoding]::new($false))

Write-Host "`n===== DONE =====" -ForegroundColor Green
Write-Host "  Dir : $BackupDir"
Write-Host "  Tbls: $($exportedTables.Count)"
Write-Host "  Git : $gitShort"

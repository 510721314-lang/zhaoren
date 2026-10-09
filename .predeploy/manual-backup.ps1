# 手动完整备份(等价 backup.ps1 的 L2+L3): admin_config 快照 + DB 全量导出 + manifest
# 用法: & 'c:\zhaoren\.predeploy\manual-backup.ps1' -AdminKey "<key>"
param([string]$AdminKey = '')
$ErrorActionPreference = 'Stop'
if (-not $AdminKey) { throw 'AdminKey required' }
$CLOUD_ENV = 'cloud1-d9gkefwcp5c777088'
$GATEWAY_URL = "https://$CLOUD_ENV-1482004365.ap-shanghai.app.tcloudbase.com/api"
$PROJECT_DIR = 'c:\zhaoren'

$COLLECTIONS = @(
  'admin_config', 'admin_web_sessions',
  'user_account', 'partner_profile',
  'demand', 'demand_draft',
  'order_main', 'order_status_log', 'order_confirmations',
  'emergency_contact', 'credit_score_log', 'platform_event', 'audit_log',
  'system_notice', 'disclaimer_signature', 'evaluation',
  'blog_post', 'blog_like', 'blog_comment',
  'safety_report',
  'im_conversation', 'im_message',
  'withdraw_record',
  'user_profile', 'partner_exam', 'partner_apply',
  'dispute', 'withdraw_request', 'credit_log',
  'insurance_record', 'report', 'sms_log', 'device_bind',
  'exam_bank',
  'config_history',
  'no_show_report'
)

$BackupDir = "C:\zhaoren-bak\zhaoren_backup_$(Get-Date -Format 'yyyyMMdd-HHmm')"
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
    Write-Host "[FAIL] $Action : $($_.Exception.Message)" -ForegroundColor Red
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

# L2: admin_config 快照
Write-Host "`n===== L2 admin_config =====" -ForegroundColor Yellow
$cfgResp = Invoke-AdminApi 'export_admin_config' @{ confirm = $true }
if ($cfgResp -and $cfgResp.ok) {
  $cfgData = @{
    config     = $cfgResp.data.config
    exported_at = $cfgResp.data.exported_at
    git_head   = $gitHead
    git_short  = $gitShort
  }
  $cfgPath = "$BackupDir\admin_config\$(Get-Date -Format 'yyyyMMdd-HHmm').json"
  $cfgSha = Save-JsonWithHash $cfgPath $cfgData
  Write-Host "[OK] admin_config SHA=$($cfgSha.Substring(0,16))..." -ForegroundColor Green
} else { Write-Host '[SKIP] export_admin_config failed' -ForegroundColor Magenta }

# L3: DB 全量导出
Write-Host "`n===== L3 DB Export =====" -ForegroundColor Yellow
$exportedTables = @()
foreach ($col in $COLLECTIONS) {
  $page = 1; $allDocs = @(); $total = 0; $truncated = $false; $exported = $false
  while ($true) {
    $resp = Invoke-AdminApi 'export_collection' @{ collection = $col; page = $page; page_size = 100; confirm = $true }
    if (-not $resp -or -not $resp.ok) { Write-Host "  [SKIP] $col" -ForegroundColor Magenta; break }
    $total = $resp.data.total
    $truncated = $resp.data.truncated
    $allDocs += $resp.data.list
    $exported = $true
    if (-not $resp.data.has_more) { break }
    $page++
    if ($page -gt 100) { Write-Host "  [WARN] $col >100 pages force stop" -ForegroundColor Red; break }
  }
  if ($exported) {
    $dbPath = "$BackupDir\db\$col.json"
    $dbData = @{
      collection = $col
      total      = $total
      exported_at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      truncated  = $truncated
      list       = $allDocs
    }
    $dbSha = Save-JsonWithHash $dbPath $dbData
    Write-Host "  [OK] $col : $($allDocs.Count)/$total $(if($truncated){'(TRUNC!)'}) SHA=$($dbSha.Substring(0,12))..." -ForegroundColor Green
    $exportedTables += $col
  }
}

# L6: 云函数代码（从云端下载实际部署版本）
Write-Host "`n===== L6 云函数代码(云端下载) =====" -ForegroundColor Yellow
$fnCodeDir = $null
$cli = Get-ChildItem -Path 'C:\Users\Administrator\Desktop' -Directory -ErrorAction SilentlyContinue |
  Where-Object { Test-Path (Join-Path $_.FullName 'cli.bat') } | Select-Object -First 1
if ($cli) {
  $cliBat = Join-Path $cli.FullName 'cli.bat'
  $fnRoot = "$BackupDir\meta\functions_code"
  New-Item -ItemType Directory -Force -Path $fnRoot | Out-Null
  $fnNames = @(Get-ChildItem "$PROJECT_DIR\cloudfunctions" -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'index.js') } | ForEach-Object { $_.Name })
  $downloaded = 0; $failed = @()
  foreach ($fn in $fnNames) {
    $target = Join-Path $fnRoot $fn
    $errFile = Join-Path $fnRoot "$fn.err.txt"
    $p = Start-Process -FilePath $cliBat `
      -ArgumentList @('cloud','functions','download','--env',$CLOUD_ENV,'--name',$fn,'--path',$target,'--project',$PROJECT_DIR) `
      -RedirectStandardOutput (Join-Path $fnRoot "$fn.std.txt") -RedirectStandardError $errFile -NoNewWindow -Wait -PassThru
    $size = ((Get-ChildItem $target -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum)
    if ($p.ExitCode -eq 0 -and $size -gt 0) { $downloaded++ }
    else { $failed += $fn }
  }
  if ($downloaded -gt 0) { $fnCodeDir = $fnRoot; Write-Host "[OK] $downloaded/$($fnNames.Count) 函数已下载到 $fnRoot" -ForegroundColor Green }
  if ($failed.Count) { Write-Host "[WARN] 下载失败: $($failed -join ',')" -ForegroundColor Magenta }
} else { Write-Host '[SKIP] CLI 未找到, 跳过 L6' -ForegroundColor Magenta }

# L7: 索引设计台账（从 init-db INDEXES 提取为 JSON）
Write-Host "`n===== L7 INDEX LEDGER(design-level) =====" -ForegroundColor Yellow
$indexLedgerPath = $null
$dumpJs = "$PROJECT_DIR\scripts\dump-index-ledger.js"
if (Test-Path $dumpJs) {
  try {
    $ledgerPath = Join-Path $BackupDir 'meta\index_ledger.json'
    $ledgerLog = "$ledgerPath.node.log"
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'   # node stderr 在 Stop 模式下会被转成终止错误, 仅 node 调用期间关掉
    & node $dumpJs $ledgerPath 2> $ledgerLog
    $ErrorActionPreference = $prevEap
    if (Test-Path $ledgerPath) {
      $ledgerSha = (Get-FileHash $ledgerPath -Algorithm SHA256).Hash.ToLower()
      [System.IO.File]::WriteAllText("$ledgerPath.sha256", $ledgerSha, [System.Text.Encoding]::ASCII)
      $indexLedgerPath = $ledgerPath
      Write-Host "[OK] index_ledger.json (32 indexes) SHA=$($ledgerSha.Substring(0,12))..." -ForegroundColor Green
    } else { Write-Host '[SKIP] dump-index-ledger.js exec failed' -ForegroundColor Magenta }
  } catch { Write-Host "[FAIL] L7 : $($_.Exception.Message)" -ForegroundColor Red }
} else { Write-Host '[SKIP] dump-index-ledger.js not found' -ForegroundColor Magenta }

# manifest
$manifest = @{
  backup_at    = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  git_head     = $gitHead
  git_short    = $gitShort
  cloud_env    = $CLOUD_ENV
  appid        = 'wxbc4a4afacdf234f5'
  collections  = $exportedTables
  total_tables = $exportedTables.Count
  has_functions_code = $fnCodeDir
  has_index_ledger   = $indexLedgerPath
}
[System.IO.File]::WriteAllText("$BackupDir\manifest.json", ($manifest | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))

Write-Host "`n===== DONE =====" -ForegroundColor Green
Write-Host "  Dir : $BackupDir"
Write-Host "  Tbls: $($exportedTables.Count)"
Write-Host "  Git : $gitShort"
Write-Host "  Func-code : $(if($fnCodeDir){'yes'}else{'skip'}) | Index-ledger : $(if($indexLedgerPath){'yes'}else{'skip'})"
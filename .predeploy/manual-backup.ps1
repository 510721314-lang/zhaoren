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

# manifest
$manifest = @{
  backup_at    = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  git_head     = $gitHead
  git_short    = $gitShort
  cloud_env    = $CLOUD_ENV
  appid        = 'wxbc4a4afacdf234f5'
  collections  = $exportedTables
  total_tables = $exportedTables.Count
}
[System.IO.File]::WriteAllText("$BackupDir\manifest.json", ($manifest | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))

Write-Host "`n===== DONE =====" -ForegroundColor Green
Write-Host "  Dir : $BackupDir"
Write-Host "  Tbls: $($exportedTables.Count)"
Write-Host "  Git : $gitShort"
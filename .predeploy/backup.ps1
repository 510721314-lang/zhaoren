# zhaoren Cloud Backup Script L2+L3+L5
# Usage: .\backup.ps1 [-BackupDir C:\zhaoren_backup_YYYYMMDD]
param(
  [string]$BackupDir = ''
)
$ErrorActionPreference = 'Stop'

$CLOUD_ENV   = 'cloud1-d9gkefwcp5c777088'
$PROJECT_DIR = 'c:\Users\DC\Desktop\zhaoren'
$APPID       = 'wxbc4a4afacdf234f5'
$ADMIN_KEY   = 'AWK-27ea10d4ed8a995add3000f977ad62c2ade8ff98d70ef9c1a8bee02df9d49c0c'
$GATEWAY_URL = "https://$CLOUD_ENV-1482004365.ap-shanghai.app.tcloudbase.com/api"

$COLLECTIONS = @(
  'admin_config', 'admin_web_sessions',
  'user_profile', 'partner_profile', 'partner_exam',
  'order', 'order_status_log', 'order_deposit', 'order_payment', 'order_settlement',
  'demand_publish', 'demand_match',
  'blog', 'blog_comment', 'blog_like',
  'safety_report', 'safety_checkin',
  'system_notice',
  'credit_log', 'withdraw_request',
  'insurance_record',
  'report', 'dispute',
  'sms_log', 'device_bind'
)

# Find cli.bat
$cli = Get-ChildItem -Path 'C:\Users\DC','C:\' -Filter 'cli.bat' -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match 'wechat' } |
  Select-Object -First 1 -ExpandProperty FullName
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
      -Headers @{ 'X-Admin-Key' = $ADMIN_KEY; 'Content-Type' = 'application/json' } `
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
  $fnInfo = & $cli cloud functions info --env $CLOUD_ENV --project $PROJECT_DIR 2>&1 | Out-String
  [System.IO.File]::WriteAllText("$BackupDir\meta\functions_info.txt", $fnInfo, [System.Text.UTF8Encoding]::new($false))
  Write-Host '[OK] functions_info.txt' -ForegroundColor Green
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

# check-audit-prune.ps1 - verify auditPrune dry-run record (one-off / daily watchdog)
# Purpose: confirm order-timer's auditPrune actually ran at the UTC 19:00 slot (Beijing 03:00)
#          and wrote admin_config.audit_prune_last = {at,dry_run,matched,pruned,cutoff,days}.
# Expected first-run result: dry_run=true, matched=0 (audit_log keeps only records newer than 90 days).
# exit codes: 0 = PASS, 1 = FAIL, 2 = no key, 5 = gateway unreachable
# Usage: powershell -File scripts/check-audit-prune.ps1   (reads $env:AWK_KEY, falls back to key file)
# Log: appended to C:\zhaoren-bak\audit-prune-check.log (UTF-8 no BOM)
$ErrorActionPreference = 'Stop'

$key = $env:AWK_KEY
if (-not $key) {
  $kf = 'C:\zhaoren-bak\admin-key-20261009.txt'
  if (Test-Path $kf) { $key = (Get-Content $kf -Raw).Trim() }
}
$logPath = 'C:\zhaoren-bak\audit-prune-check.log'
$gate = 'https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api'

function Write-Log([string]$msg) {
  $line = "[{0}] {1}" -f ([DateTimeOffset]::Now.ToString('yyyy-MM-dd HH:mm:ss')), $msg
  Write-Host $line
  try {
    [System.IO.File]::AppendAllText($logPath, $line + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
  } catch { }
}

if (-not $key) {
  Write-Log 'FATAL: AWK_KEY not set and key file missing'
  exit 2
}

$resp = $null
try {
  $resp = Invoke-WebRequest -Method POST -Uri $gate -Headers @{ 'X-Admin-Key' = $key } `
    -Body '{"action":"config_get"}' -ContentType 'application/json' -UseBasicParsing -TimeoutSec 30
} catch {
  Write-Log ("CANNOT VERIFY: gateway unreachable - {0}" -f $_.Exception.Message)
  exit 5
}

$j = $null
try { $j = $resp.Content | ConvertFrom-Json } catch { }
if (-not $j) {
  Write-Log 'CANNOT VERIFY: config_get response unparsable'
  exit 5
}

$ap = $null
if ($j.data) { $ap = $j.data.audit_prune_last }
if (-not $ap) {
  Write-Log 'FAIL: audit_prune_last absent - auditPrune did not run at the UTC 19:00 slot (or field not exposed)'
  exit 1
}

$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$at = [int64]$ap.at
$ageH = [math]::Round((($now - $at) / 3600000.0), 2)
$detail = $ap | ConvertTo-Json -Compress
Write-Log ("record: {0}  age_hours={1}" -f $detail, $ageH)

if ($at -le 0 -or $ageH -gt 24) {
  Write-Log ("FAIL: record stale or invalid (age_hours={0})" -f $ageH)
  exit 1
}
if ($ap.dry_run -eq $true -and [int64]$ap.matched -eq 0) {
  Write-Log 'PASS: dry-run record confirmed (dry_run=true, matched=0) - auditPrune chain verified end-to-end'
  exit 0
}
Write-Log ("FAIL: unexpected shape (dry_run={0}, matched={1}, pruned={2})" -f $ap.dry_run, $ap.matched, $ap.pruned)
exit 1

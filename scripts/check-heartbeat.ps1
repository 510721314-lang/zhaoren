# check-heartbeat.ps1 - order-timer watchdog observability (D7 fix, tech-review P1)
# Reads admin_config.error_scan_heartbeat_at via admin gateway config_get and reports age.
#   fresh (<30min)        -> exit 0  [heartbeat] OK
#   stale / never beaten  -> exit 1  [heartbeat] FAIL (orderTimer trigger down? see docs/runbooks/ops-runbook.md)
#   gateway unreachable   -> exit 5  (cannot verify; smoke step already covers connectivity)
# 2026-10-07: trigger confirmed working (root cause was isTimer detection incompatible with the SCF
# event format, every run was rejected by ot_forbidden), so a stale heartbeat now FAILs the gate.
# Usage: powershell -File scripts/check-heartbeat.ps1   (needs $env:AWK_KEY)
param([int]$MaxAgeMin = 30)
$ErrorActionPreference = 'Stop'
if (-not $env:AWK_KEY) { Write-Host '[heartbeat] FATAL: AWK_KEY not set'; exit 2 }

$gate = "https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api"
try {
  $resp = Invoke-WebRequest -Method POST -Uri $gate -Headers @{ 'X-Admin-Key' = $env:AWK_KEY } `
    -Body '{"action":"config_get"}' -ContentType 'application/json' -UseBasicParsing -TimeoutSec 20
  $j = $resp.Content | ConvertFrom-Json
  $hb = $null
  if ($j -and $j.config) { $hb = $j.config.error_scan_heartbeat_at }
  elseif ($j -and $j.data) { $hb = $j.data.error_scan_heartbeat_at }
  elseif ($j) { $hb = $j.error_scan_heartbeat_at }
  $hb = [int64]($hb | Where-Object { $_ })
  if ($j -and $j.config) { $src = 'config-nested' }
  elseif ($j -and $j.data) { $src = 'data-nested' }
  elseif ($j) { $src = 'flat' } else { $src = 'unparsed' }
  Write-Host "[heartbeat] debug: parsed heartbeat=$hb source=$src"
  if ($hb -le 0) {
    Write-Host '[heartbeat] FAIL: never beaten (error_scan_heartbeat_at=0) - orderTimer trigger down? see docs/runbooks/ops-runbook.md'
    exit 1
  }
  $ageMin = [math]::Round((([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $hb) / 60000), 1)
  if ($ageMin -le $MaxAgeMin) { Write-Host "[heartbeat] OK: last beat ${ageMin} min ago"; exit 0 }
  Write-Host "[heartbeat] FAIL: last beat ${ageMin} min ago (> $MaxAgeMin) - timer may be stuck"
  exit 1
} catch {
  Write-Host "[heartbeat] CANNOT VERIFY: $($_.Exception.Message) (exit 5)"
  exit 5
}
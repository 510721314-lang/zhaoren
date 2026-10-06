# smoke-check.ps1 - gateway core-link smoke test (run after every cloud function deploy / key change)
# usage: powershell -ExecutionPolicy Bypass -File .predeploy/smoke-check.ps1
# all calls are read-only or idempotent probes; exit 0 = all pass
$ErrorActionPreference = 'Continue'
$gate = 'https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api'
$key  = $env:AWK_KEY
if (-not $key) { Write-Host '[FATAL] AWK_KEY env not set' -ForegroundColor Red; exit 2 }
$script:fail = 0

function Invoke-Gw($body) {
  $json = $body | ConvertTo-Json -Compress -Depth 5
  # escape quotes for cmdline transport (same as manual curl \")
  $d = $json.Replace('"', '\"')
  $raw = curl.exe -s -X POST $gate -H 'Content-Type: application/json' -H "X-Admin-Key: $key" -d $d
  try { return ($raw | ConvertFrom-Json) } catch { Write-Host "[RAW] $raw"; return $null }
}
function Check($name, $cond, $detail) {
  if ($cond) { Write-Host "[PASS] $name" -ForegroundColor Green }
  else { Write-Host "[FAIL] $name" -ForegroundColor Red; if ($detail) { Write-Host "       $detail" -ForegroundColor Red }; $script:fail++ }
}

# 1. public config: switch consistency (tip / platform switch / time redline)
$r = Invoke-Gw @{ action = 'config_public' }
Check 'config_public.ok' ($r -and $r.ok) ($r | ConvertTo-Json -Compress)
Check 'config_public.tip_enabled' ($r -and $r.ok -and $r.data.payment.tip_enabled -eq $true) 'tip_enabled not delivered; check mock_payment_enabled / admin-action config_public'
Check 'config_public.switch_access' ($r -and $r.ok -and $r.data.switches.switch_access -eq $true) 'platform in maintenance mode'
Check 'config_public.time_redline' ($r -and $r.ok -and $r.data.time_redline.open_min -eq 360 -and $r.data.time_redline.close_min -eq 1440) 'time redline params drifted'

# 2. square list: seed demands in place (guest view; 48 seeded matching demands exist => list >= 10)
$r = Invoke-Gw @{ action = 'home_probe_square'; limit = 20 }
$sqCount = if ($r -and $r.ok -and $r.data.list) { @($r.data.list).Count } else { 0 }
Check 'home_probe_square' ($r -and $r.ok -and $sqCount -ge 10) "square list count=$sqCount"

# 4. modify-confirm notice link (system_notice collection readable)
$r = Invoke-Gw @{ action = 'home_probe_system_notice'; type = 'modify_confirm'; hours = 720 }
Check 'home_probe_system_notice' ($r -and $r.ok) ($r | ConvertTo-Json -Compress)

Write-Host ''
if ($script:fail -eq 0) { Write-Host 'SMOKE ALL PASS' -ForegroundColor Green; exit 0 }
else { Write-Host "SMOKE FAILED: $script:fail item(s)" -ForegroundColor Red; exit 1 }
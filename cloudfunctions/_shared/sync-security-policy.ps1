# Sync security_policy.js (canonical) -> local copies in the 3 cloud functions that share it
# Usage: powershell -File cloudfunctions/_shared/sync-security-policy.ps1
# Canonical source: _shared/security_policy.js ; run this script after ANY edit to it.
# Consumers: user-login(密码登录防爆破/紧急联系人冷却) / init-db(bootstrap CAS 决策) /
#            admin-action(admin_login 防爆破锁定, 2026-10-13 加入)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # cloudfunctions/
$src  = Join-Path $root '_shared\security_policy.js'
$dirs = @('user-login','init-db','admin-action')
$dsts = $dirs | ForEach-Object { Join-Path $root "$_\security_policy.js" }
if (-not (Test-Path $src)) { throw "canonical source missing: $src" }
foreach ($d in $dsts) {
  Copy-Item $src $d -Force
  Write-Host "[SYNC] -> $d"
}
foreach ($d in $dsts) {
  $h1 = (Get-FileHash $src -Algorithm SHA256).Hash
  $h2 = (Get-FileHash $d  -Algorithm SHA256).Hash
  if ($h1 -ne $h2) { throw "consistency FAIL: $d differs from canonical" }
  Write-Host "[OK] identical: $d"
}
Write-Host 'ALL SYNCED'
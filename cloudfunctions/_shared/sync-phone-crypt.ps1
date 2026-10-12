# Sync phone_crypt.js (canonical) -> local copies in user-login, demand-publish, admin-action
# Usage: powershell -File cloudfunctions/_shared/sync-phone-crypt.ps1
# Canonical source: _shared/phone_crypt.js ; run this script after ANY edit to it.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # cloudfunctions/
$src  = Join-Path $root '_shared\phone_crypt.js'
$dsts = @(
  (Join-Path $root 'user-login\phone_crypt.js'),
  (Join-Path $root 'demand-publish\phone_crypt.js'),
  (Join-Path $root 'admin-action\phone_crypt.js')
)
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

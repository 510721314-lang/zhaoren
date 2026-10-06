# Sync test_data.js (canonical) -> local copies in demand-publish, order-create, admin-action, init-db
# Usage: powershell -File cloudfunctions/_shared/sync-test-data.ps1
# Canonical source: _shared/test_data.js ; run this script after ANY edit to it.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # cloudfunctions/
$src  = Join-Path $root '_shared\test_data.js'
$dsts = @(
  (Join-Path $root 'demand-publish\test_data.js'),
  (Join-Path $root 'order-create\test_data.js'),
  (Join-Path $root 'admin-action\test_data.js'),
  (Join-Path $root 'init-db\test_data.js')
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

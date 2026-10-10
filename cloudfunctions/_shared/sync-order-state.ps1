# Sync order_state.js (canonical) -> local copies in order-action, order-timer
# Usage: powershell -File cloudfunctions/_shared/sync-order-state.ps1
# Canonical source: _shared/order_state.js ; run this script after ANY edit to it.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # cloudfunctions/
$src  = Join-Path $root '_shared\order_state.js'
$dsts = @(
  (Join-Path $root 'order-action\order_state.js'),
  (Join-Path $root 'order-timer\order_state.js')
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

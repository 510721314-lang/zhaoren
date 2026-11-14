# Sync sub_msg.js (canonical) -> local copies
# Usage: powershell -File cloudfunctions/_shared/sync-sub-msg.ps1
# Canonical source: _shared/sub_msg.js ; run this script after ANY edit to it.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # cloudfunctions/
$src  = Join-Path $root '_shared\sub_msg.js'
$dsts = @(
  (Join-Path $root 'order-action\sub_msg.js'),
  (Join-Path $root 'order-timer\sub_msg.js'),
  (Join-Path $root 'partner-action\sub_msg.js')
  (Join-Path $root 'payment-mock\sub_msg.js')
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

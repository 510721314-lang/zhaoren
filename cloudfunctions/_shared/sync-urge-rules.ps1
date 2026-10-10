# Sync urge_rules.js (canonical) -> local copies in order-timer, order-action
# Usage: powershell -File cloudfunctions/_shared/sync-urge-rules.ps1
# Canonical source: _shared/urge_rules.js ; run this script after ANY edit to it.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # cloudfunctions/
$src  = Join-Path $root '_shared\urge_rules.js'
$dsts = @(
  (Join-Path $root 'order-timer\urge_rules.js'),
  (Join-Path $root 'order-action\urge_rules.js')
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

# Sync take_rules.js (canonical) -> local copies in order-create, demand-publish, order-action, home-action, partner-apply, partner-action
# Usage: powershell -File cloudfunctions/_shared/sync-take-rules.ps1
# Canonical source: _shared/take_rules.js ; run this script after ANY edit to it.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # cloudfunctions/
$src  = Join-Path $root '_shared\take_rules.js'
$dsts = @(
  (Join-Path $root 'order-create\take_rules.js'),
  (Join-Path $root 'demand-publish\take_rules.js'),
  (Join-Path $root 'order-action\take_rules.js'),
  (Join-Path $root 'home-action\take_rules.js'),
  (Join-Path $root 'partner-apply\take_rules.js'),
  (Join-Path $root 'partner-action\take_rules.js')
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

# Sync cert_state.js (canonical) -> local copies in partner-apply, order-create, partner-action
# Usage: powershell -File cloudfunctions/_shared/sync-cert-state.ps1
# Canonical source: _shared/cert_state.js ; run this script after ANY edit to it.
# S5 adds exam-action to the destination list when that function is created.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # cloudfunctions/
$src  = Join-Path $root '_shared\cert_state.js'
$dsts = @(
  (Join-Path $root 'partner-apply\cert_state.js'),
  (Join-Path $root 'order-create\cert_state.js'),
  (Join-Path $root 'partner-action\cert_state.js')
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

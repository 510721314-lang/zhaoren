# Sync scene_meta.js (canonical) -> local copies in each cloud function that renders scene names
# Usage: powershell -File cloudfunctions/_shared/sync-scene-meta.ps1
# Canonical source: _shared/scene_meta.js ; run this script after ANY edit to it.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # cloudfunctions/
$src  = Join-Path $root '_shared\scene_meta.js'
$dsts = @(
  'payment-mock', 'im-send', 'im-conv', 'demand-publish',
  'order-action', 'admin-action', 'home-action'
) | ForEach-Object { Join-Path $root "$_\scene_meta.js" }
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

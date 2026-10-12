# Sync audit.js (canonical) -> local copies in 11 cloud functions
# Usage: powershell -File cloudfunctions/_shared/sync-audit.ps1
# Canonical source: _shared/audit.js ; run this script after ANY edit to it.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # cloudfunctions/
$src  = Join-Path $root '_shared\audit.js'
$dirs = @(
  'admin-action','blog-action','demand-publish','evaluation-submit','im-send',
  'order-action','order-create','partner-action','payment-mock','safety-report','user-login'
)
if (-not (Test-Path $src)) { throw "canonical source missing: $src" }
foreach ($d in $dirs) {
  $dst = Join-Path $root "$d\audit.js"
  Copy-Item $src $dst -Force
  Write-Host "[SYNC] -> $dst"
}
foreach ($d in $dirs) {
  $dst = Join-Path $root "$d\audit.js"
  $h1 = (Get-FileHash $src -Algorithm SHA256).Hash
  $h2 = (Get-FileHash $dst -Algorithm SHA256).Hash
  if ($h1 -ne $h2) { throw "consistency FAIL: $dst differs from canonical" }
}
Write-Host 'ALL SYNCED'

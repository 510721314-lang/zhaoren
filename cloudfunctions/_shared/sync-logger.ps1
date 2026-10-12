# Sync logger.js (canonical) -> local copies in 16 cloud functions
# Usage: powershell -File cloudfunctions/_shared/sync-logger.ps1
# Canonical source: _shared/logger.js ; run this script after ANY edit to it.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # cloudfunctions/
$src  = Join-Path $root '_shared\logger.js'
$dirs = @(
  'admin-action','blog-action','demand-match','demand-publish','evaluation-submit','home-action',
  'im-conv','im-send','order-action','order-create','order-timer',
  'partner-action','partner-apply','payment-mock','safety-report','user-login'
)
if (-not (Test-Path $src)) { throw "canonical source missing: $src" }
foreach ($d in $dirs) {
  $dst = Join-Path $root "$d\logger.js"
  Copy-Item $src $dst -Force
  Write-Host "[SYNC] -> $dst"
}
foreach ($d in $dirs) {
  $dst = Join-Path $root "$d\logger.js"
  $h1 = (Get-FileHash $src -Algorithm SHA256).Hash
  $h2 = (Get-FileHash $dst -Algorithm SHA256).Hash
  if ($h1 -ne $h2) { throw "consistency FAIL: $dst differs from canonical" }
}
Write-Host 'ALL SYNCED'

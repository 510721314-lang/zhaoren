# Sync config_defaults.js + config_defaults.json (canonical) -> local copies
# Usage: powershell -File cloudfunctions/_shared/sync-config-defaults.ps1
# Canonical: _shared/config_defaults.js + _shared/config_defaults.json ; run after ANY edit.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # cloudfunctions/
$dirs = @('order-action', 'admin-action', 'order-timer')
$files = @('config_defaults.js', 'config_defaults.json')
foreach ($f in $files) {
  $src = Join-Path $root "_shared\$f"
  if (-not (Test-Path $src)) { throw "canonical source missing: $src" }
  foreach ($d in $dirs) {
    $dst = Join-Path $root "$d\$f"
    Copy-Item $src $dst -Force
    Write-Host "[SYNC] $f -> $dst"
  }
}
foreach ($f in $files) {
  $src = Join-Path $root "_shared\$f"
  $h1 = (Get-FileHash $src -Algorithm SHA256).Hash
  foreach ($d in $dirs) {
    $dst = Join-Path $root "$d\$f"
    $h2 = (Get-FileHash $dst -Algorithm SHA256).Hash
    if ($h1 -ne $h2) { throw "consistency FAIL: $dst differs from canonical" }
    Write-Host "[OK] identical: $dst"
  }
}
Write-Host 'ALL SYNCED'

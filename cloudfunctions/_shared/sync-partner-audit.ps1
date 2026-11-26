# Sync partner_audit.js (canonical) -> local copies in partner-action & admin-action
# Usage: powershell -File cloudfunctions/_shared/sync-partner-audit.ps1
# Canonical source: _shared/partner_audit.js ; run this script after ANY edit to it.
# 2026-11-19 评审修复: heal.js(新含 healAuditLock) require('./partner_audit') —— demand-match/order-create
#   纳入 heal 消费方, 副本分发与 check-shared-sync.js SYNC_MAP 同步登记
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # cloudfunctions/
$src  = Join-Path $root '_shared\partner_audit.js'
$dsts = @(
  (Join-Path $root 'partner-action\partner_audit.js'),
  (Join-Path $root 'admin-action\partner_audit.js'),
  (Join-Path $root 'demand-match\partner_audit.js'),
  (Join-Path $root 'order-create\partner_audit.js')
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

# Sync heal.js (canonical) -> local copies in demand-match / order-create / partner-action
# Usage: powershell -File cloudfunctions/_shared/sync-heal.ps1
# Canonical source: _shared/heal.js ; run this script after ANY edit to it.
# 注意: heal.js require('./partner_audit') —— 消费方副本由 sync-partner-audit.ps1 分发
#       (2026-11-19 评审修复: 此前该文件无 sync 脚本, demand-match/order-create 漂移为旧版且缺 partner_audit.js 副本,
#        按规范源直接同步会 require 期 MODULE_NOT_FOUND 崩溃 —— 两脚本须配套执行)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # cloudfunctions/
$src  = Join-Path $root '_shared\heal.js'
$dsts = @(
  (Join-Path $root 'demand-match\heal.js'),
  (Join-Path $root 'order-create\heal.js'),
  (Join-Path $root 'partner-action\heal.js')
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

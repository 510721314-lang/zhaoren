# Sync exam-fallback.js (canonical) -> local copies in the cloud functions that consume it
# Usage: powershell -File cloudfunctions/_shared/sync-exam-fallback.ps1
# Canonical source: _shared/exam-fallback.js ; run this script after ANY edit to it.
# Consumers: partner-action(exam_bank 读库失败兜底) / admin-action(exam_subject_* 兜底)
# 背景: CloudBase 按单函数目录打包, _shared/ 不随包上传 -> 各函数内必须持有本地副本, require('./exam-fallback')。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # cloudfunctions/
$src  = Join-Path $root '_shared\exam-fallback.js'
$dirs = @('partner-action','admin-action')
$dsts = $dirs | ForEach-Object { Join-Path $root "$_\exam-fallback.js" }
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

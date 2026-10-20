# Sync admin-login.js (canonical) -> local copies in the cloud functions that consume it
# Usage: powershell -File cloudfunctions/_shared/sync-admin-login.ps1
# Canonical source: _shared/admin-login.js ; run this script after ANY edit to it.
# Consumers: admin-action(免鉴权前置组 admin_login/admin_logout) / admin-web(本地直调登录, 消除双冷启动 504)
# 依赖: admin-login.js 内部 require('./security_policy') -> 两消费函数的 security_policy.js 副本由 sync-security-policy.ps1 维护
#       (admin-web 已于 2026-10-19 加入 sync-security-policy.ps1 的消费方清单)。
# 背景: CloudBase 按单函数目录打包, _shared/ 不随包上传 -> 各函数内必须持有本地副本, require('./admin-login')。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # cloudfunctions/
$src  = Join-Path $root '_shared\admin-login.js'
$dirs = @('admin-action','admin-web')
$dsts = $dirs | ForEach-Object { Join-Path $root "$_\admin-login.js" }
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
if (-not (Test-Path (Join-Path $root 'admin-web\security_policy.js'))) {
  Write-Host "[WARN] admin-web/security_policy.js 缺失 -> 请先跑 sync-security-policy.ps1(已含 admin-web 消费方)" -ForegroundColor Yellow
}
Write-Host 'ALL SYNCED'

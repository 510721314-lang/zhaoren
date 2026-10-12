# Sync openid.js (canonical) -> local copies in the 15 cloud functions that share the core resolver
# Usage: powershell -File cloudfunctions/_shared/sync-openid.ps1
# Canonical source: _shared/openid.js ; run this script after ANY edit to it.
#
# 变体说明(有意分叉, 不纳入同步, 由 check-shared-sync.js 的 SYNC_MAP 显式排除):
#   - admin-action/openid.js : 规范源超集, 额外含 admin-web 网关共享密钥(admin_web_key)校验,
#                              用于防客户端直连 callFunction 冒充管理员 —— 变更时须同步对齐规范源的安全逻辑
#   - init-db/openid.js      : 独立变体(初始化场景), 用途见该文件头注释
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # cloudfunctions/
$src  = Join-Path $root '_shared\openid.js'
$dirs = @(
  'blog-action','demand-match','demand-publish','evaluation-submit','home-action',
  'im-conv','im-send','order-action','order-create','order-timer',
  'partner-action','partner-apply','payment-mock','safety-report','user-login'
)
$dsts = $dirs | ForEach-Object { Join-Path $root "$_\openid.js" }
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

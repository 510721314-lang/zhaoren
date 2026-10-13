# Sync openid.js (canonical) -> local copies in ALL 17 cloud functions that share the core resolver
# Usage: powershell -File cloudfunctions/_shared/sync-openid.ps1
# Canonical source: _shared/openid.js ; run this script after ANY edit to it.
#
# 2026-10-13 收敛: 原先两处「有意变体」已合并归零, 全量 17 个业务函数逐字节同源(SHA 门禁守护):
#   - admin-action : 网关代理密钥(admin_web_key)校验已上移到 admin-action/index.js 的
#                    resolveOpenidWithProxy 包装层, 其 openid.js 与规范源一致
#   - init-db      : 独立变体废弃(此前缺失 dev_until fail-closed 加固, 属安全隐患);
#                    invalidateEnvCache 已并入规范源导出, 全量同源
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # cloudfunctions/
$src  = Join-Path $root '_shared\openid.js'
$dirs = @(
  'blog-action','demand-match','demand-publish','evaluation-submit','home-action',
  'im-conv','im-send','order-action','order-create','order-timer',
  'partner-action','partner-apply','payment-mock','safety-report','user-login',
  'admin-action','init-db'
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
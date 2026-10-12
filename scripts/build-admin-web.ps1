# scripts/build-admin-web.ps1 · 构建 admin-web 前端并同步到云函数 public 目录(批 5.5)
# 用法: powershell -File scripts/build-admin-web.ps1
# public/ 构建产物已出库(.gitignore), 部署 admin-web 前须先跑本脚本生成产物。
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$fe = Join-Path $root 'admin-web-frontend'
$dist = Join-Path $fe 'dist'
$public = Join-Path $root 'cloudfunctions\admin-web\public'

Push-Location $fe
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)" }
}
finally { Pop-Location }

if (Test-Path (Join-Path $public 'assets')) {
  Remove-Item (Join-Path $public 'assets') -Recurse -Force
}
Copy-Item (Join-Path $dist '*') $public -Recurse -Force
Write-Host "admin-web 构建产物已同步 -> $public"

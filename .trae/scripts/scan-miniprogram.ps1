# zhaoren scan-miniprogram.ps1 — 小程序静态一致性门禁
# 三合一: node --check 语法 + no-undef 未定义变量 + data/WXML 绑定一致性
# 用法:
#   .\scan-miniprogram.ps1                # 全量扫描(默认 miniprogram 根)
#   .\scan-miniprogram.ps1 -SkipUndef     # 跳过 eslint no-undef(离线/未装 node_modules 时)
# 退出码: 0 = 全通过 / 1 = 存在问题
param(
  [string]$Root = (Join-Path $PSScriptRoot '..\..\miniprogram'),
  [switch]$SkipUndef
)
$ErrorActionPreference = 'Stop'
$node = $null
foreach ($cand in @("$env:ProgramFiles\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
  if (Test-Path $cand) { $node = $cand; break }
}
if (-not $node) { Write-Host "[FATAL] node.exe not found" -ForegroundColor Red; exit 1 }
$scriptsDir = $PSScriptRoot

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " zhaoren miniprogram static scan" -ForegroundColor Cyan
Write-Host " root: $Root" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# 1) JS 语法
Write-Host "`n[1/3] node --check (JS syntax)" -ForegroundColor Yellow
$jsFiles = Get-ChildItem $Root -Recurse -Filter *.js -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules|miniprogram_npm' }
$synFail = 0
foreach ($f in $jsFiles) {
  & $node --check $f.FullName 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host "  FAIL $($f.FullName)" -ForegroundColor Red; $synFail++ }
}
Write-Host "  $($jsFiles.Count) files, $synFail syntax error(s)" -ForegroundColor $(if($synFail){'Red'}else{'Green'})

# 2) no-undef
$undefExit = 0
if (-not $SkipUndef) {
  Write-Host "`n[2/3] eslint no-undef (bare identifiers)" -ForegroundColor Yellow
  & $node (Join-Path $scriptsDir 'scan-undef.js') $Root mp
  $undefExit = $LASTEXITCODE
} else {
  Write-Host "`n[2/3] eslint no-undef (skipped by -SkipUndef)" -ForegroundColor Magenta
}

# 3) data/WXML 一致性
Write-Host "`n[3/3] data/WXML binding consistency" -ForegroundColor Yellow
& $node (Join-Path $scriptsDir 'scan-data-consistency.js') $Root
$dataExit = $LASTEXITCODE

Write-Host "`n==================================================" -ForegroundColor Cyan
$failed = $synFail -ne 0 -or $undefExit -eq 1 -or $dataExit -eq 1
if ($failed) {
  Write-Host " RESULT: FAIL" -ForegroundColor Red
  exit 1
} else {
  Write-Host " RESULT: ALL PASS" -ForegroundColor Green
  exit 0
}

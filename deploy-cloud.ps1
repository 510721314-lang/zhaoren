# 云函数统一部署脚本 (PowerShell 5+)
# 用法: .\deploy-cloud.ps1                     # 部署全部
#       .\deploy-cloud.ps1 -Names partner-action,order-action  # 部署指定
# 规则: 串行 + 自动重试 + 强制 --remote-npm-install
param(
  [string[]]$Names = @(
    "partner-action",
    "order-action",
    "payment-mock",
    "user-login",
    "demand-publish",
    "home-action",
    "im-conv",
    "im-send",
    "evaluation-submit",
    "order-create",
    "partner-apply",
    "safety-report",
    "admin-action",
    "blog-action"
  )
)

$cli = "C:\Users\DC\Desktop\微信WEB开发者工具\cli.bat"
$envId = "cloud1-d9gkefwcp5c777088"
$proj = "c:\Users\DC\Desktop\zhaoren"
$gap  = 5  # 函数之间间隔秒

function Deploy-One($name) {
  Write-Host ">>> 部署 $name ..." -ForegroundColor Cyan
  $cmd = "& `"$cli`" cloud functions deploy --env $envId --names $name --project `"$proj`" --remote-npm-install"
  $out = Invoke-Expression $cmd 2>&1 | Out-String
  $success = $out -match "success\s*\|\s*true" -or $out -match "deploy cloudfunctions" -and $out -match "$name" -and $out -notmatch "false"
  if ($out -match "Updating状态") {
    Write-Host "    被锁了, 等 25s 重试..." -ForegroundColor Yellow
    Start-Sleep -Seconds 25
    $out = Invoke-Expression $cmd 2>&1 | Out-String
  }
  if ($out -match "true") {
    Write-Host "    ✅ $name OK" -ForegroundColor Green
    return $true
  } else {
    Write-Host "    ❌ $name 失败: $($out -split "`n" | Select-Object -Last 3)" -ForegroundColor Red
    return $false
  }
}

Write-Host "=============================" -ForegroundColor Cyan
Write-Host "部署 $($Names.Count) 个云函数" -ForegroundColor Cyan
Write-Host "环境: $envId" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan

$ok = 0; $fail = 0
foreach ($n in $Names) {
  if (Deploy-One $n) { $ok++ } else { $fail++ }
  Start-Sleep -Seconds $gap
}

Write-Host ""
Write-Host "结果: ✅ $ok 成功  ❌ $fail 失败" -ForegroundColor $(if($fail -eq 0){'Green'}else{'Red'})

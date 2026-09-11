# UI 一致性校验测试 · 找人帮忙小程序
# 用法: powershell -ExecutionPolicy Bypass -File tests\ui-consistency.test.ps1
# 无需第三方依赖, 纯 PowerShell
#
# 测试范围(对应三批 UI 优化):
#   1. 全局类定义完整性 (app.wxss 中 skeleton/empty-state/loading-tip 等)
#   2. CSS 变量定义完整 (--transition/--gap-*)
#   3. 按钮交互态覆盖 (btn-primary/btn-ghost/btn-danger 有 :active)
#   4. 页面冗余定义清除 (各页 wxss 不再有本地 .empty/.empty-tip/.loading-tip)
#   5. WXML 不残留旧 class="empty"(无连字符)
#   6. 骨架屏复合类正确 (skeleton + sk-* 搭配)
#   7. shimmer 动画定义存在
#   8. 卡片阴影/圆角提升
#   9. 金额等宽数字 (tabular-nums)
#  10. mine 菜单 icon 圆形底

$ErrorActionPreference = "Stop"
$MINI = Join-Path $PSScriptRoot "..\miniprogram"
$PAGES = Join-Path $MINI "pages"
$passed = 0
$failed = 0
$failures = @()

function Assert-Test {
    param([bool]$Condition, [string]$Name, [string]$Detail = "")
    if ($Condition) {
        $script:passed++
    } else {
        $script:failed++
        $script:failures += [PSCustomObject]@{ Name = $Name; Detail = $Detail }
        Write-Host "  [FAIL] $Name$(if ($Detail) { " -> $Detail" })" -ForegroundColor Red
    }
}

$appWxss = Get-Content (Join-Path $MINI "app.wxss") -Raw

# ─── TEST 1: 全局类定义完整性 ───
Write-Host "`n> TEST 1: Quan ju lei ding yi wan zheng xing (app.wxss)" -ForegroundColor Cyan

$requiredClasses = @(
    'skeleton','sk-line','sk-line-sm','sk-circle','sk-card','sk-row',
    'empty-state','empty-icon','empty-text','empty-sub','empty-btn',
    'loading-tip',
    'btn-primary','btn-ghost','btn-danger',
    'card','tag','mini-btn'
)
foreach ($cls in $requiredClasses) {
    Assert-Test ($appWxss -match "\.$cls\b") "app.wxss defines .$cls" "missing .$cls"
}

# ─── TEST 2: CSS 变量定义完整 ───
Write-Host "`n> TEST 2: CSS variables (app.wxss)" -ForegroundColor Cyan

$requiredVars = @('--transition','--gap-xs','--gap-sm','--gap-md','--gap-lg',
    '--primary','--bg-page','--bg-card','--border','--text-1','--text-2','--text-3')
foreach ($v in $requiredVars) {
    Assert-Test ($appWxss -match [regex]::Escape("$v`:")) "app.wxss defines $v" "missing $v"
}

# ─── TEST 3: 按钮交互态覆盖 (:active) ───
Write-Host "`n> TEST 3: Button :active states (app.wxss)" -ForegroundColor Cyan

$btnClasses = @('btn-primary','btn-ghost','btn-danger','mini-btn')
foreach ($btn in $btnClasses) {
    # Search for .btn-name followed by :active within 300 chars
    $idx = $appWxss.IndexOf(".$btn")
    if ($idx -ge 0) {
        $chunk = $appWxss.Substring($idx, [Math]::Min(300, $appWxss.Length - $idx))
        Assert-Test ($chunk -match ':active') ".$btn has :active" ".$btn missing :active"
    } else {
        Assert-Test $false ".$btn has :active" ".$btn not found"
    }
}

# ─── TEST 4: 页面冗余定义清除 ───
Write-Host "`n> TEST 4: Page redundant styles removed" -ForegroundColor Cyan

$wxssFiles = Get-ChildItem -Path $PAGES -Filter "*.wxss" -Recurse
foreach ($f in $wxssFiles) {
    $content = Get-Content $f.FullName -Raw
    $pageName = $f.BaseName

    # .empty-tip should not be locally defined
    Assert-Test (-not ($content -match '(?m)^\.empty-tip\s*[,{:]')) "$pageName.wxss no local .empty-tip" "still defines .empty-tip"

    # .loading-tip should not be locally defined (except chat-detail which uses it for a static message)
    if ($pageName -ne 'chat-detail') {
        Assert-Test (-not ($content -match '(?m)^\.loading-tip\s*[,{:]')) "$pageName.wxss no local .loading-tip" "still defines .loading-tip"
    }

    # .empty (without hyphen) should not be a standalone selector
    Assert-Test (-not ($content -match '\.empty(?![\w-])\s*[,{:]')) "$pageName.wxss no standalone .empty" "still defines .empty"
}

# ─── TEST 5: WXML 不残留旧 class="empty" ───
Write-Host "`n> TEST 5: WXML no stale class=`"empty`"" -ForegroundColor Cyan

$wxmlFiles = Get-ChildItem -Path $PAGES -Filter "*.wxml" -Recurse
foreach ($f in $wxmlFiles) {
    $content = Get-Content $f.FullName -Raw
    $pageName = $f.BaseName
    Assert-Test (-not ($content -match 'class="empty"')) "$pageName.wxml no class=""empty""" "still uses class=""empty"""
}

# ─── TEST 6: 骨架屏复合类正确 ───
Write-Host "`n> TEST 6: Skeleton compound classes (skeleton + sk-*)" -ForegroundColor Cyan

foreach ($f in $wxmlFiles) {
    $lines = Get-Content $f.FullName
    $pageName = $f.BaseName
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        # class with skeleton should also have sk-* (or be standalone "skeleton")
        if ($line -match 'class="([^"]*skeleton[^"]*)"') {
            $clsStr = $Matches[1]
            Assert-Test ($clsStr -match 'sk-' -or $clsStr -eq 'skeleton') "${pageName} L$($i+1): skeleton+sk-*" "skeleton without sk-* shape"
        }
        # sk-* shape classes (line/circle/card) should have skeleton; sk-row is a layout container, exempt
        if ($line -match 'class="([^"]*sk-(line|circle|card)[^"]*)"') {
            $clsStr = $Matches[1]
            Assert-Test ($clsStr -match 'skeleton') "${pageName} L$($i+1): sk-*+skeleton" "sk-* without skeleton base"
        }
    }
}

# ─── TEST 7: shimmer 动画定义 ───
Write-Host "`n> TEST 7: Shimmer animation defined" -ForegroundColor Cyan

Assert-Test ($appWxss -match 'skeleton-shimmer') "app.wxss defines @keyframes skeleton-shimmer" "missing animation"
Assert-Test ($appWxss -match 'animation:\s*skeleton-shimmer') ".skeleton uses shimmer animation" "skeleton class missing animation ref"

# ─── TEST 8: 卡片阴影/圆角提升 ───
Write-Host "`n> TEST 8: Card shadow & radius upgrade" -ForegroundColor Cyan

Assert-Test ($appWxss -match '0\s+4rpx\s+24rpx\s+rgba\(0,0,0,0\.06\)') ".card shadow upgraded" "missing shadow value"
Assert-Test ($appWxss -match 'border-radius:\s*20rpx') ".card radius 20rpx" "missing 20rpx radius"

# ─── TEST 9: 金额等宽数字 ───
Write-Host "`n> TEST 9: tabular-nums for amounts" -ForegroundColor Cyan

$orderDetailWxss = Join-Path $PAGES "order-detail\order-detail.wxss"
$cashierWxss = Join-Path $PAGES "cashier\cashier.wxss"
if (Test-Path $orderDetailWxss) {
    $od = Get-Content $orderDetailWxss -Raw
    Assert-Test ($od -match 'tabular-nums') "order-detail.wxss has tabular-nums" "missing tabular-nums"
}
if (Test-Path $cashierWxss) {
    $cs = Get-Content $cashierWxss -Raw
    Assert-Test ($cs -match 'tabular-nums') "cashier.wxss has tabular-nums" "missing tabular-nums"
}

# ─── TEST 10: mine 菜单 icon 圆形底 ───
Write-Host "`n> TEST 10: mine menu icon circular background" -ForegroundColor Cyan

$mineWxss = Join-Path $PAGES "mine\mine.wxss"
if (Test-Path $mineWxss) {
    $mn = Get-Content $mineWxss -Raw
    $hasMenuIcon = $mn -match '\.menu-icon'
    $hasRadius = $mn -match 'border-radius:\s*50%'
    $hasBg = $mn -match 'background:'
    Assert-Test ($hasMenuIcon -and $hasRadius -and $hasBg) "mine.wxss .menu-icon circular bg" "missing circular background"
}

# ─── 汇总 ───
Write-Host "`n$('=' * 50)" -ForegroundColor Yellow
Write-Host "  Result: $passed passed / $failed failed / $($passed + $failed) total" -ForegroundColor $(if ($failed -eq 0) { 'Green' } else { 'Red' })
if ($failed -gt 0) {
    Write-Host "`n  Failures:" -ForegroundColor Red
    foreach ($f in $failures) {
        Write-Host "    [FAIL] $($f.Name)$(if ($f.Detail) { " -> $($f.Detail)" })" -ForegroundColor Red
    }
    exit 1
} else {
    Write-Host "  All passed [OK]" -ForegroundColor Green
    exit 0
}

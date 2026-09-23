# ============================================================
# zhaoren - Batch cloud function deploy (thin wrapper)
#
# Delegates EVERY deploy to .trae/predeploy.ps1 so there is ONE gate:
#   syntax check ALL functions -> whitelist gate -> commit gate -> CLI deploy
# (--remote-npm-install is always passed by the gate script.)
#
# NOTE: this file is intentionally ASCII-only. The previous version contained
# Chinese text saved as UTF-8 without BOM, which PowerShell 5.1 reads as ANSI
# and turns into mojibake -> ParseError -> the script could not run at all.
#
# Usage:
#   .\deploy-cloud.ps1                                  # deploy ALL whitelisted functions
#   .\deploy-cloud.ps1 -Names partner-action,order-action
#
# Exit codes: 0 = all ok / 1 = one or more failed (per-function codes come from predeploy.ps1)
# ============================================================
param(
    [string[]]$Names = @(),
    [int]$GapSeconds = 5
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$gate = Join-Path $root ".trae\predeploy.ps1"
$wlPath = Join-Path $root ".trae\cloudfunctions.whitelist"

$psExe = Join-Path $PSHOME "powershell.exe"
if (-not (Test-Path $psExe)) { $psExe = "powershell.exe" }

if (-not (Test-Path $gate)) {
    Write-Host "[FATAL] gate script not found: $gate" -ForegroundColor Red
    exit 1
}

if ($Names.Count -eq 0) {
    if (-not (Test-Path $wlPath)) {
        Write-Host "[FATAL] whitelist not found: $wlPath (pass -Names explicitly to override)" -ForegroundColor Red
        exit 1
    }
    $Names = @(Get-Content $wlPath -Encoding UTF8 |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and ($_ -notlike '#*') })
    Write-Host "[info] no -Names given; deploying all $($Names.Count) whitelisted functions" -ForegroundColor Gray
}

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " batch deploy: $($Names.Count) function(s)" -ForegroundColor Cyan
Write-Host " gate: $gate" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

$ok = 0
$failed = @()
foreach ($n in $Names) {
    Write-Host ""
    Write-Host ">>> $n" -ForegroundColor Cyan
    & $psExe -ExecutionPolicy Bypass -File $gate -Deploy $n
    $code = $LASTEXITCODE
    if ($code -eq 0) {
        $ok++
        Write-Host "    [OK] $n" -ForegroundColor Green
    } else {
        $failed += "$n (exit $code)"
        Write-Host "    [FAIL] $n (exit $code)" -ForegroundColor Red
    }
    if ($GapSeconds -gt 0) { Start-Sleep -Seconds $GapSeconds }
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
if ($failed.Count -eq 0) {
    Write-Host " RESULT: all $ok succeeded" -ForegroundColor Green
} else {
    Write-Host " RESULT: $ok ok / $($failed.Count) failed" -ForegroundColor Red
    $failed | ForEach-Object { Write-Host "   - $_" -ForegroundColor Yellow }
}
Write-Host " exit-code legend: 1 syntax / 3 bad name / 4 deploy / 5 cli / 6 uncommitted / 7 audit / 8 no git" -ForegroundColor Gray
Write-Host "==================================================" -ForegroundColor Cyan

if ($failed.Count -gt 0) { exit 1 }
exit 0
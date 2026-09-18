# ============================================================
# zhaoren - Pre-deploy Syntax Gate
# Runs `node --check` on EVERY cloud function before any deploy.
# Bad syntax (e.g. duplicate const -> SyntaxError) blocks deploy.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .trae\predeploy.ps1
#       -> check all cloud functions only
#   powershell -ExecutionPolicy Bypass -File .trae\predeploy.ps1 -Deploy demand-publish
#       -> check all, then deploy the named function if ALL pass
#
# Exit codes: 0 = ok / 1 = syntax failed / 2 = node not found
#             3 = function name invalid / 4 = deploy failed / 5 = cli not found
# ============================================================
param(
    [string]$Deploy = "",
    [string]$EnvId = "cloud1-d9gkefwcp5c777088"
)

# Continue (not Stop): native commands like node.exe emit parse errors on stderr;
# with "Stop" PowerShell 5.1 turns that redirection into a terminating RemoteException
# and swallows our own [FAIL] reporting. We gate on $LASTEXITCODE explicitly.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$fnDir = Join-Path $root "cloudfunctions"

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " zhaoren pre-deploy gate  ($(Get-Date -Format 'HH:mm:ss'))" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# ── 1. Locate node.exe (may exist but be missing from PATH) ──
$nodeExe = $null
$cmd = Get-Command node.exe -ErrorAction SilentlyContinue
if ($cmd) { $nodeExe = $cmd.Source }
if (-not $nodeExe) {
    $candidates = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
    )
    foreach ($c in $candidates) { if (Test-Path $c) { $nodeExe = $c; break } }
}
if (-not $nodeExe) {
    Write-Host "[FATAL] node.exe not found (PATH + common install dirs)." -ForegroundColor Red
    Write-Host "        Install Node.js LTS: https://nodejs.org/" -ForegroundColor Yellow
    exit 2
}
Write-Host "[1/4] node: $nodeExe" -ForegroundColor Gray
& $nodeExe --version | ForEach-Object { Write-Host "      $_" }

# ── 2. Syntax check every cloud function ──
Write-Host "[2/4] node --check cloudfunctions/*/index.js" -ForegroundColor Gray
$functions = Get-ChildItem $fnDir -Directory | Sort-Object Name
$failed = @()
$checked = 0
foreach ($f in $functions) {
    $entry = Join-Path $f.FullName "index.js"
    if (-not (Test-Path $entry)) { continue }
    $checked++
    # via cmd /c so stderr comes back as plain strings (no PS ErrorRecord wrappers)
    $out = & cmd /c "`"$nodeExe`" --check `"$entry`" 2>&1"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "      [OK]   $($f.Name)" -ForegroundColor Green
    } else {
        Write-Host "      [FAIL] $($f.Name)" -ForegroundColor Red
        $out | Where-Object { $_ -and $_.Trim() } | Select-Object -First 4 |
            ForEach-Object { Write-Host "             $($_.Trim())" -ForegroundColor Yellow }
        $failed += $f.Name
    }
}

# ── 3. Convention checks (warnings, do not block) ──
Write-Host "[3/4] convention checks" -ForegroundColor Gray
$warnings = 0
foreach ($f in $functions) {
    $oid = Join-Path $f.FullName "openid.js"
    $entry = Join-Path $f.FullName "index.js"
    if ((Test-Path $entry) -and -not (Test-Path $oid)) {
        Write-Host "      [WARN] $($f.Name): openid.js missing (rules: copy openid.js into every function dir)" -ForegroundColor Yellow
        $warnings++
    }
}
Push-Location $root
$dirty = git status --porcelain 2>$null
Pop-Location
if ($dirty) {
    Write-Host "      [WARN] uncommitted changes in working tree - commit before/after deploy" -ForegroundColor Yellow
    $warnings++
}
if ($warnings -eq 0) { Write-Host "      no warnings" -ForegroundColor Green }

# ── 4. Gate result ──
Write-Host "[4/4] result" -ForegroundColor Gray
if ($failed.Count -gt 0) {
    Write-Host ""
    Write-Host "##################################################" -ForegroundColor Red
    Write-Host " SYNTAX CHECK FAILED ($($failed.Count)/$checked): $($failed -join ', ')" -ForegroundColor Red
    Write-Host " DEPLOY BLOCKED. Fix the errors above first." -ForegroundColor Red
    Write-Host "##################################################" -ForegroundColor Red
    exit 1
}
Write-Host "      all $checked cloud functions passed syntax check" -ForegroundColor Green

# ── Optional deploy (single function; CLI does not accept comma lists) ──
if ($Deploy) {
    Write-Host ""
    Write-Host "Deploy target: $Deploy" -ForegroundColor Cyan
    $target = Join-Path $fnDir $Deploy
    if (-not (Test-Path (Join-Path $target "index.js"))) {
        Write-Host "[FATAL] cloud function '$Deploy' not found under cloudfunctions\" -ForegroundColor Red
        $deployable = $functions | Where-Object { Test-Path (Join-Path $_.FullName "index.js") }
        Write-Host "        Valid names: $(($deployable.Name) -join ', ')" -ForegroundColor Yellow
        exit 3
    }
    $cli = $null
    # NOTE: search by wildcard instead of typing the Chinese folder name,
    # so this script works regardless of file encoding / PS 5.1 codepage.
    $searchRoots = @(
        "${env:ProgramFiles(x86)}\Tencent",
        "$env:ProgramFiles\Tencent",
        "$env:LOCALAPPDATA\Programs",
        "$env:USERPROFILE\Desktop"
    ) | Where-Object { Test-Path $_ }
    foreach ($sr in $searchRoots) {
        $hit = Get-ChildItem $sr -Filter "cli.bat" -Recurse -Depth 3 -ErrorAction SilentlyContinue |
            Where-Object { Test-Path (Join-Path $_.DirectoryName "cli.js") } |
            Select-Object -First 1
        if ($hit) { $cli = $hit.FullName; break }
    }
    if (-not $cli) {
        Write-Host "[FATAL] WeChat DevTools cli.bat not found." -ForegroundColor Red
        exit 5
    }
    Write-Host "cli: $cli" -ForegroundColor Gray
    Write-Host "env: $EnvId" -ForegroundColor Gray
    & $cli cloud functions deploy --env $EnvId --names $Deploy --project $root --remote-npm-install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FATAL] deploy of '$Deploy' failed" -ForegroundColor Red
        exit 4
    }
    Write-Host ""
    Write-Host "[DEPLOYED] $Deploy -> $EnvId (all syntax checks passed beforehand)" -ForegroundColor Green
}
Write-Host ""

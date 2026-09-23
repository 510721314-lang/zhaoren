# ============================================================
# zhaoren - Pre-deploy Syntax Gate
# Runs `node --check` on EVERY cloud function before any deploy.
# Bad syntax (e.g. duplicate const -> SyntaxError) blocks deploy.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .trae\predeploy.ps1
#       -> check all cloud functions only
#   powershell -ExecutionPolicy Bypass -File .trae\predeploy.ps1 -Audit
#       -> same + whitelist drift / unregistered temp function / dead-code flip audit
#          (audit findings are BLOCKING in this mode)
#   powershell -ExecutionPolicy Bypass -File .trae\predeploy.ps1 -Deploy demand-publish
#       -> check all, then deploy the named function if ALL pass
#
# Exit codes: 0 = ok / 1 = syntax failed / 2 = node not found
#             3 = function name invalid / 4 = deploy failed / 5 = cli not found
#             6 = uncommitted changes in target function (commit before deploy)
#             7 = audit failed (whitelist drift / unregistered fn / dead-code flip)
#             8 = git not found (commit gate cannot be verified - fail closed)
# ============================================================
param(
    [string]$Deploy = "",
    [string]$EnvId = "cloud1-d9gkefwcp5c777088",
    [switch]$Audit
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
Write-Host "[1/5] node: $nodeExe" -ForegroundColor Gray
& $nodeExe --version | ForEach-Object { Write-Host "      $_" }

# ── 1b. Locate git.exe (PATH does not always expose it; the commit gate must not fail open) ──
$gitExe = $null
$gcmd = Get-Command git.exe -ErrorAction SilentlyContinue
if ($gcmd) { $gitExe = $gcmd.Source }
if (-not $gitExe) {
    $gitCandidates = @(
        "$env:ProgramFiles\Git\cmd\git.exe",
        "${env:ProgramFiles(x86)}\Git\cmd\git.exe",
        "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe"
    )
    foreach ($gc in $gitCandidates) { if (Test-Path $gc) { $gitExe = $gc; break } }
}
if ($gitExe) {
    Write-Host "      git: $gitExe" -ForegroundColor Gray
} else {
    Write-Host "      git: NOT FOUND (commit gate cannot verify)" -ForegroundColor Yellow
}

# ── 2. Syntax check every cloud function ──
Write-Host "[2/5] node --check cloudfunctions/*/index.js" -ForegroundColor Gray
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
Write-Host "[3/5] convention checks" -ForegroundColor Gray
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
$dirty = if ($gitExe) { & $gitExe status --porcelain 2>$null } else { $null }
Pop-Location
if ($dirty) {
    Write-Host "      [WARN] uncommitted changes in working tree - commit before/after deploy" -ForegroundColor Yellow
    $warnings++
}
if ($warnings -eq 0) { Write-Host "      no warnings" -ForegroundColor Green }

# ── 4. Audit: whitelist drift / temp functions / dead-code flips ──
# Findings are warnings here, but BLOCKING when -Audit is passed (exit 7),
# and a non-whitelisted -Deploy target is always refused.
Write-Host "[4/5] audit (whitelist drift / temp functions / dead-code flip)" -ForegroundColor Gray
$auditIssues = @()
$whitelistPath = Join-Path $root ".trae\cloudfunctions.whitelist"
$wl = @()
if (Test-Path $whitelistPath) {
    $wl = @(Get-Content $whitelistPath -Encoding UTF8 |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and ($_ -notlike '#*') })
} else {
    $auditIssues += "whitelist file missing: .trae/cloudfunctions.whitelist"
}
$deployable = @($functions |
    Where-Object { Test-Path (Join-Path $_.FullName "index.js") } |
    ForEach-Object { $_.Name })
if ($wl.Count -gt 0) {
    $unlisted = @($deployable | Where-Object { $wl -notcontains $_ })
    $missingDir = @($wl | Where-Object { $deployable -notcontains $_ })
    if ($unlisted.Count -gt 0) {
        $auditIssues += "unregistered function dir (has index.js, absent from whitelist): $($unlisted -join ', ')"
    }
    if ($missingDir.Count -gt 0) {
        $auditIssues += "whitelisted but no local dir: $($missingDir -join ', ')"
    }
}

# zz- prefixed temp functions must be registered in .trae/zz-registry.md
$zzDirs = @($deployable | Where-Object { $_ -like 'zz-*' })
if ($zzDirs.Count -gt 0) {
    $zzReg = Join-Path $root ".trae\zz-registry.md"
    $zzRegText = ""
    if (Test-Path $zzReg) { $zzRegText = Get-Content $zzReg -Raw -Encoding UTF8 }
    foreach ($z in $zzDirs) {
        if ($zzRegText -notmatch [regex]::Escape($z)) {
            $auditIssues += "temp function '$z' not registered in .trae/zz-registry.md"
        }
    }
}

# dead-code flip scan (rule: if(false && ...) style temporary flips must not ship)
$flipPattern = 'if\s*\(\s*(false|0)\s*&&'
$flips = @()
foreach ($f in $deployable) {
    $entry = Join-Path $fnDir (Join-Path $f "index.js")
    $hit = Select-String -Path $entry -Pattern $flipPattern -ErrorAction SilentlyContinue
    if ($hit) { $flips += "$f(L$($hit[0].LineNumber))" }
}
if ($flips.Count -gt 0) {
    $auditIssues += "dead-code flip detected: $($flips -join ', ')"
}

if ($auditIssues.Count -eq 0) {
    Write-Host "      clean ($($deployable.Count) deployable, whitelist $($wl.Count))" -ForegroundColor Green
} else {
    $auditColor = if ($Audit) { "Red" } else { "Yellow" }
    foreach ($ai in $auditIssues) {
        Write-Host "      [AUDIT] $ai" -ForegroundColor $auditColor
    }
    Write-Host "      ($($auditIssues.Count) finding(s); blocking only with -Audit)" -ForegroundColor Gray
}

# ── 5. Gate result ──
Write-Host "[5/5] result" -ForegroundColor Gray
if ($failed.Count -gt 0) {
    Write-Host ""
    Write-Host "##################################################" -ForegroundColor Red
    Write-Host " SYNTAX CHECK FAILED ($($failed.Count)/$checked): $($failed -join ', ')" -ForegroundColor Red
    Write-Host " DEPLOY BLOCKED. Fix the errors above first." -ForegroundColor Red
    Write-Host "##################################################" -ForegroundColor Red
    exit 1
}
if ($Audit -and $auditIssues.Count -gt 0) {
    Write-Host ""
    Write-Host "##################################################" -ForegroundColor Red
    Write-Host " AUDIT FAILED ($($auditIssues.Count) finding(s))" -ForegroundColor Red
    Write-Host " Fix the findings above (or update .trae/cloudfunctions.whitelist)." -ForegroundColor Red
    Write-Host "##################################################" -ForegroundColor Red
    exit 7
}
Write-Host "      all $checked cloud functions passed syntax check" -ForegroundColor Green

# ── Optional deploy (single function; CLI does not accept comma lists) ──
if ($Deploy) {
    Write-Host ""
    Write-Host "Deploy target: $Deploy" -ForegroundColor Cyan
    $target = Join-Path $fnDir $Deploy
    if (-not (Test-Path (Join-Path $target "index.js"))) {
        Write-Host "[FATAL] cloud function '$Deploy' not found under cloudfunctions\" -ForegroundColor Red
        Write-Host "        Valid names: $($deployable -join ', ')" -ForegroundColor Yellow
        exit 3
    }

    # ── Whitelist gate: never deploy an unregistered / temp function ──
    if ($wl.Count -gt 0 -and ($wl -notcontains $Deploy)) {
        Write-Host ""
        Write-Host "##################################################" -ForegroundColor Red
        Write-Host " '$Deploy' IS NOT IN .trae/cloudfunctions.whitelist" -ForegroundColor Red
        Write-Host " DEPLOY REFUSED (unregistered or temporary function)." -ForegroundColor Red
        Write-Host " Register it in .trae/cloudfunctions.whitelist first." -ForegroundColor Red
        Write-Host "##################################################" -ForegroundColor Red
        exit 7
    }

    # ── Commit-before-deploy gate: the target function MUST be fully committed ──
    # Rule (per user workflow): never deploy uncommitted code, so the running cloud
    # function always maps to a recoverable git commit. Unpushed commits are allowed
    # (network may be down); only UNCOMMITTED working-tree changes block deploy.
    if (-not $gitExe) {
        Write-Host ""
        Write-Host "##################################################" -ForegroundColor Red
        Write-Host " git.exe NOT FOUND - cannot verify cloudfunctions/$Deploy is committed." -ForegroundColor Red
        Write-Host " DEPLOY BLOCKED (fail-closed: commit gate cannot be skipped)." -ForegroundColor Red
        Write-Host "##################################################" -ForegroundColor Red
        exit 8
    }
    Push-Location $root
    $fnChanges = @(& $gitExe status --porcelain -- "cloudfunctions/$Deploy" 2>$null)
    Pop-Location
    if ($fnChanges.Count -gt 0) {
        Write-Host ""
        Write-Host "##################################################" -ForegroundColor Red
        Write-Host " UNCOMMITTED CHANGES in cloudfunctions/$Deploy" -ForegroundColor Red
        $fnChanges | ForEach-Object { Write-Host "   $_" -ForegroundColor Yellow }
        Write-Host " DEPLOY BLOCKED. Commit first (rule: commit before deploy), e.g.:" -ForegroundColor Red
        Write-Host "   git add cloudfunctions/$Deploy ; git commit -m `"fix($Deploy): ...`"" -ForegroundColor Gray
        Write-Host "##################################################" -ForegroundColor Red
        exit 6
    }
    Write-Host "commit gate: cloudfunctions/$Deploy clean (all changes committed)" -ForegroundColor Green

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

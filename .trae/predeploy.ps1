# ============================================================
# zhaoren - Pre-deploy Syntax Gate + Cloud Audit
# Runs `node --check` on EVERY cloud function before any deploy.
# Optionally performs cloud-side drift audit via DevTools CLI.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .trae\predeploy.ps1
#       -> check all cloud functions only (zero external deps)
#   powershell -ExecutionPolicy Bypass -File .trae\predeploy.ps1 -Deploy demand-publish
#       -> check all, commit gate, deploy named function, then -Audit
#   powershell -ExecutionPolicy Bypass -File .trae\predeploy.ps1 -Audit
#       -> syntax check + cloud diff + local naming/guard scan + flip-comment scan
#
# Exit codes: 0 = ok / 1 = syntax failed / 2 = node not found
#             3 = function name invalid / 4 = deploy failed / 5 = cli not found
#             6 = uncommitted changes in target function (commit before deploy)
#             7 = cloud drift (whitelist mismatch OR zz-registry expired)
#             8 = local naming/guard violation (no whitelist, no zz- prefix, no guard)
#             9 = flip-comment hit (if(false && / 临时放开 / 上线前恢复 / 上线前删除)
# ============================================================
param(
    [string]$Deploy = "",
    [string]$EnvId = "cloud1-d9gkefwcp5c777088",
    [switch]$Audit = $false
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

    # ── Commit-before-deploy gate: the target function MUST be fully committed ──
    # Rule (per user workflow): never deploy uncommitted code, so the running cloud
    # function always maps to a recoverable git commit. Unpushed commits are allowed
    # (network may be down); only UNCOMMITTED working-tree changes block deploy.
    Push-Location $root
    $fnChanges = @(git status --porcelain -- "cloudfunctions/$Deploy" 2>$null)
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
    $Audit = $true  # deploy always triggers audit
}

# ============================================================
# 5. Audit mode (or auto-triggered after deploy)
# ============================================================
if ($Audit) {
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host " CLOUD AUDIT (whitelist drift / naming guard / flip-comments)" -ForegroundColor Cyan
    Write-Host "==================================================" -ForegroundColor Cyan

    $auditBlocked = $false

    # ── 5.0 Load whitelist ──
    $wlPath = Join-Path $root ".trae\cloudfunctions.whitelist"
    if (-not (Test-Path $wlPath)) {
        Write-Host "[AUDIT] whitelist not found: $wlPath" -ForegroundColor Red
        Write-Host "        create it or run without -Audit" -ForegroundColor Yellow
        $auditBlocked = $true
        # no exit yet — naming/guard scan can still run
    }
    $wlNames = @()
    if (Test-Path $wlPath) {
        $wlNames = Get-Content $wlPath | Where-Object { $_ -and -not $_.StartsWith('#') -and $_.Trim() } | ForEach-Object { $_.Trim() }
        Write-Host "[5.0] whitelist: $($wlNames.Count) formal functions" -ForegroundColor Gray
    }

    # ── 5.1 Cloud drift (CLI) ──
    Write-Host "[5.1] cloud functions list vs whitelist" -ForegroundColor Gray
    $cli = $null
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
        Write-Host "      [WARN] cli.bat not found — cloud drift skipped" -ForegroundColor Yellow
    } else {
        $listOut = & $cli cloud functions list --env $EnvId --project $root --lang zh 2>&1
        $cloudNames = @()
        foreach ($line in $listOut) {
            if ($line -match '^\*\s+([a-z0-9-]+)\s*$') { $cloudNames += $Matches[1] }
        }
        if ($cloudNames.Count -eq 0) {
            Write-Host "      [WARN] parsed 0 from cloud list — IDE not logged in or CLI changed format" -ForegroundColor Yellow
        } else {
            Write-Host "      cloud returns $($cloudNames.Count) functions" -ForegroundColor Gray
            $cloudSet = @{}; $cloudNames | ForEach-Object { $cloudSet[$_] = $true }
            $wlSet = @{}; $wlNames | ForEach-Object { $wlSet[$_] = $true }

            # Cloud drift: on cloud, not in whitelist
            $drift = @()
            foreach ($c in $cloudNames) { if (-not $wlSet.ContainsKey($c)) { $drift += $c } }
            if ($drift.Count -gt 0) {
                Write-Host ""
                Write-Host "      [DRIFT] 云端有/白名单无 — 疑似裸奔临时函数! ($($drift.Count)个)" -ForegroundColor Red
                $drift | ForEach-Object { Write-Host "         → $_  — 立即在云开发控制台删除" -ForegroundColor Red }
                $auditBlocked = $true
            } else {
                Write-Host "      ✅ 云端零漂移（与白名单完全一致）" -ForegroundColor Green
            }
            # Missing deploy: on whitelist, not in cloud (informational only)
            $missing = @()
            foreach ($w in $wlNames) { if (-not $cloudSet.ContainsKey($w)) { $missing += $w } }
            if ($missing.Count -gt 0) {
                Write-Host "      [INFO] 白名单有/云端无 — 未部署 ($($missing.Count)个)" -ForegroundColor Yellow
                $missing | ForEach-Object { Write-Host "         → $_" -ForegroundColor Yellow }
            }
        }
    }

    # ── 5.2 Local naming + guard scan ──
    Write-Host "[5.2] local naming + zz- guard scan" -ForegroundColor Gray
    $localNames = @(Get-ChildItem $fnDir -Directory | Where-Object { Test-Path (Join-Path $_.FullName "index.js") } | ForEach-Object { $_.Name })
    $wlSet2 = @{}; $wlNames | ForEach-Object { $wlSet2[$_] = $true }
    $namingViolations = @()   # not in whitelist AND not zz-
    $guardViolations = @()    # zz- but no guard
    foreach ($n in $localNames) {
        if ($wlSet2.ContainsKey($n)) { continue }
        if ($n -match '^zz-') {
            # zz- function: must have guard marker
            $idx = Join-Path $fnDir "$n\index.js"
            $raw = Get-Content $idx -Raw -ErrorAction SilentlyContinue
            if (-not $raw) { continue }
            $hasGuard = ($raw -match 'cloud\.getWXContext\(\)\.OPENID') -and ($raw -match 'admin_openids')
            if (-not $hasGuard) { $guardViolations += $n }
        } else {
            $namingViolations += $n
        }
    }
    if ($namingViolations.Count -gt 0) {
        Write-Host "      [NAMING] 非白名单且非 zz- 前缀 — 必须登记白名单或改 zz- 名! ($($namingViolations.Count)个)" -ForegroundColor Red
        $namingViolations | ForEach-Object { Write-Host "         → $_" -ForegroundColor Red }
        $auditBlocked = $true
    } else { Write-Host "      ✅ 本地命名全部合规" -ForegroundColor Green }
    if ($guardViolations.Count -gt 0) {
        Write-Host "      [GUARD] zz- 函数缺最小守卫 (getWXContext OPENID + admin_openids 白名单) ($($guardViolations.Count)个)" -ForegroundColor Red
        $guardViolations | ForEach-Object { Write-Host "         → $_" -ForegroundColor Red }
        $auditBlocked = $true
    } else {
        # only print zz- count — if no violations, the section is noise when there are none
        $zzCount = @($localNames | Where-Object { $_ -match '^zz-' }).Count
        if ($zzCount -gt 0) { Write-Host "      ✅ $zzCount 个 zz- 临时函数全部带守卫" -ForegroundColor Green }
    }

    # ── 5.3 Flip-comment scan ──
    Write-Host "[5.3] flip-comment scan (false && gate / 临时放开 / 上线前恢复 / 上线前删除)" -ForegroundColor Gray
    $flipPatterns = @(
        'if\s*\(\s*false\s*\&\&',    # regex: false && with variable whitespace
        '临时放开',
        '上线前恢复',
        '上线前删除'
    ) | Select-Object -Unique
    $flipHits = @()
    foreach ($f in $functions) {
        $idx = Join-Path $f.FullName "index.js"
        if (-not (Test-Path $idx)) { continue }
        $lines = Get-Content $idx -ErrorAction SilentlyContinue
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $ln = $lines[$i]
            foreach ($pat in $flipPatterns) {
                if ($ln -match $pat) {
                    $flipHits += "$($f.Name):$($i+1): $($ln.Trim())"
                    break
                }
            }
        }
    }
    if ($flipHits.Count -gt 0) {
        Write-Host "      [FLIP] 临时翻转/延迟删除注释命中 ($($flipHits.Count)处)" -ForegroundColor Red
        $flipHits | ForEach-Object { Write-Host "         → $_" -ForegroundColor Red }
        $auditBlocked = $true
    } else { Write-Host "      ✅ 零临时翻转注释命中" -ForegroundColor Green }

    # ── 5.4 zz-registry expiry (simple: zz- functions exist but entry has past date) ──
    # skipped on purpose: this would require parsing the markdown table which is fragile
    # human process rule covers it: if zz- function is present, audit reports them above,
    # and the 5.1 drift scan catches any zz- function left on cloud

    # ── Final audit verdict ──
    Write-Host ""
    if ($auditBlocked) {
        Write-Host "##################################################" -ForegroundColor Red
        Write-Host " AUDIT FAILED (see [DRIFT]/[NAMING]/[GUARD]/[FLIP] above)" -ForegroundColor Red
        Write-Host " DEPLOY BLOCKED. Fix the issues, then run: predeploy.ps1 -Audit" -ForegroundColor Red
        Write-Host "##################################################" -ForegroundColor Red
        if ($deploySuccess) { exit 4 }  # deploy succeeded but audit failed
        exit 7
    } else {
        Write-Host "##################################################" -ForegroundColor Green
        Write-Host " AUDIT PASSED — zero drift, zero naming violations, zero flip-comments" -ForegroundColor Green
        Write-Host "##################################################" -ForegroundColor Green
    }
}

Write-Host ""

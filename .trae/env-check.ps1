# ============================================================
# zhaoren 找人帮忙 - 新电脑环境一键检查 + 自动修复脚本
# 用法: PowerShell 中运行 pwsh -File .trae\env-check.ps1
# ============================================================
$ErrorActionPreference = "Continue"
$script:passed = 0
$script:warned = 0
$script:failed = 0
$script:fixes = @()

function Check {
    param([string]$name, [bool]$ok, [string]$detail, [string]$fixAction = "")
    if ($ok) {
        Write-Host "  [OK] $name" -ForegroundColor Green
        Write-Host "       $detail" -ForegroundColor Gray
        $script:passed++
    } else {
        Write-Host "  [FAIL] $name" -ForegroundColor Red
        Write-Host "         $detail" -ForegroundColor Yellow
        if ($fixAction) {
            Write-Host "         Auto-fix: $fixAction" -ForegroundColor Cyan
            $script:fixes += $fixAction
        } else {
            $script:failed++
        }
    }
}

function Warn {
    param([string]$name, [string]$detail, [string]$manualAction)
    Write-Host "  [WARN] $name" -ForegroundColor Yellow
    Write-Host "         $detail" -ForegroundColor Gray
    Write-Host "         Need manual: $manualAction" -ForegroundColor Cyan
    $script:warned++
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " zhaoren - Environment Check v1.0" -ForegroundColor Cyan
Write-Host " Repo: https://github.com/510721314-lang/zhaoren" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# 1. PowerShell
Write-Host "[1/10] PowerShell" -ForegroundColor White
$psVer = $PSVersionTable.PSVersion
Check "PowerShell 5.1+" ($psVer.Major -ge 5) "Current: $psVer"

# 2. OS
Write-Host "[2/10] OS" -ForegroundColor White
$os = [Environment]::OSVersion
Check "Windows 10+ 64-bit" ($os.Version.Major -ge 10) "Current: $($os.VersionString)"

# 3. Git
Write-Host "[3/10] Git" -ForegroundColor White
$gitOk = $false
try {
    $gv = git --version 2>&1
    $gitOk = $LASTEXITCODE -eq 0
    Check "Git installed" $gitOk "Version: $gv"
} catch {
    Check "Git installed" $false "Not found. Install from https://git-scm.com/download/win"
}
if ($gitOk) {
    $un = git config --global user.name 2>$null
    if ([string]::IsNullOrWhiteSpace($un)) {
        git config --global user.name "NIC"
        $script:fixes += "git user.name -> NIC"
    } else {
        Check "git user.name" $true "= $un"
    }
    $em = git config --global user.email 2>$null
    if ([string]::IsNullOrWhiteSpace($em)) {
        git config --global user.email "510721314@qq.com"
        $script:fixes += "git user.email -> 510721314@qq.com"
    } else {
        Check "git user.email" $true "= $em"
    }
    $ch = git config --global credential.helper 2>$null
    if ([string]::IsNullOrWhiteSpace($ch)) {
        git config --global credential.helper "manager"
        $script:fixes += "git credential.helper -> manager"
    }
    $cl = git config --global core.autocrlf 2>$null
    if ([string]::IsNullOrWhiteSpace($cl)) {
        git config --global core.autocrlf "true"
        $script:fixes += "git core.autocrlf -> true"
    }
}

# 4. Node.js
Write-Host "[4/10] Node.js" -ForegroundColor White
$nodeOk = $false
try {
    $nv = node --version 2>&1
    $nm = npm --version 2>&1
    $major = [int]($nv.Trim('v').Split('.')[0])
    $nodeOk = $true
    Check "Node.js 18+" ($major -ge 18) "Node $nv / npm $nm"
} catch {
    $paths = @("$env:ProgramFiles\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")
    foreach ($p in $paths) {
        if (Test-Path $p) {
            Warn "Node.js PATH" "Found at $p but not in PATH" "Add $(Split-Path $p) to system PATH env var"
            $nodeOk = $true
            break
        }
    }
    if (-not $nodeOk) {
        Check "Node.js 18+" $false "Not found. Install from https://nodejs.org/ (LTS recommended)"
    }
}

# 5. WeChat DevTools CLI
Write-Host "[5/10] WeChat DevTools CLI" -ForegroundColor White
$cliOk = $false
$cliPaths = @(
    "${env:ProgramFiles(x86)}\Tencent\微信web开发者工具\cli.bat",
    "$env:ProgramFiles\Tencent\微信web开发者工具\cli.bat",
    "$env:LOCALAPPDATA\Programs\WeChatWebDevTools\cli.bat"
)
foreach ($cp in $cliPaths) {
    if (Test-Path $cp) {
        Check "WeChat DevTools CLI" $true "Found: $cp"
        $cliOk = $true
        break
    }
}
if (-not $cliOk) {
    $desktopCli = Get-ChildItem "$env:USERPROFILE\Desktop" -Filter "cli.bat" -ErrorAction SilentlyContinue |
        Where-Object { $_.DirectoryName -match "微信|WeChat" } | Select-Object -First 1
    if ($desktopCli) {
        Check "WeChat DevTools CLI" $true "Found on Desktop: $($desktopCli.FullName)"
        $cliOk = $true
    }
}
if (-not $cliOk) {
    Check "WeChat DevTools CLI" $false "Not found. Install: https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html"
}

# 6. Disk space
Write-Host "[6/10] Disk Space" -ForegroundColor White
$cDrive = Get-PSDrive C -ErrorAction SilentlyContinue
if ($cDrive) {
    $freeGB = [math]::Round($cDrive.Free / 1GB, 1)
    Check "C: > 10GB free" ($freeGB -gt 10) "C: $freeGB GB free"
}

# 7. Project dir
Write-Host "[7/10] Project Directory" -ForegroundColor White
$repoUrl = "https://github.com/510721314-lang/zhaoren.git"
$projectDir = Join-Path $env:USERPROFILE "Desktop\zhaoren"
if (Test-Path $projectDir) {
    Check "Project dir exists" $true "$projectDir"
    try {
        $remote = git -C $projectDir remote get-url origin 2>$null
        if ($remote -eq $repoUrl) {
            Check "Git remote origin" $true "= $remote"
        } else {
            Warn "Git remote mismatch" "Current: $remote" "cd $projectDir; git remote set-url origin $repoUrl"
        }
        git -C $projectDir fetch --quiet 2>$null
        $ab = git -C $projectDir rev-list --left-right --count HEAD...origin/master 2>$null
        if ($ab -match "^0\s+0$") {
            Check "Code up to date" $true ""
        } elseif ($ab -match "^\d+\s+\d+$") {
            $parts = $ab -split '\s+'
            Warn "Behind origin/master" "$($parts[1]) commits behind" "cd $projectDir; git pull origin master"
        }
    } catch {
        Warn "Repo state issue" $_.Exception.Message "cd $projectDir; git fetch; git status"
    }
} else {
    Write-Host "  [FAIL] Project dir not found" -ForegroundColor Red
    Write-Host "         Expected at: $projectDir" -ForegroundColor Yellow
    Write-Host "         Run: git clone $repoUrl `"$projectDir`"" -ForegroundColor Cyan
    $script:failed++
}

# 8. WeChat DevTools GUI settings (manual)
Write-Host "[8/10] WeChat DevTools GUI Settings" -ForegroundColor White
Warn "AppID" "Configure in DevTools GUI" "Open DevTools -> Import Project -> AppID: wxbc4a4afacdf234f5"
Warn "Cloud Env" "Bind in DevTools GUI" "DevTools -> CloudBase -> Bind env: cloud1-d9gkefwcp5c777088"
Warn "Request Domain" "Tencent Map API needs allowlist" "DevTools -> Details -> Local Settings -> Add https://apis.map.qq.com to request domain whitelist"

# 9. First init-db run
Write-Host "[9/10] First-time init-db" -ForegroundColor White
Warn "admin_config seed" "Run once to add disclaimer_type field to scene_list" "DevTools -> CloudBase -> Functions -> init-db -> Cloud Test -> Invoke with empty params"

# 10. Backup baseline
Write-Host "[10/10] Backup Baseline" -ForegroundColor White
Warn "First triple backup" "After clone + config" "Run commands shown below"

# Summary
Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Result: [OK] $script:passed  [FAIL] $script:failed  [WARN] $script:warned" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

if ($script:fixes.Count -gt 0) {
    Write-Host ""
    Write-Host "-- Auto-applied fixes --" -ForegroundColor Green
    $script:fixes | ForEach-Object { Write-Host "  [FIXED] $_" -ForegroundColor Green }
}

if ($script:failed -gt 0) {
    Write-Host ""
    Write-Host "-- Manual install needed --" -ForegroundColor Red
    Write-Host "  1. Git: https://git-scm.com/download/win"
    Write-Host "  2. Node.js LTS: https://nodejs.org/"
    Write-Host "  3. WeChat DevTools: https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html"
}

Write-Host ""
Write-Host "-- First-time Quick Commands (copy-paste to PowerShell) --" -ForegroundColor Yellow
Write-Host ""
Write-Host "# 1. Clone + config" -ForegroundColor White
Write-Host "git clone $repoUrl `"$projectDir`"" -ForegroundColor Gray
Write-Host "cd `"$projectDir`"" -ForegroundColor Gray
Write-Host "git config user.name `"NIC`"" -ForegroundColor Gray
Write-Host "git config user.email `"510721314@qq.com`"" -ForegroundColor Gray
Write-Host "git config credential.helper manager" -ForegroundColor Gray
Write-Host "git config core.autocrlf true" -ForegroundColor Gray
Write-Host ""
Write-Host "# 2. Deploy cloud functions (first-time verify)" -ForegroundColor White
Write-Host "# Find cli.bat first (check paths above), then:" -ForegroundColor Gray
Write-Host "& `"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`" cloud functions deploy --env cloud1-d9gkefwcp5c777088 --names partner-action --project `"$projectDir`" --remote-npm-install" -ForegroundColor Gray
Write-Host ""
Write-Host "# 3. First triple backup (after everything ready)" -ForegroundColor White
Write-Host "`$date = Get-Date -Format 'yyyyMMdd'" -ForegroundColor Gray
Write-Host "git bundle create `"$env:USERPROFILE\Desktop\zhaoren_v0_`$date.bundle`" --all --tags" -ForegroundColor Gray
Write-Host "robocopy `"$projectDir`" `"$env:USERPROFILE\Desktop\zhaoren_backup_`$date`" /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NP" -ForegroundColor Gray
Write-Host ""
Write-Host "Done. Now read .trae/handoff-prompt.md and start coding in Trae." -ForegroundColor Cyan
Write-Host ""
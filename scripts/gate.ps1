# gate.ps1 - One-command gate (B2)
# Runs all checks in docs/regression-checklist.md order: one command before delivery/commit
# Usage:  powershell -File scripts/gate.ps1      (exit 0 = ALL PASS)
# Preconditions: node on PATH (if absent after reboot: $env:Path += ';C:\Program Files\nodejs')
# Step 6 smoke needs $env:AWK_KEY (after key rotation set new key first, see docs/runbooks/key-rotation.md)
# Step 7 heartbeat also needs AWK_KEY; stale heartbeat is WARN (does not block) while the orderTimer trigger check is owner-side pending
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if (-not $env:AWK_KEY) { Write-Host '[gate] WARN: AWK_KEY not set, step 6 smoke will fail' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '[gate] FATAL: node not on PATH'
  exit 3
}

$steps = @(
  @{ n = '1/7 check-nightmask';  c = 'node scripts/check-nightmask.js' },
  @{ n = '2/7 check-ssot';       c = 'node scripts/check-ssot.js' },
  @{ n = '3/7 check-syntax';     c = 'node scripts/check-syntax.js' },
  @{ n = '4/7 check-shared-sync';c = 'node scripts/check-shared-sync.js' },
  @{ n = '5/7 npm test';         c = 'npm test' },
  @{ n = '6/7 smoke-check';      c = 'powershell -File .predeploy/smoke-check.ps1' },
  @{ n = '7/7 check-heartbeat';  c = 'powershell -File scripts/check-heartbeat.ps1' }
)

Push-Location $root
try {
  foreach ($s in $steps) {
    Write-Host "[gate] $($s.n) ..."
    Invoke-Expression $s.c
    if ($LASTEXITCODE -ne 0) {
      Write-Host "[gate] FAIL: $($s.n) (exit $LASTEXITCODE)"
      Pop-Location
      exit $LASTEXITCODE
    }
  }
} finally { Pop-Location }
Write-Host '[gate] ALL PASS'
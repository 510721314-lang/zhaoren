param(
  [Parameter(Mandatory=$true)][string]$Fn,
  [Parameter(Mandatory=$true)][string]$EvFile,
  [string]$Tag = '',
  [int]$WaitMs = 8000
)
$ErrorActionPreference = 'Stop'
$ROOT = 'c:\Users\DC\Desktop\zhaoren\.tmp-cloud-runner'
$HWND = 307760310

function Click([int]$x, [int]$y, [string]$btn = 'left', [int]$wait = 400) {
  & "$ROOT\click3.ps1" $x $y $HWND $btn $wait
  if ($LASTEXITCODE -ne 0) { throw "click foreground fail at $x,$y" }
}
function Input([string]$text = '', [int]$bs = 0, [int]$downs = 0, [int]$ends = 0) {
  & "$ROOT\input.ps1" -hwndInt $HWND -text $text -bs $bs -downs $downs -ends $ends
}

# 1) build single-line event with var substitution
$evText = [System.IO.File]::ReadAllText($EvFile, [System.Text.Encoding]::UTF8)
$varsPath = Join-Path $ROOT 'vars.json'
if (Test-Path $varsPath) {
  $vars = Get-Content $varsPath -Raw | ConvertFrom-Json
  $vars.PSObject.Properties | ForEach-Object { $evText = $evText.Replace('{{' + $_.Name + '}}', [string]$_.Value) }
}
if ($evText -match '\{\{[A-Z0-9_]+\}\}') { throw "unresolved var: $($Matches[0])" }
$obj = $evText | ConvertFrom-Json
$line = $obj | ConvertTo-Json -Compress -Depth 12
# escape non-ASCII to \uXXXX: WM_CHAR typing mangles CJK; JSON.parse decodes escapes server-side
$line = -join ($line.ToCharArray() | ForEach-Object { if ([int]$_ -gt 127) { '\u{0:x4}' -f [int]$_ } else { [string]$_ } })

# 2) switch function panel if needed
$stateFile = Join-Path $ROOT 'state.fn'
$cur = if (Test-Path $stateFile) { Get-Content $stateFile -Raw } else { '' }
if (-not $cur) { $cur = '' }
if ($cur.Trim() -ne $Fn) {
  Click 1899 94 left 500                 # close any open panel
  Click 1800 150 left 400                # search box
  Input -ends 1 -bs 80                   # clear search box
  Input -text $Fn
  Start-Sleep -Milliseconds 900          # wait for filter
  Click 1700 250 left 800                # open cloud-test panel (row 1)
  Set-Content -Path $stateFile -Value $Fn
  Start-Sleep -Milliseconds 400
}

# 3) focus editor, select-all, paste event (clipboard = unicode-safe, atomic; WM_CHAR typing proven unreliable)
Click 1292 200 left 300
$lineFile = Join-Path $ROOT 'ev-line.txt'
[System.IO.File]::WriteAllText($lineFile, $line, [System.Text.Encoding]::ASCII)
& "$ROOT\paste.ps1" -file $lineFile -x 1500 -y 220
if ($LASTEXITCODE -ne 0) { throw "paste failed" }
Start-Sleep -Milliseconds 400

# 4) run (button sits ~y405 after editor grows with long content)
Click 1896 643 left 200                # close IDE promo ad if present (no-op otherwise); ad swallows run clicks
Click 1880 395 left 300                # run button center (measured rect 1841-1923 x 384-408)
Start-Sleep -Milliseconds $WaitMs

# 5) capture result screenshot (3 passes; no extra clicks that could disturb the panel)
$shot = if ($Tag) { "$ROOT\res-$Tag.png" } else { "$ROOT\res-last.png" }
$shot2 = if ($Tag) { "$ROOT\res-$Tag-b.png" } else { "$ROOT\res-last-b.png" }
$shot3 = if ($Tag) { "$ROOT\res-$Tag-c.png" } else { "$ROOT\res-last-c.png" }
& "$ROOT\snap.ps1" 1140 400 780 560 $shot | Out-Null
Start-Sleep -Milliseconds 6000
& "$ROOT\snap.ps1" 1140 400 780 560 $shot2 | Out-Null
Start-Sleep -Milliseconds 7000
& "$ROOT\snap.ps1" 1140 400 780 560 $shot3 | Out-Null
Write-Output ("STEP_DONE fn=$Fn tag=$Tag shots=$shot,$shot2")
Write-Output ("EV=$line")

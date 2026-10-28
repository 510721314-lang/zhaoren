# C4 — Frontend callCloud(action) vs Backend handler contract
# Front:  find every callCloud('fn')/name:'fn', pair with nearest action:'xxx' within 300 chars
# Back:   match both switch-case and guard-clause forms:
#           case 'x':
#           action === 'x' | action !== 'x' | action == 'x' | action != 'x'
#         2026-10-28: 巨型入口物理拆分后 handler 多在同级 action_*.js, 注册形态四种都要认
#           (case/if 守卫 | function 名 | 无引号对象键/exports 简写 | 引号对象键),
#           仅扫 index.js 曾误报 85 例; _orig_baseline.js/node_modules/*.test.js 排除
param(
  [string]$Fe = (Join-Path $PSScriptRoot '..\..\..\..\miniprogram'),
  [string]$Be = (Join-Path $PSScriptRoot '..\..\..\..\cloudfunctions')
)

$front = @{}
Get-ChildItem "$Fe\pages-v2","$Fe\components","$Fe\custom-tab-bar" -Recurse -Filter *.js -ErrorAction SilentlyContinue | ForEach-Object {
  $t = Get-Content $_.FullName -Raw -Encoding UTF8
  $fnHits = [regex]::Matches($t, "(?:callCloud\(\s*'|name:\s*')([a-z0-9-]+)'")
  $actHits = [regex]::Matches($t, "action:\s*'([a-z_]+)'")
  foreach ($fh in $fnHits) {
    $fn = $fh.Groups[1].Value
    $next = ($fnHits | Where-Object { $_.Index -gt $fh.Index } | ForEach-Object { $_.Index } | Measure-Object -Minimum).Minimum
    $ah = $actHits | Where-Object { $_.Index -gt $fh.Index -and $_.Index - $fh.Index -lt 300 -and (-not $next -or $_.Index -lt $next) } | Select-Object -First 1
    if ($ah) {
      $act = $ah.Groups[1].Value
      if (-not $front.ContainsKey($fn)) { $front[$fn] = @{} }
      $front[$fn][$act] = $true
    }
  }
}

$back = @{}
Get-ChildItem $Be -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $names = New-Object 'System.Collections.Generic.HashSet[string]'
  Get-ChildItem $_.FullName -Recurse -Filter *.js -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notlike '*node_modules*' -and $_.Name -ne '_orig_baseline.js' -and $_.Name -notlike '*.test.js' } |
    ForEach-Object {
      $t = Get-Content $_.FullName -Raw -Encoding UTF8
      foreach ($m in [regex]::Matches($t, "case\s+'([a-z_][a-z0-9_]*)'")) { [void]$names.Add($m.Groups[1].Value) }
      foreach ($m in [regex]::Matches($t, "action\s*(?:===?|!==?)\s*'([a-z_][a-z0-9_]*)'")) { [void]$names.Add($m.Groups[1].Value) }
      foreach ($m in [regex]::Matches($t, '(?m)(?:async\s+)?function\s+([a-z_][a-z0-9_]*)\s*\(')) { [void]$names.Add($m.Groups[1].Value) }
      foreach ($m in [regex]::Matches($t, '(?m)^\s*[''""]?([a-z_][a-z0-9_]*)[''""]?\s*:')) { [void]$names.Add($m.Groups[1].Value) }
      foreach ($m in [regex]::Matches($t, '(?m)^\s*([a-z_][a-z0-9_]*)\s*[,}]')) { [void]$names.Add($m.Groups[1].Value) }
    }
  $back[$_.Name] = @($names | Sort-Object -Unique)
}

$bad = 0
foreach ($f in ($front.Keys | Sort-Object)) {
  if (-not $back.ContainsKey($f)) { "  FAIL  cloud fn dir missing: $f"; $bad++; continue }
  foreach ($a in ($front[$f].Keys | Sort-Object)) {
    if ($back[$f] -notcontains $a) {
      "  FAIL  $f.$a  backend handler missing (frontend calls it)"
      $bad++
    }
  }
}

if ($bad -eq 0) {
  "[C4] PASS  all cloud action contracts aligned ($($front.Count) functions)"
  exit 0
} else {
  "[C4] FAIL  $bad contract break(s)"
  exit 1
}

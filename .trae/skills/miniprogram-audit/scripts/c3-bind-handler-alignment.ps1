# C3 — WXML bind:catch handlers vs JS method definitions
# Scans pages-v2/ and components/
# Finds all bindxxx="Name" / catchxxx="Name" in each .wxml
# Checks every .js has matching "Name(" / "async Name(" / "Name:"
param(
  [string]$Root = (Join-Path $PSScriptRoot '..\..\..\..\miniprogram')
)

$pagesRoot = Join-Path $Root 'pages-v2'
$compRoot  = Join-Path $Root 'components'
$issues    = New-Object System.Collections.Generic.List[string]

foreach ($dir in (Get-ChildItem $pagesRoot -Directory)) {
  $wxml = Join-Path $dir.FullName "$($dir.Name).wxml"
  $js   = Join-Path $dir.FullName "$($dir.Name).js"
  if (-not (Test-Path $wxml) -or -not (Test-Path $js)) { continue }
  $w = Get-Content $wxml -Raw -Encoding UTF8
  $j = Get-Content $js   -Raw -Encoding UTF8
  $names = ([regex]::Matches($w, '(?:bind|catch):?[a-zA-Z]*="([a-zA-Z_][a-zA-Z0-9_]*)"') |
    ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
  foreach ($n in $names) {
    if ($j -notmatch "(?m)^\s*(?:async\s+)?$n\s*[\(:]") {
      $issues.Add("  FAIL  $($dir.Name): WXML bind '$n' not in JS")
    }
  }
}

foreach ($dir in (Get-ChildItem $compRoot -Directory -ErrorAction SilentlyContinue)) {
  $wxml = Join-Path $dir.FullName "index.wxml"
  $js   = Join-Path $dir.FullName "index.js"
  if (-not (Test-Path $wxml) -or -not (Test-Path $js)) { continue }
  $w = Get-Content $wxml -Raw -Encoding UTF8
  $j = Get-Content $js   -Raw -Encoding UTF8
  $names = ([regex]::Matches($w, '(?:bind|catch):?[a-zA-Z]*="([a-zA-Z_][a-zA-Z0-9_]*)"') |
    ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
  foreach ($n in $names) {
    if ($j -notmatch "(?m)^\s*(?:async\s+)?$n\s*[\(:]") {
      $issues.Add("  FAIL  component/$($dir.Name): '$n' not in JS")
    }
  }
}

if ($issues.Count -eq 0) {
  "[C3] PASS  WXML handlers vs JS methods all aligned"
  exit 0
} else {
  "[C3] FAIL  $($issues.Count) missing handler(s):"
  $issues
  exit 1
}

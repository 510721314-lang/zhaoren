param([Parameter(Mandatory=$true)][string]$ListFile)
$ErrorActionPreference = 'Stop'
$lines = Get-Content $ListFile | Where-Object { $_.Trim() -ne '' -and -not $_.StartsWith('#') }
$i = 0
foreach ($ln in $lines) {
  $i++
  $p = $ln.Split('|')
  if ($p.Count -lt 3) { throw "bad line: $ln" }
  $fn = $p[0].Trim(); $ev = $p[1].Trim(); $tag = $p[2].Trim()
  Write-Output "=== [$i/$($lines.Count)] $tag fn=$fn"
  & powershell -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\step.ps1" -Fn $fn -EvFile $ev -Tag $tag
  if ($LASTEXITCODE -ne 0) { throw "step failed: $tag (exit $LASTEXITCODE)" }
}
Write-Output "BATCH_ALL_DONE count=$($lines.Count)"

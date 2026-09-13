param([int]$hwnd = 307760310)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty, $hwnd)
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if (-not $win) { 'WIN NOT FOUND'; exit 1 }
"win: $($win.Current.Name)"
# walk all descendants, print editable / text controls
$all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
"descendants: $($all.Count)"
$i = 0
foreach ($el in $all) {
  $c = $el.Current.ControlType.ProgrammaticName
  if ($c -match 'Edit|Document|Text') {
    $hasValue = $false; $hasText = $false
    try { $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $hasValue = $true } catch {}
    try { $tp = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern); $hasText = $true } catch {}
    $val = ''
    if ($hasValue) { try { $val = ($el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).Current.Value } catch {} }
    if ($val.Length -gt 60) { $val = $val.Substring(0,60) + '...' }
    "$i | $c | value=$hasValue text=$hasText | '$($el.Current.Name)' | val='$val'"
  }
  $i++
}

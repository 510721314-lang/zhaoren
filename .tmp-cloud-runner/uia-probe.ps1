Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, 17872)
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
"windows found: $($wins.Count)"
foreach ($w in $wins) {
  "  hwnd=$($w.Current.NativeWindowHandle) name='$($w.Current.Name)' class='$($w.Current.ClassName)'"
}

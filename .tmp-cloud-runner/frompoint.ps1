param([int]$X=1614,[int]$Y=433)
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type -AssemblyName WindowsBase
$pt=New-Object System.Windows.Point($X,$Y)
$el=[System.Windows.Automation.AutomationElement]::FromPoint($pt)
if($el){
  $c=$el.Current
  Write-Host ("FromPoint({0},{1}) -> {2} name='{3}' aid='{4}'" -f $X,$Y,$c.ControlType.ProgrammaticName,$c.Name,$c.AutomationId)
  $vp=$null; try{ $vp=$el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) }catch{}
  if($vp){ Write-Host ("  value='"+$vp.Current.Value+"'") }
} else { Write-Host 'no element at point' }

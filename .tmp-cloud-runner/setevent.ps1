param([string]$file)
Add-Type -AssemblyName System.Windows.Forms
$json = [System.IO.File]::ReadAllText($file)
[System.Windows.Forms.Clipboard]::SetText($json)
Start-Sleep -Milliseconds 150
# click into the Monaco editor (image coords 1300,270 -> screen 1292,262)
& powershell -NoProfile -ExecutionPolicy Bypass -File "c:\Users\DC\Desktop\zhaoren\.tmp-cloud-runner\click.ps1" -x 1292 -y 262 -wait 300 | Out-Null
[System.Windows.Forms.SendKeys]::SendWait("^a")
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait("{DEL}")
Start-Sleep -Milliseconds 120
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 300
"event-set"

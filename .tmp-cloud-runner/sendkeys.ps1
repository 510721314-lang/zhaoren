param([string]$text = "2", [long]$hwnd = 307760310)
Add-Type -AssemblyName System.Windows.Forms
$src = @'
using System;using System.Runtime.InteropServices;using System.Threading;
public class KB2 {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
}
'@
Add-Type -TypeDefinition $src
[KB2]::SetForegroundWindow([IntPtr]$hwnd) | Out-Null
[KB2]::BringWindowToTop([IntPtr]$hwnd) | Out-Null
Start-Sleep -Milliseconds 250
[System.Windows.Forms.SendKeys]::SendWait($text)
Start-Sleep -Milliseconds 600
"sent [$text]"

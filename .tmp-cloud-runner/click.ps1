param([int]$x, [int]$y, [long]$hwnd = 307760310, [int]$double = 0, [int]$wait = 350)
Add-Type -AssemblyName System.Windows.Forms
$sig = @'
using System;using System.Runtime.InteropServices;
public class IN{
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
}
'@
Add-Type -TypeDefinition $sig
[IN]::ShowWindow([IntPtr]$hwnd, 3) | Out-Null
[IN]::BringWindowToTop([IntPtr]$hwnd) | Out-Null
[IN]::SetForegroundWindow([IntPtr]$hwnd) | Out-Null
Start-Sleep -Milliseconds 200
[IN]::SetCursorPos($x, $y)
Start-Sleep -Milliseconds 120
[IN]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[IN]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
if ($double -eq 1) {
  Start-Sleep -Milliseconds 90
  [IN]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [IN]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}
Start-Sleep -Milliseconds $wait
"clicked $x,$y"

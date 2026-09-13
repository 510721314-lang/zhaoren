param([int]$x, [int]$y, [int]$hwndInt = 307760310, [string]$button = 'left', [int]$wait = 350)
Add-Type -AssemblyName System.Windows.Forms
$sig = @'
using System;using System.Runtime.InteropServices;
public class IN3{
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool c);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
'@
Add-Type -TypeDefinition $sig
$hwnd = [IntPtr]$hwndInt

# verify foreground with retry; use AttachThreadInput trick if needed
$ok = $false
for ($i = 0; $i -lt 5; $i++) {
  [IN3]::ShowWindow($hwnd, 3) | Out-Null
  [IN3]::BringWindowToTop($hwnd) | Out-Null
  $fg = [IN3]::GetForegroundWindow()
  if ($fg -eq $hwnd) { $ok = $true; break }
  $fgPid = 0
  [IN3]::GetWindowThreadProcessId($fg, [ref]$fgPid) | Out-Null
  $myTid = [IN3]::GetCurrentThreadId()
  $fgTid = [IN3]::GetWindowThreadProcessId($fg, [ref]$fgPid)
  [IN3]::AttachThreadInput($myTid, $fgTid, $true) | Out-Null
  [IN3]::SetForegroundWindow($hwnd) | Out-Null
  [IN3]::AttachThreadInput($myTid, $fgTid, $false) | Out-Null
  Start-Sleep -Milliseconds 250
}
if (-not $ok) { "FOREGROUND_FAIL fg=$([IN3]::GetForegroundWindow())"; exit 9 }
Start-Sleep -Milliseconds 200
[IN3]::SetCursorPos($x, $y)
Start-Sleep -Milliseconds 120
$down = 0x0002; $up = 0x0004
if ($button -eq 'right') { $down = 0x0008; $up = 0x0010 }
[IN3]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[IN3]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds $wait
"clicked $x,$y $button"
exit 0

$src = @'
using System;
using System.Runtime.InteropServices;
public class KA {
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p);
 [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);
 public struct P { public int X,Y; }
}
'@
Add-Type -TypeDefinition $src
[KA]::SetThreadExecutionState(0x80000003) | Out-Null
while ($true) {
  try {
    $p = New-Object KA+P
    [KA]::GetCursorPos([ref]$p) | Out-Null
    [KA]::SetCursorPos($p.X + 1, $p.Y) | Out-Null
    Start-Sleep -Milliseconds 80
    [KA]::SetCursorPos($p.X, $p.Y) | Out-Null
    [KA]::SetThreadExecutionState(0x80000003) | Out-Null
  } catch {}
  Start-Sleep -Seconds 35
}

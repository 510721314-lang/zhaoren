Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public class W{
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out R r);
 public struct R{public int L,T,Ri,B;}
}
'@
[W]::ShowWindow([IntPtr]307760310,3) | Out-Null
[W]::SetForegroundWindow([IntPtr]307760310) | Out-Null
Start-Sleep -Milliseconds 900
$r = New-Object W+R
[W]::GetWindowRect([IntPtr]307760310,[ref]$r) | Out-Null
"rect: $($r.L),$($r.T) - $($r.Ri),$($r.B)"

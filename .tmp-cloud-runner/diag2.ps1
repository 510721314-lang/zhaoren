$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Dg2 {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);
 public struct RECT { public int L,T,R,B; }
}
'@
Add-Type -TypeDefinition $src
$h = [Dg2]::GetForegroundWindow()
"fg hwnd=$h iswindow=$([Dg2]::IsWindow($h)) vis=$([Dg2]::IsWindowVisible($h))"
$pid2 = 0; $tid = [Dg2]::GetWindowThreadProcessId($h, [ref]$pid2)
$sb = New-Object System.Text.StringBuilder 256; [Dg2]::GetWindowText($h,$sb,256) | Out-Null
$cn = New-Object System.Text.StringBuilder 256; [Dg2]::GetClassName($h,$cn,256) | Out-Null
$r = New-Object Dg2+RECT; [Dg2]::GetWindowRect($h,[ref]$r) | Out-Null
"text='$($sb.ToString())' class='$($cn.ToString())' tid=$tid pid=$pid2 rect=$($r.L),$($r.T),$($r.R),$($r.B)"
$parent = [Dg2]::GetWindow($h, 4)
"parent hwnd=$parent iswindow=$([Dg2]::IsWindow($parent))"
$p = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
if ($p) { $p | Select-Object Id,ProcessName,Path | Format-List }

$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Dg {
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
 [DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint tid);
 [DllImport("user32.dll")] public static extern bool GetUserObjectInformation(IntPtr h,int idx,StringBuilder buf,int len,out int needed);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 public struct POINT { public int X,Y; }
 public static string DeskName(IntPtr d){ var sb=new StringBuilder(256); int n; GetUserObjectInformation(d,2,sb,256,out n); return sb.ToString(); }
}
'@
Add-Type -TypeDefinition $src
$p = New-Object Dg+POINT
[Dg]::GetCursorPos([ref]$p) | Out-Null
"cursor before: $($p.X),$($p.Y)"
[Dg]::SetCursorPos(20,187) | Out-Null
Start-Sleep -Milliseconds 150
[Dg]::GetCursorPos([ref]$p) | Out-Null
"cursor after set(20,187): $($p.X),$($p.Y)"
$fg=[Dg]::GetForegroundWindow(); $sb=New-Object System.Text.StringBuilder 256; [Dg]::GetWindowText($fg,$sb,256) | Out-Null
"foreground: $fg $($sb.ToString())"
$myDesk=[Dg]::DeskName([Dg]::GetThreadDesktop([Dg]::GetCurrentThreadId()))
"my desktop: $myDesk"
$pid2=0; $tid=[Dg]::GetWindowThreadProcessId([IntPtr]307760310,[ref]$pid2)
$tDesk=[Dg]::DeskName([Dg]::GetThreadDesktop($tid))
"console pid=$pid2 tid=$tid desktop: $tDesk"

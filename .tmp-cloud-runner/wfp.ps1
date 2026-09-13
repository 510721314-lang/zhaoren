Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WP {
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@
foreach($pt in @(@(1427,382),@(1252,874),@(730,388))){
  $p=New-Object WP+POINT; $p.X=$pt[0]; $p.Y=$pt[1]
  $w=[WP]::WindowFromPoint($p)
  $pid2=0; [void][WP]::GetWindowThreadProcessId($w,[ref]$pid2)
  $sb=New-Object Text.StringBuilder 256; [void][WP]::GetWindowText($w,$sb,256)
  $root=[WP]::GetAncestor($w,2)  # GA_ROOT
  $sb2=New-Object Text.StringBuilder 256; [void][WP]::GetWindowText($root,$sb2,256)
  Write-Host ("point({0},{1}) -> hwnd={2} pid={3} classWinTitle='{4}' rootTitle='{5}'" -f $pt[0],$pt[1],$w.ToInt64(),$pid2,$sb.ToString(),$sb2.ToString())
}

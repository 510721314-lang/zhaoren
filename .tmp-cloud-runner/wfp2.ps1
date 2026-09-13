Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WP2 {
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@
foreach($pt in @(@(1614,433),@(1252,874),@(900,500),@(1280,700))){
  $p=New-Object WP2+POINT; $p.X=$pt[0]; $p.Y=$pt[1]
  $w=[WP2]::WindowFromPoint($p)
  $pid2=0; [void][WP2]::GetWindowThreadProcessId($w,[ref]$pid2)
  $sb=New-Object Text.StringBuilder 256; [void][WP2]::GetWindowText($w,$sb,256)
  $sc=New-Object Text.StringBuilder 256; [void][WP2]::GetClassName($w,$sc,256)
  $root=[WP2]::GetAncestor($w,2)
  $sb2=New-Object Text.StringBuilder 256; [void][WP2]::GetWindowText($root,$sb2,256)
  Write-Host ("({0},{1}) hwnd={2} pid={3} class='{4}' title='{5}' root='{6}'" -f $pt[0],$pt[1],$w.ToInt64(),$pid2,$sc.ToString(),$sb.ToString(),$sb2.ToString())
}

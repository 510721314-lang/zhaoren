Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class HG {
  [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h,uint msg,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
  [DllImport("kernel32.dll")] public static extern bool CheckRemoteDebuggerPresent(IntPtr h,out bool dbg);
}
"@
foreach($hwnd in @(@(1639520,'console'),@(984096,'IDE-main'))){
  $h=[IntPtr]$hwnd[0]
  $hung=[HG]::IsHungAppWindow($h)
  $res=[IntPtr]::Zero
  $t0=Get-Date
  $ok=[HG]::SendMessageTimeout($h,0,([IntPtr]::Zero),([IntPtr]::Zero),2,2000,[ref]$res)  # SMTO_ABORTIFHUNG
  $ms=((Get-Date)-$t0).TotalMilliseconds
  $sb=New-Object Text.StringBuilder 128; [void][HG]::GetClassName($h,$sb,128)
  Write-Host ("{0} hwnd={1} class='{2}' IsHung={3} msgTimeout={4}ms({5})" -f $hwnd[1],$hwnd[0],$sb.ToString(),$hung,$ms,($ok -ne [IntPtr]::Zero))
}

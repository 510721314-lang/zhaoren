Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public class F1 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int cmd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb,IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public delegate bool EnumProc(IntPtr h,IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }

  public static long FindConsole(){
    long found=0;
    EnumWindows((h,l)=>{ uint p; GetWindowThreadProcessId(h,out p);
      if(p==13860 && IsWindowVisible(h)){ var s=new StringBuilder(256); GetWindowText(h,s,256);
        if(s.ToString().Contains("云开发控制台")){ found=h.ToInt64(); return false; } }
      return true; }, IntPtr.Zero);
    return found;
  }
}
"@
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding=[Text.Encoding]::UTF8

$ch=[IntPtr][F1]::FindConsole()
if($ch -eq [IntPtr]::Zero){ Write-Host 'CONSOLE NOT FOUND'; exit 1 }
Write-Host ("console hwnd={0}" -f $ch.ToInt64())

[void][F1]::ShowWindow($ch,9); Start-Sleep -Milliseconds 600
[void][F1]::SetForegroundWindow($ch); Start-Sleep -Milliseconds 700
$fg=[F1]::GetForegroundWindow()
Write-Host ("fg match after SetForeground: {0}" -f ($fg -eq $ch))

$r=New-Object F1+RECT; [void][F1]::GetWindowRect($ch,[ref]$r)
Write-Host ("rect=({0},{1},{2},{3})" -f $r.L,$r.T,$r.R,$r.B)
$bx=$r.L+934; $by=$r.T+137
Write-Host ("clicking ({0},{1})" -f $bx,$by)
[void][F1]::SetCursorPos($bx,$by); Start-Sleep -Milliseconds 200
[F1]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [F1]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 500
Write-Host ("fg match after click: {0}" -f ([F1]::GetForegroundWindow() -eq $ch))

[System.Windows.Forms.SendKeys]::SendWait("^a")
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait("order-create")
Start-Sleep -Milliseconds 1000
Write-Host ("fg match after type: {0}" -f ([F1]::GetForegroundWindow() -eq $ch))

$w2=$r.R-$r.L; $h2=$r.B-$r.T
$bmp=New-Object System.Drawing.Bitmap($w2,$h2)
$g=[System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L,$r.T,0,0,[System.Drawing.Size]::new($w2,$h2))
$bmp.Save("c:\Users\Administrator\Desktop\zhaoren\.tmp-cloud-runner\shot9.png",[System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host "shot9 saved"

param([string]$Mode="notepad",[long]$Hwnd=0,[int]$RX=0,[int]$RY=0,[string]$Keys="",$string=$false)
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class M3 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int cmd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h,int x,int y,int w,int ht,bool repaint);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
}
"@
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding=[Text.Encoding]::UTF8
switch($Mode){
  'notepad' {
    $np=Get-Process notepad -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -First 1
    if(-not $np){ Start-Process notepad; Start-Sleep -Seconds 2; $np=Get-Process notepad | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -First 1 }
    $h=$np.MainWindowHandle
    [void][M3]::MoveWindow($h,100,100,900,500,$true); Start-Sleep -Milliseconds 400
    [void][M3]::ShowWindow($h,9); [void][M3]::SetForegroundWindow($h); Start-Sleep -Milliseconds 500
    # click at client point (450,200) -> screen (100+450+8ish,100+200+30ish) use window rect
    $r=New-Object M3+RECT; [void][M3]::GetWindowRect($h,[ref]$r)
    $ax=$r.L+450; $ay=$r.T+250
    [void][M3]::SetCursorPos($ax,$ay); Start-Sleep -Milliseconds 150
    [M3]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 50; [M3]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait("notepad-injection-OK-123")
    Start-Sleep -Milliseconds 600
    $r2=New-Object M3+RECT; [void][M3]::GetWindowRect($h,[ref]$r2)
    $w2=$r2.R-$r2.L; $h2=$r2.B-$r2.T
    $bmp=New-Object System.Drawing.Bitmap($w2,$h2)
    $g=[System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r2.L,$r2.T,0,0,[System.Drawing.Size]::new($w2,$h2))
    $bmp.Save("c:\Users\Administrator\Desktop\zhaoren\.tmp-cloud-runner\np2.png",[System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Host "notepad test done, shot np2.png rect=($($r2.L),$($r2.T),$($r2.R),$($r2.B))"
  }
}

param([int]$Hwnd,[string]$OutFile,[int]$SleepMs=300)
$ErrorActionPreference='Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class S32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
}
"@
Add-Type -AssemblyName System.Drawing
[void][S32]::SetForegroundWindow([IntPtr]$Hwnd)
Start-Sleep -Milliseconds 400
$r=New-Object S32+RECT; [void][S32]::GetWindowRect([IntPtr]$Hwnd,[ref]$r)
$w=$r.R-$r.L; $h=$r.B-$r.T
Start-Sleep -Milliseconds $SleepMs
$bmp=New-Object System.Drawing.Bitmap($w,$h)
$g=[System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L,$r.T,0,0,[System.Drawing.Size]::new($w,$h))
$bmp.Save($OutFile,[System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host "shot saved: $OutFile ($w x $h) rect=($($r.L),$($r.T),$($r.R),$($r.B))"

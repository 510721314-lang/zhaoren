param([int]$X=500,[int]$Y=400,[int]$Notches=3)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WH {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
}
"@
$r=Get-Content "c:\Users\Administrator\Desktop\zhaoren\.tmp-cloud-runner\wndpos.txt" -ErrorAction SilentlyContinue
# window position read from file: L,T
$pos=$r -split ','
$ax=[int]$pos[0]+$X; $ay=[int]$pos[1]+$Y
[void][WH]::SetCursorPos($ax,$ay)
Start-Sleep -Milliseconds 200
$delta = -120*$Notches
$ud = [uint32]($delta + 4294967296)
[WH]::mouse_event(0x0800,0,0,$ud,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 500
Write-Host "wheel $Notches notches at abs($ax,$ay)"

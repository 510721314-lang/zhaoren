Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SPI {
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint action,uint param,IntPtr vparam,uint ini);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
}
"@
# SPI_SETSCREENREADER = 0x0045, SPIF_UPDATEINIFILE|SPIF_SENDCHANGE = 3
$ok=[SPI]::SystemParametersInfo(0x0045,1,[IntPtr]::Zero,3)
Write-Host "SPI_SETSCREENREADER ok=$ok"
Start-Sleep -Seconds 1
Write-Host "SM_SCREENREADER(0x2D=45) =" ([SPI]::GetSystemMetrics(0x2D))

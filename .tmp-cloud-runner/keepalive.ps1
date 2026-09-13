Add-Type 'using System;using System.Runtime.InteropServices;public class KK{[DllImport("user32.dll")]public static extern void keybd_event(byte k,byte s,uint f,UIntPtr e);}'
1..200 | ForEach-Object { [KK]::keybd_event(0x7E,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [KK]::keybd_event(0x7E,0,2,[UIntPtr]::Zero); Start-Sleep -Seconds 20 }

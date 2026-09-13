param([string]$file, [int]$x, [int]$y, [int]$delay = 6)
$src = @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class UI3 {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
 [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
 public static void Click(int x,int y) {
   SetCursorPos(x,y); Thread.Sleep(120);
   mouse_event(0x2,0,0,0,UIntPtr.Zero); Thread.Sleep(50);
   mouse_event(0x4,0,0,0,UIntPtr.Zero);
 }
 public static void Combo(byte ctrl, byte k) {
   keybd_event(ctrl,0,0,UIntPtr.Zero); Thread.Sleep(40);
   keybd_event(k,0,0,UIntPtr.Zero); Thread.Sleep(40);
   keybd_event(k,0,2,UIntPtr.Zero); Thread.Sleep(40);
   keybd_event(ctrl,0,2,UIntPtr.Zero);
 }
 public static void Type(string s, int delay) {
   for (int i=0;i<s.Length;i++){
     char c = s[i];
     keybd_event(0,0,0x4,(UIntPtr)c);
     keybd_event(0,0,0x4|0x2,(UIntPtr)c);
     if (delay>0) Thread.Sleep(delay);
   }
 }
}
'@
Add-Type -TypeDefinition $src
$json = [System.IO.File]::ReadAllText($file)
[UI3]::ShowWindow([IntPtr]307760310,3) | Out-Null
[UI3]::BringWindowToTop([IntPtr]307760310) | Out-Null
[UI3]::SetForegroundWindow([IntPtr]307760310) | Out-Null
Start-Sleep -Milliseconds 200
[UI3]::Click($x,$y)
Start-Sleep -Milliseconds 250
[UI3]::Combo(0x11,0x41)
Start-Sleep -Milliseconds 120
[UI3]::Type($json, $delay)
Start-Sleep -Milliseconds 300
"typed $($json.Length) chars"

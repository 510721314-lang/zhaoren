param([string]$text = "2", [long]$hwnd = 307760310)
$src = @'
using System;using System.Runtime.InteropServices;using System.Threading;
public class KB {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
 public static void TypeText(string s, int delay) {
   for (int i=0;i<s.Length;i++){
     char c = s[i];
     keybd_event(0,0,0x4,(UIntPtr)c);
     keybd_event(0,0,0x4|0x2,(UIntPtr)c);
     if (delay>0) Thread.Sleep(delay);
   }
 }
 public static void Enter() {
   keybd_event(0x0D,0,0,UIntPtr.Zero); Thread.Sleep(40);
   keybd_event(0x0D,0,2,UIntPtr.Zero); Thread.Sleep(40);
 }
}
'@
Add-Type -TypeDefinition $src
[KB]::SetForegroundWindow([IntPtr]$hwnd) | Out-Null
Start-Sleep -Milliseconds 250
[KB]::TypeText($text, 15)
Start-Sleep -Milliseconds 150
[KB]::Enter()
Start-Sleep -Milliseconds 600
"typed [$text] + Enter"

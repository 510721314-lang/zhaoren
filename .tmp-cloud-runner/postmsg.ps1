param([int]$hwndInt = 307760310)
$src = @'
using System;using System.Runtime.InteropServices;using System.Threading;
public class PM {
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 public const uint WM_KEYDOWN = 0x0100;
 public const uint WM_KEYUP   = 0x0101;
 public const uint WM_CHAR    = 0x0102;
 public static IntPtr Lp(uint scan, bool prev, bool up) {
   int v = (int)(scan << 16) | 1;
   if (prev) v |= (1 << 30);
   if (up)   v |= (1 << 31);
   return (IntPtr)v;
 }
 public static void Key(byte vk, uint scan, bool ctrl) {
   if (ctrl) PostMessage(H, WM_KEYDOWN, (IntPtr)0x11, Lp(0x1D, false, false));
   PostMessage(H, WM_KEYDOWN, (IntPtr)vk, Lp(scan, false, false));
   Thread.Sleep(30);
   PostMessage(H, WM_KEYUP, (IntPtr)vk, Lp(scan, false, true));
   if (ctrl) PostMessage(H, WM_KEYUP, (IntPtr)0x11, Lp(0x1D, true, true));
 }
 public static IntPtr H = IntPtr.Zero;
 public static void Chars(string s, int delay) {
   foreach (char c in s) {
     PostMessage(H, WM_CHAR, (IntPtr)c, IntPtr.Zero);
     if (delay > 0) Thread.Sleep(delay);
   }
 }
}
'@
Add-Type -TypeDefinition $src
[PM]::H = [IntPtr]$hwndInt
[PM]::SetForegroundWindow([PM]::H) | Out-Null
Start-Sleep -Milliseconds 300
# Ctrl+A select all
[PM]::Key(0x41, 0x1E, $true)
Start-Sleep -Milliseconds 200
# type chars
[PM]::Chars("XYZ", 10)
"posted"

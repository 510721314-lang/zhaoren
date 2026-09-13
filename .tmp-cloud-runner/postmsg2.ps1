param([int]$hwndInt = 307760310, [string]$text = "Q")
$src = @'
using System;using System.Runtime.InteropServices;using System.Threading;
public class PM2 {
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 public const uint WM_KEYDOWN = 0x0100;
 public const uint WM_KEYUP   = 0x0101;
 public const uint WM_CHAR    = 0x0102;
 public static IntPtr H = IntPtr.Zero;
 public static void CtrlChar(byte c, int delay) {
   PostMessage(H, WM_CHAR, (IntPtr)c, IntPtr.Zero);
   if (delay > 0) Thread.Sleep(delay);
 }
 public static void Chars(string s, int delay) {
   foreach (char c in s) {
     PostMessage(H, WM_CHAR, (IntPtr)c, IntPtr.Zero);
     if (delay > 0) Thread.Sleep(delay);
   }
 }
}
'@
Add-Type -TypeDefinition $src
[PM2]::H = [IntPtr]$hwndInt
Start-Sleep -Milliseconds 200
# Ctrl+A as WM_CHAR 0x01
[PM2]::CtrlChar(0x01, 250)
# then type replacement text
[PM2]::Chars($text, 8)
"posted wm_char"

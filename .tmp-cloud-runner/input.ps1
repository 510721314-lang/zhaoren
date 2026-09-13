param([int]$hwndInt = 307760310, [string]$text = '', [int]$bs = 0, [int]$downs = 0, [int]$ends = 0)
$src = @'
using System;using System.Runtime.InteropServices;using System.Threading;
public class PM4 {
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
 public const uint WM_KEYDOWN = 0x0100;
 public const uint WM_KEYUP   = 0x0101;
 public const uint WM_CHAR    = 0x0102;
 public static IntPtr H = IntPtr.Zero;
 public static IntPtr Lp(uint scan, bool up) {
   int v = (int)(scan << 16) | 1;
   if (up) v |= unchecked((int)(1u << 31));
   return (IntPtr)v;
 }
 public static void KeyTap(byte vk, uint scan, int times) {
   for (int i = 0; i < times; i++) {
     PostMessage(H, WM_KEYDOWN, (IntPtr)vk, Lp(scan, false));
     PostMessage(H, WM_KEYUP, (IntPtr)vk, Lp(scan, true));
     Thread.Sleep(2);
   }
 }
 public static void Backspaces(int n) { KeyTap(0x08, 0x0E, n); }
 public static void Downs(int n)     { KeyTap(0x28, 0x50, n); }
 public static void Ends(int n)      { KeyTap(0x23, 0x4F, n); }
 public static void Chars(string s) {
   foreach (char c in s) PostMessage(H, WM_CHAR, (IntPtr)c, IntPtr.Zero);
 }
}
'@
Add-Type -TypeDefinition $src
[PM4]::H = [IntPtr]$hwndInt
if ($downs -gt 0) { [PM4]::Downs($downs) }
if ($ends   -gt 0) { [PM4]::Ends($ends) }
if ($bs     -gt 0) { [PM4]::Backspaces($bs) }
Start-Sleep -Milliseconds 120
if ($text.Length -gt 0) { [PM4]::Chars($text) }
"posted downs=$downs ends=$ends bs=$bs textlen=$($text.Length)"

param([string]$file, [int]$x, [int]$y)
Add-Type -AssemblyName System.Windows.Forms
$src = @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class UI2 {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
 [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
 [DllImport("user32.dll")] public static extern bool OpenClipboard(IntPtr h);
 [DllImport("user32.dll")] public static extern bool EmptyClipboard();
 [DllImport("user32.dll")] public static extern IntPtr SetClipboardData(uint f, IntPtr h);
 [DllImport("user32.dll")] public static extern bool CloseClipboard();
 [DllImport("kernel32.dll")] public static extern IntPtr GlobalAlloc(uint u, UIntPtr b);
 [DllImport("kernel32.dll")] public static extern IntPtr GlobalLock(IntPtr h);
 [DllImport("kernel32.dll")] public static extern bool GlobalUnlock(IntPtr h);
 public static bool SetClip(string text) {
   byte[] b = System.Text.Encoding.Unicode.GetBytes(text + "\0");
   for (int i=0;i<12;i++) {
     if (OpenClipboard(IntPtr.Zero)) {
       EmptyClipboard();
       IntPtr g = GlobalAlloc(0x2000, (UIntPtr)b.Length);
       IntPtr p = GlobalLock(g);
       Marshal.Copy(b, 0, p, b.Length);
       GlobalUnlock(g);
       IntPtr r = SetClipboardData(13, g);
       CloseClipboard();
       if (r != IntPtr.Zero) return true;
     }
     Thread.Sleep(120);
   }
   return false;
 }
 public static void Click(int x,int y) {
   SetCursorPos(x,y); Thread.Sleep(120);
   mouse_event(0x2,0,0,0,UIntPtr.Zero); Thread.Sleep(50);
   mouse_event(0x4,0,0,0,UIntPtr.Zero);
 }
 public static void Keys(params byte[] ks) {
   foreach (byte k in ks) { keybd_event(k,0,0,UIntPtr.Zero); Thread.Sleep(30); keybd_event(k,0,2,UIntPtr.Zero); Thread.Sleep(40); }
 }
 public static void Combo(byte ctrl, byte k) {
   keybd_event(ctrl,0,0,UIntPtr.Zero); Thread.Sleep(40);
   keybd_event(k,0,0,UIntPtr.Zero); Thread.Sleep(40);
   keybd_event(k,0,2,UIntPtr.Zero); Thread.Sleep(40);
   keybd_event(ctrl,0,2,UIntPtr.Zero);
 }
}
'@
Add-Type -TypeDefinition $src
$json = [System.IO.File]::ReadAllText($file)
$ok = [UI2]::SetClip($json)
if (-not $ok) { "CLIP_FAIL"; exit 1 }
[UI2]::ShowWindow([IntPtr]307760310,9) | Out-Null
[UI2]::BringWindowToTop([IntPtr]307760310) | Out-Null
[UI2]::SetForegroundWindow([IntPtr]307760310) | Out-Null
Start-Sleep -Milliseconds 200
[UI2]::Click($x,$y)
Start-Sleep -Milliseconds 250
# Ctrl+A
[UI2]::Combo(0x11,0x41)
Start-Sleep -Milliseconds 150
[UI2]::Keys(0x2E) # Delete
Start-Sleep -Milliseconds 120
# Ctrl+V
[UI2]::Combo(0x11,0x56)
Start-Sleep -Milliseconds 400
"pasted ok"

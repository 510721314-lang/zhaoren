$ErrorActionPreference = 'Stop'
$src = @'
using System;using System.Runtime.InteropServices;
public class W {
 [DllImport("user32.dll")] public static extern IntPtr FindWindowW(string c, string t);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
 public struct RECT { public int L; public int T; public int R; public int B; }
}
'@
Add-Type -TypeDefinition $src

# 1) target hwnd from previous session
$old = [IntPtr]307760310
"OLD_HWND=307760310 valid=$([W]::IsWindow($old)) visible=$([W]::IsWindowVisible($old))"
if ([W]::IsWindow($old)) {
  $sb = New-Object System.Text.StringBuilder 256
  [void][W]::GetWindowText($old, $sb, 256)
  $r = New-Object W+RECT
  [void][W]::GetWindowRect($old, [ref]$r)
  "OLD_TITLE=$($sb.ToString()) rect=$($r.L),$($r.T)-$($r.R),$($r.B)"
}

# 2) enumerate all top-level windows to find devtools
Add-Type -AssemblyName System.Text.Encoding
$sig2 = @'
using System;using System.Text;using System.Runtime.InteropServices;
public classEnum { }
'@
$enumSrc = @'
using System;using System.Text;using System.Runtime.InteropServices;using System.Collections.Generic;
public class EW {
  public delegate bool CB(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(CB cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static List<string> Found = new List<string>();
  public static void Scan() {
    Found.Clear();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      int n = GetWindowTextLength(h);
      if (n <= 0) return true;
      StringBuilder sb = new StringBuilder(n + 2);
      GetWindowText(h, sb, n + 2);
      string t = sb.ToString();
      if (t.IndexOf("微信开发者工具", StringComparison.Ordinal) >= 0 || t.IndexOf("wechatwebdevtools", StringComparison.OrdinalIgnoreCase) >= 0 || t.IndexOf("WeChat DevTools", StringComparison.OrdinalIgnoreCase) >= 0) {
        uint pid; GetWindowThreadProcessId(h, out pid);
        Found.Add(h.ToInt64() + "|" + pid + "|" + t);
      }
      return true;
    }, IntPtr.Zero);
  }
}
'@
Add-Type -TypeDefinition $enumSrc
[EW]::Scan()
$devtoolsPid = (Get-Process | Where-Object { $_.ProcessName -match 'wechatdevtools|wechatwebdevtools|devtools' } | Select-Object -First 1).Id
"DEVTOOLS_PID=$devtoolsPid"
[EW]::Found | ForEach-Object { "WIN=$_" }

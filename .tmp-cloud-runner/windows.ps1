Add-Type -AssemblyName System.Drawing,System.Windows.Forms
$sig = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public class Win {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<string> List() {
    var outp = new List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256);
      GetWindowText(h, sb, 256);
      var t = sb.ToString();
      if (t.Trim().Length == 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      RECT r; GetWindowRect(h, out r);
      outp.Add(h.ToInt64() + "|" + pid + "|" + r.Left + "," + r.Top + "," + r.Right + "," + r.Bottom + "|" + t);
      return true;
    }, IntPtr.Zero);
    return outp;
  }
}
'@
Add-Type -TypeDefinition $sig -Language CSharp
[Win]::List() | ForEach-Object { $_ }

param([string]$Mode="list",[long]$Target=0,[int]$RX=0,[int]$RY=0,[string]$Text="")
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public class CH {
  public delegate bool EnumProc(IntPtr h,IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p,EnumProc cb,IntPtr l);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }

  public static List<string> Kids(IntPtr parent){
    var res=new List<string>();
    EnumChildWindows(parent,(h,l)=>{
      var c=new StringBuilder(128); GetClassName(h,c,128);
      var t=new StringBuilder(128); GetWindowText(h,t,128);
      RECT r; GetWindowRect(h,out r);
      res.Add(h.ToInt64()+"|"+c+"|"+t+"|("+r.L+","+r.T+","+r.R+","+r.B+")");
      return true; },IntPtr.Zero);
    return res;
  }
  public static IntPtr FindLegacy(IntPtr parent){
    IntPtr found=IntPtr.Zero;
    EnumChildWindows(parent,(h,l)=>{
      var c=new StringBuilder(128); GetClassName(h,c,128);
      if(c.ToString()=="Chrome_RenderWidgetHostHWND"){ found=h; return false; }
      return true; },IntPtr.Zero);
    return found;
  }
  public static void Click(IntPtr h,int cx,int cy){
    IntPtr lp=(IntPtr)((cy<<16)|(cx&0xFFFF));
    PostMessage(h,0x0200,(IntPtr)0,lp);       // WM_MOUSEMOVE
    System.Threading.Thread.Sleep(80);
    PostMessage(h,0x0201,(IntPtr)1,lp);       // WM_LBUTTONDOWN MK_LBUTTON
    System.Threading.Thread.Sleep(60);
    PostMessage(h,0x0202,(IntPtr)0,lp);       // WM_LBUTTONUP
  }
  public static void Type(IntPtr h,string s){
    foreach(char ch in s){
      IntPtr lp=(IntPtr)ch;
      PostMessage(h,0x0100,(IntPtr)ch,lp);    // WM_KEYDOWN
      PostMessage(h,0x0102,(IntPtr)ch,lp);    // WM_CHAR
      PostMessage(h,0x0101,(IntPtr)ch,lp);    // WM_KEYUP
      System.Threading.Thread.Sleep(25);
    }
  }
}
"@
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$console=[IntPtr]1639520
switch($Mode){
  'list' {
    [CH]::Kids($console) | ForEach-Object { Write-Host $_ }
  }
  'click' {
    $leg=[CH]::FindLegacy($console)
    if($leg -eq [IntPtr]::Zero){ Write-Host 'NO LEGACY WINDOW'; exit 1 }
    $r=New-Object CH+RECT; [void][CH]::GetWindowRect($leg,[ref]$r)
    $cx=$RX; $cy=$RY
    Write-Host ("legacy hwnd={0} rect=({1},{2},{3},{4}) clientClick=({5},{6})" -f $leg.ToInt64(),$r.L,$r.T,$r.R,$r.B,$cx,$cy)
    [CH]::Click($leg,$cx,$cy)
    Write-Host 'posted click'
  }
  'type' {
    $leg=[CH]::FindLegacy($console)
    if($leg -eq [IntPtr]::Zero){ Write-Host 'NO LEGACY WINDOW'; exit 1 }
    [CH]::Type($leg,$Text)
    Write-Host "typed: $Text"
  }
}

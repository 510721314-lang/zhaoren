# cu.ps1 - UIA driver for cloud console test panel (replaces computer-use MCP)
param(
  [Parameter(Position=0)][string]$Mode,
  [string]$Title,
  [int]$Hwnd,
  [int]$Pid2,          # process id filter
  [string]$NameRegex,
  [string]$Role,
  [string]$ValRegex,
  [string]$Value,
  [string]$OutFile,
  [int]$MaxDepth = 60,
  [int]$X, [int]$Y, [int]$RX, [int]$RY,
  [string]$Keys
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public class U32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int cmd);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h,int x,int y,int w,int ht,bool repaint);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb,IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  public delegate bool EnumProc(IntPtr h,IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }

  public static string ListWindows() {
    var sb=new StringBuilder(); var list=new List<long>();
    EnumProc cb=(h,l)=>{ if(IsWindowVisible(h)) list.Add(h.ToInt64()); return true; };
    EnumWindows(cb,IntPtr.Zero);
    foreach(long hl in list){
      IntPtr h=(IntPtr)hl;
      var t=new StringBuilder(512); GetWindowText(h,t,512);
      uint p=0; GetWindowThreadProcessId(h,out p);
      RECT r; GetWindowRect(h,out r);
      if(t.Length>0){ sb.Append(hl).Append(" pid=").Append(p)
        .Append(" rect=(").Append(r.L).Append(',').Append(r.T).Append(',').Append(r.R).Append(',').Append(r.B).Append(") \"")
        .Append(t).Append("\"\n"); }
    }
    return sb.ToString();
  }
}
"@
[Console]::OutputEncoding=[Text.Encoding]::UTF8

function Get-TopWindows([string]$filter){
  $list=@()
  foreach($line in ([U32]::ListWindows() -split "`n" | Where-Object { $_ })){
    if($line -match '^(\d+) pid=(\d+) rect=\((-?\d+),(-?\d+),(-?\d+),(-?\d+)\) "(.*)"'){
      $list+=[pscustomobject]@{Hwnd=[long]$Matches[1];Pid=[int]$Matches[2];Rect=@([int]$Matches[3],[int]$Matches[4],[int]$Matches[5],[int]$Matches[6]);Title=$Matches[7]}
    }
  }
  if($filter){ return $list | Where-Object { $_.Title -match $filter } } else { return $list }
}

function Foreground([long]$h){
  [void][U32]::SetForegroundWindow([IntPtr]$h)
  Start-Sleep -Milliseconds 400
}

function Dump-Tree($el,[int]$depth,[int]$max,[Text.StringBuilder]$sb){
  if($depth -gt $max){ return }
  $c=$el.Current
  $name=$c.Name; if($name -and $name.Length -gt 800){ $name=$name.Substring(0,800)+'<TRUNC>' }
  $name=($name -replace "`r|`n",' ')
  $val=''
  if($c.HasKeyboardFocus){ $val+=' focused' }
  $vp=$null
  try{ $vp=$el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) }catch{}
  if($vp){ $v=$vp.Current.Value; $v=($v -replace "`r|`n",' '); if($v.Length -gt 600){$v=$v.Substring(0,600)+'<TRUNC>'}; $val+=' val="'+$v+'"' }
  $pats=@()
  foreach($p in @([System.Windows.Automation.InvokePattern]::Pattern,[System.Windows.Automation.ValuePattern]::Pattern,[System.Windows.Automation.ExpandCollapsePattern]::Pattern,[System.Windows.Automation.TogglePattern]::Pattern,[System.Windows.Automation.ScrollPattern]::Pattern)){
    try{ if($el.GetCurrentPattern($p)){ $pats+=($p.ProgrammaticName -replace 'PatternIdentifiers\.Pattern','') } }catch{}
  }
  $id=$c.AutomationId
  $line=('  '*$depth)+$c.ControlType.ProgrammaticName.Replace('ControlType.','')+' "'+$name+'"'
  if($pats.Count){ $line+=' ['+($pats -join ',')+']' }
  if($val){ $line+=$val }
  if($id){ $line+=' aid='+$id }
  [void]$sb.AppendLine($line)
  $kids=$el.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
  foreach($k in $kids){ Dump-Tree $k ($depth+1) $max $sb }
}

function Find-Element($root,[string]$nameRegex,[string]$role,[string]$valRegex,[int]$maxDepth){
  $found=$null
  function Walk($el,$depth){
    if($script:found){ return }
    if($depth -gt $maxDepth){ return }
    $c=$el.Current
    $okRole = [string]::IsNullOrEmpty($role) -or ($c.ControlType.ProgrammaticName -match $role)
    $okName = [string]::IsNullOrEmpty($nameRegex) -or ($c.Name -match $nameRegex)
    $okVal = $true
    if($valRegex){
      $okVal=$false
      try{ $vp=$el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); if($vp -and $vp.Current.Value -match $valRegex){ $okVal=$true } }catch{}
    }
    if($okRole -and $okName -and $okVal){ $script:found=$el; return }
    $kids=$el.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
    foreach($k in $kids){ Walk $k ($depth+1); if($script:found){ return } }
  }
  Walk $root 0
  return $found
}

switch($Mode){
  'wins' {
    $q=[char]34
    Get-TopWindows $Title | ForEach-Object {
      ("{0} pid={1} rect=({2},{3},{4},{5}) {6}{7}{6}" -f $_.Hwnd,$_.Pid,$_.Rect[0],$_.Rect[1],$_.Rect[2],$_.Rect[3],$q,$_.Title)
    }
  }
  'fg' {
    Foreground $Hwnd; Write-Host "fg ok $Hwnd"
  }
  'restore' {
    [void][U32]::ShowWindow([IntPtr]$Hwnd,9)  # SW_RESTORE
    Start-Sleep -Milliseconds 500
    Foreground $Hwnd
    $r=New-Object U32+RECT; [void][U32]::GetWindowRect([IntPtr]$Hwnd,[ref]$r)
    Write-Host "restored hwnd=$Hwnd rect=($($r.L),$($r.T),$($r.R),$($r.B))"
  }
  'tree' {
    $ae=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
    $sb=New-Object Text.StringBuilder
    Dump-Tree $ae 0 $MaxDepth $sb
    if($OutFile){ [IO.File]::WriteAllText($OutFile,$sb.ToString(),[Text.Encoding]::UTF8); Write-Host "tree written: $OutFile ($($sb.Length) chars)" }
    else { $s=$sb.ToString(); if($s.Length -gt 6000){ $s.Substring(0,6000)+'<TRUNCATED>' } else { $s } }
  }
  'treeid' { # tree of window found by title filter (auto fg first)
    $w=Get-TopWindows $Title | Select-Object -First 1
    if(-not $w){ Write-Host 'NOWINDOW'; exit 1 }
    Foreground $w.Hwnd
    $ae=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$w.Hwnd)
    $sb=New-Object Text.StringBuilder
    Dump-Tree $ae 0 $MaxDepth $sb
    if($OutFile){ [IO.File]::WriteAllText($OutFile,$sb.ToString(),[Text.Encoding]::UTF8); Write-Host "tree written: $OutFile ($($sb.Length) chars) hwnd=$($w.Hwnd) title=$($w.Title)" }
    else { $s=$sb.ToString(); if($s.Length -gt 6000){ $s.Substring(0,6000)+'<TRUNCATED>' } else { $s } }
  }
  'setval' {
    Foreground $Hwnd
    $ae=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
    $el=Find-Element $ae $NameRegex $Role $ValRegex $MaxDepth
    if(-not $el){ Write-Host 'ELEMENT_NOT_FOUND'; exit 2 }
    try{ $vp=$el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $vp.SetValue($Value) }
    catch{
      # fallback: focus + ctrl-a + type via SendKeys
      $el.SetFocus(); Start-Sleep -Milliseconds 200
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('^a')
      Start-Sleep -Milliseconds 150
      [System.Windows.Forms.SendKeys]::SendWait($Value)
    }
    Start-Sleep -Milliseconds 600
    $vp2=$null; try{ $vp2=$el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) }catch{}
    $now=if($vp2){ $vp2.Current.Value } else { '(no value pattern)' }
    $nowS=($now -replace "`r|`n",' '); if($nowS.Length -gt 300){$nowS=$nowS.Substring(0,300)+'...'}
    Write-Host ("SETVAL_OK now="+$nowS)
  }
  'invoke' {
    Foreground $Hwnd
    $ae=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
    $el=Find-Element $ae $NameRegex $Role $ValRegex $MaxDepth
    if(-not $el){ Write-Host 'ELEMENT_NOT_FOUND'; exit 2 }
    try{ $ip=$el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); $ip.Invoke(); Write-Host 'INVOKE_OK name='+$el.Current.Name }
    catch{
      # fallback: move mouse to clickable point and click
      $r=$el.Current.BoundingRectangle
      $x=[int]($r.X+$r.Width/2); $y=[int]($r.Y+$r.Height/2)
      [void][U32]::SetCursorPos($x,$y); Start-Sleep -Milliseconds 80
      [U32]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [U32]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
      Write-Host "INVOKE_FALLBACK_CLICK ($x,$y)"
    }
  }
  'clickxy' {
    [void][U32]::SetCursorPos($X,$Y); Start-Sleep -Milliseconds 120
    [U32]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [U32]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
    Write-Host "CLICKED $X,$Y"
  }
  'key' {
    Add-Type -AssemblyName System.Windows.Forms
    Foreground $Hwnd
    [System.Windows.Forms.SendKeys]::SendWait($Keys)
    Write-Host "KEYS_SENT $Keys"
  }
  'op' {
    # single-process: restore+fg console window, optional click at window-relative XY, optional keys, then screenshot
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    $w=Get-TopWindows $Title | Select-Object -First 1
    if(-not $w){ Write-Host 'NOWINDOW'; exit 1 }
    [void][U32]::ShowWindow([IntPtr]$w.Hwnd,9); Start-Sleep -Milliseconds 600
    [void][U32]::SetForegroundWindow([IntPtr]$w.Hwnd); Start-Sleep -Milliseconds 700
    $r=New-Object U32+RECT; [void][U32]::GetWindowRect([IntPtr]$w.Hwnd,[ref]$r)
    Write-Host ("hwnd={0} rect=({1},{2},{3},{4})" -f $w.Hwnd,$r.L,$r.T,$r.R,$r.B)
    if(($X -gt 0) -or ($Y -gt 0)){
      $ax=$r.L+$X; $ay=$r.T+$Y
      [void][U32]::SetCursorPos($ax,$ay); Start-Sleep -Milliseconds 200
      [U32]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [U32]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
      Start-Sleep -Milliseconds 500
      Write-Host ("clicked rel=({0},{1}) abs=({2},{3})" -f $X,$Y,$ax,$ay)
    }
    if($Keys){
      [System.Windows.Forms.SendKeys]::SendWait($Keys)
      Start-Sleep -Milliseconds 800
      Write-Host "keys sent"
    }
    $w2=$r.R-$r.L; $h2=$r.B-$r.T
    $bmp=New-Object System.Drawing.Bitmap($w2,$h2)
    $g=[System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.L,$r.T,0,0,[System.Drawing.Size]::new($w2,$h2))
    $bmp.Save($OutFile,[System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Host "shot saved: $OutFile"
  }
  'move' {
    [void][U32]::MoveWindow([IntPtr]$Hwnd,$X,$Y,[int]$RX,[int]$RY,$true)
    Start-Sleep -Milliseconds 800
    $r=New-Object U32+RECT; [void][U32]::GetWindowRect([IntPtr]$Hwnd,[ref]$r)
    Write-Host "moved hwnd=$Hwnd rect=($($r.L),$($r.T),$($r.R),$($r.B))"
  }
  default { Write-Host "unknown mode $Mode"; exit 1 }
}

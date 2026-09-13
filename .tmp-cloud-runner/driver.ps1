param(
  [string]$Manifest = 'c:\Users\DC\Desktop\zhaoren\.tmp-cloud-runner\manifest.json',
  [string]$VarsFile = 'c:\Users\DC\Desktop\zhaoren\.tmp-cloud-runner\vars.json',
  [string]$Out      = 'c:\Users\DC\Desktop\zhaoren\.tmp-cloud-runner\results.jsonl',
  [string]$Only     = '',
  [int]$startAt     = 0,
  [int]$endAt       = 9999
)
$ErrorActionPreference = 'Continue'
$ROOT = 'c:\Users\DC\Desktop\zhaoren\.tmp-cloud-runner'
$src = @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Text;
public class DRV {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
 [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
 [DllImport("user32.dll")] public static extern bool OpenClipboard(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr SetClipboardData(uint f, IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetClipboardData(uint f);
 [DllImport("user32.dll")] public static extern bool CloseClipboard();
 [DllImport("kernel32.dll")] public static extern IntPtr GlobalAlloc(uint u, UIntPtr b);
 [DllImport("kernel32.dll")] public static extern IntPtr GlobalLock(IntPtr h);
 [DllImport("kernel32.dll")] public static extern bool GlobalUnlock(IntPtr h);
 [DllImport("kernel32.dll")] public static extern IntPtr GlobalSize(IntPtr h);
 public static void Click(int x,int y,int hold) {
   SetCursorPos(x,y); Thread.Sleep(150);
   mouse_event(0x2,0,0,0,UIntPtr.Zero); Thread.Sleep(hold);
   mouse_event(0x4,0,0,0,UIntPtr.Zero);
 }
 public static void Combo(byte ctrl, byte k) {
   keybd_event(ctrl,0,0,UIntPtr.Zero); Thread.Sleep(45);
   keybd_event(k,0,0,UIntPtr.Zero); Thread.Sleep(45);
   keybd_event(k,0,2,UIntPtr.Zero); Thread.Sleep(45);
   keybd_event(ctrl,0,2,UIntPtr.Zero); Thread.Sleep(45);
 }
 public static void Type(string s, int delay) {
   for (int i=0;i<s.Length;i++){
     char c = s[i];
     keybd_event(0,0,0x4,(UIntPtr)c);
     keybd_event(0,0,0x4|0x2,(UIntPtr)c);
     if (delay>0) Thread.Sleep(delay);
   }
 }
 public static string GetClip(int tries) {
   for (int i=0;i<tries;i++) {
     if (OpenClipboard(IntPtr.Zero)) {
       try {
         IntPtr h = GetClipboardData(13);
         if (h != IntPtr.Zero) {
           IntPtr p = GlobalLock(h);
           int sz = (int)GlobalSize(h);
           byte[] b = new byte[sz];
           Marshal.Copy(p, b, 0, sz);
           GlobalUnlock(h);
           return Encoding.Unicode.GetString(b).TrimEnd('\0');
         }
       } finally { CloseClipboard(); }
     }
     Thread.Sleep(120);
   }
   return null;
 }
}
'@
Add-Type -TypeDefinition $src
$HWND = [IntPtr]307760310
Add-Type -AssemblyName System.Web.Extensions | Out-Null
$SER = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$SER.MaxJsonLength = [int]::MaxValue

function LoadJSON([string]$path) {
  $t = [System.IO.File]::ReadAllText($path)
  $o = $SER.DeserializeObject($t)
  if ($o -is [array]) { return ,$o }
  return $o
}

$CFG = LoadJSON (Join-Path $ROOT 'coords.json')
"coords res_x=$($CFG['res_x']) rows=$($CFG['rows'].Count)"

$vars = @{}
if (Test-Path $VarsFile) {
  $v = LoadJSON $VarsFile
  foreach ($k in $v.Keys) { $vars[$k] = [string]$v[$k] }
}
$vars['T31'] = [string][DateTimeOffset]::Now.AddDays(31).ToUnixTimeMilliseconds()

$mraw = [System.IO.File]::ReadAllText($Manifest)
$mSteps = @(ConvertFrom-Json -InputObject $mraw)
if ($mSteps.Count -eq 1 -and $mSteps[0] -is [array]) { $mSteps = @($mSteps[0]) }
"manifest steps: $($mSteps.Count)"
if ($mSteps.Count -lt 10) { throw 'manifest load failed' }

function Subst($text) {
  foreach ($k in $vars.Keys) { $text = $text.Replace('{{' + $k + '}}', $vars[$k]) }
  return $text
}

function Focus {
  [DRV]::ShowWindow($HWND,3) | Out-Null
  [DRV]::BringWindowToTop($HWND) | Out-Null
  [DRV]::SetForegroundWindow($HWND) | Out-Null
  Start-Sleep -Milliseconds 250
}

function Read-Result {
  [DRV]::Click([int]$CFG['res_x'], [int]$CFG['res_y'], 50)
  Start-Sleep -Milliseconds 120
  [DRV]::Combo(0x11,0x41)
  Start-Sleep -Milliseconds 80
  [DRV]::Combo(0x11,0x43)
  Start-Sleep -Milliseconds 180
  return [DRV]::GetClip(4)
}

$idx = -1
foreach ($step in $mSteps) {
  $idx++
  if ($idx -lt $startAt -or $idx -gt $endAt) { continue }
  if ($Only -and ($step.id -notlike $Only)) { continue }
  $id = $step.id; $fn = $step.fn
  $evRel = $step.ev
  $evPath = Join-Path $ROOT $evRel
  if (-not ($evRel -and (Test-Path $evPath))) {
    "[$id] SKIP ev missing: '$evRel'"
    [pscustomobject]@{id=$id;fn=$fn;ok=$false;code='EV_MISSING';raw=''} | ConvertTo-Json -Compress | Out-File -FilePath $Out -Append -Encoding utf8
    continue
  }
  $evText = Subst([System.IO.File]::ReadAllText($evPath))
  if ($evText -match '\{\{[A-Z0-9_]+\}\}') {
    "[$id] SKIP unresolved placeholder: $($Matches[0])"
    [pscustomobject]@{id=$id;fn=$fn;ok=$false;code='UNRESOLVED';raw=''} | ConvertTo-Json -Compress | Out-File -FilePath $Out -Append -Encoding utf8
    continue
  }
  Focus
  $row = $CFG['rows'][$fn]
  [DRV]::Click([int]$row['x'], [int]$row['y'], 60)
  Start-Sleep -Milliseconds 450
  [DRV]::Click([int]$CFG['editor_x'], [int]$CFG['editor_y'], 60)
  Start-Sleep -Milliseconds 180
  [DRV]::Combo(0x11,0x41)
  Start-Sleep -Milliseconds 100
  [DRV]::Type($evText, 4)
  Start-Sleep -Milliseconds 200
  $old = Read-Result

  $final = $null; $res = $null; $attempts = 0; $isTimeout = $false
  while ($attempts -lt 2) {
    $attempts++
    [DRV]::Click([int]$CFG['run_x'], [int]$CFG['run_y'], 60)
    $res = $null
    for ($i=0; $i -lt 18; $i++) {
      Start-Sleep -Milliseconds 800
      $r = Read-Result
      if ($r -and $r -match '"ok"\s*:' -and $r -ne $old) { $res = $r; break }
      if ($r -and ($r -match '433' -or $r -match 'timed out') -and $r -ne $old) { $res = $r; break }
    }
    if ($res -and ($res -match '433' -or $res -match 'timed out')) { $isTimeout = $true; $old = $res; continue }
    $final = $res; break
  }
  if (-not $final) { $final = $res; if (-not $final) { $final = 'NO_RESULT' } }

  $code = ''; $okV = $null
  try {
    $j = $SER.DeserializeObject($final)
    if ($j -isnot [array]) {
      $code = [string]$j['code']; $okV = $j['ok']
    }
  } catch {}
  $cap = ''
  if ($step.capture) {
    foreach ($capDef in ([string]$step.capture -split ';')) {
      $parts = $capDef.Split('=')
      $varName = $parts[0]; $path = $parts[1]
      $val = $null
      try {
        $jj = $SER.DeserializeObject($final)
        if ($path -eq 'data._id') { $val = $jj['data']['_id'] }
        elseif ($path -eq 'data.order_id') { $val = $jj['data']['order_id'] }
      } catch {}
      if ($val) { $vars[$varName] = [string]$val; $cap += "$varName=$val;" }
    }
    $sb = New-Object System.Text.StringBuilder
    $first = $true
    foreach ($k in $vars.Keys) {
      if (-not $first) { [void]$sb.Append(', ') }
      [void]$sb.Append('"' + $k + '": "' + $vars[$k] + '"')
      $first = $false
    }
    [System.IO.File]::WriteAllText($VarsFile, '{ ' + $sb.ToString() + ' }', (New-Object System.Text.UTF8Encoding($false)))
  }
  $line = [pscustomobject]@{id=$id;fn=$fn;ok=$okV;code=$code;timeout=$isTimeout;capture=$cap;raw=$final}
  ($line | ConvertTo-Json -Compress) | Out-File -FilePath $Out -Append -Encoding utf8
  "[$id] $fn ok=$okV code=$code timeout=$isTimeout $cap"
}
"DONE"

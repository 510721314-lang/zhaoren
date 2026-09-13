$procId = 13860
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class TI2 {
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint acc,bool inh,uint id);
  [DllImport("advapi32.dll")] public static extern bool OpenProcessToken(IntPtr h,uint acc,out IntPtr t);
  [DllImport("advapi32.dll")] public static extern bool GetTokenInformation(IntPtr t,int info,IntPtr data,uint len,out uint ret);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
}
"@
$h=[TI2]::OpenProcess(0x1000,$false,$procId)
$t=[IntPtr]::Zero
[void][TI2]::OpenProcessToken($h,0x8,[ref]$t)
$ret=0
[void][TI2]::GetTokenInformation($t,25,[IntPtr]::Zero,0,[ref]$ret)
$data=[Runtime.InteropServices.Marshal]::AllocHGlobal([int]$ret)
[void][TI2]::GetTokenInformation($t,25,$data,$ret,[ref]$ret)
$sid=[Runtime.InteropServices.Marshal]::ReadIntPtr($data)
# SID: byte0 Revision, byte1 SubAuthorityCount, then identifier authorities(6 bytes), then subauthorities (4 bytes each)
$count=[Runtime.InteropServices.Marshal]::ReadByte($sid,1)
$ridBase=[int]8+4*($count-1)   # offset: 8 bytes header + subauthorities
$rid=[Runtime.InteropServices.Marshal]::ReadInt32($sid,$ridBase)
Write-Host "pid=$procId subauthority_count=$count integrity_rid=$rid"
if($rid -ge 12288){ Write-Host 'HIGH (elevated)' } elseif($rid -ge 8192){ Write-Host 'MEDIUM (not elevated)' } else { Write-Host "LOW/other $rid" }
[Runtime.InteropServices.Marshal]::FreeHGlobal($data)
[TI2]::CloseHandle($t)|Out-Null; [TI2]::CloseHandle($h)|Out-Null

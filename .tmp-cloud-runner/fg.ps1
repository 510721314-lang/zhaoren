param([int]$ProcId = 19660)
$sig = @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
'@
Add-Type -MemberDefinition $sig -Name W -Namespace U
$p = Get-Process -Id $ProcId
$h = $p.MainWindowHandle
Write-Output "hwnd=$h title=$($p.MainWindowTitle)"
[U.W]::ShowWindow($h, 9) | Out-Null
[U.W]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 800
Write-Output "fg=$([U.W]::GetForegroundWindow())"

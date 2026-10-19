# register-backup-tasks.ps1 — 注册 3 个备份计划任务(zhaoren-backup-full/incr/verify)
# 用法: powershell -File scripts\register-backup-tasks.ps1   (当前用户注册, 无需管理员)
# 卸载: Unregister-ScheduledTask -TaskName 'zhaoren-backup-full','zhaoren-backup-incr','zhaoren-backup-verify' -Confirm:$false
# 说明: -StartWhenAvailable = 错过(关机/睡眠)补跑；凌晨 2:00-4:00 电脑常开已由用户确认, 故不设 WakeToRun；
#       incremental 任务全天每小时触发, 由脚本内时段守卫跳过 02:00-04:59(仅 0,1,5-23 点实际执行, 与需求 05:00-次日01:00 对齐)
$ErrorActionPreference = 'Stop'

$cmd = 'C:\zhaoren\scripts\auto-backup.ps1'
$tasks = @(
  @{ Name = 'zhaoren-backup-full';  Mode = 'full';         At = '02:30'; LimitH = 3; Desc = 'zhaoren 每日全量备份(bundle+热备+37表脱敏+raw加密+CHECKSUMS)' },
  @{ Name = 'zhaoren-backup-incr';  Mode = 'incremental';  At = $null;   LimitH = 1; Desc = 'zhaoren 每小时增量(时段守卫 05:00-次日01:00 内生效)' },
  @{ Name = 'zhaoren-backup-verify'; Mode = 'verify';      At = '04:30'; LimitH = 1; Desc = 'zhaoren 每日备份校验汇总(SHA/bundle/解密探针/restore dry-run)' }
)

foreach ($t in $tasks) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument ('-NoProfile -ExecutionPolicy Bypass -File ' + $cmd + ' -Mode ' + $t.Mode)
  if ($t.At) { $trigger = New-ScheduledTaskTrigger -Daily -At $t.At }
  else {
    # HOURLY 跨午夜改用 21 个 Daily 触发器(00,01,05-23 点各一; RepetitionDuration MaxValue 超任务计划 XML 上限 P99999999D 被拒)
    $trigger = @(foreach ($h in (@(0,1) + @(5..23))) { New-ScheduledTaskTrigger -Daily -At ('{0:D2}:00' -f $h) })
  }
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours $t.LimitH) -MultipleInstances IgnoreNew
  # 已存在则先卸载(幂等重注册)
  if (Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false
    Write-Host "[RE-REG] $($t.Name)"
  }
  Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $trigger -Settings $settings -Description $t.Desc | Out-Null
  Write-Host "[OK] $($t.Name) mode=$($t.Mode)"
}
Write-Host '--- 当前任务状态 ---'
Get-ScheduledTask -TaskName 'zhaoren-backup-*' | Get-ScheduledTaskInfo |
  Select-Object TaskName, LastRunTime, LastTaskResult, NextRunTime | Format-Table -AutoSize

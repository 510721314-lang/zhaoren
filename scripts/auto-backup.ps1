# auto-backup.ps1 — zhaoren 自动备份调度入口（full / incremental / verify 三模式）
# 用法:
#   powershell -File scripts\auto-backup.ps1 -Mode full         # 每日 02:30 任务(全量)
#   powershell -File scripts\auto-backup.ps1 -Mode incremental  # HOURLY 任务(时段守卫内生效)
#   powershell -File scripts\auto-backup.ps1 -Mode verify       # 每日 04:30 任务(校验汇总)
# 备份根: H:\zhaoren_bak_day (full\ / incremental\ / logs\)
# 依赖: .predeploy\manual-backup.ps1(L2~L7 脱敏链) / scripts\raw-export-encrypted.ps1(B 通道加密原值)
#       C:\zhaoren-bak\admin-key-20261009.txt(admin key) / C:\zhaoren-bak\backup-enc-key.txt(加密密码)
# 纪律: 跑前必检 UTF-8 BOM(20261013 BOM 事故)；断言失败硬 FAIL exit 1，禁静默假成功
param(
  [Parameter(Mandatory=$true)][ValidateSet('full','incremental','verify')][string]$Mode,
  [string]$BackupRoot = 'H:\zhaoren_bak_day'
)
$ErrorActionPreference = 'Stop'
$PROJECT = 'C:\zhaoren'
$ADMIN_KEY_FILE = 'C:\zhaoren-bak\admin-key-20261009.txt'
$ENC_KEY_FILE   = 'C:\zhaoren-bak\backup-enc-key.txt'
$LOG_DIR  = Join-Path $BackupRoot 'logs'
$LOG_FILE = Join-Path $LOG_DIR  'backup-log.csv'
$HOT_COLLECTIONS = 'audit_log,order_main,order_status_log,platform_event,im_message'
$GATEWAY_URL = 'https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api'
$script:t0 = Get-Date

# ── 公共函数 ──
function Test-Bom([string]$Path) {
  if (-not (Test-Path $Path)) { throw "BOM 检查对象不存在: $Path" }
  $b = New-Object byte[] 3
  $fs = [System.IO.File]::OpenRead($Path); [void]$fs.Read($b,0,3); $fs.Dispose()
  if ($b[0] -ne 0xEF -or $b[1] -ne 0xBB -or $b[2] -ne 0xBF) { throw "UTF-8 BOM 缺失(PS5.1 会 ParserError): $Path" }
}
function Read-KeyFile([string]$Path, [string]$Name) {
  if (-not (Test-Path $Path)) { throw "$Name 密钥文件不存在: $Path" }
  $k = (Get-Content $Path -Raw).Trim()
  if (-not $k) { throw "$Name 密钥文件为空: $Path" }
  return $k
}
function Write-Log([string]$Result, [string]$Detail) {
  New-Item -ItemType Directory -Force -Path $LOG_DIR | Out-Null
  $dur = [int]((Get-Date) - $script:t0).TotalSeconds
  $detail = ($Detail -replace '"', "'").Replace("`r`n", ' | ').Replace("`n", ' | ')
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ',' + $Mode + ',' + $Result + ',' + $dur + ',"' + $detail + '"'
  Add-Content -Path $LOG_FILE -Value $line -Encoding UTF8
  Write-Host "[LOG] $Result ($dur s): $detail"
}
function Test-HWritable {
  $probe = Join-Path $BackupRoot ('.probe-' + [guid]::NewGuid().ToString('N'))
  try { Set-Content -Path $probe -Value 'ok' -Encoding ASCII; $ok = (Get-Content $probe) -eq 'ok' } finally { Remove-Item $probe -ErrorAction SilentlyContinue }
  if (-not $ok) { throw "备份根不可写: $BackupRoot(H 盘在线?)" }
}
function Invoke-Guard {
  Test-Bom "$PROJECT\scripts\auto-backup.ps1"
  Test-HWritable
}
function Assert-FullChain {
  Test-Bom "$PROJECT\.predeploy\manual-backup.ps1"
  Test-Bom "$PROJECT\.predeploy\restore.ps1"
  Test-Bom "$PROJECT\scripts\raw-export-encrypted.ps1"
  Test-Bom "$PROJECT\scripts\raw-decrypt.ps1"
}
function Invoke-BundleVerify([string]$Bundle) {
  # PS5.1 坑: $ErrorActionPreference='Stop' 下 git 的 stderr(含进度/"is okay")经 2>&1 会变成终止错误 → 临时置 Continue(同 L7 的坑)
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { git -C $PROJECT bundle verify $Bundle 2>&1 | Out-Null; return $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
}
function Invoke-Bundle([string]$OutBundle) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { git -C $PROJECT bundle create $OutBundle --all 2>&1 | Out-Null } finally { $ErrorActionPreference = $prev }
  if ($LASTEXITCODE -ne 0) { throw "git bundle create 失败 exit=$LASTEXITCODE" }
  if ((Invoke-BundleVerify $OutBundle) -ne 0) { throw "git bundle verify 失败: $OutBundle" }
}
function Invoke-RoboCopy([string]$Dst) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { robocopy $PROJECT $Dst /E /R:1 /W:1 /NFL /NDL /NJH /XD node_modules .git .tmp-tcb .backup-lark | Out-Null } finally { $ErrorActionPreference = $prev }
  if ($LASTEXITCODE -ge 8) { throw "robocopy 失败 exit=$LASTEXITCODE" }
}
function Invoke-RawExport([string]$RawDir, [switch]$Hot) {
  $p = Join-Path $PROJECT 'scripts\raw-export-encrypted.ps1'
  if ($Hot) { & $p -OutDir $RawDir -Hot -EncKeyFile $ENC_KEY_FILE }
  else      { & $p -OutDir $RawDir -EncKeyFile $ENC_KEY_FILE }
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $RawDir 'enc-manifest.json'))) { throw "raw 加密导出失败: $RawDir" }
}
function Test-DecryptProbe([string]$RawDir, [int]$Take) {
  $mf = Get-Content (Join-Path $RawDir 'enc-manifest.json') -Raw | ConvertFrom-Json
  $encPass = Read-KeyFile $ENC_KEY_FILE 'enc'
  $picked = @($mf.files | Get-Random -Count ([Math]::Min($Take, $mf.files.Count)))
  foreach ($f in $picked) {
    $encPath = Join-Path $RawDir $f.file
    $tmp = Join-Path $env:TEMP ('zrprobe-' + [guid]::NewGuid().ToString('N') + '.jsonl')
    try {
      & (Join-Path $PROJECT 'scripts\raw-decrypt.ps1') -File $encPath -OutFile $tmp -EncKeyFile $ENC_KEY_FILE | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "解密探针失败: $($f.file)" }
      $sha = (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower()
      if ($sha -ne $f.plain_sha256) { throw "解密探针 SHA 不符: $($f.file)" }
    } finally { Remove-Item $tmp -ErrorAction SilentlyContinue }
  }
  Write-Host "[PROBE] 解密探针 $($picked.Count) 件全过: $RawDir"
}
function Get-CheckSums([string]$Dir) {
  $lines = @('# zhaoren auto-backup checksums ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), '# exempt: meta\functions_code\ (数万 node_modules 小文件; 完整性由 L6 云端下载机制保证, 不入逐文件哈希)')
  Get-ChildItem $Dir -Recurse -File | Where-Object { $_.Name -ne 'CHECKSUMS.txt' -and $_.FullName -notmatch '\\functions_code\\' } | ForEach-Object {
    $rel = $_.FullName.Substring($Dir.Length + 1)
    $lines += (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower() + '  ' + $rel
  }
  [System.IO.File]::WriteAllLines((Join-Path $Dir 'CHECKSUMS.txt'), $lines, (New-Object System.Text.UTF8Encoding($true)))  # BOM: PS5.1 Get-Content 无 BOM 会按 GBK 读致中文路径乱码
}
function Test-CheckSums([string]$Dir) {
  $list = Get-Content (Join-Path $Dir 'CHECKSUMS.txt') | Where-Object { $_ -and -not $_.StartsWith('#') }
  $bad = 0; $checked = 0
  foreach ($l in $list) {
    $sha, $rel = $l -split '  ', 2
    $p = Join-Path $Dir $rel
    if (-not (Test-Path $p)) { $bad++; Write-Host "[BAD] 缺失: $rel"; continue }
    $checked++
    if ((Get-FileHash $p -Algorithm SHA256).Hash.ToLower() -ne $sha) { $bad++; Write-Host "[BAD] 不符: $rel" }
  }
  if ($bad -gt 0) { throw "CHECKSUMS 校验失败 $bad 处" }
  Write-Host "[CHECKSUMS] $checked 件全过: $Dir"
}
function Remove-OldFull {
  $dirs = Get-ChildItem (Join-Path $BackupRoot 'full') -Directory -ErrorAction SilentlyContinue | Sort-Object Name
  if ($dirs.Count -gt 30) { $dirs | Select-Object -First ($dirs.Count - 30) | ForEach-Object { Remove-Item $_.FullName -Recurse -Force; Write-Host "[PRUNE] full 旧份: $($_.Name)" } }
}
function Remove-OldIncremental {
  $cutoff = (Get-Date).AddDays(-7).ToString('yyyyMMdd')
  Get-ChildItem (Join-Path $BackupRoot 'incremental') -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -lt $cutoff } | ForEach-Object { Remove-Item $_.FullName -Recurse -Force; Write-Host "[PRUNE] incremental 旧份: $($_.Name)" }
}

# ── full 模式 ──
if ($Mode -eq 'full') {
  try {
    Invoke-Guard; Assert-FullChain
    $ak = Read-KeyFile $ADMIN_KEY_FILE 'admin'; [void](Read-KeyFile $ENC_KEY_FILE 'enc')
    $dir = Join-Path $BackupRoot ('full\' + (Get-Date -Format 'yyyyMMdd_HHmm'))
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Write-Host "===== FULL START: $dir ====="
    # 1) git bundle 全量
    $bundle = Join-Path $dir ('zhaoren-full-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.bundle')
    Invoke-Bundle $bundle
    # 2) worktree 热备
    Invoke-RoboCopy (Join-Path $dir 'files')
    # 3) manual-backup 全链(L2~L7: DB 37 表脱敏 + 函数代码下载 + 索引台账)
    & (Join-Path $PROJECT '.predeploy\manual-backup.ps1') -AdminKey $ak
    if ($LASTEXITCODE -ne 0) { throw "manual-backup.ps1 exit=$LASTEXITCODE" }
    $srcBak = Get-ChildItem 'C:\zhaoren-bak' -Directory -Filter 'zhaoren_backup_*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $srcBak -or -not (Test-Path (Join-Path $srcBak.FullName 'manifest.json'))) { throw 'manual-backup 产物缺失 manifest.json' }
    $mf = Get-Content (Join-Path $srcBak.FullName 'manifest.json') -Raw | ConvertFrom-Json
    if (-not $mf.total_tables -or $mf.total_tables -lt 37) { throw "manual-backup 表数异常: total_tables=$($mf.total_tables)" }
    Move-Item $srcBak.FullName (Join-Path $dir 'db_export')
    Write-Host "[L2-L7] 37 表脱敏链完成并搬入 db_export"
    # 4) B 通道: tcb 直连原值加密
    Invoke-RawExport (Join-Path $dir 'raw')
    # 5) CHECKSUMS + 保留清理
    Get-CheckSums $dir
    Remove-OldFull
    # 6) 异地 3 件套 staging(best-effort, 推送保持手动: 见 cloud-backup-restore 技能 lark 流程)
    try {
      $stag = 'C:\zhaoren\.backup-lark'
      New-Item -ItemType Directory -Force -Path $stag | Out-Null
      $zip = Join-Path $stag ('zhaoren-full-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
      Compress-Archive -Path $bundle, (Join-Path $dir 'raw'), (Join-Path $dir 'CHECKSUMS.txt') -DestinationPath $zip -Force
      Write-Host "[LARK-STAGING] $zip (异地推送保持手动流程)"
    } catch { Write-Host "[WARN] lark staging 失败(不阻断): $($_.Exception.Message)" }
    Write-Log 'SUCCESS' "full -> $dir"
    exit 0
  } catch {
    Write-Log 'FAIL' $_.Exception.Message
    exit 1
  }
}

# ── incremental 模式 ──
if ($Mode -eq 'incremental') {
  # 时段守卫: 仅 05:00-次日01:00 生效(供 HOURLY 全天任务), 其余时段静默退出
  $h = (Get-Date).Hour
  if (-not (($h -ge 5 -and $h -le 23) -or $h -eq 0 -or $h -eq 1)) { Write-Host '[SKIP] 非增量时段(守卫静默退出)'; exit 0 }
  try {
    Invoke-Guard
    $ek = [void](Read-KeyFile $ENC_KEY_FILE 'enc')
    $dayDir = Join-Path $BackupRoot ('incremental\' + (Get-Date -Format 'yyyyMMdd'))
    $dir = Join-Path $dayDir (Get-Date -Format 'HH')
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Write-Host "===== INCREMENTAL START: $dir ====="
    # 1) bundle 小快照
    $bundle = Join-Path $dir ('zhaoren-incr-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.bundle')
    Invoke-Bundle $bundle
    # 2) 文件增量(robocopy 仅复制变化文件)
    Invoke-RoboCopy (Join-Path $dir 'files')
    # 3) L2 admin_config 快照(网关, 与 manual-backup L2 产物格式对齐; 敏感导出需 confirm:true)
    $ak = Read-KeyFile $ADMIN_KEY_FILE 'admin'
    $acDir = Join-Path $dir 'admin_config'
    New-Item -ItemType Directory -Force -Path $acDir | Out-Null
    $body = '{"action":"export_admin_config","confirm":true}'
    $resp = Invoke-RestMethod -Uri $GATEWAY_URL -Method Post -Headers @{ 'X-Admin-Key' = $ak; 'Content-Type' = 'application/json' } -Body $body -TimeoutSec 60
    if (-not $resp.ok) { throw "export_admin_config 返回异常: $($resp | ConvertTo-Json -Compress -Depth 3)" }
    $gitHead  = (git -C $PROJECT rev-parse HEAD 2>$null).Trim()
    $gitShort = (git -C $PROJECT log --oneline -1 2>$null).Trim()
    $cfgData = @{ config = $resp.data.config; exported_at = $resp.data.exported_at; git_head = $gitHead; git_short = $gitShort }
    $acPath = Join-Path $acDir ((Get-Date -Format 'yyyyMMdd-HH') + '.json')
    [System.IO.File]::WriteAllText($acPath, ($cfgData | ConvertTo-Json -Depth 30 -Compress), [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText("$acPath.sha256", (Get-FileHash $acPath -Algorithm SHA256).Hash.ToLower(), [System.Text.Encoding]::ASCII)
    # 4) 热集合 5 集合原值加密(tcb 直连)
    Invoke-RawExport (Join-Path $dir 'raw') -Hot
    # 5) 清理 7 天
    Remove-OldIncremental
    Write-Log 'SUCCESS' "incremental -> $dir"
    exit 0
  } catch {
    Write-Log 'FAIL' $_.Exception.Message
    exit 1
  }
}

# ── verify 模式 ──
if ($Mode -eq 'verify') {
  $issues = @()
  try {
    Invoke-Guard
    $fullRoot = Join-Path $BackupRoot 'full'
    $latestFull = Get-ChildItem $fullRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
    if ($latestFull) {
      Write-Host "===== VERIFY FULL: $($latestFull.Name) ====="
      $bundle = Get-ChildItem $latestFull.FullName -Filter '*.bundle' | Select-Object -First 1
      if ((Invoke-BundleVerify $bundle.FullName) -ne 0) { $issues += "bundle verify 失败" }
      try { Test-CheckSums $latestFull.FullName } catch { $issues += $_.Exception.Message }
      $dbDir = Join-Path $latestFull.FullName 'db_export'
      if (Test-Path (Join-Path $dbDir 'manifest.json')) {
        $ak = Read-KeyFile $ADMIN_KEY_FILE 'admin'
        & (Join-Path $PROJECT '.predeploy\restore.ps1') -BackupDir $dbDir -AdminKey $ak
        if ($LASTEXITCODE -ne 0) { $issues += "restore dry-run 失败" }
      } else { $issues += 'db_export/manifest.json 缺失' }
      $rawDir = Join-Path $latestFull.FullName 'raw'
      if (Test-Path (Join-Path $rawDir 'enc-manifest.json')) {
        try { Test-DecryptProbe $rawDir 2 } catch { $issues += "raw 探针: $($_.Exception.Message)" }
      } else { $issues += 'raw/enc-manifest.json 缺失' }
    } else { Write-Host '[WARN] 尚无 full 份(仅查 incremental)'; $issues += 'full 缺席' }
    # 最近 incremental 抽查
    $incrRoot = Join-Path $BackupRoot 'incremental'
    $latestDay = Get-ChildItem $incrRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
    if ($latestDay) {
      $latestIncr = Get-ChildItem $latestDay.FullName -Directory | Sort-Object Name -Descending | Select-Object -First 1
      Write-Host "===== VERIFY INCREMENTAL: $($latestDay.Name)\$($latestIncr.Name) ====="
      $b2 = Get-ChildItem $latestIncr.FullName -Filter '*.bundle' | Select-Object -First 1
      if ((Invoke-BundleVerify $b2.FullName) -ne 0) { $issues += 'incremental bundle verify 失败' }
      $r2 = Join-Path $latestIncr.FullName 'raw'
      if (Test-Path (Join-Path $r2 'enc-manifest.json')) {
        try { Test-DecryptProbe $r2 1 } catch { $issues += "incr raw 探针: $($_.Exception.Message)" }
      } else { $issues += 'incremental raw 缺失' }
    }
    $result = if ($issues.Count) { 'PARTIAL' } else { 'SUCCESS' }
    Write-Log $result ("verify issues: " + ($issues -join ' | '))
    if ($issues.Count) { exit 2 } else { exit 0 }
  } catch {
    Write-Log 'FAIL' $_.Exception.Message
    exit 1
  }
}

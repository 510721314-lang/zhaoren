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
$LARK_FOLDER = 'RCsff3kGUlKhpud1KVFckJOhnGc'   # 异地备份目标文件夹(明文 token 非密钥, 见 cloud-backup-restore 技能)
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
function Invoke-WithRetry([scriptblock]$Job, [string]$What, [int]$Tries = 5, [int]$DelaySec = 1) {
  # B1(2026-10-20): 网关间歇 504/400 必须重试(backup-restore runbook 早要求); 失败信息带 HTTP 状态与响应体, 便于区分「间歇」与「内容被拒」
  # ⚠️ 陷阱(2026-10-20 实证): PS 变量名**大小写不敏感** → 参数名若叫 $Body, 会与脚本作用域的 $body(JSON 串)撞名;
  #   脚本块内 `-Body $body` 会解析成**脚本块自身** → 请求体非 JSON → 网关 400(空响应体)。故参数名用 $Job, 禁用 $Body/$Body 类命名。
  for ($i = 1; $i -le $Tries; $i++) {
    try { return (& $Job) } catch {
      $info = $_.Exception.Message
      try {
        $st = [int]$_.Exception.Response.StatusCode
        $bd = (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()
        if ($bd.Length -gt 300) { $bd = $bd.Substring(0, 300) }
        $info = "HTTP $st $($_.Exception.Message) BODY=$bd"
      } catch {}
      if ($i -ge $Tries) { throw $info }
      Write-Host ("[RETRY] $What 第 $i/$Tries 次失败, ${DelaySec}s 后重试: " + $info)
      Start-Sleep -Seconds $DelaySec
    }
  }
}
function Invoke-RawExport([string]$RawDir, [switch]$Hot) {
  $p = Join-Path $PROJECT 'scripts\raw-export-encrypted.ps1'
  # B1(2026-10-20): raw 导出曾 exit=3(存在 failed 集合/致命错误) → 重试 3 次(间隔 15s); 子脚本的终止性错误也纳入重试(否则会绕过循环)
  for ($i = 1; $i -le 3; $i++) {
    $err = ''
    try {
      if ($Hot) { & $p -OutDir $RawDir -Hot -EncKeyFile $ENC_KEY_FILE }
      else      { & $p -OutDir $RawDir -EncKeyFile $ENC_KEY_FILE }
    } catch { $err = $_.Exception.Message }
    if ($LASTEXITCODE -eq 0 -and -not $err -and (Test-Path (Join-Path $RawDir 'enc-manifest.json'))) { return }
    if ($i -ge 3) { throw "raw 加密导出失败(重试 3 次): $RawDir (exit=$LASTEXITCODE err=$err)" }
    Write-Host "[RETRY] raw 导出第 $i 次失败(exit=$LASTEXITCODE err=$err), 15s 后重试"
    Start-Sleep -Seconds 15
  }
}
function Invoke-LarkPush([string]$Dir, [string]$Bundle) {
  # 异地自动推送(lark-cli 镜像): staging=bundle+CHECKSUMS+raw\*(均<20MB; 2026-10-19 实测 28MB 被拒/16.8MB 过)
  # 纪律(cloud-backup-restore 技能): --as user; --local-dir 须在 cwd 内; overwrite 推送 + smart 复核; 失败重试 2 次
  $stag = 'C:\zhaoren\.backup-lark'
  Remove-Item "$stag\*" -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path "$stag\raw" | Out-Null
  Copy-Item $Bundle $stag -Force
  Copy-Item (Join-Path $Dir 'CHECKSUMS.txt') $stag -Force
  Copy-Item (Join-Path $Dir 'raw\*') "$stag\raw\" -Force
  foreach ($o in (Get-ChildItem $stag -Recurse -File | Where-Object { $_.Length -gt 19MB })) {
    Remove-Item $o.FullName -Force
    Write-Host "[LARK-WARN] 超限剔除(本地保留原件): $($o.Name)"
  }
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'   # lark-cli stderr 在 Stop 模式会变终止错误(同 git 坑)
  try {
    $ok = $false; $detail = ''
    for ($i = 1; $i -le 2; $i++) {
      $out = lark-cli drive +push --folder-token $script:LARK_FOLDER --as user --local-dir .backup-lark --if-exists overwrite --json 2>&1
      if ($LASTEXITCODE -eq 0) { $ok = $true; break }
      $detail = (($out | Out-String) -replace '\s+', ' ')
      if ($detail.Length -gt 160) { $detail = $detail.Substring(0, 160) }
      if ($i -lt 2) { Start-Sleep -Seconds 30 }
    }
    if (-not $ok) { return @{ ok = $false; detail = 'push 失败: ' + $detail } }
    $out2 = lark-cli drive +push --folder-token $script:LARK_FOLDER --as user --local-dir .backup-lark --if-exists smart --json 2>&1
    if ($LASTEXITCODE -ne 0) { return @{ ok = $false; detail = 'push 成功但 smart 复核失败' } }
    return @{ ok = $true; detail = 'pushed+verified' }
  } finally { $ErrorActionPreference = $prev }
}
function Test-DecryptProbe([string]$RawDir, [int]$Take) {
  $mf = Get-Content (Join-Path $RawDir 'enc-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
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
    $mf = Get-Content (Join-Path $srcBak.FullName 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $mf.total_tables -or $mf.total_tables -lt 37) { throw "manual-backup 表数异常: total_tables=$($mf.total_tables)" }
    Move-Item $srcBak.FullName (Join-Path $dir 'db_export')
    Write-Host "[L2-L7] 37 表脱敏链完成并搬入 db_export"
    # 4) B 通道: tcb 直连原值加密
    Invoke-RawExport (Join-Path $dir 'raw')
    # 5) CHECKSUMS + 保留清理
    Get-CheckSums $dir
    Remove-OldFull
    # 6) 异地自动推送(lark mirror): staging → overwrite push(重试2) → smart 复核; 失败 WARN 不阻断本地备份
    $larkTag = 'lark=WARN(未执行)'
    try {
      $lark = Invoke-LarkPush $dir $bundle
      if ($lark.ok) { $larkTag = 'lark=OK'; Write-Host "[LARK] 异地推送+复核完成" }
      else { $larkTag = 'lark=WARN: ' + $lark.detail; Write-Host "[LARK-WARN] $larkTag" }
    } catch { $larkTag = 'lark=WARN: ' + $_.Exception.Message; Write-Host "[LARK-WARN] $larkTag" }
    Write-Log 'SUCCESS' "full -> $dir $larkTag"
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
    $body = (@{ action = 'export_admin_config'; confirm = $true } | ConvertTo-Json -Depth 20 -Compress)  # B1(2026-10-20): 改由 hashtable 构造, 与 manual-backup 已验证路径同构(消除手写 JSON 字面量差异面)
    $resp = Invoke-WithRetry { Invoke-RestMethod -Uri $GATEWAY_URL -Method Post -Headers @{ 'X-Admin-Key' = $ak; 'Content-Type' = 'application/json' } -Body $body -TimeoutSec 60 } 'incremental export_admin_config 网关' 6 10
    if (-not $resp.ok) { throw "export_admin_config 返回异常: $($resp | ConvertTo-Json -Compress -Depth 3)" }
    # A1(2026-10-20): git 输出为 UTF-8, PS5.1 默认按 GB2312 解码 → 乱码落盘后读端重解码会吞引号(02:30 full FAIL 根因); 仅包住 git 调用, 不改后续 cli 重定向文件编码
    $prevOutEnc = [Console]::OutputEncoding
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $gitHead  = (git -C $PROJECT rev-parse HEAD 2>$null).Trim()
    $gitShort = (git -C $PROJECT log --oneline -1 2>$null).Trim()
    [Console]::OutputEncoding = $prevOutEnc
    $cfgData = @{ config = $resp.data.config; exported_at = $resp.data.exported_at; git_head = $gitHead; git_short = $gitShort }
    $acPath = Join-Path $acDir ((Get-Date -Format 'yyyyMMdd-HH') + '.json')
    [System.IO.File]::WriteAllText($acPath, ($cfgData | ConvertTo-Json -Depth 30 -Compress), (New-Object System.Text.UTF8Encoding($true)))  # A3: 带 BOM, 否则 PS5.1 按 GB2312 读乱码
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
      # 异地推送缺口检查(最近 full 成功行须含 lark=OK, 04:30 verify 暴露 02:30 的推送缺口)
      $lastFullLog = Get-Content $LOG_FILE -ErrorAction SilentlyContinue | Where-Object { $_ -match ',full,SUCCESS' } | Select-Object -Last 1
      if ($lastFullLog -and $lastFullLog -notmatch 'lark=OK') { $issues += '最近 full 异地推送未确认(lark 缺口)' }
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

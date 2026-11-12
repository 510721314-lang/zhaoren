# 手动完整备份(等价 backup.ps1 的 L2+L3): admin_config 快照 + DB 全量导出 + manifest
# 用法: & 'c:\zhaoren\.predeploy\manual-backup.ps1' -AdminKey "<key>"
param([string]$AdminKey = '')
$ErrorActionPreference = 'Stop'
if (-not $AdminKey) { throw 'AdminKey required' }
$CLOUD_ENV = 'cloud1-d9gkefwcp5c777088'
$GATEWAY_URL = "https://$CLOUD_ENV-1482004365.ap-shanghai.app.tcloudbase.com/api"
$PROJECT_DIR = 'c:\zhaoren'

$COLLECTIONS = @(
  'admin_config', 'admin_web_sessions',
  'user_account', 'partner_profile',
  'demand', 'demand_draft',
  'order_main', 'order_status_log', 'order_confirmations',
  'emergency_contact', 'credit_score_log', 'platform_event', 'audit_log',
  'system_notice', 'disclaimer_signature', 'evaluation',
  'blog_post', 'blog_like', 'blog_comment',
  'safety_report',
  'im_conversation', 'im_message',
  'withdraw_record',
  'user_profile', 'partner_exam', 'partner_apply',
  'dispute', 'withdraw_request', 'credit_log',
  'insurance_record', 'report', 'sms_log', 'device_bind',
  'exam_bank',
  'config_history',
  'no_show_report',
  'complaint',
  # 批1a(2026-10-25): 法律文档版本库
  'legal_doc'
)

$BackupDir = "C:\zhaoren-bak\zhaoren_backup_$(Get-Date -Format 'yyyyMMdd-HHmm')"
New-Item -ItemType Directory -Force -Path $BackupDir, "$BackupDir\admin_config", "$BackupDir\db", "$BackupDir\meta" | Out-Null
Write-Host "[INFO] BackupDir: $BackupDir" -ForegroundColor Cyan

function Invoke-AdminApi($Action, $Params = @{}) {
  $bodyObj = @{ action = $Action } + $Params
  $body = $bodyObj | ConvertTo-Json -Depth 20 -Compress
  try {
    $resp = Invoke-RestMethod -Uri $GATEWAY_URL -Method Post `
      -Headers @{ 'X-Admin-Key' = $AdminKey; 'Content-Type' = 'application/json' } `
      -Body $body -TimeoutSec 60
    # T-13.3-D(2026-11-12 实测): 大响应(~118KB)时 PS5.1 Invoke-RestMethod 返回 String 而非对象;
    #   且 ConvertFrom-Json 遇空键名会报「参数 name 的值无效」, 故用 JavaScriptSerializer(支持空键名, 返回 Dictionary)
    if ($resp -is [string] -and $resp.TrimStart().StartsWith('{')) {
      try {
        Add-Type -AssemblyName System.Web.Extensions -ErrorAction SilentlyContinue
        $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
        $ser.MaxJsonLength = 67108864
        $resp = $ser.DeserializeObject($resp)
      } catch { Write-Host "[WARN] 大响应解析失败: $($_.Exception.Message)" -ForegroundColor Magenta }
    }
    return $resp
  } catch {
    Write-Host "[FAIL] $Action : $($_.Exception.Message)" -ForegroundColor Red
    return $null
  }
}

function Save-JsonWithHash($Path, $Data) {
  $json = $Data | ConvertTo-Json -Depth 30 -Compress
  [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($true)))  # A3(2026-10-20): 集合 JSON 带 BOM, 与 manifest 同口径; 否则 PS5.1 按 GB2312 读会乱码/吞引号
  $sha = (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLower()
  [System.IO.File]::WriteAllText("$Path.sha256", $sha, [System.Text.Encoding]::ASCII)
  return $sha
}

# A1(2026-10-20): git 输出为 UTF-8, PS5.1 默认按 GB2312 解码 → 乱码写进 manifest 后, 读端重解码会吞掉闭合引号致 JSON 解析失败(02:30 full FAIL 根因); 仅包住 git 调用
$prevOutEnc = [Console]::OutputEncoding
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$gitHead = (git -C $PROJECT_DIR rev-parse HEAD 2>$null).Trim()
$gitShort = (git -C $PROJECT_DIR log --oneline -1 2>$null).Trim()
[Console]::OutputEncoding = $prevOutEnc

# L2: admin_config 快照
Write-Host "`n===== L2 admin_config =====" -ForegroundColor Yellow
$cfgResp = Invoke-AdminApi 'export_admin_config' @{ confirm = $true }
if ($cfgResp -and $cfgResp.ok) {
  $cfgData = @{
    config     = $cfgResp.data.config
    exported_at = $cfgResp.data.exported_at
    git_head   = $gitHead
    git_short  = $gitShort
  }
  $cfgPath = "$BackupDir\admin_config\$(Get-Date -Format 'yyyyMMdd-HHmm').json"
  $cfgSha = Save-JsonWithHash $cfgPath $cfgData
  Write-Host "[OK] admin_config SHA=$($cfgSha.Substring(0,16))..." -ForegroundColor Green
} else { Write-Host '[SKIP] export_admin_config failed' -ForegroundColor Magenta }

# L3: DB 全量导出
Write-Host "`n===== L3 DB Export =====" -ForegroundColor Yellow
$exportedTables = @()
foreach ($col in $COLLECTIONS) {
  $page = 1; $allDocs = @(); $total = 0; $truncated = $false; $exported = $false
  while ($true) {
    $resp = Invoke-AdminApi 'export_collection' @{ collection = $col; page = $page; page_size = 100; confirm = $true }
    if (-not $resp -or -not $resp.ok) {
      # T-13.3-C(2026-11-12): 分页失败曾静默写出部分数据(实测 order_main total=406 仅 100 条且 truncated=false)
      Start-Sleep -Milliseconds 800
      $resp = Invoke-AdminApi 'export_collection' @{ collection = $col; page = $page; page_size = 100; confirm = $true }
    }
    if (-not $resp -or -not $resp.ok) {
      # 重试仍失败: 已导出的部分不得伪报完整, 置 truncated 让 manifest/日志显式告警
      Write-Host "  [FAIL] $col page=$page 导出失败, 停止翻页并标记 truncated" -ForegroundColor Red
      $truncated = $true
      break
    }
    $total = $resp.data.total
    $truncated = $resp.data.truncated
    $allDocs += $resp.data.list
    $exported = $true
    if (-not $resp.data.has_more) { break }
    $page++
    if ($page -gt 100) { Write-Host "  [WARN] $col >100 pages force stop" -ForegroundColor Red; break }
  }
  if ($exported) {
    $dbPath = "$BackupDir\db\$col.json"
    $dbData = @{
      collection = $col
      total      = $total
      exported_at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      truncated  = $truncated
      list       = $allDocs
    }
    $dbSha = Save-JsonWithHash $dbPath $dbData
    Write-Host "  [OK] $col : $($allDocs.Count)/$total $(if($truncated){'(TRUNC!)'}) SHA=$($dbSha.Substring(0,12))..." -ForegroundColor Green
    $exportedTables += $col
  }
}

# L6: 云函数代码（从云端下载实际部署版本）
Write-Host "`n===== L6 云函数代码(云端下载) =====" -ForegroundColor Yellow
$fnCodeDir = $null
# CLI 路径探测(2026-10-09 新机适配; 2026-10-13 补主用安装与迁移后路径):
#   主用 = Program Files (x86)\Tencent 安装(实测 cli 可用); 桌面旧拷版已移入 Desktop\工具\
$cliDirs = @(
  'C:\Program Files (x86)\Tencent\微信web开发者工具',
  'C:\Users\DC\Desktop\工具\微信WEB开发者工具',
  'C:\Users\Administrator\Desktop\微信WEB开发者工具',
  'C:\Users\DC\Desktop\微信WEB开发者工具',
  (Join-Path $env:USERPROFILE 'Desktop\微信WEB开发者工具')
)
$cliBat = $cliDirs | Where-Object { Test-Path (Join-Path $_ 'cli.bat') } | Select-Object -First 1 | ForEach-Object { Join-Path $_ 'cli.bat' }
if ($cliBat) {
  $fnRoot = "$BackupDir\meta\functions_code"
  New-Item -ItemType Directory -Force -Path $fnRoot | Out-Null
  $fnNames = @(Get-ChildItem "$PROJECT_DIR\cloudfunctions" -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'index.js') } | ForEach-Object { $_.Name })
  $downloaded = 0; $failed = @()
  $hbFile = Join-Path (Join-Path $BackupDir 'meta') 'heartbeat.txt'
  foreach ($fn in $fnNames) {
    $target = Join-Path $fnRoot $fn
    $errFile = Join-Path $fnRoot "$fn.err.txt"
    # B-1(2026-11-03): 单函数下载超时, 防 CLI 挂起拖死整条备份链; 每函数前后写心跳
    # T-13.3-B(2026-11-12 实测 admin-action/admin-web >90s 被杀): 90 → 300s, 需完整下载后才能剔除 node_modules
    Add-Content -Path $hbFile -Value "$(Get-Date -Format s) L6_START $fn" -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath $cliBat `
      -ArgumentList @('cloud','functions','download','--env',$CLOUD_ENV,'--name',$fn,'--path',$target,'--project',$PROJECT_DIR) `
      -RedirectStandardOutput (Join-Path $fnRoot "$fn.std.txt") -RedirectStandardError $errFile -NoNewWindow -PassThru
    $exited = $false
    try { $p | Wait-Process -Timeout 300 -ErrorAction Stop; $exited = $true } catch { $exited = $false }
    if (-not $exited -or -not $p.HasExited) {
      try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
      Write-Host "[TIMEOUT] L6 download $fn > 300s, killed" -ForegroundColor Red
      Add-Content -Path $hbFile -Value "$(Get-Date -Format s) L6_TIMEOUT $fn" -ErrorAction SilentlyContinue
      $failed += $fn
      continue
    }
    $size = ((Get-ChildItem $target -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum)
    if ($p.ExitCode -eq 0 -and $size -gt 0) {
      $downloaded++
      Add-Content -Path $hbFile -Value "$(Get-Date -Format s) L6_OK $fn" -ErrorAction SilentlyContinue
      # T-13.3-A(2026-11-12 用户批准): 云端下载的 node_modules 占备份体积约 99%(实测 29 目录/374MB),
      #   备份只保留源码; 恢复时必须走 --remote-npm-install(runbook backup-restore.md 已补注)
      $nmDir = Join-Path $target 'node_modules'
      if (Test-Path $nmDir) {
        try {
          Remove-Item $nmDir -Recurse -Force -ErrorAction Stop
          Add-Content -Path $hbFile -Value "$(Get-Date -Format s) L6_PRUNE_NM $fn" -ErrorAction SilentlyContinue
        } catch {
          Write-Host "[WARN] L6 剔除 node_modules 失败(不影响该函数源码备份): $fn" -ForegroundColor Magenta
        }
      }
    }
    else { $failed += $fn; Add-Content -Path $hbFile -Value "$(Get-Date -Format s) L6_FAIL $fn exit=$($p.ExitCode)" -ErrorAction SilentlyContinue }
  }
  if ($downloaded -gt 0) { $fnCodeDir = $fnRoot; Write-Host "[OK] $downloaded/$($fnNames.Count) 函数已下载到 $fnRoot" -ForegroundColor Green }
  if ($failed.Count) { Write-Host "[WARN] 下载失败: $($failed -join ',')" -ForegroundColor Magenta }
} else { Write-Host '[SKIP] CLI 未找到, 跳过 L6' -ForegroundColor Magenta }

# L7: 索引设计台账（从 init-db INDEXES 提取为 JSON）
Write-Host "`n===== L7 INDEX LEDGER(design-level) =====" -ForegroundColor Yellow
$indexLedgerPath = $null
$dumpJs = "$PROJECT_DIR\scripts\dump-index-ledger.js"
if (Test-Path $dumpJs) {
  try {
    $ledgerPath = Join-Path $BackupDir 'meta\index_ledger.json'
    $ledgerLog = "$ledgerPath.node.log"
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'   # node stderr 在 Stop 模式下会被转成终止错误, 仅 node 调用期间关掉
    & node $dumpJs $ledgerPath 2> $ledgerLog
    $ErrorActionPreference = $prevEap
    if (Test-Path $ledgerPath) {
      $ledgerSha = (Get-FileHash $ledgerPath -Algorithm SHA256).Hash.ToLower()
      [System.IO.File]::WriteAllText("$ledgerPath.sha256", $ledgerSha, [System.Text.Encoding]::ASCII)
      $indexLedgerPath = $ledgerPath
      Write-Host "[OK] index_ledger.json (design ledger) SHA=$($ledgerSha.Substring(0,12))..." -ForegroundColor Green
    } else { Write-Host '[SKIP] dump-index-ledger.js exec failed' -ForegroundColor Magenta }
  } catch { Write-Host "[FAIL] L7 : $($_.Exception.Message)" -ForegroundColor Red }
} else { Write-Host '[SKIP] dump-index-ledger.js not found' -ForegroundColor Magenta }

# manifest
$manifest = @{
  backup_at    = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  git_head     = $gitHead
  git_short    = $gitShort
  cloud_env    = $CLOUD_ENV
  appid        = 'wxbc4a4afacdf234f5'
  collections  = $exportedTables
  total_tables = $exportedTables.Count
  has_functions_code = $fnCodeDir
  has_index_ledger   = $indexLedgerPath
}
[System.IO.File]::WriteAllText("$BackupDir\manifest.json", ($manifest | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($true)))  # A3: 带 BOM(同 CHECKSUMS.txt 口径), 否则 PS5.1 按 GB2312 读乱码/吞引号

Write-Host "`n===== DONE =====" -ForegroundColor Green
Write-Host "  Dir : $BackupDir"
Write-Host "  Tbls: $($exportedTables.Count)"
Write-Host "  Git : $gitShort"
Write-Host "  Func-code : $(if($fnCodeDir){'yes'}else{'skip'}) | Index-ledger : $(if($indexLedgerPath){'yes'}else{'skip'})"
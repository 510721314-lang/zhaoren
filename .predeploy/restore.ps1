# zhaoren 云端恢复脚本
# 用法: .\restore.ps1 -BackupDir C:\zhaoren_backup_20260921-2359 [-Force]
# 警告: 恢复会覆盖云端数据! 默认 dry-run 只校验不执行
param(
  [Parameter(Mandatory=$true)]
  [string]$BackupDir,
  [switch]$Force  # 加此参数才真恢复, 否则只校验备份完整性
)

$ErrorActionPreference = 'Stop'

# ── 常量 ──
$CLOUD_ENV   = 'cloud1-d9gkefwcp5c777088'
$PROJECT_DIR = 'c:\Users\DC\Desktop\zhaoren'
$APPID       = 'wxbc4a4afacdf234f5'
$ADMIN_KEY   = 'AWK-27ea10d4ed8a995add3000f977ad62c2ade8ff98d70ef9c1a8bee02df9d49c0c'
$GATEWAY_URL = "https://$CLOUD_ENV-1482004365.ap-shanghai.app.tcloudbase.com/api"

# ── 动态发现 CLI ──
$cli = Get-ChildItem -Path 'C:\Users\DC','C:\' -Filter 'cli.bat' -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '微信WEB开发者工具' -or $_.FullName -match 'wechat' } |
  Select-Object -First 1 -ExpandProperty FullName

Write-Host "===== zhaoren 云端恢复 =====" -ForegroundColor Yellow
if (-not $Force) { Write-Host "[DRY-RUN] 只校验备份完整性, 加 -Force 才真恢复" -ForegroundColor Magenta }
Write-Host ""

# ── 1. 校验备份存在 ──
if (-not (Test-Path $BackupDir)) { throw "备份目录不存在: $BackupDir" }
$manifest = Get-Content "$BackupDir\manifest.json" -Raw | ConvertFrom-Json
Write-Host "[MANIFEST] git=$($manifest.git_short) tables=$($manifest.total_tables) backup_at=$($manifest.backup_at)" -ForegroundColor Cyan

# ── 2. 校验 SHA256 ──
Write-Host "`n===== SHA256 完整性校验 =====" -ForegroundColor Yellow
$okCount = 0; $badCount = 0
Get-ChildItem $BackupDir -Recurse -Filter '*.sha256' | ForEach-Object {
  $hashFile = $_.FullName
  $targetFile = $hashFile -replace '\.sha256$', ''
  $expected = (Get-Content $hashFile -Raw).Trim().ToLower()
  if (-not (Test-Path $targetFile)) { Write-Host "  [MISSING] $targetFile"; $badCount++; return }
  $actual = (Get-FileHash -Path $targetFile -Algorithm SHA256).Hash.ToLower()
  if ($expected -eq $actual) { Write-Host "  [OK] $($_.Name -replace '\.sha256$')"; $okCount++ }
  else { Write-Host "  [BAD] $($_.Name -replace '\.sha256$') expected=$expected actual=$actual"; $badCount++ }
}
Write-Host "  结果: $okCount OK / $badCount BAD" -ForegroundColor $(if($badCount -eq 0){'Green'}else{'Red'})
if ($badCount -gt 0) { throw "有 $badCount 个文件 SHA256 不匹配, 拒绝恢复" }

if (-not $Force) {
  Write-Host "`n===== DRY-RUN 完成 =====" -ForegroundColor Green
  Write-Host "加 -Force 执行真实恢复 (会覆盖云端数据!)" -ForegroundColor Red
  exit 0
}

# ── 3. 真恢复: 确认提示 ──
Write-Host "`n===== 即将执行真实恢复 =====" -ForegroundColor Red
Write-Host "  备份目录: $BackupDir"
Write-Host "  将覆盖 admin_config + $($manifest.total_tables) 个 collection"
$confirm = Read-Host "输入 YES 确认"
if ($confirm -ne 'YES') { Write-Host "已取消"; exit 0 }

# ── 4. 恢复 admin_config ──
Write-Host "`n===== 恢复 admin_config =====" -ForegroundColor Yellow
$cfgFiles = Get-ChildItem "$BackupDir\admin_config" -Filter '*.json' | Sort-Object LastWriteTime -Descending
if ($cfgFiles.Count -gt 0) {
  $cfgData = (Get-Content $cfgFiles[0].FullName -Raw | ConvertFrom-Json).config
  $body = @{ action = 'config_restore'; config = $cfgData } | ConvertTo-Json -Depth 30 -Compress
  try {
    $resp = Invoke-RestMethod -Uri $GATEWAY_URL -Method Post `
      -Headers @{ 'X-Admin-Key' = $ADMIN_KEY; 'Content-Type' = 'application/json' } `
      -Body $body -TimeoutSec 120
    Write-Host "  [OK] admin_config 恢复成功" -ForegroundColor Green
  } catch {
    Write-Host "  [FAIL] admin_config 恢复: $_" -ForegroundColor Red
    Write-Host "  提示: admin-action 需新增 config_restore action, 或手动调 config_set" -ForegroundColor Magenta
  }
} else { Write-Host "  [SKIP] 无 admin_config 备份" -ForegroundColor Magenta }

# ── 5. 恢复 DB (逐 collection 插入, 不删旧数据——增量追加) ──
Write-Host "`n===== 恢复 DB 数据 =====" -ForegroundColor Yellow
foreach ($colFile in Get-ChildItem "$BackupDir\db" -Filter '*.json') {
  $data = Get-Content $colFile.FullName -Raw | ConvertFrom-Json
  $docs = $data.list
  Write-Host "  $($data.collection): $($docs.Count) 条 (truncated=$($data.truncated))" -ForegroundColor Cyan
  # 注: 恢复 DB 需要 admin-action 有 import_collection action, 暂未实现
  # 这里只列出待恢复, 不自动执行
}

Write-Host "`n===== 恢复完成 =====" -ForegroundColor Green
Write-Host "注意: DB 数据恢复需 admin-action 新增 import_collection action, 当前仅恢复了 admin_config" -ForegroundColor Magenta

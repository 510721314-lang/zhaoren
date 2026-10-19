# raw-export-encrypted.ps1 — B 通道加密落盘：tcb 直连拉原值 → 逐文件 AES-256-CBC 加密 → 往返校验 → 删明文
# 用法: powershell -File scripts\raw-export-encrypted.ps1 -OutDir 'H:\zhaoren_bak_day\full\xxx\raw' [-Hot] [-Collections 'a,b'] [-KeepPlain]
# 文件格式(ZRBE1): magic 5B + salt 16B + iv 16B + AES-256-CBC(PKCS7) 密文；密钥 = PBKDF2(密码, salt, 100000, SHA1) 派生
# 密码来源: -EncKeyFile(默认 C:\zhaoren-bak\backup-enc-key.txt，整文件 Trim 后为密码本体；禁入库禁回显)
param(
  [Parameter(Mandatory=$true)][string]$OutDir,
  [string]$Collections = '',
  [switch]$Hot,
  [string]$EncKeyFile = 'C:\zhaoren-bak\backup-enc-key.txt',
  [switch]$KeepPlain
)
$ErrorActionPreference = 'Stop'
$PROJECT = 'C:\zhaoren'

if (-not (Test-Path $EncKeyFile)) { throw "加密密钥文件不存在: $EncKeyFile" }
$encPass = (Get-Content $EncKeyFile -Raw).Trim()
if (-not $encPass) { throw "加密密钥文件为空: $EncKeyFile" }

$plainDir = Join-Path $OutDir 'plain'
New-Item -ItemType Directory -Force -Path $OutDir, $plainDir | Out-Null

# ── 1. tcb 直连导出原值 JSONL(node 端) ──
Push-Location $PROJECT
try {
  $nodeArgs = @('scripts\raw-export.js', '--outdir', $plainDir)
  if ($Hot) { $nodeArgs += '--hot' }
  elseif ($Collections) { $nodeArgs += @('--collections', $Collections) }
  $mf = Join-Path $OutDir 'raw-manifest.json'
  $nodeArgs += @('--manifest', $mf)
  & node @nodeArgs
  if ($LASTEXITCODE -ne 0) { throw "raw-export.js 失败 exit=$LASTEXITCODE(存在 failed 集合或致命错误)" }
} finally { Pop-Location }

# ── 2. AES-256-CBC 加密原语(自包含，无 7z 依赖) ──
function Protect-File([string]$In, [string]$Out, [string]$Pass) {
  $rng  = [System.Security.Cryptography.RNGCryptoServiceProvider]::Create()
  $salt = New-Object byte[] 16; $rng.GetBytes($salt)
  $iv   = New-Object byte[] 16; $rng.GetBytes($iv)
  $rfc  = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($Pass, $salt, 100000)
  $key  = $rfc.GetBytes(32)
  $aes  = New-Object System.Security.Cryptography.AesCryptoServiceProvider
  $aes.KeySize = 256; $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
  $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
  $aes.Key = $key; $aes.IV = $iv
  $fsIn  = [System.IO.File]::OpenRead($In)
  $fsOut = [System.IO.File]::Open($Out, [System.IO.FileMode]::Create)
  try {
    $fsOut.Write([System.Text.Encoding]::ASCII.GetBytes('ZRBE1'), 0, 5)
    $fsOut.Write($salt, 0, 16); $fsOut.Write($iv, 0, 16)
    $enc = $aes.CreateEncryptor()
    $cs  = New-Object System.Security.Cryptography.CryptoStream($fsOut, $enc, [System.Security.Cryptography.CryptoStreamMode]::Write)
    $fsIn.CopyTo($cs); $cs.FlushFinalBlock(); $cs.Dispose()
  } finally { $fsIn.Dispose(); $fsOut.Dispose(); $aes.Dispose() }
}
function Unprotect-File([string]$In, [string]$Out, [string]$Pass) {
  $fsIn = [System.IO.File]::OpenRead($In)
  $fsOut = [System.IO.File]::Open($Out, [System.IO.FileMode]::Create)
  try {
    $magic = New-Object byte[] 5; [void]$fsIn.Read($magic, 0, 5)
    if ([System.Text.Encoding]::ASCII.GetString($magic) -ne 'ZRBE1') { throw "magic 不符(非 ZRBE1): $In" }
    $salt = New-Object byte[] 16; [void]$fsIn.Read($salt, 0, 16)
    $iv   = New-Object byte[] 16; [void]$fsIn.Read($iv,   0, 16)
    $rfc  = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($Pass, $salt, 100000)
    $aes  = New-Object System.Security.Cryptography.AesCryptoServiceProvider
    $aes.KeySize = 256; $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
    $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
    $aes.Key = $rfc.GetBytes(32); $aes.IV = $iv
    $dec = $aes.CreateDecryptor()
    $cs  = New-Object System.Security.Cryptography.CryptoStream($fsIn, $dec, [System.Security.Cryptography.CryptoStreamMode]::Read)
    $cs.CopyTo($fsOut); $cs.Dispose()
  } finally { $fsIn.Dispose(); $fsOut.Dispose(); $aes.Dispose() }
}

# ── 3. 逐文件加密 + 往返校验 + 删明文 ──
$encFiles = @()
$plainList = Get-ChildItem $plainDir -Filter '*.jsonl' -File
if (-not $plainList) { throw "导出产物为空: $plainDir" }
foreach ($f in $plainList) {
  $encPath = Join-Path $OutDir ($f.BaseName + '.jsonl.enc')
  Protect-File -In $f.FullName -Out $encPath -Pass $encPass
  # 往返校验: 解密到 TEMP 比对 SHA256 后即删
  $tmpBack = Join-Path $env:TEMP ("zrbe-verify-" + [guid]::NewGuid().ToString('N') + ".jsonl")
  try {
    Unprotect-File -In $encPath -Out $tmpBack -Pass $encPass
    $shaPlain = (Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLower()
    $shaBack  = (Get-FileHash $tmpBack  -Algorithm SHA256).Hash.ToLower()
    if ($shaPlain -ne $shaBack) { throw "往返校验失败: $($f.Name)" }
  } finally { Remove-Item $tmpBack -ErrorAction SilentlyContinue }
  $encFiles += @{ file = (Split-Path $encPath -Leaf); plain_sha256 = $shaPlain; enc_sha256 = (Get-FileHash $encPath -Algorithm SHA256).Hash.ToLower(); plain_bytes = $f.Length }
  Remove-Item $f.FullName -Force   # 明文即删，H 盘不留原值
  Write-Host "[ENC] $($f.Name) -> $(Split-Path $encPath -Leaf) OK"
}
if (-not $KeepPlain) { Remove-Item $plainDir -Force -Recurse -ErrorAction SilentlyContinue }

# ── 4. 加密清单落盘 ──
$encManifest = @{
  created_at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  cipher     = 'AES-256-CBC/PKCS7, PBKDF2-SHA1 100k, magic ZRBE1'
  key_file   = $EncKeyFile
  files      = $encFiles
}
$mfPath = Join-Path $OutDir 'enc-manifest.json'
[System.IO.File]::WriteAllText($mfPath, ($encManifest | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText("$mfPath.sha256", (Get-FileHash $mfPath -Algorithm SHA256).Hash.ToLower(), [System.Text.Encoding]::ASCII)
Write-Host "[DONE] 加密 $($encFiles.Count) 个文件 -> $OutDir"

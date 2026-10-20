# raw-decrypt.ps1 — B 通道解密/恢复工具（配合 raw-export-encrypted.ps1 的 ZRBE1 格式）
# 用法: powershell -File scripts\raw-decrypt.ps1 -File <path.jsonl.enc> -OutFile <path.jsonl> [-EncKeyFile C:\zhaoren-bak\backup-enc-key.txt]
# 灾难恢复: 解密得 JSONL(extended JSON，每行一文档) → 经 import 通道或手工回灌云端
param(
  [Parameter(Mandatory=$true)][string]$File,
  [Parameter(Mandatory=$true)][string]$OutFile,
  [string]$EncKeyFile = 'C:\zhaoren-bak\backup-enc-key.txt'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $EncKeyFile)) { throw "加密密钥文件不存在: $EncKeyFile" }
$encPass = (Get-Content $EncKeyFile -Raw -Encoding UTF8).Trim()
if (-not $encPass) { throw "加密密钥文件为空: $EncKeyFile" }
if (-not (Test-Path $File)) { throw "输入文件不存在: $File" }

$fsIn  = [System.IO.File]::OpenRead($File)
$fsOut = [System.IO.File]::Open($OutFile, [System.IO.FileMode]::Create)
try {
  $magic = New-Object byte[] 5; [void]$fsIn.Read($magic, 0, 5)
  if ([System.Text.Encoding]::ASCII.GetString($magic) -ne 'ZRBE1') { throw "magic 不符(非 ZRBE1): $File" }
  $salt = New-Object byte[] 16; [void]$fsIn.Read($salt, 0, 16)
  $iv   = New-Object byte[] 16; [void]$fsIn.Read($iv,   0, 16)
  $rfc  = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($encPass, $salt, 100000)
  $aes  = New-Object System.Security.Cryptography.AesCryptoServiceProvider
  $aes.KeySize = 256; $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
  $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
  $aes.Key = $rfc.GetBytes(32); $aes.IV = $iv
  $dec = $aes.CreateDecryptor()
  $cs  = New-Object System.Security.Cryptography.CryptoStream($fsIn, $dec, [System.Security.Cryptography.CryptoStreamMode]::Read)
  $cs.CopyTo($fsOut); $cs.Dispose()
} finally { $fsIn.Dispose(); $fsOut.Dispose(); $aes.Dispose() }

$sha = (Get-FileHash $OutFile -Algorithm SHA256).Hash.ToLower()
Write-Host "[OK] $OutFile"
Write-Host "SHA256: $sha"

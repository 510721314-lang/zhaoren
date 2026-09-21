# PowerShell 5 Windows 陷阱与对策（zhaoren 项目专用）

## 触发场景

- 在 Windows 上写/跑 `.ps1` 脚本
- PowerShell 报 `Unexpected token` / `The string is missing the terminator`
- 中文注释/字符串输出乱码（`寰俊` / `鈹€`）
- 管道报错 `Expressions are only allowed as the first element of a pipeline`

## 环境事实

| 项 | 值 |
|----|-----|
| 默认 Shell | Windows PowerShell 5.1（`powershell5`） |
| PS 5 编码 | 默认按 **GBK** 读 `.ps1` 文件，**不是 UTF-8** |
| PS 7 | 支持 `&&`、默认 UTF-8，但本机未默认装 |
| 调用方式 | `powershell -ExecutionPolicy Bypass -File script.ps1` |

---

## 陷阱 1：`&&` 不支持

**错误**：
```powershell
cd admin-web-frontend && npm run build
# ParserError: The token '&&' is not a valid statement separator
```

**对策**：
- 用 `;` 分隔（无条件继续）
- 或用 `if ($?) { ... }` 实现短路
- 跨 Shell 通用写法：
```powershell
cd admin-web-frontend; if ($?) { npm run build }
```

---

## 陷阱 2：UTF-8 无 BOM 文件中文乱码

**现象**：
- Write 工具创建的 `.ps1` 默认 UTF-8 无 BOM
- PS 5 按 GBK 读，中文注释变 `寰俊WEB寮€鍙戣€呭伐鍏`
- 中文单引号字符串被截断，报 `The string is missing the terminator`

**对策（三选一）**：

### A. 写文件时强制 UTF-8 BOM（推荐）
```powershell
# 用 .NET API 写带 BOM 的 UTF-8
$content = Get-Content script.ps1 -Raw
[System.IO.File]::WriteAllText("script.ps1", $content, [System.Text.UTF8Encoding]::new($true))
```

### B. ps1 脚本里全用英文注释（最稳，zhaoren 项目约定）
```powershell
# Find cli.bat (注释用英文)
$cli = Get-ChildItem -Path 'C:\' -Filter 'cli.bat' -Recurse
```

### C. 脚本里显式声明编码（对输出有效，对源码本身无效）
```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
```

**zhaoren 项目约定**：所有 `.ps1` 脚本注释和字符串**全用英文**，避免编码坑。仅在输出给用户看的 `Write-Host` 消息里可以用中文，但优先英文。

---

## 陷阱 3：管道里不能以表达式开头

**错误**：
```powershell
$manifest | ConvertTo-Json | [System.IO.File]::WriteAllText("path", $_, $enc)
# Expressions are only allowed as the first element of a pipeline
```

**对策**：先存变量再写：
```powershell
$json = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText("path", $json, $enc)
```

---

## 陷阱 4：`2>&1` 把 stderr 当错误抛

**现象**：git、npm 等命令往 stderr 写进度信息，PS 5 的 `2>&1` 把这些包装成 `RemoteException`，触发 `$ErrorActionPreference = 'Stop'` 直接中断。

**典型表现**：
```powershell
git push origin master 2>&1
# git : To https://github.com/...
# NativeCommandError
```
但实际命令**成功了**（看输出里有 `master -> master`）。

**对策**：
```powershell
# 临时放宽错误处理
$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
git push origin master 2>&1 | Out-Null
$ErrorActionPreference = $prev

# 或不用 2>&1, 让 stderr 直接显示
git push origin master
```

**判断命令是否成功**：看 `$LASTEXITCODE`（0=成功），不要看 PS 有没有报错。
```powershell
git push origin master
if ($LASTEXITCODE -eq 0) { Write-Host "OK" } else { Write-Host "FAIL" }
```

---

## 陷阱 5：`ConvertTo-Json` 默认 Depth=2

**现象**：嵌套对象超过 2 层被序列化成 `System.Collections.Hashtable` 字符串。

**对策**：
```powershell
$data | ConvertTo-Json -Depth 30 -Compress
```
备份/配置类脚本固定 `-Depth 30`。

---

## 陷阱 6：`Get-ChildItem -Recurse` 在 C:\ 根目录极慢

**现象**：动态发现 `cli.bat` 时搜 `C:\` 全盘，可能跑几分钟。

**对策**：
```powershell
# 限定已知路径
Get-ChildItem -Path 'C:\Users\DC','C:\Program Files*' -Filter 'cli.bat' -Recurse -ErrorAction SilentlyContinue

# 加超时(后台 job)
$job = Start-Job { Get-ChildItem 'C:\' -Filter 'cli.bat' -Recurse -ErrorAction SilentlyContinue }
if (Wait-Job $job -Timeout 30) { Receive-Job $job } else { Stop-Job $job }
```

---

## 陷阱 7：PowerShell 5 不支持三元运算符

**错误**：
```powershell
$x = $a ? $b : $c
```

**对策**：
```powershell
$x = if ($a) { $b } else { $c }
```

---

## 陷阱 8：`~` 在路径里不展开

**错误**：
```powershell
Get-Content '~\.gitconfig'  # 找不到文件
```

**对策**：
```powershell
Get-Content "$env:USERPROFILE\.gitconfig"
```

---

## 快速检查清单（写 ps1 后必过）

1. ✅ 没有 `&&`（用 `; if ($?)`）
2. ✅ 文件保存为 UTF-8 with BOM **或** 全英文注释
3. ✅ 管道里没有 `[xxx.Method]` 开头（先存变量）
4. ✅ `ConvertTo-Json` 带 `-Depth 30`
5. ✅ 调用外部命令后判断 `$LASTEXITCODE`，不靠 PS 错误
6. ✅ `Get-ChildItem -Recurse` 限定路径
7. ✅ 没有三元运算符
8. ✅ 路径用 `$env:USERPROFILE` 不用 `~`

## 实测踩坑记录（2026-09-21）

- backup.ps1 第一次写：中文注释 + UTF-8 无 BOM → PS 5 GBK 乱码 → 语法错误，重写 3 次
- 最终方案：全英文注释 + UTF-8 无 BOM（PS 5 读纯 ASCII 无问题）
- `git push 2>&1` 报 NativeCommandError 但实际成功，靠输出里 `master -> master` 判断
- `$manifest | ConvertTo-Json | [IO.File]::WriteAllText` 报 pipeline 错，改为先存 `$json` 变量

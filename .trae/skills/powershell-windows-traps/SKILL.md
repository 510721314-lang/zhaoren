---
name: powershell-windows-traps
description: PowerShell 5 / Windows 脚本陷阱与对策（引号、中文乱码、管道、stderr 包装）。Use when 编写或运行 .ps1、遇到 Unexpected token / string is missing the terminator / 中文乱码 / NativeCommandError。Do not use for bash/Linux 脚本或小程序业务逻辑。
---

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

**zhaoren 项目约定**：新写 `.ps1` 建议注释/字符串全用英文（最稳）；**存量中文脚本不必重写**——按方案 A 直接加 UTF-8 BOM 即可（2026-10-10 manual-backup.ps1 实证：中文注释 + 无 BOM → ParserError，加 BOM 即修复，commit e2fa124）。输出给用户看的 `Write-Host` 消息可用中文。

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

## 陷阱 9：向 `curl.exe` 传内联 JSON 会被剥掉双引号（2026-11-11 实证）

**现象**：`curl.exe -d '{"action":"config_get"}'` 到服务端变成 `{action:config_get}`，返回 400 / 业务 `invalid_action`，且**不报 PowerShell 错误**，极像「接口挂了」。

**根因**：PowerShell 5 调用 native 程序时按 `NativeArguments` 重新拼命令行，单引号字符串里的内嵌双引号**不经转义就被吞掉**（与 bash 单引号语义不同）。反斜杠转义 `\"` 同样不可靠。

**对策（按优先级）**：
1. **写 JSON 到文件，用 `--data-binary "@<path>"`**（最稳，中文也不乱码）：
   ```powershell
   curl.exe -s -X POST -H "Content-Type: application/json" -H "X-Admin-Key: $h" `
     --data-binary "@C:\Users\DC\AppData\Local\Temp\body.json" "https://.../api"
   ```
2. **改用 Node + `fetch`**（脚本里 `JSON.stringify` 天然安全，适合需要断言/解析响应的核验）：
   ```powershell
   node -e "fetch(u,{method:'POST',headers:{...},body:JSON.stringify({action:'config_get'})})"
   ```
3. 临时文件用完即删，别留在仓库（`$env:TEMP` 下即可）。

**连带教训**：PowerShell 里用 `-match` 正则从 JSON 里抠字段极不可靠（贪婪/嵌套不符预期）→ **解析一律交给 Node `JSON.parse`**，Shell 只负责取原文。

---

## 陷阱 10：提示「后台命令仍在跑」≠ 命令真的在跑（2026-11-15 实证）

**现象**：会话提示 `timed_out_moved_to_background` / `Background command is still running`，据此一直等待，或不敢重跑。

**取证（只读）**：
```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*zhaoren*' } |
  Select-Object ProcessId, Name, CreationDate, CommandLine | Format-List
```

**判读**：只剩 MCP 常驻 `node`（`miniapp-mcp … cli.js`）、`wxfilewatcher_x64`、本命令自身 `powershell` → 原命令已结束；无 npm/node 的 `verify` / `test` 进程即无残留，可安全重跑。禁凭提示等待，禁不改参数重复同一命令。

---

## 陷阱 11：Node.js `spawn` + `shell:true` + 含空格/括号路径被 PowerShell 误解析（2026-11-16 实证）

**现象**：`node -e "spawn('C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat', [...], {shell:true})"` 报 `'C:\Program' is not recognized` 或 `x86 : 无法将"x86"项识别为 cmdlet`。

**根因**：① `shell:true` 时 spawn 把 cmd+args 拼成命令行字符串交给 cmd.exe，路径含空格必须加引号；② 在 PowerShell 命令行内联 `node -e "..."` 时，PowerShell 先解析脚本字符串，把 `(x86)` 当表达式求值、把 `\\` 转义吃掉，最终传给 Node 的字符串已损坏。

**修**：
1. **路径用引号包裹**：`const cli = '"C:\\Program Files (x86)\\...\\cli.bat"'`（spawn 的 cmd 参数本身带引号）
2. **内联 `node -e` 不可靠时，写独立 `.js` 文件再 `node xxx.js`**——避免 PowerShell 对字符串的二次解析（本次 `start-auto.js` 方案验证可行）

---

## 陷阱 12：PowerShell 管道中调用「文档」类脚本（无扩展名 node 脚本）报「无法在管道中间运行文档」（2026-11-16 实证）

**现象**：`& "C:\Users\DC\AppData\Roaming\npm\node_modules\@cloudbase\cli\bin\tcb" fn list | Select-String ...` 报 `无法在管道中间运行文档: ...\bin\tcb`（CantActivateDocumentInPipeline）。

**根因**：npm 全局包的 `bin/tcb` 是**无扩展名 node 脚本**，PowerShell 将其识别为「文档」而非可执行程序；「文档」不能在管道中激活（既不能 `&` 调用后再接管道）。

**修**：改用同名 `.cmd` 包装器——npm 全局 bin 目录同时提供 `tcb` / `tcb.cmd` / `tcb.ps1`，管道场景用 `tcb.cmd fn list ... | Select-String ...` 即可。

---

## 陷阱 13：npm 全局 `tcb` 命中 `tcb.ps1` 垫片报 PSSecurityException；密钥登录禁止命令行传参（2026-11-17 实证）

**现象**：①终端直接跑 `tcb ...` 报 `无法加载文件 ...\npm\tcb.ps1，因为在此系统上禁止运行脚本`（PSSecurityException）；②`tcb login --AKIDxxx`（含误敲成四横线）报 `unknown option`——密钥被 commander 当 option 解析且进了命令历史；③旧脚本硬编码 `C:\Users\Administrator\AppData\Roaming\npm\...` 在当前用户（DC）下 `Cannot find module`。

**根因**：npm 全局 bin 同时提供 `tcb.ps1` / `tcb.cmd` / 无扩展名 `tcb` 三种垫片，PowerShell 优先命中 `.ps1`（受执行策略限制）；`login --key` 的**裸位置参数**（如 `--AKIDxxx`）会被 commander 当 option 解析报 `unknown option`（合法参数形为 `--apiKeyId/--apiKey`，见 zhaoren-ops 坑位 #11，但凭据进命令历史，交互粘贴更安全）；跨用户/跨机器路径不可硬编码。

**修**：①直接调 **`tcb.cmd`**（绕过执行策略，零系统改动；`Set-ExecutionPolicy` 属系统配置变更不采用）；②密钥登录 `tcb.cmd login --key` 后在 `? 请输入秘钥 ID / 秘钥 Key` 提示处**交互粘贴**，密钥不写命令行；③脚本内全局包路径用 `$env:APPDATA` 派生（`%APPDATA%\npm\node_modules\@cloudbase\cli\dist\standalone\cli.js`）；KEY 文件路径见 zhaoren-ops 坑位 #15。

---

## 陷阱 14：`Set-Content/Out-File -Encoding UTF8` 叠加 BOM（2026-11-19 实证）

**现象**：`register-backup-tasks.ps1` 首 16 字节实测 `EF BB BF` 重复 4 份（BOM 叠加），脚本可能仍能跑但 BOM 异常；多次用 `-Encoding UTF8` 保存同一文件，BOM 份数逐次累加。

**根因**：PS5 的 `Set-Content -Encoding UTF8` / `Out-File -Encoding UTF8` 每次写入都**强制前置 `EF BB BF`，且不剥除文件已有前导 BOM**——与陷阱 2（无 BOM 乱码）配对：陷阱 2 缺 BOM，本陷阱 BOM 多份。

**对策**：
1. **还原**：`git checkout <file>` 回仓库单 BOM 版本（最干净）。
2. **写无 BOM 的 UTF-8**（`.md` / JSON 配置）：
   ```powershell
   [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false))
   ```
3. **写有 BOM 的 UTF-8**（中文 `.ps1`）——`$true` 会正确处理、不叠加：
   ```powershell
   [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($true))
   ```
4. **复检**：任何编辑/工具改写中文 `.ps1` 后，`Format-Hex <file> | Select-Object -First 1` 看前 3 字节，必须**恰好一份** `EF BB BF`（与 §25 / 陷阱 2 纪律一致）。

**对照**：JSON / `.md` 反之必须**无 BOM**，勿混淆（见 L269 实测记录）。

---

## 陷阱 15：递归删除含只读文件的目录报「访问被拒绝」（2026-11-19 实证）

**现象**：`[System.IO.Directory]::Delete($dir, $true)` 或 `Remove-Item $dir -Recurse -Force` 删备份/还原目录时报「对路径"LICENSE"的访问被拒绝」，目录删不掉。

**根因**：目录内含**只读属性**文件（从压缩包/备份还原的 `LICENSE`、`report.json` 等常带只读位），递归删除不自动清除只读属性即抛拒绝。

**对策（分级）**：
1. **先清只读再删**（首选）：
   ```powershell
   Get-ChildItem -Path $dir -Recurse -Force | ForEach-Object { $_.Attributes = 'Normal' }
   Remove-Item $dir -Recurse -Force
   ```
2. **仍失败 → robocopy 镜像空目录清空**（rc ≤ 7 视为成功，≥ 8 才真失败）：
   ```powershell
   $empty = Join-Path $env:TEMP ("empty_" + [guid]::NewGuid())
   New-Item -ItemType Directory -Path $empty -Force | Out-Null
   robocopy $empty $dir /MIR /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
   # rc∈{0..7} = 清空成功；然后 Remove-Item 空壳
   Remove-Item $empty -Force; Remove-Item $dir -Force
   ```
3. **大目录 robocopy 可能长时间跑**：放后台时按陷阱 10 用 `Get-CimInstance Win32_Process` 核对 robocopy 进程是否真在跑，禁凭提示等待。

---

## 陷阱 16：PS5 向 CLI 传 JSON 参数「三连坑」（`tcb db nosql execute --command` 等，2026-11-20 实证）

**现象**：给 `.cmd`/`.bat` CLI 传 JSON 命令参数（如 `tcb db nosql execute --command '[{"TableName":...,"Command":"{\"find\":...}"}]'`），无论哪种传法都报 `命令参数 JSON 解析失败: Expected property name or '}' in JSON at position ...`。

**三连坑**：① `ConvertTo-Json` 对单元素数组会被 PS5 解包成对象（输出缺 `[`）；② 内层 `\"` 反斜杠转义在 PS5→cmd.exe→Node 多层拼接中被逐层吞掉（here-string/`--%` 停止解析均救不了）；③ 陷阱 9 的 curl 对策只覆盖 `--data-binary` 场景，`--command` 这类**值参数**没有文件通道。

**对策（唯一稳定解）**：JSON 写文件 + Node 包装器以 spawnSync 数组参数直传（项目已有 `scripts/tcb-exec.js`，正是为此而生）：
```powershell
@'
[{"TableName":"admin_config","CommandType":"QUERY","Command":"{\"find\":\"admin_config\",\"filter\":{},\"limit\":1}"}]
'@ | Set-Content -Path $f -Encoding UTF8   # here-string 字面量落盘, 不经命令行
node scripts/tcb-exec.js $f --json
```
**判别口诀**：值参数要传 JSON（而非 stdin/body）→ 直接放弃命令行转义，走文件 + Node 数组传参。

---

## 陷阱 17：`Invoke-WebRequest` 拉中文内容返回假 False（编码静默错解，2026-11-20 实证）

**现象**：`(iwr $url).Content.Contains('履约中')` 返回 False，`$js.Length` 却正常（≈86 万）——极像「产物不对/功能没上线」，实为**编码错解**。

**根因**：响应头无 charset（Vite 产物 JS 常见）时 PS5 按默认编码（非 UTF-8）解码字节流，中文全部变成错码字符，`Contains`/`-match` 中文永远 False，且**不报任何错**。

**对策（唯一可靠解）**：
```powershell
curl.exe -s -o $tmp $url                                   # 字节流原样落盘
$js = [System.IO.File]::ReadAllText($tmp, [System.Text.Encoding]::UTF8)  # 显式 UTF-8 解码
$js.Contains('履约完毕确认中')                              # True
```
4. **字节级对比绕过编码（2026-11-25 补）**：断言「线上产物 == 本地 dist」时，用 Node `https` 拿响应 `Buffer` 算 SHA256 与本地文件比对（项目 `scripts/check-admin-web-live.js` 即此方案），完全绕开字符串解码，不受中文 / 编码影响。
**判别口诀**：`Content` 尺寸正常但中文匹配全 False → 先怀疑编码，再怀疑产物；拉中文内容一律 curl.exe 落盘 + 显式 UTF-8 解码，禁用 `Invoke-WebRequest .Content` 直接比对。

---

## 陷阱 18：PS5 文本工具读 UTF-8 中文 .md 给错误行数 / 搜不到中文（2026-11-22 实证）

**现象**：用 `Select-String` / `Get-Content | Measure-Object -Line` 读 `docs/deploy-log.md`、`docs/CHANGELOG.md` 等 UTF-8 中文文档，返回的**行数明显偏小**；`Select-String -Pattern "1.6.9"` **搜不到中文行里的关键词**。据此定位台账追加锚点会找错行、甚至误判文件末尾。

**根因**：PS5 的 `Get-Content` / `Select-String` 默认按系统 ANSI（GBK）解码**无 BOM 的 UTF-8** 文件，中文字节被错解 → 行分割失效（多行被并成一行）、中文正则匹配全 False，且**不报任何错**。与陷阱 17（IWR 拉内容编码错解）同根，只是发生在**本地文件读取侧**。

**对策**：读中文 docs / 定位行号 / 搜中文关键词，**一律用 Grep 工具（ripgrep）和 Read 工具**——它们正确处理 UTF-8：

```text
# 定位台账追加锚点（末尾追加，顶部是旧条目）——用 Grep 找关键词行号
Grep  pattern="v1.6.9"  path="docs/deploy-log.md"  output_mode=content  -n=true
# 读文件尾部确认最后一行内容
Read  file_path="docs/deploy-log.md"  offset=490  limit=10
```

**判别口诀**：PS5 读中文 `.md` 行数对不上 / 中文搜不到 → 先怀疑编码，换 Grep / Read 工具，别信 `Get-Content` / `Select-String` 的结果。

---

## 陷阱 19：`Select-String` 对超长单行字符串管道输入报 `InputObjectNotBound`（2026-11-25 实证）

**现象**：台账文件（`FUNCTION-REGISTRY.md` / `deploy-log.md`）的表格行常达上千字符，用 `$text | Select-String -Pattern $old` 统计/匹配某子串出现次数时报 `InputObjectNotBound`（ParameterBindingException），据此 `ABORT` 中断——但文件根本没被写，是工具参数绑定失败，不是内容不匹配。

**根因**：`Select-String` 接受管道输入时要求输入对象绑定到 `-InputObject`；单个超长字符串（数千字符）经管道传入时，PS5 的参数绑定器无法正确绑定。与陷阱 18（编码错解导致行数错 / 中文搜不到）**不同根**——陷阱 18 是解码错，本陷阱是绑定失败，即使编码正确也会触发。

**对策**：统计 / 匹配超长行内容，禁用 `$text | Select-String`，改用：
```powershell
$found = $text.Contains($old)                                          # 最简单，存在性
$occurrences = ([regex]::Matches($text, [regex]::Escape($old))).Count  # 计数
```
或直接用 **Grep 工具（ripgrep）** 定位行号 / 计数，它对超长行无此问题。

**判别口诀**：对单个超长字符串做子串统计 / 匹配 → 别走 `Select-String` 管道，用 `.Contains()` / `[regex]::Matches` 或 Grep 工具。

---

## 陷阱 20：Vite SPA 线上回读找不到懒加载 chunk——须从入口 bundle 二次解析（2026-11-25 实证）

**现象**：校验 admin-web 线上是否已部署某页面改动（如 Operations.vue 整合），从 `index.html` 提取所有 `<script src>` 里的 chunk 名，找不到目标 `Operations-*.js`，据此误判「没上线」。

**根因**：Vite SPA 路由懒加载的 chunk 名**不写在 index.html 里**，而是编码在入口 bundle（`index-*.js`）内部（异步加载清单 / `__vitePreload` 映射）。只解析 index.html 只能拿到入口和首屏 chunk，懒加载页面的 chunk 名全部漏掉。

**对策**：fetch `index.html` → 定位入口 `index-*.js` → fetch 入口 bundle → 用正则从入口源码解析全量 chunk 名（如 `/assets/([A-Za-z0-9_-]+\.js)/g`）→ 在全量集合里定位目标 → 断言指纹 + 可选 SHA256。项目 `scripts/check-admin-web-live.js` 已实现此二次解析逻辑。

**判别口诀**：Vite / SPA 线上找某个懒加载页面 chunk → 别只看 index.html，必须 fetch 入口 bundle 二次解析全量 chunk 名。

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
9. ✅ 提示「后台命令仍在跑」时先用 `Get-CimInstance Win32_Process` 枚举命令行核对
10. ✅ `node -e` 内联含空格/括号路径时，改用独立 `.js` 文件（避免 PowerShell 二次解析）
11. ✅ 管道中调用 npm 全局 CLI 用 `.cmd` 包装器（`tcb.cmd`），不用无扩展名 `bin/tcb`（「文档」不能在管道中激活）
12. ✅ 命中 `tcb.ps1` PSSecurityException 时改 `tcb.cmd`；密钥类凭据只在交互提示处粘贴（不写命令行）；脚本内全局包路径从 `$env:APPDATA` 派生
13. ✅ 中文 `.ps1` 改动后复检前 3 字节恰好一份 `EF BB BF`（禁多份叠加，见陷阱 14）
14. ✅ 删含只读文件的目录先清只读属性或用 robocopy `/MIR` 清空（rc ≤ 7 成功，见陷阱 15）
15. ✅ 读中文 `.md` 定位行号 / 搜中文关键词，用 Grep / Read 工具，不信 PS5 `Get-Content` / `Select-String`（行数会错、中文搜不到，见陷阱 18）
16. ✅ 对超长单行字符串（台账表格行）做子串统计 / 匹配，用 `.Contains()` / `[regex]::Matches` 或 Grep 工具，禁用 `$text | Select-String`（会报 `InputObjectNotBound`，见陷阱 19）
17. ✅ 断言「线上产物 == 本地 dist」用 Node https Buffer 算 SHA256 字节级对比（绕过 IWR 编码错解，见陷阱 17）；Vite SPA 找懒加载 chunk 须 fetch 入口 bundle 二次解析全量 chunk 名（见陷阱 20）

## 实测踩坑记录（2026-09-21）

- backup.ps1 第一次写：中文注释 + UTF-8 无 BOM → PS 5 GBK 乱码 → 语法错误，重写 3 次
- 最终方案：全英文注释 + UTF-8 无 BOM（PS 5 读纯 ASCII 无问题）
- `git push 2>&1` 报 NativeCommandError 但实际成功，靠输出里 `master -> master` 判断
- `$manifest | ConvertTo-Json | [IO.File]::WriteAllText` 报 pipeline 错，改为先存 `$json` 变量
- 2026-10-10 manual-backup.ps1（中文注释 + UTF-8 无 BOM）→ `Unexpected token` / `Missing terminator`（表象像语法错误，实为 GBK 乱码解析）→ 方案 A 加 BOM 修复（e2fa124）；对照：JSON 配置文件反之必须**无 BOM**，勿混淆
- 2026-10-13 二次实证（**BOM 会被后续编辑静默丢失**）：manual-backup.ps1 / restore.ps1 在 10-13 早间改动后丢 BOM → 整脚本 ParserError（备份链整体不可用；manual-backup 的 L6 CLI 旧路径同时会静默 SKIP）；修复=重加 BOM（f18d2d0）。**纪律：任何编辑/工具改写中文 .ps1 后，复检前 3 字节 = `EF BB BF`**；本次全仓扫描又补 6 个（.trae/predeploy.ps1、.trae/scripts/scan-miniprogram.ps1、_shared/sync-openid.ps1、_shared/sync-security-policy.ps1、scripts/build-admin-web.ps1、tests/ui-consistency.test.ps1）

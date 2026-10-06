# 云函数部署与 admin-web 前端重建 SOP

> 适用场景：云函数代码改动后需要重新部署才生效；admin-web 后台前端（Vue3 + Vite）改动后重新构建上线；确认/核对云函数、配置超时与定时触发器；排查「改了代码不生效」。

## 前置条件

- CLI 真实全路径（**旧 skill 文档里的 `C:\Users\DC\Desktop\...` 是旧机器残留，已废弃，勿用**）：
  `C:\Users\Administrator\Desktop\微信WEB开发者工具\cli.bat`（同目录 `微信开发者工具.exe`）
- 云环境 ID：`cloud1-d9gkefwcp5c777088`（唯一来源 `miniprogram/envList.js`，勿改）
- 项目根：`c:\zhaoren`（cloudfunctionRoot = `cloudfunctions/`）
- IDE 必须**已打开**且「设置 → 安全设置 → 服务端口」已开启；实际端口以 IDE 启动后 `%LOCALAPPDATA%\微信开发者工具\User Data\<实例哈希>\Default\.ide` 为准（当前 28023）
- 新装/拷贝 IDE 后必须先手动启动一次并登录，否则 CLI 报 `ENOENT ... Default\.cli`
- node/npm 必须在 PATH（重启后常不在 PATH，需先确认可用或用全路径）

## 步骤

### 1. 部署单个云函数（铁律：串行逐个，禁并发）

```powershell
$cli  = "C:\Users\Administrator\Desktop\微信WEB开发者工具\cli.bat"
$env_ = "cloud1-d9gkefwcp5c777088"
$proj = "c:\zhaoren"
& $cli cloud functions deploy --env $env_ --names <函数名> --project $proj --remote-npm-install
```

- `--remote-npm-install` = 云端安装依赖（铁律，禁止本地打包 node_modules 上传，Windows 路径分隔符 `\` 会导致云端 Linux `require` 找不到模块）
- 成功标志：输出表格该函数行 `success │ true` 且显示 packSize

### 2. 部署多个云函数（foreach 串行循环）

```powershell
$cli  = "C:\Users\Administrator\Desktop\微信WEB开发者工具\cli.bat"
$env_ = "cloud1-d9gkefwcp5c777088"
$proj = "c:\zhaoren"
foreach ($f in @("函数名1","函数名2")) {
  "===== DEPLOY $f ====="
  & $cli cloud functions deploy --env $env_ --names $f --project $proj --remote-npm-install 2>&1 |
    Select-String -Pattern "success|true|false|error|fail|packSize" | ForEach-Object { $_.Line }
}
```

- 并发部署会触发 `FailedOperation.UpdateFunctionCode 当前函数处于 Updating 状态`，必须等上一个 success 再下一个
- 单次 Shell 调用的 timeout 给足（多函数时 600000ms）

### 3. config.json 的 timeout/triggers CLI 不生效（必须控制台手工配）

CLI `deploy` **只上传代码，不应用函数目录下 config.json 里的 `timeout` 和 `triggers`**：

- **超时时间**：云开发控制台 → 云函数 → 函数名 → 函数配置 → 超时时间，改完读回校验：
  ```powershell
  & $cli cloud functions info --env $env_ --project $proj --names <函数名>
  # 看输出表格 timeout 列
  ```
- **定时触发器**：CLI 也不生效，需控制台「触发器」标签手动添加；验证期用云端测试手动 `{"action":"run"}` 连点推进
- config.json 仍保留记录期望值，但不要凭「已部署 config.json」就断定超时/触发器已生效；config.json 必须 UTF-8 无 BOM，用 `[System.IO.File]::WriteAllText` + `UTF8Encoding($false)` 写

### 4. admin-web 前端重建（先设 node PATH 再 build → 清空重拷 public → 部署 admin-web）

```powershell
# 1. 确认 node/npm 可用（重启后常不在 PATH）；再从 admin-web-frontend 构建
Set-Location c:\zhaoren\admin-web-frontend; npm run build

# 2. 清空旧 static 再拷入新 dist（静态文件由 admin-web 云函数 serveStatic 托管）
Remove-Item c:\zhaoren\cloudfunctions\admin-web\public\* -Recurse -Force
Copy-Item c:\zhaoren\admin-web-frontend\dist\* c:\zhaoren\cloudfunctions\admin-web\public\ -Recurse -Force

# 3. 部署 admin-web 云函数（带上 public）
$cli  = "C:\Users\Administrator\Desktop\微信WEB开发者工具\cli.bat"
& $cli cloud functions deploy --env cloud1-d9gkefwcp5c777088 --names admin-web --project c:\zhaoren --remote-npm-install
```

- 改 `admin-web-frontend/src/` 后**不重新 build + 部署**= 不生效；每次 build 后 chunk 文件名哈希变化（CDN 自然失效）

## 验证

- 部署后看 packSize 变化与 `functions list` 更新时间
- admin-web 验证：`GET https://<网关>/` 返回 `<!doctype html>`；`GET /assets/index-*.js` 应 200 且体积正常
- CLI **不能远程调用云函数**（只支持 deploy/list/info/download 等管理操作），业务验证走开发工具云端测试面板或小程序真机

## 坑

- `--remote-npm-install` 部署后等 90-120 秒再调用（云端 npm install 还在进行）
- 全量 `deploy` 可能不上传 `public/` 静态资源（首页/assets 全 404 但 /api 正常）→ 用增量补传：
  ```powershell
  & $cli cloud functions inc-deploy -e cloud1-d9gkefwcp5c777088 --path C:\zhaoren\cloudfunctions\admin-web --file public --project c:\zhaoren
  ```
- CLI 会把嵌套目录拍平成带反斜杠文件名（云端 `/var/user` 下出现 `public\index.html` 这种条目，真实 `public/` 目录不存在）→ admin-web `serveStatic` 用启动期 `STATIC_MAP` 兼容「正常目录 / 扁平化」两种布局，否则后台 `GET /index.html` 404
- `project.config.json` 的 `packOptions.ignore` 不能包含 `node_modules`（folder 级别会误杀云函数依赖）
- 提示 `Updating 状态` = 并发部署导致，改串行
- 免费体验版超时锁死 3 秒（控制台输入框灰），长流程需「每步落库 + 幂等 + 断点续跑」
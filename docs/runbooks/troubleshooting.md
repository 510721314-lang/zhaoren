# 坑位速查 SOP

> 适用场景：git push 卡死/超时、PowerShell 调网关报错、网关超时误判、图片直传 413、CloudBase HTTP 接入字段取不到、admin-web 静态 404、重启后 node/git 找不到。

## 前置条件

- 本机 Shell 为 Windows PowerShell 5.1（默认按 GBK 读 `.ps1`，不支持 `&&`）
- 网关端点：`https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api`

## 步骤（按症状查）

### 1. git push 被死代理拦截（127.0.0.1:7890）

- 根因：git 全局 `http.proxy`/`https.proxy` 指向未运行的 127.0.0.1:7890，每次远端操作白等约 20s
- 一次性直连绕过：
  ```powershell
  git -c http.proxy= -c https.proxy= push origin master
  # 仓库内用：git -C c:\zhaoren -c http.proxy= -c https.proxy= push origin master
  ```
- 恢复后清掉全局代理再推：`git config --global --unset http.proxy` / `git config --global --unset https.proxy`
- 检测：`curl` 测 github.com 数据面（恢复=200，受限=000 超时）；`api.github.com` 可作基准

### 2. PowerShell 无 heredoc / commit 报错

- bash `<<'EOF'` 在 PowerShell 报错 → git commit 用**单行 `-m`**：
  ```powershell
  git commit -m "type(scope): description"
  ```

### 3. PowerShell 调网关 JSON 值含空格 → no_action exit 3

- 根因：值中任何空格（如 reason 长句）在 PowerShell 传参时被截断 → 一律用**下划线无空格串**：
  ```powershell
  # 用 reason 用 no_space_underscore；干跑可用 config_bad_key 类拒绝码先探路径
  ```

### 4. 网关 2.5s 超时 ≠ 云函数失败

- 网关 3s 硬限 + 冷启动，`withTimeout(2.5s)` 返回 `gateway_timeout`/网关 504 **不代表目标函数失败**——超时后云端函数仍会执行完（实测 per=5 网关 504 但 45 条全部落库）
- 慢任务务必**幂等设计 + 可重试**，报错后先查实际数据再决定重跑

### 5. HTTP 网关请求体 100KiB 上限（图片直传 413）

- 网关(tcbgw)请求体约 100KiB（实测 98KB 通过 / 102KB 拒绝），经 `POST /api` 的 base64 图片直传都会 413
- admin-web 活动图上传已改为**前端 canvas 压缩**到 750×360 / 750×750 JPEG（base64≤90KB）内联直传；超限引导走「微信开发者工具 → 云开发 → 存储」上传后粘贴 `cloud://` 链接

### 6. CloudBase HTTP 云接入字段坑

- 查询参数字段是 `queryStringParameters`（无 `query`，直接 `req.query.key` 会抛异常 → `FUNCTIONS_INVOCATION_FAILED`）
- 集成响应必须用 `statusCode` 字段（误用 `status` 则所有错误响应退化为 HTTP 200）
- HTTP 触发事件实测 keys：`body, headers, httpMethod, isBase64Encoded, multiValueHeaders, path, queryStringParameters, requestContext`；serveStatic 不支持 `isBase64Encoded:true`

### 7. DevTools CLI 拍平打包 public\ 目录

- CLI 部署把嵌套目录拍平成带反斜杠文件名（云端 `/var/user` 下出现 `public\index.html` 这类条目，真实 `public/` 不存在），运行时 `__dirname=/var/user`，`GET /index.html` 404
- admin-web `serveStatic` 用启动期目录扫描 `STATIC_MAP` 兼容「正常目录 / 扁平化」两种布局

### 8. 重启后 node/git 不在 PATH

- 重启后 node/git 常不在系统 PATH → 需要用全路径调用；跑构建前先确认 `node -v` / `npm -v` 可用

## 验证

- push 后 `git status` / `master...origin/master` 无领先
- 网关报错先看 `$LASTEXITCODE`（0=成功），不要只看 PS 有没有报错（`2>&1` 会把 stderr 包成 NativeCommandError）

## 坑

- WXSS 不支持 `*` 通配选择器、子选择器、属性选择器（`* {}` 报 unexpected token 且上传失败）
- `data:image/svg+xml` 的 url() 内层属性只能用单引号、特殊字符 `%XX` 编码（外双内单）
- ridgrep 不支持 lookbehind/lookahead（`/pages/(?!v2)` 直接报错）
- 云函数间调用 OPENID 为空 → 用 `event.mock_openid` fallback；正则用 `db.RegExp` 且元字符转义（`'^\[种子]'`）
- 身份键一律 `user_account.openid`（不存在 `users._id=openid` 写法）
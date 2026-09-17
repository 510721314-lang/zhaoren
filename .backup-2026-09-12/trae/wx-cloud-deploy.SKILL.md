---
name: "wx-cloud-deploy"
description: "Deploy WeChat CloudBase cloud functions for the zhaoren mini program via DevTools CLI (serial, remote npm install) and verify. Invoke when user asks to deploy/upload 云函数, redeploy after cloud function code changes, or verify deployment status."
---

# 微信云函数 CLI 部署与验证（找人帮忙项目）

本项目（c:\Users\DC\Desktop\zhaoren，微信原生小程序 + CloudBase；2026-09-12 前旧路径 h:\zhaoren 已废弃）云函数改动后**必须重新部署才生效**。本 skill 固化已验证的命令行部署链路，替代手动右键上传。

## 环境事实（已确认，勿再探测）

- IDE 实际安装路径（2026-09-12 起唯一可信）：`c:\Users\DC\Desktop\微信WEB开发者工具\cli.bat`（同目录 `微信开发者工具.exe`）
  - H 盘旧 IDE（`H:\微信WEB开发者工具`）已不存在；`C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat` 为旧装残留，**不要使用**，避免多实例端口漂移。
  - 新装/拷贝后必须先手动启动一次 IDE（创建 User Data 目录并登录），否则 CLI 报 `ENOENT ... Default\.cli` / `Please ensure that the IDE has been properly installed`。
- 云环境 ID：`cloud1-d9gkefwcp5c777088`（唯一来源 miniprogram/envList.js，勿改）
- 项目根：`c:\Users\DC\Desktop\zhaoren`（cloudfunctionRoot = cloudfunctions/）
- 前置条件：IDE 已打开且「设置 → 安全设置 → 服务端口」已开启。实际端口以 IDE 启动后的 `.ide` 文件内容为准：`%LOCALAPPDATA%\微信开发者工具\User Data\<实例哈希>\Default\.ide`（旧实例残留的 58449 不可信；若 CLI 报 "please restart developer tools / auto testing" 类错误，提示用户检查该开关）。

## 部署命令（PowerShell）

**铁律：云函数必须一个一个串行部署**。并发部署会触发 `FailedOperation.UpdateFunctionCode 当前函数处于 Updating 状态`。用 foreach 串行循环：

```powershell
$cli = "c:\Users\DC\Desktop\微信WEB开发者工具\cli.bat"
$env_ = "cloud1-d9gkefwcp5c777088"
$proj = "c:\Users\DC\Desktop\zhaoren"
foreach ($f in @("函数名1","函数名2")) {
  "===== DEPLOY $f ====="
  & $cli cloud functions deploy --env $env_ --names $f --project $proj --remote-npm-install 2>&1 |
    Select-String -Pattern "success|true|false|error|fail|packSize" | ForEach-Object { $_.Line }
}
```

- `--remote-npm-install` = 右键菜单的「上传并部署：云端安装依赖」，云函数仅依赖 wx-server-sdk，用此模式。
- 成功标志：输出表格中该函数行 `success │ true`，并显示 packSize。
- 单次 Shell 调用 timeout 给足（多函数时 600000ms）；循环内串行即不会冲突。
- 不要用 `--names a,b` 一次传多个后再并发别的调用；循环内逐个最稳。

## 云函数清单（名字必须精确）

正式 15 个：user-login、demand-publish、demand-match、partner-apply、partner-action、order-create、order-action、order-timer、payment-mock、safety-report、im-conv、im-send、evaluation-submit、admin-action、init-db
临时自测 1 个（验收后删除）：zz-selftest-timer

### config.json 不生效（重要，已实测确认）

CLI `deploy` **只上传代码，不会应用函数目录下 config.json 里的 `timeout` 和 `triggers`**（多次部署后 `functions info` 仍显示 timeout=3，定时触发器整夜不触发即为此因）。因此：
- **超时时间只能在云开发控制台手动改**：云函数 → 点函数名 → 函数配置 → 超时时间。改完用下面命令读回校验，别假设已生效：
  ```powershell
  & $cli cloud functions info --env $env_ --project $proj --names 函数名
  # 看输出表格的 timeout 列
  ```
- **免费体验版超时锁死 3 秒**（控制台输入框灰色不可改），需升级套餐；3 秒是 callFunction 硬上限。无法升级时的代码对策：无依赖的 DB 读用 `Promise.all` 并行；长流程拆成"每步落库 + 幂等 + 断点续跑"（zz-selftest-timer 是范本）。
- **定时触发器（timer triggers）CLI 也不生效**，需在控制台「触发器」标签手动添加；不能假设定时器会自动跑，验证阶段用云端测试手动 `{"action":"run"}` 连点推进。
- config.json 仍要保留（记录期望值、控制台配置的依据），但**不要在对话里声称"已部署 config.json 所以超时=60"**——必须以控制台/info 实际值为准。
- config.json 必须 **UTF-8 无 BOM**：用 `[System.IO.File]::WriteAllText` + `UTF8Encoding($false)` 写；PowerShell `Set-Content -Encoding UTF8` 会带 BOM 导致 JSON 解析失败。

## 部署后验证

1. **CLI 不能远程调用云函数**（只支持 deploy / functions list / logs 等管理操作）。业务验证只能：
   - 云开发控制台 → 云函数 → 云端测试面板（用户手动粘贴入参），或
   - 小程序模拟器/真机前端操作。
2. 给用户云端测试入参时必须**完整可直接粘贴**，含 `mock_openid` 字段（测试面板无独立 OPENID 输入框）：
   - 身份取值模式：`const openid = wxCtx.OPENID || event.mock_openid`（部分函数写法相反，等价）。新增/改动云函数必须保留此模式。
   - 测试身份：发布者 `oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c`（易错字符 Yy_6yN5MrxhVl）；耍伴测试号 `test_partner_001`。
3. 入参中的订单/需求标识用**文档 _id（32 位十六进制）**，不是业务单号（ORD/DR/PAY 开头）。查 _id 用 my_orders / my_demands。5 个函数（order-action、payment-mock、evaluation-submit、order-create、demand-publish）已加 `isValidDocId` 预检，非法 ID 返回 `*_bad_order_id` / `*_bad_demand_id`。
4. 状态机测试后提醒：测试面板保留上次入参，重复点「运行测试」会产生幂等/状态拒绝返回（如 idempotent:true、oa_not_confirmable），属正常防重，不是 bug。

## 排障速查

- `please open and restart developer tools` / 自动确认失败 → 服务端口未开或用错了旧装 cli.bat；统一改用桌面路径 `c:\Users\DC\Desktop\微信WEB开发者工具\cli.bat` 并让用户检查开关。
- `Please ensure that the IDE has been properly installed` / `ENOENT ... Default\.cli` → 新装 IDE 从未启动过，User Data 目录未创建；先手动打开一次 `微信开发者工具.exe` 并登录，再用 CLI。
- `Updating 状态` 冲突 → 并发部署导致；改为串行 foreach，等上一个 success 再下一个。
- 改了代码"不生效" → 99% 是没重新部署；部署后看 packSize 变化与 functions list 的更新时间。
- 云端测试 `未知动作` → 测试面板顶部的函数名与入参 action 不匹配（如在 payment-mock 面板发 confirm_all）；切到对应函数面板。
- 云端测试返回 `{"errorCode":-1,"errorMessage":"Invoking task timed out after 3 seconds","statusCode":433}` → 函数硬超时 3 秒被杀。根因不是代码死循环，而是 CLI 部署不应用 config.json 的 timeout（见上文「config.json 不生效」）。处置：①控制台把该函数超时调大并 `functions info` 读回确认；②若免费版锁死 3 秒，则把函数内 DB 读并行化、长流程改为每步落库+幂等续跑。典型受害：冷启动的 demand-publish/detail、跨函数编排的 zz-selftest-timer（表现为"单据可能已落库但进度没存"，复用逻辑要能捞回半成品）。
- 定时函数"整夜没跑/状态冻结" → CLI 不应用 config.json 的 triggers；去控制台「触发器」手动添加，或验证期手动连点 run。
- `该需求已不可接单`（自测/重复接单时）→ 上一次 create_from_take 已把 demand 置 matched、order 已建，但调用方因超时没拿到响应而重发。复用方应先查库捞回已建订单，而不是再次接单。

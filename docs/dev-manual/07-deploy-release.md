# Ch7 · 部署与发布流程

> 事实来源：`.predeploy/`、`scripts/`、[cloudbaserc.json](file:///c:/zhaoren/cloudbaserc.json)（含 envId，勿外传）、既有部署约定。

## 7.1 部署工具与凭据

- 部署 CLI（开发者工具）：`c:\Users\DC\Desktop\微信WEB开发者工具\cli.bat`。
- 环境 ID 从 [cloudbaserc.json](file:///c:/zhaoren/cloudbaserc.json) 读取（**手册不写明文**）。
- 云端读取用 `tcb`（@cloudbase/cli）或 devtools CLI；`tcb fn detail <name> --env-id <env>` 可读函数配置（timeout/触发器/代码大小）。

## 7.2 云函数部署（串行）

**必须串行部署**，一次只部署一个函数（不可逗号拼接多个名称），部署后等待 90–120s 再 `functions info` 读回校验：

```
C:\Users\DC\Desktop\微信WEB开发者工具\cli.bat cloud functions deploy ^
  --env <envId> --names <单个函数名> --project C:\zhaoren --remote-npm-install
```

要点：

- `--remote-npm-install`：在云端安装依赖（`wx-server-sdk` 等）。
- **`deploy` 只上传代码，不应用 `config.json` 的 `timeout`/`triggers`**。`config.json` 仅作「期望值台账」，由 `check-deploy-config.js` 做漂移比对。
- 一次性批量部署易触发限流/凭据问题，故坚持串行。

## 7.3 触发器更新（独立通道）

云函数触发器**不能**靠 `deploy` 生效，需通过其一：

1. **miniprogram-ci 程序化更新**（如 [scripts/create-warmup-trigger.js](file:///c:/zhaoren/scripts/create-warmup-trigger.js)）——受微信公众平台 **「小程序代码上传」IP 白名单**限制，未加白名单会报 `-10008 invalid ip`。
2. **云开发控制台手动修改**触发器配置。

> 当前 `order-timer` / `zz-warmup` 均为 `0 */5 * * * * *`。改触发器须**三处同步**：`config.json`、创建脚本中的 CRON 常量、控制台实际值。

## 7.4 后台管理端（admin-web）发布流程

admin-web 不是独立站点，而是云函数内的静态托管 + HTTP 网关：

1. 设置 node 路径：`$env:PATH="C:\Program Files\nodejs;"+$env:PATH`。
2. 构建并同步产物：`powershell -File scripts/build-admin-web.ps1`（`npm run build` → 清空并复制 `dist/*` 到 [cloudfunctions/admin-web/public](file:///c:/zhaoren/cloudfunctions/admin-web)）。
3. 部署 `admin-web` 云函数（见 7.2）。

> `public/` 构建产物已出库（`.gitignore`），**部署前必须重新构建**，否则线上为旧产物。

## 7.5 小程序端发布

1. 清缓存 + 重新编译（避免旧编译产物误导真机验证）。
2. 上传体验版 → 真机二维码预览验证。
3. 提审：遵守 [Ch5 §5.7](file:///c:/zhaoren/docs/dev-manual/05-redlines.md) 提审策略（范围收敛、验收标准达成）。

> **IDE 白屏/陈旧产物辨识**：模拟器可能渲染陈旧编译产物（源码中存在的输入框在模拟器不显示），而真机正常。定性顺序：① 确认云端是否已部署该改动 → ② 看真机是否正常 → ③ 均指向 IDE 侧则「关闭项目 → 重新打开 C:\zhaoren → 重新编译」。**不得据模拟器现象判定代码回归**。

## 7.6 部署后验证

- `powershell -File scripts/check-heartbeat.ps1`（读 `AWK_KEY`，无需日志通道）——部署后空转验证。
- 网关写操作返回 `gateway_timeout`（admin-action 冷启动哨兵）**≠ 执行失败**：可能已落库，遇超时先复核（查流水/读数值）再决定重试，防重复执行。
- 注意：`tcb fn log` 在本环境取不到日志，排障依赖云函数自身输出与手机端实收结果。

## 7.7 常见故障速查

| 现象 | 根因 | 处置 |
|---|---|---|
| 批量部署报 `40001 invalid credential` / 需重新登录 | IDE 登录凭据失效 | `cli login -f image -o <png> -r <json>` 扫码重登（`cli islogin` 可能假阳性） |
| 触发器更新报 `-10008 invalid ip` | 本机公网 IP 未加「代码上传」白名单 | 加白名单或控制台手改 |
| 云调用报 `-501001 INVALID_WX_ACCESS_TOKEN` | 非小程序端触发（定时器/网关/CLI），无小程序上下文 | 改 HTTPS API 或改由小程序端触发路径发送 |
| `Cannot find module 'wx-server-sdk'` | 未 `--remote-npm-install` 或依赖缺失 | 重新部署并云端装依赖 |

## 7.8 备份与密钥

- **收工备份**：三重备份——git bundle + robocopy 热备 + 云端 DB 导出；备份文件统一存 `c:\zhaoren-bak`。每次备份后须逐一核查所有备份通道可用性。
- DB 导出通道：`backup.ps1` AdminKey 未配置时，用 `force_set_env dev` + `mock_openid=管理员` → `fn invoke admin-action export_collection` 分页导出（白名单校验在 admin-action 内）。
- 密钥轮换：`node scripts/rotate-admin-key.js` 生成合规密钥 + `node scripts/rehearse-key-rotation.js` 演练；`phone_hash` 需随密钥同步重算。

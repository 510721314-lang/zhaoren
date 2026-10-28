# 提审备案类配置填报清单（A6）

> 适用：小程序 `1.6.59`（2026-10-28 上传；当前提审候选版本）｜事实来源＝仓库代码实测（`miniprogram/app.json`、`pages-v2/**`、`config/index.js`、`cloudfunctions/admin-action/action_config_set.js`）｜本文只描述「在 mp/云开发后台要填什么、怎么填、填错会怎样」，不含代码改动。

## 0. 总览（5 项，按填报顺序）

| # | 后台位置 | 项 | 阻塞提审 | 预估耗时 |
|---|---|---|---|---|
| F1 | mp 后台 → 设置 → 服务内容声明 → 用户隐私保护指引 | 隐私保护指引 | **是**（未通过则无法提审） | 20 min |
| F2 | mp 后台 → 开发 → 开发管理 → 接口设置 | `getLocation`/`chooseLocation` 权限申请 | **是**（未开通则位置功能报错） | 10 min + 审核 |
| F3 | mp 后台 → 功能 → 订阅消息 | **3 个**订阅模板（`demand_grab`/`demand_urge`/`confirm_comm`） | 否（缺则静默不推送） | 15 min |
| F4 | mp 后台 → 开发 → 开发管理 → 服务器域名 | request 合法域名 | **是**（缺则真机请求被拦） | 5 min |
| F5 | 云开发控制台 + `admin_config` | HTTP 网关与密钥白名单 | 否（仅影响后台） | 10 min |

---

## F1 隐私保护指引

### 需填报的信息类型（依代码实测逐一对应）

| 信息类型 | 触发 API（代码位置） | 用途文案建议 | 必填 |
|---|---|---|---|
| **位置信息** | `wx.getLocation`（`demand-detail.js:77`、`nearby-map.js:56/98`、`order-detail.js:610/696`、`partner-detail.js:121`、`safety.js:154/275`）<br>`wx.chooseLocation`（`chat.js:600`、`partner-apply.js:47`、`accept-config.js:341`） | 用于展示附近需求、计算履约距离、安全报备与位置选点 | **是** |
| **相册/摄像头（图片）** | `wx.chooseMedia`（`blog-publish.js:71`、`partner-profile-edit.js:217`、`no-show-report.js:65`） | 用于上传头像、发布图文、提交爽约凭证 | **是** |
| **证件信息（姓名、身份证号）** | `pages-v2/pkg-low/realname`（`form.real_name` / `form.idcard`，AES-256-GCM 加密落库） | 用于耍伴实名认证与纠纷取证 | **是** |
| **手机号** | 代码未调用 `getPhoneNumber`（**当前不采集**） | — | 否 |
| **微信 OpenID** | 云开发登录态（`cloud.getWXContext()`） | 用于账号识别与订单归属 | **是** |

### 坑点（必读）

1. **`requiredPrivateInfos` 与隐私指引必须一致**：`app.json` 已声明 `getLocation, chooseLocation`；若指引里漏填「位置信息」，提交会被驳回并提示接口未声明。
2. **选填项不要多填**：未实际采集的信息（如手机号）若勾选，需提供采集证据，反而增加驳回面。
3. **`chooseMedia` 无需写进 `requiredPrivateInfos`**，但**必须**在隐私指引勾选「相册/摄像头」，否则首次调用会直接失败（`chooseMedia:fail api scope is not declared`）。
4. **指引更新有生效延迟**：提交后约 5–30 分钟生效，**不要在生效前上传提审包**，否则审核侧读到旧版本。
5. **联动**：指引版本变更不影响 `privacy` 页文本，但两者口径必须一致（`pages-v2/privacy/privacy.wxml` 为端内展示版）。

---

## F2 接口权限申请（`wx.getLocation`）

- 位置：mp 后台 → 开发 → 开发管理 → **接口设置** → 位置接口。
- 需填：**申请理由**（建议模板）：
  > 本小程序为同城到家服务平台：① 展示用户附近的可接需求（按距离排序）；② 计算服务者与需求方的履约距离；③ 服务过程中的安全报备与位置共享。位置信息仅在用户主动触发时获取，不后台持续定位。
- 需上传：**功能截图**（建议提供 3 张：附近需求列表 / 需求详情中的距离提示 / 安全报备页）。

### 坑点

1. **`chooseLocation` 属于同一权限族**，`getLocation` 通过后通常一并可用；但若审核只批 `getLocation`，`chooseLocation` 仍需单独在指引中声明。
2. **代码已有降级**：`safety.js:150` 在 API 被拒时停止轮询并显示降级 banner——**这不是免责**，审核仍会因「未开通权限」驳回。
3. **审核周期**：通常 1–3 个工作日，**必须在提审前完成**，否则提审包内位置功能直接不可用。

---

## F3 订阅消息模板（3 个）

### 需选用/申请的模板

| 键（`admin_config.sub_msg_templates`） | 场景 | 模板类目建议 | 代码位置 |
|---|---|---|---|
| `demand_grab` | 抢单通知（需求被接单/有新需求） | 生活服务 → 订单状态通知 | `miniprogram/config/index.js:73`（SSOT 由 `config_public.sub_msg.demand_grab` 覆盖） |
| `demand_urge` | 催单提醒（超时未确认/即将超时） | 生活服务 → 服务提醒 | `accept-config.js:170`（`urgeCloudSub`） |
| `confirm_comm` | 确认完成/结算提醒 | 生活服务 → 订单状态通知 | `order-timer` 提醒段（G3 超时提醒同链路） |

> 服务端键白名单 `TMPL_WHITELIST = ['demand_grab','demand_urge','confirm_comm']`（`cloudfunctions/admin-action/action_config_set.js`）——不在白名单内的键写了也不生效。

> **核实记录（2026-10-28，TCB 只读 QUERY `admin_config._id=global`）**：三键 `tmpl_id` 均已写入、均 `miniprogram_state=trial`，第 6 节已勾选。**注意两点**：①`demand_grab` 由 `order-timer` 定时触发发送，无小程序上下文 → 云调用必报 `-501001 invalid wx openapi access_token`（`demand.sub_msg_send_logs` 最近记录全为 `fail/-501001`），属既定设计：自动链路降级站内 `system_notice`，不影响提审；②`demand_urge`/`confirm_comm` 由小程序端 `order-action` 触发（有上下文），但需耍伴 `partner_profile.sub_msgs.<key>.authorized=true`，**发送实效待真机回归验证**（走一次手动催办 + 一次四确认）。

### 填报步骤

1. mp 后台 → 功能 → 订阅消息 → 我的模板 → 从公共模板库选用上表三个模板，或申请自定义模板。
2. 复制 `template_id`，**通过运营配置页写入**（有 `config_history` 审计；不要用临时脚本直写 DB）：
   ```json
   { "sub_msg_templates": { "demand_grab": { "tmpl_id": "…", "enabled": true }, "demand_urge": { "tmpl_id": "…", "enabled": true }, "confirm_comm": { "tmpl_id": "…", "enabled": true } } }
   ```
3. **`miniprogram_state` 保持 `trial`，正式发布日再切 `formal`**（T-7.12）。

### 坑点（高频）

1. **字段映射顺序必须与代码一致**：订阅消息的 `data.key1/key2…` 与模板字段名强绑定，字段名/顺序不一致会返回 **`47003`（argument invalid）**，且**用户已授权也发不出**。
2. **一次性订阅 ≠ 长期订阅**：本项目走 `wx.requestSubscribeMessage` **一次性订阅**（每次授权只可发 1 条）；不要用「长期订阅」口径向审核承诺「持续推送」。
3. **`trial` 状态下用户收不到正式版推送**：体验版测试需用体验成员账号，且模板状态为试用；切 `formal` 前不要对外宣称「可收通知」。
4. **不要向 `order-timer` 云函数发配置**：配置写入唯一入口是 `admin-action`（`order-timer` 有硬鉴权门，写配置会得 `ot_forbidden`）。

---

## F4 服务器域名（request 合法域名）

### 需配置

| 类型 | 域名 | 说明 |
|---|---|---|
| **request 合法域名** | `https://apis.map.qq.com` | 唯一外部请求域名（腾讯位置服务，用于地址解析/距离计算） |
| uploadFile / downloadFile | **无需配置** | 走云开发 `wx.cloud.uploadFile`（fileID 通道），不计入域名白名单 |
| socket 合法域名 | **无需配置** | 代码无 `wx.connectSocket` |
| 业务域名 / 跳转小程序 | **无需配置** | 无 webview、无跨小程序跳转 |

### 坑点

1. **云开发 HTTP 网关地址不要填进 request 域名**：`cloud1-xxx.app.tcloudbase.com` 属云开发通道，且本项目后台网关仅供 admin-web 使用，**小程序端不直连**。
2. **开发工具「不校验合法域名」会掩盖问题**：真机必现 `request:fail url not in domain list`；提审前必须**关闭该校验**做一次真机自测。
3. **域名变更需重新下载配置**：mp 后台改域名后，开发者工具需「详情 → 域名信息 → 刷新」。
4. **`apis.map.qq.com` 需配 key 白名单**：腾讯位置服务控制台需把该小程序 AppID 加入 key 白名单，否则返回 `INVALID_REQUEST`。

---

## F5 后台网关与密钥白名单

| 项 | 值/位置 | 说明 |
|---|---|---|
| `admin_web_key` | `admin_config.global.admin_web_key` | 形如 `AWK-` + 64 位 hex（长度 68），由 `generate_admin_web_key` 生成 |
| `admin_openids` | `admin_config.global.admin_openids` | 管理员 OPENID 白名单（权限信任根）；为空时首位调用者自动成为管理员（bootstrap） |
| HTTP 访问服务 | 云开发控制台 → 环境 → HTTP 访问服务 | 需开启并绑定 `admin-web` 云函数路径 `/api` |

### 坑点

1. **`admin_openids` 为空即 bootstrap 开放**：若线上清空该数组，任意首个调用者都能拿到管理员身份 → **提审前务必确认非空且为真实管理员 OPENID**（A5）。
2. **`admin_web_key` 泄露即等同后台全权限**：只在 `X-Admin-Key` 头使用，禁止写入前端代码或日志；轮换见 `key-rotation.md`。
3. **网关 2.5s 代理硬限**：冷启动会触发 `gateway_timeout`，属预期；运营侧操作间隔 ≥ 3s 重试。

---

## F6 提审说明（支付 Mock 如实描述）

> 决策（2026-10-21 用户拍板）：**支付侧保持 mock**，不做真实微信支付。提交审核时必须在「版本描述/测试说明」中如实说明，避免以「已接入支付」误导审核。

**版本描述建议文案（可直接粘贴）**：

```text
本版本为生活服务撮合平台首版，仅提供信息发布与撮合、站内沟通、履约记录功能。
当前版本的支付与结算均为平台内部记账演示（不调用微信支付、不产生真实扣款）：
- 订单中的金额仅用于双方线下自行协商参考，平台不代收、不代付；
- 页面内「支付/结算」类操作仅更新订单状态，不涉及资金流转；
- 正式收款能力将在后续版本接入微信支付后开放，届时另行提交审核。
请审核同学在体验时无需进行任何实际支付操作。
```

**测试路径（供审核复现）**：

1. 登录 → 实名认证（证件信息仅加密存储，用于身份核验）；
2. 发布需求 → 在广场查看 → 使用另一个账号接单；
3. 订单详情内完成「确认开始/确认完成」等状态操作（全程无真实扣款）。

**注意**：

- 严禁在提审材料中写「已接入微信支付/支持在线支付」等与事实不符的表述；
- `admin_config.global.mock_payment_enabled=true` 为当前既定状态，提审期间**不要改**（改后前端无真实支付通道可用，反而造成审核侧功能异常）；
- 后续接入真实支付属独立版本：需商户号、支付资质、回调与对账链路，单独排期与提审。

---

## 6. 提审前逐项验收（勾选）

- [ ] F1 隐私保护指引已提交且**状态为「已通过」**
- [ ] F1 指引勾选项 = 位置 / 相册摄像头 / 证件信息 / OpenID（**不含手机号**）
- [ ] F2 位置接口权限显示「已开通」
- [x] F3 **三个**模板 `tmpl_id` 已写入 `sub_msg_templates`（2026-10-28 实测：`demand_grab`=`x1TfKgMBQCa2PpfpW10AVewcaFfm8BfuPCKOLk2Dx3Q`、`demand_urge`=`-JfmHqHsI_q3qZHy_yrJloS_a8Xr3uez18YqD041hmg`、`confirm_comm`=`9j-D9hF_b4AMdHqcxsXjEOex0b7t61ZNfM1YGhT-n6o`；库中无 `enabled` 字段，`admin-action/action_config_public.js` 以 `tmpl_id` 存在即下发 `enabled:true`，口径等价）
- [x] F3 `miniprogram_state` 仍为 `trial`（2026-10-28 实测三键均 `trial`；正式发布日再切）
- [ ] F4 request 域名含 `https://apis.map.qq.com`，开发者工具「不校验合法域名」**已关闭**并真机自测通过
- [x] F5 `admin_openids` 非空且为真实管理员 OPENID（2026-10-22 只读实测：2 条，`oLDJ***Tw9c`/`oLDJ***LPA4`，非 bootstrap 开放态）
- [x] F5 `admin_web_key` 为 `AWK-`+64hex，未出现在任何前端文件（2026-10-22 实测：线上 68 字符；全仓 grep + `miniprogram/` + `admin-web/public/` + `admin-web-frontend/src|dist` 共 0 命中；明文仅存于仓库外 `C:\zhaoren-bak\admin-key-20261009.txt`）
- [x] 冒烟 `smoke-check.ps1` = **SMOKE ALL PASS**（2026-10-22 复跑：6/6 PASS，`SMOKE_EXIT=0`，含 `config_public` 4 项 + `home_probe` 2 项）

## 7. 坑位速查（症状 → 根因）

| 症状 | 根因 | 处置 |
|---|---|---|
| 首次进页面 `chooseMedia:fail api scope is not declared` | 隐私指引未勾「相册/摄像头」 | 回 F1 补勾 |
| 真机 `getLocation:fail auth deny` 或直接无响应 | 接口权限未开通 | 回 F2 申请 |
| 订阅消息返回 `47003` | 模板字段名/顺序与代码不一致 | 对照模板字段重排 `data` 键 |
| 订阅消息返回 `43101` | 用户未授权或授权次数用尽 | 重新引导 `requestSubscribeMessage` |
| 订阅消息能发但用户收不到 | `miniprogram_state=trial` | 发布日切 `formal` |
| 真机 `request:fail url not in domain list` | request 域名未配或未刷新 | 回 F4 |
| 后台 401 `bad_key` | `admin_web_key` 不一致 | 核对 `admin_config.global.admin_web_key` |
| 任意人能进后台 | `admin_openids` 为空（bootstrap） | 回 F5 补白名单 |

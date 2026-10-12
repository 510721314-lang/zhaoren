# Ch1 · 系统总览与运行拓扑

> 事实来源：`miniprogram/app.json`、`project.config.json`、`cloudfunctions/`、`admin-web-frontend/`、`scripts/`（详见 [00-factbase.md](file:///c:/zhaoren/docs/dev-manual/00-factbase.md)）。

## 1.1 系统由三端 + 一朵云组成

| 组成部分 | 位置 | 技术栈 | 说明 |
|---|---|---|---|
| 小程序端 | [miniprogram/](file:///c:/zhaoren/miniprogram) | 原生微信小程序（无框架） | 面向 C 端用户与耍伴（接单人），19 个主页 + 4 个分包 |
| 后台管理端 | [admin-web-frontend/](file:///c:/zhaoren/admin-web-frontend) | Vue 3.5 + Vite 8 + Element Plus 2.14 | 运营/审核/财务后台 SPA |
| 云函数层 | [cloudfunctions/](file:///c:/zhaoren/cloudfunctions) | 微信云开发（Node.js） | 20 个业务云函数 + `_shared` 规范源 |
| 云开发后端 | 微信云开发环境 | 云数据库 / 云存储 | 数据集合、文件存储、定时触发器 |

关键点：**没有传统自建服务器**。后台管理端不是独立部署的站点——它被构建为静态资源后，托管在云函数 `admin-web` 的 `public/` 目录里（见 [build-admin-web.ps1](file:///c:/zhaoren/scripts/build-admin-web.ps1)）。

## 1.2 运行拓扑

```
                    ┌──────────────────────────────┐
   小程序端          │  miniprogram/ (原生小程序)     │
   (C 端用户/耍伴)   │  pages-v2 (19 主页) + 4 分包   │
                    └───────────────┬──────────────┘
                                    │ wx.cloud.callFunction
                                    │ 统一经 utils/cloud.js → app.cloudCall
                                    ▼
   ┌────────────────────────────────────────────────────────────┐
   │                    微信云开发环境                             │
   │                                                            │
   │  ┌─────────────── 业务云函数 (20) ───────────────┐           │
   │  │ user-login / home-action / demand-publish     │           │
   │  │ order-create / order-action / order-timer     │           │
   │  │ payment-mock / im-conv / im-send / blog-action│           │
   │  │ partner-action / partner-apply / safety-report│           │
   │  │ evaluation-submit / demand-match / init-db    │           │
   │  │ evaluation… / admin-action / zz-warmup 等      │           │
   │  └───────────────────┬───────────────────────────┘           │
   │                      │ require('./<module>')（本地副本）      │
   │              ┌───────┴────────┐                              │
   │              │ _shared 规范源  │  ← SHA 门禁强制一致          │
   │              └────────────────┘                              │
   │                                                            │
   │  ┌──────────── 云数据库 ────────────┐  ┌──── 云存储 ────┐     │
   │  │ admin_config / order_main / …    │  │ 图片/证据文件   │     │
   │  └─────────────────────────────────┘  └───────────────┘     │
   │                                                            │
   │  ┌── admin-web (HTTP 网关 + 静态托管) ──┐                     │
   │  │  /public  ← admin-web-frontend 构建产物│                    │
   │  │  HTTP path 路由 → 代理 admin-action    │                    │
   │  └───────────────┬─────────────────────┘                     │
   └──────────────────┼──────────────────────────────────────────┘
                      │ HTTPS + X-Admin-Token
                      ▼
              ┌───────────────────────────┐
              │ admin-web-frontend (Vue3) │  后台管理端（运营/审核/财务）
              └───────────────────────────┘
```

## 1.3 小程序端请求链路

1. 页面调用统一封装 `callCloud(name, data)`（[utils/cloud.js](file:///c:/zhaoren/miniprogram/utils/cloud.js)）。
2. `callCloud` 委托 `app.cloudCall`，统一实现：等待云初始化就绪（`cloudReady`）→ 读操作重试 2 次 / 写操作不重试 → 单次超时 6s → 注入 `device` 摘要。
3. `app.cloudCall` 最终执行 `wx.cloud.callFunction({ name, data })`；各云函数 `index.js` 的 `exports.main` 按 `event.action` 分发到具体 handler。

> 统一入口是**硬约束**（见 [Ch5](file:///c:/zhaoren/docs/dev-manual/05-redlines.md)）：除初始化链路（避免循环依赖）外，任何页面不得直接调 `wx.cloud.callFunction`。

## 1.4 后台管理端请求链路

1. Vue SPA 通过 [src/api/admin.js](file:///c:/zhaoren/admin-web-frontend/src/api/admin.js) 的 axios 封装发请求，统一注入 `X-Admin-Token`。
2. 请求打到云函数 `admin-web`（HTTP 网关）：网关做路由/鉴权（优先级：`X-Admin-Token` → `admin_login` 免 key → `X-Admin-Key` 兜底），把写操作代理到 `admin-action`，并托管 `public/` 静态资源。
3. `admin-action` 承载**全部后台写操作与配置单一源**（84 个 action，见 [Ch2](file:///c:/zhaoren/docs/dev-manual/02-module-map.md)）。

## 1.5 定时任务链

| 触发器 | 云函数 | 频率 | 职责 |
|---|---|---|---|
| 定时触发器 | `order-timer` | `0 */5 * * * * *` | 订单状态推进、9 段分页扫描、错误巡检（errorScan）、订阅消息批量推送兜底 |
| 定时触发器 | `zz-warmup` | `0 */5 * * * * *` | 首屏云函数保温探针（唤醒 `home-action`/`user-login`），缓解冷启动 |

> **注意**：云函数 `deploy` 只上传代码，**不应用** `config.json` 的 `timeout`/`triggers`。触发器须另经 miniprogram-ci 或云开发控制台更新（详见 [Ch7](file:///c:/zhaoren/docs/dev-manual/07-deploy-release.md)）。

## 1.6 配置单一源

- 云端配置的**单一源**是 `admin_config` 集合，权威 schema 常量 `CONFIG_SCHEMA` 定义在 `admin-action`（见 [Ch2](file:///c:/zhaoren/docs/dev-manual/02-module-map.md)）。
- 小程序端的**前端配置源**是 [miniprogram/config/enums.js](file:///c:/zhaoren/miniprogram/config/enums.js) 与 [miniprogram/config/index.js](file:///c:/zhaoren/miniprogram/config/index.js)。
- 跨端一致性由 `scripts/check-ssot.js` 门禁保证（场景 code 必须在前后端同时存在）。

## 1.7 环境与鉴权模型

- **环境**：dev / prod 两态，由 `admin_config.global.env` 的云端运行值决定；读取失败时按 prod 兜底（不隐式放开 mock）。
- **身份**：由 `_shared/openid.js` 统一解析，遵循 **fail-closed**：生产环境 `mock_openid` 全部失效，必须使用真实 `OPENID`；dev 旁路需携带未来时间戳才生效。
- **后台鉴权优先级**：`X-Admin-Token`（校验 `admin_web_sessions`，12h 有效期）> `admin_login` 免 key > `X-Admin-Key` 兜底。

> 环境 ID、AppSecret、admin key 等**实际值不在本手册出现**，只记录「存放位置与读取机制」。

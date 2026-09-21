---
name: admin-web-remote-access
description: 找人帮忙项目 admin-web 后台网络配置与远程访问排查手册。Vite dev server 远程桌面/手机访问、CloudBase HTTP 网关 CORS 跨域、登录 400 根因修复、BASE_URL 统一策略。用在 ToDesk 远程桌面测 admin-web、手机联调 admin-web、登录密钥错误 400 报错排查。
---

# admin-web 远程访问与网络配置手册

## 1. 四场景通吃的 BASE_URL 策略（铁律）

admin-web 前端 `src/api/admin.js` 的 BASE_URL 必须**硬编码直打 CloudBase HTTPS 网关**，不能走 vite proxy：

```js
const PROD_ROOT = 'https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com';
const BASE_URL = PROD_ROOT;
```

**为什么**：vite proxy 只在 `npm run dev` 本机有效。ToDesk 远程桌面访问 localhost:5173 时，远程电脑的 vite 进程和代理在**本机**，远程浏览器的 `/api` 请求**永远打不到**本机 vite proxy——直接 404。手机浏览器更不可能走到本机 vite。

**四种场景通吃**：
| 场景 | 路径 | 是否通 |
|------|------|--------|
| 本机 dev | localhost:5173 → axios → CloudBase HTTPS | ✅ |
| ToDesk 远程桌面 | 远程 localhost:5173 → axios → CloudBase HTTPS | ✅ |
| 手机同 Wi-Fi | 手机 IP:5173 → axios → CloudBase HTTPS | ✅ |
| 生产 dist | 静态托管 → axios → CloudBase HTTPS | ✅ |

## 2. Vite dev server 远程访问配置

`vite.config.js` 必须加 `server.host: '0.0.0.0'`：

```js
export default defineConfig({
  server: {
    host: '0.0.0.0',  // 关键！默认 localhost 只监听 127.0.0.1
    port: 5173
  }
});
```

本机查局域网 IP：`ipconfig | Select-String "IPv4"` → 手机浏览器 `http://<IP>:5173`

Windows 防火墙放行（远程桌面/手机首次访问前可能需要）：
```powershell
netsh advfirewall firewall add rule name="Vite Dev" dir=in action=allow protocol=TCP localport=5173
```

## 3. CloudBase HTTP 网关 CORS 配置

admin-web 云函数（Koa）必须处理 OPTIONS preflight + 设置 CORS 头：

```js
// cloudfunctions/admin-web/index.js
app.use(async (ctx, next) => {
  ctx.set('Access-Control-Allow-Origin', '*');
  ctx.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  ctx.set('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
  if (ctx.method === 'OPTIONS') { ctx.status = 204; return; }
  await next();
});
```

**实测确认**：CloudBase 网关层对 OPTIONS preflight 返回 204（不需要函数处理），但对业务请求（POST）不带 X-Admin-Key 时**直接返回 400 空 body**，根本不调到 admin-web 云函数。带错误 key 反而能到函数返回 `{ok:false, code:'bad_key'}`。

## 4. 登录 400 根因与修复

### 根因（专家实测确认）

```
Login.vue onLogin() 时序:
  L26: call('config_get') → axios 拦截器读 localStorage 中 admin_web_key → 空! → 不发 X-Admin-Key 头
  L29: localStorage.setItem('admin_web_key', key.value) ← key 在这才存
```

**首次登录时 localStorage 为空** → X-Admin-Key 头不发 → CloudBase 网关直接 400 空 body 拦截。

### 修复方案

`call()` 增加第三参数 `keyOverride`，仅本次请求覆盖 X-Admin-Key 头：

```js
// src/api/admin.js
export function call(action, data = {}, keyOverride = null) {
  const cfg = { action, ...data };
  if (keyOverride) {
    return http.post('/api', cfg, { headers: { 'X-Admin-Key': keyOverride } });
  }
  return http.post('/api', cfg);
}
```

Login.vue 显式传 key：
```js
const r = await call('config_get', {}, key.value); // keyOverride = 用户输入的 key
```

### 网关层校验实测表

| 请求 | 状态 | Body | 谁拦截的 |
|------|------|------|----------|
| OPTIONS preflight | 204 | — | CloudBase 网关（自动） |
| POST 不带 X-Admin-Key | **400** | **空** | CloudBase 网关 |
| POST 带错误 key | 200 | `{ok:false, code:'bad_key'}` | admin-web 云函数 |
| POST 带正确 key | 200 | `{ok:true, data:{...}}` | admin-web 云函数 |

**关键区分**：400 空 body = 网关拦截（函数没机会执行）；200 + bad_key = 函数执行了。

## 5. 快速排查流程

远程桌面/手机测 admin-web 失败时：

### 步骤 1：本机 PowerShell 直打网关（隔离前端问题）

```powershell
# 不带 key（预期 400 空 body）
Invoke-WebRequest -Method POST -Uri 'https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api' -Body '{"action":"config_get"}' -ContentType 'application/json' -UseBasicParsing

# 带正确 key（预期 200 + config_get 数据）
# key 不入库: 向管理员索取, 或 init-db action=generate_admin_web_key 重新生成
$h = @{ 'X-Admin-Key' = '<ADMIN_WEB_KEY>' }
Invoke-WebRequest -Method POST -Uri 'https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api' -Body '{"action":"config_get"}' -Headers $h -ContentType 'application/json' -UseBasicParsing
```

→ 本机直打 200 = CloudBase 没问题，问题在前端或 vite。

### 步骤 2：确认 BASE_URL 不是空串

`grep "BASE_URL" src/api/admin.js` → 必须是硬编码 `https://...tcloudbase.com`，不能是空串（空串走 vite proxy，远程不通）。

### 步骤 3：DevTools Network 面板看请求

- URL 是不是 `https://...tcloudbase.com/api`？→ 不是 → BASE_URL 没生效
- Request Headers 有没有 `X-Admin-Key`？→ 没有 → localStorage 空 + call() 没传 keyOverride
- Response 是 400 空 body？→ 网关拦截，key 缺失
- Response 是 200 + bad_key？→ key 不对

### 步骤 4：强制刷新

远程浏览器 `Ctrl + Shift + R`（普通刷新用缓存的旧 admin.js）。

## 6. 已验证的项目常量

| 常量 | 值 | 来源 |
|------|-----|------|
| CloudBase HTTP 网关 | `https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api` | CloudBase 控制台 HTTP trigger |
| admin_web_key | `<不入库, 向管理员索取或 init-db generate_admin_web_key 生成>` | admin_config.global.admin_web_key |
| admin-web 云函数超时 | 20s | config.json |
| vite dev port | 5173 | vite.config.js |
| admin-web 前端 dev 路径 | `admin-web-frontend/` | 项目根 |
| admin-web 云函数路径 | `cloudfunctions/admin-web/` | 项目根 |

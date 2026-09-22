# admin-web 发版 Checklist & 关键经验

> admin-web 前端（Vue3+Element Plus+Vite）→ admin-web 云函数（静态文件服务 + HTTP 代理）→ admin-action 云函数（业务逻辑）
> 生产网关：`https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com`

---

## 一、admin-web 前端发版 7 步流程

```
1. 改 admin-web-frontend/src/ 下的代码
2. npm run build → 生成 dist/
3. 复制 dist/* → cloudfunctions/admin-web/public/（静态文件由云函数 serveStatic 托管）
4. 部署 admin-web 云函数：cli.bat cloud functions deploy --env cloud1-d9gkefwcp5c777088 --names admin-web --project <proj> --remote-npm-install
5. 等 30 秒 CDN 刷新
6. 验证：打开网关 URL → 硬刷新（Ctrl+Shift+R）→ 清 localStorage（DevTools Console: localStorage.clear(); location.reload()）
7. 生产验参：GET /debug（无鉴权返回 admin_config 状态，用于确认 key/scene_list 等）
```

### Vite 天然 CDN 缓存失效
每次 `npm run build`，chunk 文件名哈希自动变化（如 `index-BnVQh3on.js` → `index-jRQCz5Wc.js`）。
浏览器 index.html 引用新哈希的 chunk → CDN 必须重新拉取 → 不会拿到旧 JS。

---

## 二、axios request interceptor 铁律

**不能无条件覆盖 headers！** 登录页/刷新 token 场景会显式传 key。

```js
// ❌ 错误：无条件覆盖 request headers
request.interceptors.request.use(config => {
  const key = localStorage.getItem('admin_web_key');
  if (key) config.headers['X-Admin-Key'] = key;
  return config;
});

// ✅ 正确：只有没显式传时才从 localStorage 读
request.interceptors.request.use(config => {
  if (!config.headers['X-Admin-Key']) {
    const key = localStorage.getItem('admin_web_key');
    if (key) config.headers['X-Admin-Key'] = key;
  }
  return config;
});
```

---

## 三、admin_config DB 访问铁律

### 读 admin_config 单例文档（_id='global'）
```js
// ✅ 正确：直接用 doc('global')
const r = await col('admin_config').doc('global').get();
const cfg = r.data;

// ❌ 错误：where({_id:'global'}).limit(1).get() —— CloudBase 下读不到数据！
const r = await col('admin_config').where({ _id: 'global' }).limit(1).get();
const cfg = r.data && r.data[0]; // r.data 可能是空数组！
```

### 写 admin_config（update）
```js
// ⚠️ update 时 where({_id:'global'}) 能工作（实际部署验证过 force_migrate_scenes 已成功）
// 但为一致性建议也统一改：
await col('admin_config').doc('global').update({ data: patch });
```

### 项目待修复清单（共 32 处）
已修：admin-action（getConfig 处）、home-action（2 处 loadSceneList + home_activity_list）
待修：im-conv、demand-match、user-login（3 处）、order-create、blog-action（2 处）、safety-report、order-action、evaluation-submit、init-db（2 处）、payment-mock、demand-publish（2 处）、im-send（2 处）、partner-apply（2 处）、admin-action（update 6 处 + export_admin_config 1 处）、order-timer、partner-action（2 处）

---

## 四、init-db proxy 字段名冲突避坑

admin-web → admin-action（proxy） → init-db 时，**上游和下游都用 `action` 字段做路由判断**。
如果直接传 `{ action: 'init_db', ... }`，init-db 会匹配 `event.action === 'init_db'`（不存在），fallback 到默认逻辑。

**解决方案**：用 proxy 专用字段名

```js
// admin-web proxy 侧
const proxyData = {
  ...event,                         // 保留原始参数
  __init_db_action: event.action,   // 存真实 init-db action
  action: 'init_db',                // admin-action 路由匹配
  mock_openid: proxyOpenid          // proxy 层必须完整传递下游需要的所有关键字段
};

// admin-action 路由侧
case 'init_db': {
  const realAction = event.__init_db_action || event.action;
  const initDbEvent = { ...event, action: realAction };
  // 调 init-db 云函数...
}
```

**proxy 层 checklist**：必须传 `mock_openid` 等下游需要的所有关键字段，不能假设会自动映射。

---

## 五、密钥轮换操作手册

```
1. 确保 init-db proxy 通道畅通（admin-web → admin-action → init-db）
2. 开发环境放行：POST /api { action: "init_db", __init_db_action: "force_set_env", env: "dev", reason: "临时放行" }
3. 生成新 key：POST /api { action: "init_db", __init_db_action: "generate_admin_web_key", mock_openid: "oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c" }
4. 切回 prod：POST /api { action: "init_db", __init_db_action: "force_set_env", env: "prod", reason: "切回生产" }
5. 客户端清旧 key：DevTools Console → localStorage.clear(); location.reload();
6. 给新 key 给用户粘贴
```

**注意**：`force_set_env` 会改 admin_config.env 写 DB，但 init-db openid.js 有 5 分钟进程内缓存。force_set_env 动作代码里**必须同步调 `invalidateEnvCache()`**。

---

## 六、env 缓存失效规则

```js
// init-db openid.js
let _cachedEnv = null;
let _cachedEnvAt = 0;
const ENV_CACHE_TTL = 5 * 60 * 1000; // 5 分钟

function invalidateEnvCache() {
  _cachedEnv = null;
  _cachedEnvAt = 0;
}

// force_set_env 成功后必须调
if (action === 'force_set_env') {
  await col('admin_config').doc('global').update({ data: { env, updated_at: now } });
  invalidateEnvCache(); // ← 必须！
  return ok({ env });
}
```

---

## 七、生产验参工具

`GET /debug` — admin-web 云函数内置的无鉴权调试端点

返回：admin_openids_count、admin_web_key_set、admin_web_key_prefix、admin_web_key_at、scene_count、env 等

用途：在远程桌面无法登录 admin-web 时，直接 PowerShell curl 看生产配置状态。

---

## 八、CloudBase HTTP 网关返回格式

admin-web serveStatic 返回静态文件时：
- `{ status: 200, headers: { 'Content-Type': mime }, body: string }`
- 不支持 `isBase64Encoded: true`（网关会报 400）
- 3s 硬限（免费版）→ proxy timeout 设 2500ms

admin-web proxy 返回给 admin-action 的请求：
- `X-Admin-Key` header 鉴权
- body: `{ action: string, ...params }`
- POST /api

### HTTP 触发事件结构（实测 keys）
```
body, headers, httpMethod, isBase64Encoded, multiValueHeaders,
path, queryStringParameters, requestContext
```
- query 参数取 `event.queryStringParameters`（不是 queryString / query）
- 单个对象 doc('global').get() 返回 `r.data` 即文档对象本身，没有数组

### /debug 探针用法
- `GET /debug` — admin_config 基础状态（key 前缀/hash、scene_count、env）
- `GET /debug?probe=scene_groups` — 云端内网直调 home-action scene_groups，返回首页实际消费的场景分组摘要（每组 scene_code/scene_name/item_count/has_more + 耗时 ms）
- 用途：不启动小程序即可验证"运营后台新增场景 → 首页分组"整条链路；冷启动双函数约 1.5s，3s 网关硬限内可完成

---

## 九、渐进式验证法

生产网关兼容性问题时，**不要一把梭**：

1. 先写极简版 serveStatic：只处理 `/` → 返回硬编码字符串 `Hello` → 验证不报错
2. 加 fs.readFileSync → 验证文件系统 OK
3. 加 path.join + MIME 映射 → 验证完整静态服务
4. 加 SPA fallback（找不到文件时返回 index.html）→ 验证刷新子路由不 404

每加一层都部署 → 看 `/health` 是否还返回 200。

---

## 十、commit message 规范

```
feat(admin-web-frontend): axios interceptor guard 不再覆盖登录页显式传的 key
fix(home-action): loadSceneList 用 doc('global') 替代 where({_id:'global'}) 修场景不显示
fix(admin-config-DB): 全项目 where({_id:'global'}).get() → doc('global').get()
perf(home-action): square 并行 DB 查询从 9 减到 3 防冷启动超时
```

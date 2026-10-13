---
name: cloud-entry-contract-test
description: 为找人帮忙云函数入口层加 mock 契约测试（输入→返回码）。Use when 在提审冻结期内为 order-action/payment-mock/admin-action 等云函数补入口测试、扩 coverage，或需要拦截 wx-server-sdk 做无副作用断言时。Do not use for 修改运行时逻辑、提审后的结构性重构，或纯规则单测（那类直接放 _shared/*.test.js）。
---

# 云函数入口层契约测试

找人帮忙的云函数入口（`exports.main`）强依赖 `wx-server-sdk`（真实 CloudBase），无法在本地直接 `node --test`。
本技能沉淀一套**零运行时改动**的入口测试工作流，让测试断言「event 输入 → 返回 code/写入」契约。
适用冻结期——只增测试文件，不动任何业务代码。

## 关键约束（先读）

- **只增不改**：仅新增 `cloudfunctions/_shared/*.entry.test.js` 与（必要时）扩展 `_mock_sdk.js`。
  绝不修改 `cloudfunctions/*/index.js` 的运行逻辑。
- **测试发现**：`npm test` = `node --test "cloudfunctions/_shared/*.test.js"`，所以入口测试必须放 `_shared/` 且文件名以 `.test.js` 结尾。
- **mock 永不部署**：`_mock_sdk.js` 仅被测试 require，不进入任何云函数打包。
- **同步机制**：`_shared` 是规范源，改共享模块后要跑对应 `sync-*.ps1`；但入口测试/mock 不属于共享副本，无需同步。
- 全量验证命令：`node --test cloudfunctions/_shared/*.test.js`，再 `powershell -File scripts/gate.ps1`（需 `$env:AWK_KEY`）。

## 工作流

### 1. 注入 mock（拦截 wx-server-sdk）

在测试文件里用 `Module._load` 拦截，**必须在 require 目标 index 之前**完成：

```js
const Module = require('module');
let activeSdk = null;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return activeSdk;
  return origLoad.apply(this, arguments);
};
function loadIndex(sdk) {
  activeSdk = sdk;
  // 清掉目标 index 及其会残留模块级缓存的依赖（如 openid.js 的 _cachedEnv）
  for (const f of ['../order-action/index.js', '../order-action/openid.js', '../order-action/logger.js']) {
    delete require.cache[require.resolve(f)];
  }
  return require('../order-action/index.js');
}
```

文件末尾务必还原：`test.after(() => { Module._load = origLoad; });`
否则会污染同进程后续测试文件。

### 2. 构造 SDK 与数据

```js
const sdk = makeSdk({
  openid: 'o_user_1',                 // 传 '' 可测「无身份」分支（mock 已用 != null 判断，不会被默认值吞掉）
  store: { admin_config: { global: { env: 'dev', admin_openids: ['o_admin'] } },
           order_main: { [OID]: {...} } },
  agg: { order_main: [{ total: 50000, tip: 0 }], withdraw_record: [] }  // 仅聚合查询需要
});
const { main } = loadIndex(sdk);
const r = await main({ action: 'nudge_partner', order_id: OID, mock_openid: 'o_user_1' }, {});
assert.strictEqual(r.code, 'oa_not_owner');
```

断言写入：`sdk.writes.<collection>` 捕获所有 `add/doc.update/where.update`。

### 3. mock 能力速查（`_mock_sdk.js`）

已支持：`doc().get/update`、`where().get/count/update`、`collection.add`、
`db.command`（`_.gte/inc/push/or/...` 透传标记）、`db.command.aggregate`（`$.sum`）、
`collection().aggregate().match().group().end()`（结果取自 `opts.agg[name]`）、`cloud.openapi.subscribeMessage.send`。

遇到入口调用了 mock 没有的方法（如 `db.runTransaction`、`cloud.uploadFile`）：
**优先选在鉴权门就 return 的分支测**（零后续依赖），避免为通过路径扩一堆 mock。
确需扩时，按现有模式在 `_mock_sdk.js` 加最小桩，保持「返回可断言的标记/数据」而非真实行为。

### 4. 选测试目标的优先级

先覆盖**安全/越权门**（在入口早期 return，依赖少、价值高）：
- admin-action：`admin_forbidden` / `admin_empty` / `admin_no_openid` / `config_public` 免鉴权
- order-action：`oa_not_owner`（精确匹配）、`oa_not_participant`（roleOf 门）、`oa_bad_order_id`（缺参预检）
- payment-mock：`wd_amount` / `wd_too_small` / `wd_fast_cap` / `wd_insufficient`

这些分支通常在 DB 写入前返回，mock 压力最小。成功路径作为补充（断言 `sdk.writes`）。

## 验证与提交

1. `node --test cloudfunctions/_shared/<file>.entry.test.js` 先单独跑通
2. `node --test cloudfunctions/_shared/*.test.js` 确认总数递增、既有不回归
3. `scripts/gate.ps1` 全绿（smoke 偶发冷启动抖动 → 冷却 25s 重试，非代码问题）
4. 提交信息前缀 `test(entry):`，说明「零运行时改动 + 新增 N 用例 + 单测/ gate 结果」

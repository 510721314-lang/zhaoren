---
name: tcb-readback-verify
description: After deployment, read back live cloud state via tcb CLI to verify — cloud function code SHA256 match, collection index alignment, data writes and audit_log traces. Use when the user asks to verify a deployment, confirm a change went live, or check a collection/index/data. Do not use for local code checks or driving the IDE cloud test panel.
---

# 云端回读实证（tcb 直连，zhaoren 专用）

部署后**不能只信「部署成功」字样**——必须直连云端回读实际状态，与本地预期对比，给出带证据的结论。本 skill 固化已验证的三条回读链路与判据。

## 何时用 / 何时不用

- ✅ 部署云函数后，确认线上代码 == 本地（防「部署了旧包/缓存」）
- ✅ 新建集合/索引后，核对云端实际结构 == init-db 台账
- ✅ 后台/小程序写入操作后，核对集合里有对应数据 + audit_log 有留痕
- ❌ 本地代码静态检查（用 verify:offline / GetDiagnostics）
- ❌ 调用云函数跑逻辑回归（用 `cloud-console-test-driver` skill 或小程序实测）
- ❌ 部署动作本身（用 `wx-cloud-deploy` skill）

## 环境事实（已确认，勿再探测）

- 云环境 ID：自动从 `miniprogram/envList.js` 的 `CLOUD_ENV` 读取（当前 `cloud1-d9gkefwcp5c777088`），或用 `$env:TCB_ENV_ID='...'` 覆盖
- tcb CLI：`@cloudbase/cli`，入口由 `scripts/tcb-exec.js` 的 `findTcbJs()` 自动发现（`%APPDATA%\npm\node_modules\@cloudbase\cli\bin\tcb`），失败时报错并提示
- 临时脚本一律放 `.tmp-tcb/`（已在 `.gitignore`，不提交），从 `.tmp-tcb` 内 require 用 `../scripts/tcb-exec`
- **只读命令可放心跑**（listIndexes / find / fn code download）；绝不轻易跑 insert/update/delete

---

## 场景 A：云函数代码回读（SHA256 对比）

确认线上部署的代码 == 本地工作区。

**命令（PowerShell）**：

```powershell
$env:TCB_ENV_ID='cloud1-d9gkefwcp5c777088'
# 1. 清空旧下载目录（避免旧文件干扰对比）
if (Test-Path .tmp-tcb\dl-<tag>) { Remove-Item .tmp-tcb\dl-<tag> -Recurse -Force }
# 2. 下载（位置参数，无 --dir；文件直接落目标目录根下）
tcb fn code download <fnName> .tmp-tcb\dl-<tag> -e cloud1-d9gkefwcp5c777088
# 3. 算云端 SHA256，与本地对比
$sha = (Get-FileHash .tmp-tcb\dl-<tag>\index.js -Algorithm SHA256).Hash
```

**判据**：

- 云端 SHA == 本地 `(Get-FileHash cloudfunctions\<fnName>\index.js -Algorithm SHA256).Hash` → 输出 `SHA_MATCH ✓ 线上==本地`
- 不等 → `SHA_MISMATCH ✗ 云端(<sha>) != 本地(<sha>)`，说明部署的不是当前代码或部署未生效

**坑**：

- `tcb fn code download` 是**位置参数**，没有 `--dir`；目标目录必须先清空
- `tcb` 不是 DevTools 的 `cli.bat`；下载云函数代码用 tcb，部署用 cli.bat（见 `wx-cloud-deploy`）

---

## 场景 B：集合索引核对（listIndexes vs init-db 台账）

确认云端索引 == `cloudfunctions/init-db/index.js` 的 INDEXES 登记。索引只能控制台手工建，代码无法建，所以必须回读核对。

**写法（必须写临时 .js，不能 node -e——PS5 会吞引号）**：

`.tmp-tcb\check-idx.js`：

```js
const { execTcbCommands } = require('../scripts/tcb-exec');
const COLL = '<集合名>';
const EXPECTED = { name: '<idx_name>', key: '<field1>:1, <field2>:1' }; // 来自 init-db INDEXES

const r = execTcbCommands([{ TableName: COLL, CommandType: 'COMMAND', Command: JSON.stringify({ listIndexes: COLL }) }]);
const arr = Array.isArray(r.parsed) ? r.parsed : [];
console.log('=== ' + COLL + ' 实际索引（不含 _id_）===');
let ok = false;
for (const idx of arr) {
  if (!idx || idx.name === '_id_') continue; // _id_ 是系统默认
  const keyStr = Object.entries(idx.key || {}).map(([k, v]) => k + ':' + (v && v.$numberInt ? v.$numberInt : v)).join(', ');
  console.log(idx.name + ' | ' + keyStr + (idx.unique ? ' | UNIQUE' : ''));
  if (idx.name === EXPECTED.name && keyStr === EXPECTED.key) ok = true;
}
console.log(ok ? 'IDX_OK: ' + COLL + ' ' + EXPECTED.name + ' {' + EXPECTED.key + '} 与台账对齐 ✓'
              : 'IDX_MISMATCH: 未找到匹配索引 ✗');
```

运行：`$env:TCB_ENV_ID='cloud1-...'; node .tmp-tcb\check-idx.js`

**判据**：

- 找到 name + key 完全匹配的索引 → `IDX_OK ✓`
- 索引存在但 key 缺字段 / 名字错 → `IDX_MISMATCH ✗`（让用户去控制台重建；会导致 check-index-ledger FAIL 卡 verify:offline）
- `_openid_1` 是系统自动建的，忽略
- 集合不存在时 listIndexes 仍返回（只含 `_id_`）→ 说明集合还没建

---

## 场景 C：数据写入 + audit_log 留痕核对

确认后台/小程序的写操作真的落库，且审计留痕存在。

**写法（临时 .js）**：

`.tmp-tcb\verify-write.js`：

```js
const { execTcbCommands } = require('../scripts/tcb-exec');

// 1. 查目标集合写入（例：未软删的记录）
const r1 = execTcbCommands([{ TableName: '<coll>', CommandType: 'COMMAND',
  Command: JSON.stringify({ find: '<coll>', filter: { is_deleted: false }, limit: 10 }) }]);
const arr = Array.isArray(r1.parsed) ? r1.parsed : [];
console.log('未软删记录数: ' + arr.length);
for (const d of arr) console.log('  - ' + d._id + ' | ' + JSON.stringify(d).slice(0, 120));

// 2. 查 audit_log 留痕（按 at 降序，最近 N 条里筛目标 action）
const r2 = execTcbCommands([{ TableName: 'audit_log', CommandType: 'COMMAND',
  Command: JSON.stringify({ find: 'audit_log', limit: 30, sort: { at: -1 } }) }]);
const al = Array.isArray(r2.parsed) ? r2.parsed : [];
let n = 0;
for (const d of al) {
  if (/<action关键词>/.test(JSON.stringify(d))) { n++; console.log('  ★ ' + d._id + ' | action=' + d.action); }
}
console.log(arr.length > 0 ? 'WRITE_OK ✓' : 'WRITE_EMPTY');
console.log(n > 0 ? 'AUDIT_OK: ' + n + ' 条留痕 ✓' : 'AUDIT_NONE: 未见留痕（扩大 limit 或确认 action 名）');
```

**关键事实**：

- `logEvent` 写 `audit_log` 时 action 字段 = `'admin_' + type`（如 `admin_sop_project_create`），不是裸 action 名——筛选用 `admin_<type>` 或正则 `/sop_project_/`
- `audit_log` 按 `at` 字段降序（不是 `created_at`），见 `cloudfunctions/admin-action/action_audit.js`
- `logEvent` 先写 `platform_event`（必写），P2 才镜像 `audit_log`；若 audit_log 查不到，可改查 `platform_event` 的 `type` 字段确认是否调用过
- BSON 数字是 `{ $numberInt: "0" }` 包装，直接 `console.log` 会显示 `[object Object]`——取 `v.$numberInt`

---

## 输出结论规范（防谎报）

每个核对项必须**带实际值**输出，禁止只说「已验证」：

```
云端 index.js SHA256 = B781B710…
SHA_MATCH ✓ 线上==本地==HEAD
```
```
idx_scene_sort | scene_code:1, sort:1
IDX_OK: service_sop idx_scene_sort {scene_code:1, sort:1} 与台账对齐 ✓
```
```
未软删记录数: 1
  - d506... | scene=W2 | name=学习陪伴 | status=online
WRITE_OK ✓
```

- MATCH / OK 类结论必须附**实际回读到的值**
- MISMATCH / NONE 类结论必须附**预期值 vs 实际值**，并给出下一步（重建索引 / 扩大查询 / 查 platform_event）

## 已知坑汇总

| 坑 | 规避 |
|---|---|
| PS5 双引号吞 `$numberInt`、`node -e` 引号被剥 | 一律写临时 `.js` 到 `.tmp-tcb/` 执行，绝不 `node -e '...$numberInt...'` |
| `tcb database` 不是有效命令 | 用 `scripts/tcb-exec.js`（内部走 `tcb db nosql execute`） |
| `tcb fn code download` 无 `--dir` | 位置参数，文件落目标目录根；先清空目录 |
| tcb 凭据偶发失败 | `execTcbCommands` 已内置 5 次重试（命中「无有效身份信息」才重试，不产生重复写入） |
| 代理走 TUN 模式 | git 直连用 `git -c http.proxy= -c https.proxy=`；tcb 同理若失败试直连 |
| 集合不存在 | listIndexes 仍返回 `_id_`；find 会报错——先确认集合已建 |

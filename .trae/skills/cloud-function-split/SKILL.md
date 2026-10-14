---
name: cloud-function-split
description: 物理拆分微信云函数巨型入口文件(index.js 线性 if(action===...) 链)为同级 action_*.js + HANDLERS 分发 + ctx 注入,零行为变更。Use when 云函数 index.js 过大需按 action 抽离、重构巨型 handler 文件、或给 order-action/admin-action 类入口做等价拆分。Do not use for 行为/逻辑改动、TS 迁移、或新建子目录脚手架。
---

# 云函数入口物理拆分（找人帮忙项目）

把 `cloudfunctions/<fn>/index.js` 里线性 `if(action==='x'){...}` 链，逐组搬到**同级** `action_*.js`，index 仅留「鉴权/预检 + HANDLERS 分发表 + 共享 helper」。**纯物理搬家，零行为变更，对外契约一字不动。**

## 硬约束（红线）
- ❌ 不建子目录（不建 `actions/`、`services/`），handler 与 index **同级** —— 规避 `_shared` 同步脚本路径错位
- ❌ handler **禁止** `require('./index')`（循环依赖）；共享符号全部经 `ctx` 注入
- ❌ 不改 `exports.main` 对外契约、不改状态机/规则逻辑
- ✅ 仅「物理搬家 + 同级 require」

## 分发机制（index.js 骨架）
```js
// index.js 顶部（exports.main 之前）
const HANDLERS = Object.assign({},
  require('./action_foo'),
  require('./action_bar'),
  // ...
);
// 多分发点（如 admin 有免鉴权前置）则另建 HANDLERS_PRE
```
`exports.main` 内、鉴权/预检/RBAC 之后、原 if 链之前插入：
```js
if (HANDLERS[action]) {
  const ctx = { event, openid, /* 该组用到的全部顶层符号 */ };
  return await HANDLERS[action](ctx);
}
```
admin 类有两个分发点：免鉴权前置（鉴权门之前）用 `HANDLERS_PRE`，鉴权后用 `HANDLERS`。

## handler 文件模板（与 index 同级）
```js
// action_foo.js — 从 index.js 物理抽出，行为逐字不变；共享符号经 ctx 注入，禁 require('./index')
async function foo_action(ctx) {
  const { event, openid, col, _, ok, fail, ...该组用到的符号 } = ctx;
  // 函数体逐字从 index 搬入
}
module.exports = { foo_action };
```
多个相似 action 可放同一文件，`module.exports` 导出多个；带别名的用 `module.exports = { a: fn, b: fn }`。

## 每抽一组的标准流程（一组一提交一验证）
1. **列依赖**：grep 该 action 块引用的顶层符号，确认都进 ctx；新增符号（如 `action`、局部 helper）要补进 ctx 或内联进 handler
2. 写 handler 文件（函数体逐字搬；**main 内的局部 helper/常量要一并内联到 handler 顶部**）
3. 注册到 `HANDLERS`（或 `HANDLERS_PRE`）
4. 删除 index 内联块：用 **node 脚本按 marker 行 findIndex 切割**（不用 Edit，行号易偏移）
5. `node --check` 全部新文件 + index
6. **等价性验证**（决定性证据）：对拆分前版本做 A/B 深比较，见下
7. 全量单测（基线只增不减）+ 项目 gate
8. 独立 commit（可单独 revert）

## 等价性验证（A/B 深比较）
- 夹具：`cloudfunctions/_shared/ab_equivalence.js` —— 同输入跑「拆分前(_orig_baseline.js)」vs「当前 index.js」，`normalize` 把 >1e12 的数字当时间戳归一成 `<ts>`
- baseline 必须用**拆分前**的 index：`git show <拆分前commit>:cloudfunctions/<fn>/index.js > <fn>/_orig_baseline.js`（不能自录自比，那恒真）
- 每抽一组向 `CASES` 加该组的 early-return / 正常输入用例；`node cloudfunctions/_shared/ab_equivalence.js`，意外差异数必须为 0
- **`_orig_baseline.js` 冻结入库常驻、测完不删**（2026-10-13 起改定：作为后续每次改动的 A/B 常驻锚点；早期文档"测完删除"口径已作废）

## A/B 门禁的三类盲区（2026-10-14 双专家评审实证，拆分收尾必查）
A/B「0 差异」**只证明单次调用返回值一致**，下列问题全部能在 0 差异下漏网，必须各补一道独立测试/核对：
1. **跨调用有状态行为**：进程内缓存 TTL/锁/计数器/单例——用「同一模块实例连调两次 + 第二次副作用计数（DB where.get 次数等）下降或为 0」守护。
   实证：home-action 拆分时 ctx 漏注入 `TTL_SCENE_GROUPS` → `memSet(k,v,undefined)` → `until=Date.now()+undefined=NaN` → 60s 缓存永不命中，每次重跑 9 次 demand 查询，A/B 全绿。
2. **静默退化（漏注入不抛错）**：静态核对「index.js ctx 提供键 ⊇ 各 handler 解构且体内真实使用的键」。机械扫描排除四类误报：`'./openid'` 等 require 路径字符串、`{openid: x}` 对象键名、解构行自身、体内 `const openid=` 同名局部。
3. **成功路径从未走通**：A/B 两侧同抛错也判等价（互相背书）。每个核心写动作至少一条用例穿透到落库，断言返回值 + writes（多表/状态 CAS/审计/通知）。
   实证：order-create `create_from_take` 成功路径 7 变量块作用域越界、事务已提交但客户端必收 500，A/B 长期 0 差异。
- **`KNOWN_EVOLUTION` 是"跳过该例比较"不是"保护"**：修复基线时代既有 bug 致 B 成功/A(冻结基线)失败时，登记白名单（不刷基线，保留修复前证据），但**必须**为该路径另配独立行为断言（参考 `_shared/order_create_take_success.test.js`、`_shared/home_action_cache.test.js`）。

## 拆分收尾：独立审查（多组/多提交完成后默认执行）
- 派两个独立视角交叉取证（结构性猎手 + 高风险文件定点抽查），**2/2 确认才立项修复，1/1 低置信只登记**（zhaoren-tech-review 流程）。
- 只报线上故障级：ctx 注入完整性、模块级缓存/锁单例归属（必须留 index.js 注入，防每请求重建）、块作用域越界（try/finally 花括号精确配对）、HANDLERS 分发行位于 openid 鉴权之后、重复 action 键（Object.assign 静默覆盖）、事务副作用与返回一致性；**不报风格问题**。

## 验证清单（每组必过）
- [ ] `node --check` 新文件 + index 全过
- [ ] index 无残留内联 `if (action === ...)` handler（grep 应为空或仅剩已分发的）
- [ ] A/B 意外差异 0（KNOWN_EVOLUTION 每例均有独立守护测试）
- [ ] 上述「三类盲区」各有对应独立测试/静态核对结论
- [ ] 全量单测只增不减（数以 `npm test` 实测为准；2026-10-14 = 362 pass）
- [ ] 项目 gate 全绿（`npm run verify`）
- [ ] 无真实代码的循环 require（grep 命中先排除文件头"禁 require('./index')"注释文字）

## 部署
拆完后**必须重新部署云函数才生效**：用 `wx-cloud-deploy` skill 串行部署 `<fn>`，确认 packSize 变化、filesCount 增加（含新 handler 文件）。部署后云端测试面板各分组至少调 1 个 action 跑线上烟雾。

## 排障速查
- handler 报 `ReferenceError: x is not defined` → ctx 漏注符号；补进 ctx 或内联
- `Updating 状态` 冲突 → 并发部署；改为串行
- gate 偶发 1 项失败 → 多为 live 网关抖动；重试确认，非代码问题
- 大段删除用 node 脚本按 marker 切割，别用 Edit

## 本项目已完成的拆分（参考，截至 2026-10-14 共 9 个入口）
- admin-action：30 个 handler（86 action，双分发点 HANDLERS_PRE/HANDLERS）
- order-action：→392 行，7 个 handler（32 action）
- order-timer：969→639 行，4 个 section handler（11 扫描段落，SECTIONS 分发非 case）
- user-login：1250→373 行，4 个 handler（20 action）
- partner-action：1134→369 行，4 个 handler（13 action）
- home-action：828→364 行，4 个 handler（8 action；进程内缓存全留 index.js）
- payment-mock：874→186 行，4 个 handler（14 action；withdraw/fast_withdraw 落穿共享 case）
- order-create：804→193 行，2 个 handler（非 case 结构：早返回块 + 尾部续写体）
- demand-publish：1746→457 行，5 个 handler（10 action）
- 每个函数均：冻结 `_orig_baseline.js` 入库 + A/B 常驻门禁 + 串行部署 + download SHA256 核验；详见 docs/FUNCTION-REGISTRY.md #51-59

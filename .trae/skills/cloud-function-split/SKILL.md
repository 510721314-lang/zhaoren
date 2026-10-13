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
- 夹具：`cloudfunctions/_shared/ab_equivalence.js` —— 同输入跑「拆分前(git 历史版本)」vs「当前」，`normalize` 把 >1e12 的数字当时间戳归一成 `<ts>`
- baseline 必须用**拆分前**的 index：`git show <拆分前commit>:cloudfunctions/<fn>/index.js > <fn>/_orig_baseline.js`（不能自录自比，那恒真）
- 每抽一组向 `CASES` 加该组的 early-return / 正常输入用例；`node cloudfunctions/_shared/ab_equivalence.js`，退出码=差异数，必须为 0
- 测完删 `_orig_baseline.js`

## 验证清单（每组必过）
- [ ] `node --check` 新文件 + index 全过
- [ ] index 无残留内联 `if (action === ...)` handler（grep 应为空或仅剩已分发的）
- [ ] A/B 等价 0 差异（order-action 类有夹具的）
- [ ] 全量单测只增不减（基线 183）
- [ ] 项目 gate 全绿
- [ ] 无循环 require（grep `require('./index')` 为空）

## 部署
拆完后**必须重新部署云函数才生效**：用 `wx-cloud-deploy` skill 串行部署 `<fn>`，确认 packSize 变化、filesCount 增加（含新 handler 文件）。部署后云端测试面板各分组至少调 1 个 action 跑线上烟雾。

## 排障速查
- handler 报 `ReferenceError: x is not defined` → ctx 漏注符号；补进 ctx 或内联
- `Updating 状态` 冲突 → 并发部署；改为串行
- gate 偶发 1 项失败 → 多为 live 网关抖动；重试确认，非代码问题
- 大段删除用 node 脚本按 marker 切割，别用 Edit

## 本项目已完成的拆分（参考）
- order-action：2002 → 338 行，29 action → 6 个 handler（nudge/query/confirm/lifecycle/modify_extend/dispute）
- admin-action：3529 → 544 行，~90 action → 22 个 handler；双分发点（HANDLERS_PRE 免鉴权 + HANDLERS 鉴权后）

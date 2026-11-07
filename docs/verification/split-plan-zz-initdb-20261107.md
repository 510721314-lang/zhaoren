# 巨型文件拆分方案 v2 — zz-seed-orders + init-db（最终执行方案）

> 状态：**v2 定稿（2026-11-07）**。本轮采用「主对话直读两源码逐行实核」替代子代理评审（前两轮子代理结论被平台截断、第三轮被中断，避免继续消耗积分）。
> 依据：`cloud-function-split` skill；行号为 2026-11-07 对 HEAD 工作区实测：**zz-seed-orders/index.js = 1074 行、init-db/index.js = 675 行**（v1 记 1025/653，已过期，全文行号以本版为准）。
> 前置事实：git 工作区干净（仅本文件未跟踪）；`cloudfunctions_baseline/` 已存在（9 个已拆函数基线），本两函数尚无基线文件。

## 1. 目标与红线

物理拆分两个最巨型且尚无 handler 的云函数入口，**零行为变更，对外契约一字不动**。

红线（skill 强制）：同级 `action_*.js`（不建子目录）、handler 禁 `require('./index')`（共享符号经 ctx 注入）、不改 `exports.main` 契约、不改业务逻辑、分发行必须在鉴权/预检之后。

## 2. 为什么必须拆

1. 两个函数为 675/1074 行巨型入口，修改与评审成本高。
2. 测试期两者均在使用（mock 造数、quick_check / env / 密钥操作），拆后按 action 改动只触及单文件。
3. 后续提审清理可按 action 文件整组摘除。

## 3. 专家意见复核表（v1 R1-R7 逐条实测）

| # | v1 结论 | v2 复核 | 处理 |
|---|---|---|---|
| R1 | init-db「bootstrap」= 尾部默认幂等种子补齐分支（约 L529-653），独立 fail-closed 门控 | **机制属实，行号需更新**：鉴权门 L529-542、种子执行 L544-663；L220 注释中「由 L472 独立门控」已是过时行号（实际门在 L529） | 采纳；拆 action_seed 时同步校正该注释行号（仅注释，不改逻辑，可选） |
| R2 | 两函数入口默认均为 `event.action \|\| 'run'` | **部分不符**：zz-seed-orders 为 `event.action \|\| 'run'`（L287）；init-db 为 `event && event.action`（L221，无默认值）。分发设计本身成立 | 采纳修正后的语义 |
| R3 | zz-seed-orders 前置块 L276-297 留 index | **属实**，精确边界为 L275-297（鉴权 L275-283、openid L285-286、action L287、sceneList L289-295、simOpenids L297） | 采纳 |
| R4 | init-db ADMIN_ACTIONS 门 L220-235 留 index、分发行之前 | **属实**（L221-235）；set_env / force_set_env / generate_admin_web_key 不在该名单，分别有自门控：L421-424 / L438-444 / L483-484 | 采纳 |
| R5 | DEFAULT_CONFIG（L1-183）仅种子分支使用 → 搬入 action_seed.js | **不符**：实际常量名为 `SEED_CONFIG`（L106-183），且 **quick_check（L293-294）与 force_migrate_scenes（L401/L404）也引用**；zz 的 USERS/CONTENT/PLACES/VIRTUAL_USERS 全文只读、无 mutate | **修正**：SEED_CONFIG / COLLECTIONS / INDEXES 及各静态常量一律**留 index.js，经 ctx 注入**（保持模块加载时机不变，零风险） |
| R6 | lookup 块内局部 `const _ = db.command` → `_` 必须 ctx 注入 | **部分不符**：`_` 是各块内局部声明（L239/L271/L314/L516），随块搬走仍有效；真正需注入的是 `db`。zz 的 `_` 是**模块级**（L9），必须 ctx 注入 | 采纳修正 |
| R7 | 盲区①：init-db bootstrap 事务 CAS + zz softDeleteAll 幂等 | **部分不符**：事务 CAS 实际在 **generate_admin_web_key**（L488-506，`resolveAdminBootstrap` L8 引入），不在种子分支；种子分支幂等靠「只补缺失键」（L583-663） | 盲区①测试归属修正为 action_key / action_seed / action_env / zz action_misc（见 §6） |

### 开放问题答复（v1 §8）

- Q1：action 清单属实（zz 11 个、init-db 8 个 + 默认种子分支）；**行数需更正为 1074 / 675**。
- Q2：切割点属实，精确区间见 §4；切割必须用 **marker 字符串 findIndex**，禁止硬编码行号。
- Q3：init-db 无 `bootstrap` action、无其它隐藏 action；memory 提及的 simulate_realname / submit_pending_partner 全文实读不存在于本文件。
- Q4：ctx 全表见 §4.3。
- Q5：skill 强制项覆盖见 §6 / §7。
- Q6：风险见 §8。

## 4. 最终分组表（当前实测行号）

### 4.1 zz-seed-orders（1074 行 / 11 action / 5 组）

| 组 | 新文件 | 精确行区间 | actions |
|---|---|---|---|
| G1 统计与软删 | action_misc.js | L300-308 + L311-314 + L317-323 + L1000-1010 + L1014-1043 + L1047-1071 | count, cleanup, count_sim, cleanup_sim, fix_sdm_city, cleanup_seed_orders, backfill_matched |
| G2 核心造单 | action_simulate.js | L326-446 | simulate |
| G3 服务单 | action_service_orders.js | L452-598 | service_orders |
| G4 夜间单 | action_night_orders.js | L604-802 | night_orders |
| G5 场景需求 | action_scene_demands.js | L808-997 | scene_demands |

**index.js 保留**：L1-263（全部常量与 helper：`_` L9、RATE_MIN/RATE_MAX L11、DAY_OFFSETS L12、HOURS L13、VIRTUAL_USERS L16-29、USERS L30、PLACES L33-37、CONTENT L40-239、genDemandNo L241-245、pick L247、softDeleteAll L250-263）+ L265-297（鉴权/预检）+ 新增分发行 + L1073 `bad_action` 兜底。
拆分后 index 预计约 330 行。

### 4.2 init-db（675 行 / 8 action + 种子默认分支 / 4 组）

| 组 | 新文件 | 精确行区间 | actions |
|---|---|---|---|
| G1 只读诊断 | action_diag.js | L238-267 + L270-310 + L515-527 | lookup, quick_check, check_pp |
| G2 环境治理 | action_env.js | L400-408 + L412-428 + L432-473 | force_migrate_scenes, set_env, force_set_env |
| G3 密钥生成 | action_key.js | L479-512 | generate_admin_web_key |
| G4 数据治理/种子 | action_seed.js | L313-397（purge_test_data）+ L544-663（种子执行体） | purge_test_data + 默认种子分支 |

**index.js 保留**：L1-203（COLLECTIONS L11-23、INDEXES L30-103、SEED_CONFIG L106-183、resolveAdminIdentity L191-203）+ L205-235（warmEnv、force_expire 自愈 L209-218、ADMIN_ACTIONS 门 L220-235）+ **种子鉴权门 L529-542（原样留 index，在种子 handler 调用之前）** + 新增分发行 + L665-674 最终返回。
拆分后 index 预计约 330 行。

### 4.3 ctx 注入全表

**zz-seed-orders**

| handler | ctx 键 |
|---|---|
| action_misc | event, db, _, openid, simOpenids, softDeleteAll |
| action_simulate | event, db, _, openid, sceneList, simOpenids, USERS, CONTENT, PLACES, DAY_OFFSETS, HOURS, RATE_MIN, RATE_MAX, genDemandNo, pick |
| action_service_orders | event, db, _, sceneList, CONTENT, USERS, PLACES, pick |
| action_night_orders | event, db, _, sceneList, CONTENT, USERS, PLACES, pick |
| action_scene_demands | event, db, _, sceneList, CONTENT, USERS, PLACES, DAY_OFFSETS, RATE_MIN, RATE_MAX, genDemandNo, pick, softDeleteAll |

**init-db**

| handler | ctx 键 |
|---|---|
| action_diag | event, db, SEED_CONFIG（块内 `const _ = db.command` 原样随块搬走） |
| action_env | event, db, adminIdentity, SEED_CONFIG, resolveAdminIdentity, invalidateEnvCache |
| action_key | event, db, resolveAdminIdentity, resolveAdminBootstrap |
| action_seed | db, SEED_CONFIG, COLLECTIONS, INDEXES |

**index 分发骨架（两函数同构，以 init-db 为例）**

```js
// index.js 顶部（exports.main 之前）
const HANDLERS = Object.assign({},
  require('./action_diag'),
  require('./action_env'),
  require('./action_key')
);
const { run_seed } = require('./action_seed');

// …鉴权/预检/ADMIN_ACTIONS 门之后…
if (Object.prototype.hasOwnProperty.call(HANDLERS, action)) {
  return await HANDLERS[action]({ event, db, adminIdentity, SEED_CONFIG, resolveAdminIdentity, invalidateEnvCache, resolveAdminBootstrap });
}
// …种子鉴权门（原 L529-542 原样保留）…
return await run_seed({ db, SEED_CONFIG, COLLECTIONS, INDEXES });
```

> `hasOwnProperty` 防护说明：`HANDLERS[action]` 直接取值时，`action='constructor'/'toString'` 会命中原型链函数被误当 handler 调用（行为漂移）。加该判定属**零行为变更硬化**，建议纳入本次拆分（对未知 action 恢复原有兜底语义）。zz-seed-orders 未命中时保持原 L1073 `bad_action` 返回。

## 5. 执行顺序（命令级）

### Phase 0 前置（一次性）

1. 确认配额余量（freeze 规则 §3）。
2. 确认 zz-seed-orders 部署状态：文件头 L1 写「保留: 不部署」，与「云端测试期在用」说法冲突，部署前用 `tcb fn detail` / 控制台核实。
3. 冻结 baseline（常驻不删，放仓库根）：
   - `git show HEAD:cloudfunctions/init-db/index.js | Out-File -Encoding utf8 cloudfunctions_baseline/init-db.js`
   - `git show HEAD:cloudfunctions/zz-seed-orders/index.js | Out-File -Encoding utf8 cloudfunctions_baseline/zz-seed-orders.js`
   - 注意：PS5 裸 `>` 默认 UTF-16，必须用 `Out-File -Encoding utf8`。
4. 工作区干净、单一 docs commit 先落盘本方案。

### Phase 1 init-db（先做：规模小、4 组）

G1 action_diag → G2 action_env → G3 action_key → G4 action_seed，每组按 §6 标准流程 8 步，一组一提交。

### Phase 2 zz-seed-orders

G1 action_misc → G2 action_simulate → G3 action_service_orders → G4 action_night_orders → G5 action_scene_demands，同标准流程。

### Phase 3 部署与烟雾（串行、一次一个函数）

1. 提交干净 → bundle 归档 → deploy-log 登记（含回滚点）。
2. init-db：`<开发者工具路径>\cli.bat cloud functions deploy --env cloud1-d9gkefwcp5c777088 --names init-db --project c:\zhaoren --remote-npm-install`
3. 部署后 download 核验标记串（init-db 含 `dev_until`）；云端测试面板调 `quick_check` 烟雾。
4. zz-seed-orders（仅当 Phase 0 确认在线）：同命令 `--names zz-seed-orders`；面板调 `count` 烟雾。
5. 收尾独立审查（双视角交叉，2/2 确认才修）。

## 6. 每组标准流程（8 步，skill 强制）

1. 列依赖：grep 块内引用的顶层符号，对照 §4.3 确认 ctx 键齐全。
2. 写 handler 文件：函数体**逐字搬运**，`async function xxx(ctx)` + 顶部解构。
3. 注册 HANDLERS（`Object.assign`，注意两文件不得导出同名键——重复键会静默覆盖）。
4. 删除 index 内联块：node 脚本按 **marker 字符串** findIndex 切割（禁止按本文件行号硬编码）。
5. `node --check` 新文件 + index。
6. A/B 深比较：`_shared/ab_equivalence.js` 加该组 CASES，意外差异必须 0；`KNOWN_EVOLUTION` 每例须另有独立守护测试。
7. 盲区补测（见下表）+ 全量 `npm test` 只增不减。
8. `npm run verify:offline` 全绿 → 独立 commit（中文消息含来源与验证证据）。

### 三类盲区具体测试项（归属已按 §3 R7 修正）

| 盲区 | 本两函数的具体项 |
|---|---|
| ① 跨调用有状态 | ① action_key：`generate_admin_web_key` 双调用（首次 bootstrap 成功，第二次 `bootstrapped=false` / 非白名单 forbidden；事务 CAS 仅一侧成功，L491-506）；② action_seed：双调用种子补齐（第二次无新集合、admin_config 为 skip/无 patch）；③ action_env：`force_set_env` 写 `dev_until`+`force_expire_at`（L448-461），过期后再次调用 init-db 触发 L209-218 自动回退；④ zz action_misc：`cleanup_sim` / `cleanup_seed_orders` 双调用（第二次 cleaned=0）；`scene_demands` 的 `cleanup=true` 双调用 |
| ② 漏注入静默退化 | 机械扫描「index 提供的 ctx 键 ⊇ 各 handler 解构且体内真实使用的键」，排除四类误报（require 路径字符串、对象键名、解构行自身、同名局部） |
| ③ 成功路径未走通 | simulate（demand + user_account 落库计数）；service_orders（order_main S3 + confirmations + status_log）；night_orders（demand + 2 条 S2 单）；scene_demands（demand 计数）；backfill_matched（matched_openid 回填）；purge_test_data（先 dry-run 统计，再 `confirm:'PURGE'` 真删计数）；set_env（dev_until 落库）；generate_admin_web_key（admin_web_key 落库且 key 仅一次性返回）；种子分支（集合/索引/config 创建计数） |

## 7. 验证清单（每组必过）

- [ ] `node --check` 新文件 + index 全过
- [ ] index 无残留内联 `if (action === ...)` handler（grep 为空）
- [ ] A/B 意外差异 0；KNOWN_EVOLUTION 每例有独立守护测试
- [ ] 三类盲区各有独立测试/静态核对结论
- [ ] `npm test` 只增不减
- [ ] `npm run verify:offline` 全绿（含 check-handlers / check-index-ledger / check-require-scope）
- [ ] 无真实循环 require（grep `require('./index')` 仅剩注释文字）
- [ ] HANDLERS 无重复导出键（Object.assign 静默覆盖检查）

## 8. 风险与卡点

1. **行号漂移**：v1 行号已失效，切割一律用 marker 字符串，不按行号。
2. **原型键误分发**：`HANDLERS[action]` + `Object.assign` 普通对象，`constructor/toString` 等键会被误命中 → 统一加 `hasOwnProperty` 判定。
3. **重复键覆盖**：两 handler 文件不得导出同名 action；提交前 grep 检查。
4. **部署窗口**：两函数测试期活跃，串行部署、单函数、避开造数操作；部署中会有短暂 `Updating` 冲突风险。
5. **zz-seed-orders 部署状态存疑**：文件头写「保留: 不部署」，须 Phase 0 核实后再决定是否部署。
6. **index 常量保留**：SEED_CONFIG/COLLECTIONS/INDEXES/CONTENT 等留 index 属 skill 允许的「共享 helper/常量」，本方案不以行数为唯一目标。
7. **配额门控**：部署前确认余量；并行只允许只读核查。
8. **注释行号过时**：init-db L220「由 L472 独立门控」为旧行号，拆分时可选校正（仅注释）。

## 9. 待用户确认

1. 配额余量 / 是否授权后续部署。
2. 顺序：建议 init-db 先（4 组、675 行），再 zz-seed-orders（5 组、1074 行）。
3. 每组独立 commit 授权（按组逐次）。
4. zz-seed-orders 是否确需重新部署（Phase 0 核实结果为准）。
5. `hasOwnProperty` 防护是否纳入本次拆分（推荐纳入，零行为变更硬化）。

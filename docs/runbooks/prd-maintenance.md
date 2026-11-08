# PRD 维护与漂移防护（prd-maintenance）

> 用途：明确「什么情况下必须同步改 PRD」以及改的先后顺序，接到现有 CHANGELOG / FUNCTION-REGISTRY 台账纪律，不另造并行流程。
> 真值优先级：云端回读 > 代码实测 > 台账（CHANGELOG / FUNCTION-REGISTRY / deploy-log）> PRD > 助手记忆。

## 1. 分层机制

| 层 | 做什么 | 谁执行 |
|---|---|---|
| 机械比对层 | `scripts/check-prd-drift.js` 把 PRD 中可量化的断言与代码/台账实际值逐项比对，不一致即 FAIL | 机器（只读，不改文件） |
| 判断层 | 现状/规划/冲突定性、口径取舍、待确认项归类 | 人（脚本只校验锚点有效性，不自动改写） |

机械层当前覆盖：订单状态码集合、主包/分包/合计页面数、云函数目录数与业务函数数、集合声明/运行时/合计、附录 J 配置键、FUNCTION-REGISTRY 条目数、自定义组件数、后台视图数。
判断层锚点：文件路径、`文件:行号`、`REGISTRY #N`、`§X.Y`、`附录X` 必须真实存在，失效即 `FAIL [ANCHOR]`。

## 2. 触发条件（任一命中，必须同步改 PRD）

| 变更类型 | PRD 落点 | 台账动作（同一次变更内完成） |
|---|---|---|
| 订单状态码 / 流转规则 | §8.1、附录 B/G | CHANGELOG 追加一行；功能验收状态变化时同步 FUNCTION-REGISTRY |
| 主包 / 分包 / 页面增删 | §11.1、§15.1 | CHANGELOG 追加一行 |
| 云函数目录 / 业务函数增删 | §11.1、§15.2 | CHANGELOG + deploy-log（部署记录） |
| 数据库集合增删 / 声明与运行时分类变化 | §11.1、§16.1 | CHANGELOG 追加一行 |
| 配置键增删 / 默认值或区间变化 | 附录 J、§8.4 | CHANGELOG；涉及未落地能力时同步技术债台账 |
| 后台视图 / 运营 action 变化 | §5.1、附录 T | CHANGELOG；可验收项同步 FUNCTION-REGISTRY |
| 功能从「未实现/待验证」转为「已验证」 | §11、附录 T/U | **先**改 FUNCTION-REGISTRY（状态 + 日期 + 验收步骤），再改 PRD |
| 体验版号 / 上传体积 / 提审状态 | §11.1、附录 H | deploy-log + CHANGELOG，再改 PRD |

判断性内容（是否保留某规划、冲突以哪侧为准）不因脚本通过而自动改变；需要人明确拍板后才写入 PRD。

## 3. 同步顺序（单一链路）

1. 改代码/配置，并完成可自证项（语法、Console、Network、单测）。
2. 同一次变更内更新 `docs/CHANGELOG.md`：日期｜变更内容｜可能影响的功能｜回归结论。
3. 功能验收状态有变化时，更新 `docs/FUNCTION-REGISTRY.md`：功能｜涉及文件｜验收步骤｜状态｜验证日期。
4. 更新 PRD 对应章节/附录，只写实测值；未落地内容标【未落地规划】，不写不存在路径。
5. 运行 `node scripts/check-prd-drift.js`，**EXIT=0 才算完成**；FAIL 时按输出修订 PRD 或修复锚点，禁止绕过。
6. 提审/发布前按既有门禁跑 `npm run verify:offline`（本门挂载获批后自动包含在内）。

## 4. 门禁用法

```powershell
node scripts/check-prd-drift.js
# EXIT=0：机械断言一致 + 锚点全部有效
# EXIT=1：输出「PRD 写的 / 实际是 / 依据文件:行」，或 FAIL [ANCHOR] 定位失效锚点
```

挂载方式（需批准后执行，不在本文档内直接改）：

- `package.json` 新增 `"check:prd": "node scripts/check-prd-drift.js"`；
- 在 `verify` 与 `verify:offline` 末尾追加 `&& node scripts/check-prd-drift.js`；
- `scripts/check-gate-mounts.js` 的 `VERIFY_ONLY` 增加 `'check-prd-drift.js'`。

## 5. 失败处理

- `FAIL [DRIFT]`：以「依据」为准修订 PRD 的对应行；若是代码先改了而 PRD 未跟，补 PRD，不改代码去迁就文档。
- `FAIL [ANCHOR]`：引用文件已删/改名 → 更新引用；`REGISTRY #N` 不存在 → 补台账条目或改引用；章节/附录编号变化 → 同步引用。
- 连续两次修不好或两侧证据冲突：按项目规则停手上报，不继续盲改。

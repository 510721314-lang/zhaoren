# Ch4 · 开发约定与协作规范

> 事实来源：项目既有工程约定（`project_memory` Engineering Conventions）与代码实测。

## 4.1 工作目录与防漂移

- **唯一工作目录 = `C:\zhaoren`**。多目录克隆同一仓库会导致开发者工具编译旧代码。
- 新开任务前做三合一工作目录校验：`Test-Path` + `git remote -v` + `project.config.json` 的 appid。
- 重启后 node/git 可能不在系统 PATH：用全路径 `C:\Program Files\nodejs\node.exe`、`C:\Program Files\Git\bin\git.exe`。

## 4.2 命名与提交

- 提交信息格式：`type(scope): description`（如 `fix(order): …`、`feat(admin): …`）。
- 备份文件统一存放于 `c:\zhaoren-bak`。

## 4.3 共享模块开发约定（核心）

`_shared/` 多副本是本项目最重要的工程约定，**改动纪律**：

1. 只改 `_shared/<module>.js` 规范源，**不要**直接改各云函数里的副本。
2. 运行对应 `sync-<module>.ps1` 把规范源复制到各消费者目录。
3. `npm run verify` 中的 `check-shared-sync` 会以 SHA-256 校验所有副本与规范源一致；不一致即拦截。
4. 有意变体（`admin-action/openid.js`、`init-db/openid.js`）不参与同步，改它们需手工同步。

**为什么这么做**：微信云函数按单目录打包，无法共享依赖；强行抽公共依赖会破坏打包。务实方案 = 规范源 + 门禁强校验。

## 4.4 云函数拆分规范

巨型 `index.js`（线性 `if(action===...)` 链）按 action 组抽离为**同级 `action_*.js` + HANDLERS 分发 + ctx 注入**：

- **零行为变更**：拆分以「拆分前后 action 输入输出逐字节等价」为验收核心，通过等价性重放 fixture 验证，不得仅依赖单元测试。
- handler 依赖的顶层变量通过 **deps 注入**传入，不得 `require` 主模块（避免循环依赖）。
- 不创建子目录，避免破坏 `_shared` 同步脚本的路径匹配。
- 单组增量搬移：每组完成后立即跑静态检查 + 单测 + 等价性重放，全绿才继续下一组，每组独立提交便于回退。

## 4.5 小程序端约定

- **统一云调用入口**：所有页面/组件的云调用必须走 [utils/cloud.js](file:///c:/zhaoren/miniprogram/utils/cloud.js) 的 `callCloud`（等 `cloudReady`、读重试 2 次/写不重试、单次超时 6s、注入 device）。仅初始化链路保留直调以避免循环依赖。
- **设计 token**：[miniprogram/styles/tokens.wxss](file:///c:/zhaoren/miniprogram/styles/tokens.wxss) 统一色彩/间距；深色模式下**必须用主题变量**（如 `var(--text-1)`）替代硬编码色值，否则深底深字隐形。
- **组件配置完整性**：修改页面 `.json` 后检查组件声明与配置项完整，避免组件找不到。
- **样式修改一次性覆盖同类控件**，避免逐点补丁（历史上深色模式文字隐形曾分三轮才修完）。
- **原生控件坑**：`<button>` 与 `<input>` 同行时键盘失焦会吞 `bindtap` → 改用 `<view bindtap>`。
- **时间渲染**：WXML 中避免调用 Page 方法绑定（如 `{{fmtTime(x)}}` 真机不渲染），改为 JS 预计算字符串字段。
- **前端变更后**执行清缓存 + 重新编译 + 体验版升级再验证，避免旧缓存导致结果失真。

## 4.6 配置与文案一致性

- **场景中文映射全仓同步**：涉及 order-action / im-conv / im-send / payment-mock / home-action / admin-action 等的 `SCENE_CN/SCENE_NAME/SCENE_NAMES` 常量，统一由 `scene_meta.js` 规范源产出。
- **订单概况同源**：订单列表、消息页、订单详情页的概况统一由 `buildOrderSummary` 生成。
- **跨端配置一致性**：`demand-publish` 的 `SCENE_CODES_FALLBACK` 每个 code 必须存在于前端 `enums.SCENES`（由 `check-ssot.js` 门禁校验）。
- **配置生效延迟提示**：admin 端所有配置保存成功后统一提示「约 5 分钟内生效」（受云函数缓存影响）。

## 4.7 数据、索引与导出约定

- **新增集合必须同步两处导出白名单**：`admin-action` 的 `EXPORT_COLLECTIONS` + [.predeploy/backup.ps1](file:///c:/zhaoren/.predeploy/backup.ps1) 的 `$COLLECTIONS`。
- **索引台账（`index_ledger.json`）≠ 云端实际索引**：一切以 tcb 扫描为准；`node scripts/tcb-scan-indexes.js` 全量扫描落盘，`node scripts/tcb-exec.js <cmd.json>` 执行（含 createIndexes，务必 `background:true`）。
- 索引/集合类命令行操作优先 `@cloudbase/cli`（tcb）v3；PowerShell 传含引号 JSON 易被剥引号，一律走包装器（JSON 文件 + `spawnSync` 数组传参，见 [scripts/tcb-exec.js](file:///c:/zhaoren/scripts/tcb-exec.js)）。

## 4.8 测试约定

- 纯逻辑共享模块改动须同步补 `*.test.js`（零依赖，Node 内置 `node:test`）。
- 用例**自包含**：每条 test 用重置函数避免模块缓存副作用导致的顺序依赖。
- mock 需模拟**真实语义**（如带 DB 过滤语义、`db.command` 哨兵），确保测试有效。
- 入口层契约测试可用可编程内存 mock 拦截 `wx-server-sdk`，无需改运行时代码，覆盖 action 分发/鉴权/返回码。

## 4.9 文档归档约定

- 走查方案、实现文档、设计流程图统一归档至 [docs/](file:///c:/zhaoren/docs)，便于追溯设计决策与技术红线。
- 技术经验沉淀入 `.trae/skills/`（可复用技能）与项目记忆，供后续会话直接调用。

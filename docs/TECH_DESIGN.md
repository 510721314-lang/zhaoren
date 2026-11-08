# TECH_DESIGN · 技术开发手册（卷首总纲）

> 定位：技术文档体系的**卷首**——只讲定位、约定、门禁与目录导读，不重复各章正文。
> 事实源：代码（`miniprogram/`、`cloudfunctions/`、`scripts/`、`package.json`）+ 云端回读。冲突时以代码为准，并记入 [CHANGELOG.md](CHANGELOG.md)。
> 冻结说明：原 13 文件《技术开发手册》（[dev-manual/00-index.md](dev-manual/00-index.md)）已于 2026-11-08 冻结，内容按下表迁入本体系。

## 1. 事实源与真值优先级

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | 代码 + 云端回读 | `tcb fn detail` / `tcb fn code download` / 控制台用量 |
| 2 | [PRD/PRD.md](../PRD/PRD.md) | 需求正本（V2.0，区分已实现／部分实现／未实现／已废弃） |
| 3 | 台账 | [CHANGELOG.md](CHANGELOG.md)、[FUNCTION-REGISTRY.md](FUNCTION-REGISTRY.md)、[deploy-log.md](deploy-log.md) |
| 4 | 交接稿与会话记忆 | 仅作旁证，不作凭据 |

**硬规则**：文档与代码冲突 → 改文档 + 在 CHANGELOG 留痕。禁止"只改文档不记变更"。

## 2. 技术形态速览

| 组成 | 位置 | 形态 |
|---|---|---|
| 小程序端 | [miniprogram/](../miniprogram) | 原生微信小程序（无框架），`pages-v2` 主包 19 页 + 4 分包 26 页 |
| 云函数层 | [cloudfunctions/](../cloudfunctions) | 微信云开发 Node.js，20 个业务函数 + `_shared` 规范源 |
| 后台管理端 | [admin-web-frontend/](../admin-web-frontend) | SPA 源码；构建产物托管在 `cloudfunctions/admin-web/public` |
| 后端能力 | 微信云开发环境 | 云数据库 + 云存储 + 定时触发器，**无自建服务器** |

## 3. 文档地图

| 文档 | 职责 | 本体系的来源 |
|---|---|---|
| [README.md](README.md) | 总入口与角色阅读路径 | 新建 |
| [PRD.md](PRD.md) | PRD 指针页 | 新建（正文在 `PRD/PRD.md`） |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 拓扑、请求链路、定时链、配置单一源、目录地图、action 清单 | 合并 dev-manual Ch1 + Ch2 |
| `DATA_MODEL.md` | 集合/字段/索引/配置键 | 改写 dev-manual Ch3（R4） |
| `API.md` | 20 函数入口契约 + 高频 action | 新建（R4） |
| `COMPONENTS.md` | 25 个组件规格 | 新建（R5） |
| `PAGE_SPEC.md` | 45 个页面规格 | 新建（R5） |
| `RELEASE.md` | 发版、提审、灰度、回滚、值班 | 合并 dev-manual Ch7 + `runbooks/`（R6） |
| [AGENTS.md](AGENTS.md) | AI/工程师须知（纯指针） | 新建 |
| [CODE_DOC_MAPPING.md](CODE_DOC_MAPPING.md) | 代码 ↔ 文档双向索引 | 新建 |

## 4. 工程约定（只列结论，细则见代码与规则）

1. **统一云调用入口**：页面一律经 `utils/cloud.js` 的 `callCloud`，禁止直接 `wx.cloud.callFunction`（初始化链路除外）。
2. **读写策略由 action 名决定**：见 [app.js cloudCall](../miniprogram/app.js) 的 `WRITE_RE`；写类不重试，读类重试 2 次。
3. **金额一律"分"**：双整数，前端展示再除 100（规则红线，见 `.trae/rules` 附录 A）。
4. **状态机单源**：`_shared/order_state.js` → 副本；改规则只改规范源再跑 `sync-order-state.ps1`。
5. **配置单一源**：云端 `admin_config` 集合 + `CONFIG_SCHEMA`；跨端一致性由门禁保证。
6. **共享代码禁跨目录 require**：微信云函数按目录打包，必须"规范源 + 复制 + SHA 门禁"。

## 5. 门禁

```powershell
npm run verify:offline   # 24 道静态检查 + auto-test-s2-change + npm test
npm run verify           # 同上，但 check-deploy-config 走在线回读
npm test                 # node:test 单测 + _shared/ab_equivalence.js
```

静态检查清单（`package.json` 实序）：`check-syntax`、`check-miniprogram-syntax`、`check-ssot`、`check-collections-consistency`、`check-config-defaults`、`check-shared-sync`、`check-sub-msg-consistency`、`check-no-desktop-injection`、`check-require-scope`、`check-handlers`、`check-index-ledger`、`check-cloud-timeout-policy`、`check-location-timeout-policy`、`check-deploy-config`、`check-rules-size`、`check-rule-refs`、`check-secrets`、`check-manual-links`、`check-doc-links`、`check-ledger-placeholders`、`check-once-prompts`、`check-nightmask`、`check-test-globs`、`check-gate-mounts`。

> 文档相关两道门禁的**已知边界**：`check-doc-links.js` 当前不覆盖 `docs/*.md` 根层（R8 扩白名单）；两道链接门禁只校验文件存在，**不校验 `#锚点`**。

## 6. 常见任务 → 该读哪一章

| 任务 | 先读 |
|---|---|
| 新增/修改页面 | [ARCHITECTURE.md](ARCHITECTURE.md) §7 目录地图 → `PAGE_SPEC.md` → `API.md` |
| 新增云函数 action | `API.md` → `ARCHITECTURE.md` §9 `_shared` 机制 → `DATA_MODEL.md` |
| 改后台配置项 | `DATA_MODEL.md`（CONFIG_SCHEMA）→ `RELEASE.md`（发布顺序） |
| 发一版 / 回滚 | `RELEASE.md` → [runbooks/deploy.md](runbooks/deploy.md) |
| 排查线上异常 | [runbooks/troubleshooting.md](runbooks/troubleshooting.md) → `ARCHITECTURE.md` §2/§3 |
| 接手项目第一天 | [README.md](README.md) → [AGENTS.md](AGENTS.md) → 本文件 |

## 7. 文档写作纪律

1. 每条结论带 `文件:行号`；不写"大概/可能"。
2. 不臆造路由、接口字段、集合字段、action 名；对不上标【待后端确认】。
3. 不写凭据明文（AppID / AppSecret / 环境 ID / admin key）。
4. 数字类事实必须与 `app.json`、目录枚举、`init-db` 同源；旧稿数字一律复测。
5. 登录、支付、权限、隐私结论单列「待人工确认」。

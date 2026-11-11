# AGENTS.md · 接手者须知（纯指针页）

> 本文件**只放指针，不复制规则正文**。规则唯一源是 [.trae/rules/](../.trae/rules/)，本页与规则冲突时以规则为准。
> 适用对象：AI 助手、新接手工程师。业务与需求请读 [PRD/PRD.md](../PRD/PRD.md)。

## 1. 开工必读（顺序不可跳）

1. [project-rules-core.md](../.trae/rules/project-rules-core.md) §0–§9（常驻规则）
2. [FUNCTION-REGISTRY.md](FUNCTION-REGISTRY.md)（已验证功能与人工验收步骤）
3. [CHANGELOG.md](CHANGELOG.md)（近期变更与回归结论）
4. 现行交接稿 [HANDOFF-20261111.md](HANDOFF-20261111.md)（未闭合项与下一步）
5. `npm run verify:offline` 取基线（失败即停，不得绕过）

## 2. 规则指针表（按场景查）

| 场景 | 读哪个文件 |
|---|---|
| 最小改动 / 先说后做 / 回答格式 / 收尾沉淀 | [project-rules-core.md](../.trae/rules/project-rules-core.md) §0–§9 |
| 业务红线（订单状态机、超时、信用分、四确认、AA、金额、模拟支付、SOS、青少年、场景白名单、评价） | 同上，**附录 A** |
| §10–§39 实证型高危条款（全文） | [project-rules-full-20261029.md](../.trae/documents/project-rules-full-20261029.md) |
| 规则索引与区间映射 | [project_rules-20261013.md](../.trae/rules/project_rules-20261013.md) |
| 真值优先级 / 冻结期约束 / 每轮开工顺序 | [zhaoren-release-freeze.md](../.trae/rules/zhaoren-release-freeze.md) |
| 提审填报（隐私指引、接口权限、订阅模板、合法域名） | [pre-release-filing-checklist.md](runbooks/pre-release-filing-checklist.md) |
| 隐私配置与真机链路 | [privacy-filing-20261108.md](runbooks/privacy-filing-20261108.md) |
| 部署与排障 | [deploy.md](runbooks/deploy.md) ／ [troubleshooting.md](runbooks/troubleshooting.md) |
| 备份与恢复 | [backup-restore.md](runbooks/backup-restore.md) |

## 3. 硬边界（只列条目号，不复述条文）

- 单次改动默认 ≤3 文件 / ≤30 行，超出先问 → core §1
- 高危改动区（`app.json`、`project.config.json`、`project.private.config.json`、渲染引擎、基础库、`_shared`、登录态、接口字段）先说清后果 → core §3 / §4
- 已验证代码（`// @VERIFIED`）不得擅改 → core §2
- 禁止假修复（try/catch 吞异常、setTimeout 盖时序、注释掉代码） → core §7
- 提交三类隔离：业务代码 / docs 台账 / 测试基础设施 → core §9
- 文档与代码冲突以代码为准，并在 CHANGELOG 留痕

## 4. 门禁命令

```powershell
npm run verify:offline   # 24 道静态检查 + 场景自测 + npm test（含文档链接、规则体积、SSOT、A/B 等价）
npm test                 # node:test 单测 + A/B 等价
node scripts/check-doc-links.js
node scripts/check-manual-links.js
node scripts/check-prd-drift.js
```

## 5. 证据纪律

- 结论必须带 `文件:行号`；禁止「大概 / 可能」式定位。
- 云端结论以回读为准（`tcb fn detail` / `tcb fn code download` / 控制台用量）。
- **不臆造**页面路由、接口字段、集合字段；对不上的一律标【待后端确认】。
- 登录、支付、权限、隐私相关结论单列「待人工确认清单」，不写成既成事实。

## 6. 文档维护

- 本文件**只改指针**；要改规则，改 `.trae/rules/`（注意规则总体积硬上限）。
- 新增/删除文档时，同步 [README.md](README.md) 文档地图与 [CODE_DOC_MAPPING.md](CODE_DOC_MAPPING.md)。

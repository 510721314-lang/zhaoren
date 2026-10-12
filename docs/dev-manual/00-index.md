# 找人帮忙 · 技术开发手册

> 本手册是**技术实现的权威记录**，以**代码为唯一事实源**（2026-10 实测）。
> 定位：脱离任何产品需求文档（PRD）独立自含——业务域、数据模型、状态机均在本手册内完整描述，不指向外部文档。
> 凡本手册表述与代码不一致，以代码为准，并应提 issue 修正手册。

## 阅读指南

| 卷 | 章 | 文件 | 内容 |
|---|---|---|---|
| 卷一 架构底座 | Ch1 | [01-architecture.md](file:///c:/zhaoren/docs/dev-manual/01-architecture.md) | 系统总览与运行拓扑 |
| | Ch2 | [02-module-map.md](file:///c:/zhaoren/docs/dev-manual/02-module-map.md) | 目录结构、云函数与页面模块地图 |
| 卷二 工程规范 | Ch4 | [04-conventions.md](file:///c:/zhaoren/docs/dev-manual/04-conventions.md) | 开发约定与协作规范 |
| | Ch5 | [05-redlines.md](file:///c:/zhaoren/docs/dev-manual/05-redlines.md) | 硬约束与不可触碰红线 |
| | Ch6 | [06-quality-gates.md](file:///c:/zhaoren/docs/dev-manual/06-quality-gates.md) | 质量门禁与自动化校验 |
| 卷三 交付运维 | Ch7 | [07-deploy-release.md](file:///c:/zhaoren/docs/dev-manual/07-deploy-release.md) | 部署与发布流程 |
| 卷四 业务实现 | Ch3 | [03-data-model.md](file:///c:/zhaoren/docs/dev-manual/03-data-model.md) | 数据模型与配置（CONFIG_SCHEMA） |
| | Ch9 | [09-business-domains.md](file:///c:/zhaoren/docs/dev-manual/09-business-domains.md) | 业务域实现（含订单状态机全图） |
| | Ch10 | [10-ops-runbook.md](file:///c:/zhaoren/docs/dev-manual/10-ops-runbook.md) | 运维手册 |
| | Ch11 | [11-docs-index.md](file:///c:/zhaoren/docs/dev-manual/11-docs-index.md) | 文档与经验索引 |
| | 附录 | [90-appendix.md](file:///c:/zhaoren/docs/dev-manual/90-appendix.md) | 术语表/留存负债/实现决策台账/变更记录 |

## 事实底座

本手册的所有事实依据集中于 [00-factbase.md](file:///c:/zhaoren/docs/dev-manual/00-factbase.md)（云函数/action 清单、`_shared` 副本映射、页面→云函数映射、门禁链、部署链路）。
写正文与修订手册前应先核对该文件。

## 手册硬性规则

1. **以代码为唯一事实源**：所有结论必须有代码出处（`file:///` 链接到具体文件/行）。
2. **不写凭据明文**：环境 ID / AppID / AppSecret / admin key / 加密密钥一律只写「存放位置与读取机制」，不写值。
3. **自含**：业务概念在本手册内定义，不要求读者查阅 PRD。
4. **链接可校验**：手册引用的文件路径由 `scripts/check-manual-links.js` 在 `npm run verify` 中强制校验存在性。

## 主仓库布局（速览）

```
c:\zhaoren
├── miniprogram/           小程序端（原生微信小程序，pages-v2 + 4 分包）
├── cloudfunctions/        云函数（20 业务函数 + _shared 规范源）
├── admin-web-frontend/    后台管理端（Vue3 SPA，构建后落入 cloudfunctions/admin-web/public）
├── scripts/               门禁/运维脚本（check-*.js、gate.ps1、部署辅助）
├── .predeploy/            预部署脚本（backup/restore/smoke-check）
├── docs/dev-manual/       本手册
├── package.json           测试与门禁入口
├── project.config.json    小程序项目配置（含 appid，勿外传）
└── cloudbaserc.json       云开发环境配置（含 envId，勿外传）
```

# 找人帮忙 · 文档总入口

> 微信原生小程序 + 微信云开发（云函数 / 云数据库 / 云存储）+ admin-web 运营后台。
> 本文件是**唯一总入口**：先看这里，再看具体文档。所有结论以代码为唯一事实源。

## 一、按角色读

| 角色 | 阅读顺序 |
|---|---|
| 新接手开发 | 本页 → [AGENTS.md](AGENTS.md) → `ARCHITECTURE.md` → `DATA_MODEL.md` → `PAGE_SPEC.md` / `COMPONENTS.md` → `RELEASE.md` |
| 接手运营 / 发布 | 本页 → `RELEASE.md` → [runbooks/README.md](runbooks/README.md) → [release-zero-checklist.md](runbooks/release-zero-checklist.md) → [troubleshooting.md](runbooks/troubleshooting.md) |
| AI 助手 | 本页 → [AGENTS.md](AGENTS.md)（含 `.trae/rules` 指针）→ [HANDOFF-20261108.md](HANDOFF-20261108.md) |
| 产品 / 需求评审 | [PRD.md](PRD.md)（指针页）→ [PRD/PRD.md](../PRD/PRD.md) → 附录 T / 附录 U |

## 二、文档地图

### 2.1 产品层

| 文档 | 内容 | 状态 |
|---|---|---|
| [PRD.md](PRD.md) | PRD 指针页（正文在 `PRD/PRD.md`，不复制） | 已就绪 |
| [PRD/PRD.md](../PRD/PRD.md) | 需求正本 V2.0：21 章 + 附录 A–U，区分已实现／部分实现／未实现／已废弃 | 已就绪（唯一正本） |

### 2.2 技术层

| 文档 | 内容 | 状态 |
|---|---|---|
| [TECH_DESIGN.md](TECH_DESIGN.md) | 技术手册卷首：事实源原则、约定、门禁、模块总览 | 已就绪 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 三端一朵云拓扑、请求链路、定时链、配置单一源、`_shared` 副本机制、action 清单 | 已就绪 |
| [DATA_MODEL.md](DATA_MODEL.md) | 集合与字段、索引台账、`admin_config` 配置键、状态码口径（数字与 `check-prd-drift.js` 同源） | 已就绪 |
| [API.md](API.md) | 20 个云函数入口契约（触发/鉴权/入参出参/错误码/幂等/集合）；`order-action` / `payment-mock` / `admin-action` 高频 action 详表 | 已就绪 |
| [COMPONENTS.md](COMPONENTS.md) | 25 个自定义组件：props / events / 使用页面 / 拆分边界 / 已知偏差 | 已就绪 |
| [PAGE_SPEC.md](PAGE_SPEC.md) | 45 个页面规格：路径 / 职责 / 生命周期 / 依赖组件 / 关键 data / 接口 / 异常分支 / 埋点；主包按业务域、分包按 pkgAdmin/pkgAgreement/pkgPrivacy/pkgLow 分组 | 已就绪 |

### 2.3 交付运维层

| 文档 | 内容 | 状态 |
|---|---|---|
| [RELEASE.md](RELEASE.md) | 发布全流程：环境 / 分支策略 / 构建 / 云函数部署 / 体验版与提审 / 灰度 / 回滚 / 监控值班 | 已就绪 |
| [runbooks/README.md](runbooks/README.md) | 运维 SOP 索引（部署、备份、密钥轮换、隐私填报、回归） | 已就绪 |
| [deploy-log.md](deploy-log.md) | 每次部署记录与回滚点 | 持续追加 |

### 2.4 台账与索引

| 文档 | 内容 | 状态 |
|---|---|---|
| [CHANGELOG.md](CHANGELOG.md) | 变更与回归结论（日期｜变更｜影响｜结论） | 持续追加 |
| [FUNCTION-REGISTRY.md](FUNCTION-REGISTRY.md) | 已验证功能清单 + 人工验收步骤 | 持续追加 |
| [tech-debt-inventory-20261105.md](tech-debt-inventory-20261105.md) | 技术债台账 | 持续追加 |
| [CODE_DOC_MAPPING.md](CODE_DOC_MAPPING.md) | 代码 ↔ 文档双向映射（差异自检底座） | 骨架已就绪 |
| [AGENTS.md](AGENTS.md) | AI / 工程师须知（纯指针，规则正文在 `.trae/rules/`） | 已就绪 |
| [audit-20261108-code-scan.md](audit-20261108-code-scan.md) | 最近一次静态扫描结论 | 历史快照 |

### 2.5 历史与冻结

| 文档 | 状态 |
|---|---|
| [dev-manual/00-index.md](dev-manual/00-index.md) | **已冻结**：13 文件技术开发手册（2026-10），现行内容迁入 2.2 各文档，仅作存档 |
| [HANDOFF-2026xxxx.md](HANDOFF-20261108.md) | 过程快照，仅现行一份有效 |
| `docs/session-log/`、`docs/onboarding-prompt-*.md` | 会话存档，不作真值 |

## 三、真值优先级

代码与云端回读 > PRD 正本 > 台账（CHANGELOG / REGISTRY / deploy-log）> 交接稿 > 会话记忆。

冲突处理：以代码为准 → 改文档 → 在 [CHANGELOG.md](CHANGELOG.md) 留痕。禁止只改文档不记变更。

## 四、门禁

```powershell
npm run verify:offline    # 24 道静态检查 + auto-test-s2-change + npm test
npm test                  # 单测 + A/B 等价
node scripts/check-doc-links.js      # live 文档链接可达性
node scripts/check-manual-links.js   # dev-manual 13 文件链接
node scripts/check-prd-drift.js      # PRD 与代码漂移
```

已知边界（写作时需自行规避）：

- `check-doc-links.js` 当前**不覆盖** `docs/*.md` 根层，R8 扩白名单后才纳入。
- 两道链接门禁**只校验目标文件存在，不校验 `#锚点` 有效性**；锚点正确性靠人工与 `check-prd-drift.js`（仅 PRD）。

## 五、写作约定

1. 每条结论带 `文件:行号`；不写「大概 / 可能」。
2. 不臆造页面路由、接口字段、集合字段、云函数 action；对不上标【待后端确认】。
3. 不写凭据明文（AppID / AppSecret / 环境 ID / admin key 只写存放位置与读取机制）。
4. 登录、支付、权限、隐私相关结论单列「待人工确认清单」。
5. 数字类事实（页面数、组件数、云函数数、集合数）必须与 `app.json`、目录枚举、`init-db` 同源，禁止沿用旧稿。

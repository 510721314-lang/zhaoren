# 技术评价报告（2026-10-06，专家评审）

> 基线文档：作为 docs/verification/cold-start-protocol.md（B3 冷启动验证）的对照基线。
> 评价对象：zhaoren「找个人帮忙」小程序（原生小程序 + 腾讯云开发 CloudBase，25 云函数 / 34 集合，单开发者）。

## 总体判断

工程化程度显著高于单人小项目平均水准，纪律性（门禁链、单测固化、防漂移、密钥治理）是亮点；**当前下限在「观测断层」与「知识资产裸奔」两处**。技术选型（原生小程序 + CloudBase）对单人 MVP 是正确且务实的。

## 一、已建立的良好实践

- **防漂移闭环**：共享规则模块（take_rules / money_rules / test_data / partner_audit）+ SHA256 同步校验 + CI 哈希拦截
- **测试纪律**：零依赖 node:test 108 条；「0 是合法值」「Number(null)===0」等真实教训已固化进用例
- **CI 红线清晰**：写路径测试不放 CI（无云凭据），静态检查 + 单测自动化
- **密钥治理**：全出库读环境变量（$env:AWK_KEY）、轮换 SOP、危险操作 confirm 门（SWITCH_DEV / PURGE）
- **运维安全三件套**：is_test 白名单打标、purge_test_data 默认 dry-run、error_scan 巡检
- **资金与并发**：runTransaction 事务化、CAS 状态机、接单互斥锁、前端防重入

## 二、显著风险（P0/P1/P2）

| 维度 | 级别 | 风险 | 现有缓解 |
|---|---|---|---|
| 可维护性 | **P0** | bus factor=1：project_memory/skills 全在 C 盘本地、不在 git，机器损坏即知识全失 | B1-B8 整改计划中 |
| 测试 | P1 | **观测断层**：order-timer 触发器疑似停摆约 5 个周期无告警——巡检函数本身缺少自观测 | 无（整改项：error_scan 心跳） |
| 部署 | P1 | CLI 串行手动部署 9 函数，无回滚机制，出错靠手工 | 无 |
| 部署 | P1 | config.json 的 triggers/timeout 不生效、触发器需控制台手工配（已知未解缺陷） | 文档记录 |
| 架构 | P1 | 25 云函数 + 34 集合平铺无领域分组；config 存 DB 无版本历史，配置改错无法回滚 | 无 |
| 架构 | P1 | sync 脚本是权宜之计（云函数无法 require 共享目录），新增消费方需手工维护 SYNC_MAP | check-shared-sync 拦截 |
| 测试 | P1 | 零云端集成测试（约束有意为之），smoke 依赖人工跑 | 回归清单人工抽验 |
| 安全 | P1 | admin 网关仅单层 X-Admin-Key，无 IP 白名单/速率限制 | 密钥轮换可达 |
| 安全 | P2 | DB 集合无 schema 约束；audit_log 无留存期限，数据无上限增长 | 集合权限配置 |
| 可维护性 | P2 | 文档无第二人验证过 | B3/B5 计划中 |

## 三、建议优先改善项

1. **P0**：B1 知识入 git（项目记忆、skills、runbook 同步进仓库）
2. **P1**：order-timer 心跳字段（每轮运行写 `error_scan_heartbeat_at`）——让「巡检没在跑」可被 smoke/gate 检测
3. **P1**：部署回滚能力——部署记录表 + 上一版代码包归档
4. **P1**：网关加固——IP 白名单或连续失败告警
5. **P2**：config 版本历史（config_set 已写 platform_event 留痕，补 config_history 集合即可）
6. **P2**：audit_log 留存策略（如 90 天归档）

## 一句话结论

选型务实、纪律出色；**首要工程债 = 知识资产入 git（B1）+ error_scan 心跳**，两者均不依赖第二人。
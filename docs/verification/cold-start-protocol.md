# B3 冷启动验证协议（cold-start protocol）

> 目的：验证 docs/runbooks 是否「真的可移交」——文档写得再好，没人照做过就是纸面资产。
> 方法：让一个**零项目记忆**的验证者只凭仓库内文件，独立走一遍接管入口，记录每个卡点。
> 每个卡点 = 文档一处漏洞，必须回写补全。报告落 docs/verification/cold-start-report-<date>.md。

## 规则（验证者必须遵守）

1. **零记忆**：不得读取任何会话记忆、project_memory、外部知识来源；唯一信息源 = c:\zhaoren 仓库内文件（入口：docs/runbooks/README.md）+ GitHub 仓库若可达
2. **真执行**：每条命令必须真实跑出输出才可写「通过」；跑不了的写「卡点」，禁止脑补
3. **不动工**：只读验证 + 写报告；不改任何代码/配置/文档（报告文件除外）、不部署、不动云
4. **卡点分级**：阻塞级（照文档做不下去）/ 模糊级（能做但依赖猜测）/ 瑕疵级（能做但有明显误导）

## 执行清单（两段）

### 第一段：10 分钟接管入口（README「新人 10 分钟接管入口」）

1. 环境自检：node 版本、git 状态
2. 独立跑门禁前 5 步（check-nightmask → check-ssot → check-syntax → check-shared-sync → npm test）
3. 尝试第 6/7 步（smoke / check-heartbeat）：预期因密钥缺失失败 → **记录门禁输出的报错信息是否足以让新人找到钥匙在哪**（答案应能从 key-rotation.md / README 找到）
4. 按 key-rotation.md 步骤 2 找「密钥存放位置」——记录该指引对一台新机器的适用性

### 第二段：六篇 runbook 通读核验

对 deploy / backup-restore / key-rotation / ops-runbook / audit-checklist / config-sync / troubleshooting 每篇：

- 每条命令逐条比对仓库真实文件（脚本是否存在、参数是否一致、路径是否真实）
- 标注与现状不符、无法核实、或换台机器就跑不动的条目（给出行号）
- 输出「该手册可按图索骥程度」打分（A 可照做 / B 需微调 / C 有阻塞）

## 产出格式（cold-start-report）

```markdown
# 冷启动验证报告 <date>
## 执行记录（每条命令 + 真实输出摘录 + 通过/卡点）
## 卡点清单
| # | 级别 | 位置 | 现象 | 建议回写 |
## 手册评分表（A/B/C + 一句理由）
## 总体结论（是否能独立接管 + 最痛的三处文档漏洞）
```
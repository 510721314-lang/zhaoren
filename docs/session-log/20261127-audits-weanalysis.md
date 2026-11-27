# 2026-11-27 We分析可视化日志分析 + Audits 自动化尝试

## 目标
用户给 `wedata.weixin.qq.com` 体验分析链接，要求跑 Audits 体验评分；分析可视化日志定位异常；沉淀经验入规则。

## 结论
1. **Wedata「体验分析」≠ 体验评分（Audits）**：`/mp2/experience/sessions` 是可视化日志/会话回放/热力图（用户行为分析），不给小程序打分。体验评分只能在开发者工具 GUI「工具→Audits」跑，Web 端无入口。已固化入规则 **§47**。
2. **可视化日志异常定位**：profile 弹「371 条新通知」= 测试号 `system_notice` 未读积压（**非 bug**，前后端逻辑都正确）。云端实测未读 top1=1001 条，top10 全是测试/种子号，无真实用户大积压。**仅观察，用户裁定不入技术债**。
3. **Audits 自动化尝试未果**：`miniprogram-automator` 改传 `wsEndpoint` 后 connect 成功，但调任何 API 报 `Remote debug connection lost`（DevTools 调试通道未就绪），轮询 120s 无果，回退手工。已固化入规则 §47。
4. **能力边界**：本会话无 computer-use MCP，`RequestAuthorization` 两次返回 `invalid_service`，无法操作桌面 GUI 点 Audits 开始/结束按钮——这类 GUI 按钮必须用户手动点。

## 证据（命令与实测值）
- **We分析**：browser_use 子代理扫码登录成功（账号「找个人帮忙」基础版）；DOM 全文搜不到「总分/首屏/渲染/内存/CPU/流量/可访问性」关键词；可视化日志 152 条（11-20~11-27），最新会话 11-27 14:14。
- **未读分布**（`tcb-exec` aggregate `system_notice`，只读）：全量 3635 条，近 7 天 +426；未读 top10 全测试/种子号——`oLDJ73VEzT_UTK-HfQgiFRV2LPA4`=1001、`oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c`=381（= 会话看到的 371，差 10 为会话后新增）、`test_partner_001`=124 等；真实用户未出现大积压。
- **automator 连接**：传 `{port:9420}` → 报 `Failed connecting to undefined`；改 `{wsEndpoint:'ws://127.0.0.1:9420'}` → connect OK；但 `currentPage()`/`reLaunch()`/`systemInfo()` 全报 `Remote debug connection lost`，轮询 120s 无果。
- **积压根因**：未读数 = `system_notice` 集合 `to_openid==本人 且 read==false` 全量 count（`cloudfunctions/order-action/action_query.js` L432）；标已读仅在「点单条通知」或「点全部已读」时触发（`pages-v2/pkg-low/notices/notices.js` L127/L188），**进 notices 列表不自动标**——测试号从不手动清理故积压。
- **规则配额**（落笔前）：`check-rules-size` inject 17733B/19456B，余量 1723B，max§ 46。

## 改动与提交
- **规则新增 §47**：`project-rules-core.md`（摘要区精炼条 + 标题区间 10–46→10–47）+ `project-rules-full-20261029.md`（归档全文，不计 inject 桶）+ `project_rules-20261013.md`（索引区间 §10–§46→§10–§47）。
- **技能修订 2 处**：`miniprogram-automation-test/SKILL.md` 补「连接与通道故障」小节；`mini-a11y-perf-check/SKILL.md` Audits 章补入口澄清。
- **HANDOFF**：`docs/HANDOFF-20261127.md` L116 T-24.3 标「用户暂缓」。
- **CHANGELOG**：追加 1 行。
- **本文件**：存档。
- **提交状态**：落笔中，待 `check-rules-size` 复跑 + `git status` 取证后单独 docs commit（不代 push，push 需用户单独授权）。

## 未决项
- **T-24.1** cleanup 测试单：等用户说「cleanup」（`node scripts/test-order-tool.js cleanup` 全量前缀软删）。
- **T-24.2** 是否提审 v1.6.33：用户决策（人工动作 AI 不代点）。
- **T-24.3** Audits：用户暂缓。
- **通知积压**：仅观察，未立项（用户裁定不入技术债）。未来真实用户通知量起来可能复现，属产品设计评估项。

## 下次入口
- 现行交接：`docs/HANDOFF-20261127.md`
- 规则 §47 全文：`.trae/documents/project-rules-full-20261029.md` L816 起
- 若重启 Audits：开发者工具 GUI → 工具 → Audits，截图发助手，对照「Audits 扣分维度 → 代码现状」预分析表（本会话已查实长列表/轮询/首屏现状）定位扣分点。
- 若重启 automator 自动化：先看规则 §47 + `miniprogram-automation-test` 技能「连接与通道故障」节；确保 DevTools 项目窗口激活 + 模拟器已编译渲染。

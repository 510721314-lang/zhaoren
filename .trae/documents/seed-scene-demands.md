# 填充各场景需求种子数据（方案A）执行计划

## Context（为什么做）
首页/广场按场景筛选需求时，除「游玩陪伴」外所有场景显示 0 条，是因为云端已发布的需求只有 1 条（且是「测试/李**」污染数据）。这不是代码 bug，是冷启动缺数据。目标：为 W1/W2/W3/W4/W7/W8/W9/W10/W11 各造 1~2 条**真实业务示例**需求，让首页/广场每个场景筛选后都能看到对应需求，并下线那条「测试」污染数据。**不改任何业务代码**（仅云端数据）。

## 前置事实（已调研确认）
- 广场展示条件：`status==='matching'` 且 `scene_code===activeChip` 过滤（square.js:179-195）；原料 `scene_code` 取自后端 `mapDemand()→d.scene`（home-action/index.js:77-116），与前端 enums.js 的 W1/W2… 码值对齐。
- 首页/广场云端数据源 = `home-action.scene_groups` / `square`，按每个场景查 `demand`，过滤 `is_deleted:false + status:'matching' + expire_at>now + broadcast:true`（home-action/index.js:134-142）。
- 造数据合规通道 = `demand-publish` 云函数，天然满足上述大厅展示条件（发布默认 `match_mode:'broadcast'`，`status` 初始 matching，`expire_at` 未来）。mock 调用有 `isMockCall` 旁路可跳过 GPS/距离校验（demand-publish/index.js:401-420），所以可用微信开发者工具「云端测试面板」以 mock 身份批量发布。
- 发布校验要点（demand-publish/index.js:276-300）：`scene` 必须在白名单、开始时间未来且≤30天、服务时段避开 00:00-06:00 红线、时长 1-12h、`rate_fen≥100分`。

## 执行步骤
1. **用 init-db 的 `action=quick_check`（云端测试面板）确认当前云端 demand 清单与 scene_list**，核对待造场景与现有测试数据的真实 scene 值。
2. **在云端测试面板，以 mock 发布者身份，用 demand-publish 生产式发布下列 seed 需求**（each `match_mode:'broadcast'`，`rate_fen` 用合理整数分值，开始时间取未来 2~14 天内、避开凌晨）、场景与标题示例（每场景 1 条，标题用真实业务示例，不用「测试」）：
   - W1 就医陪诊 → 「周末陪父亲去医院复查挂号排队」
   - W2 学习陪伴 → 「图书馆自习监督 + 英语口语陪练」
   - W3 健身陪伴 → 「健身房一对一安全保护与动作纠偏」
   - W4 游玩陪伴 → 「周末成都周边一日游结伴同行」
   - W7 情绪陪伴 → 「下班后散步倾诉 陪你聊聊放松」
   - W8 生活协助 → 「搬家整理 帮忙抬重物与打包」
   - W9 宠物陪伴 → 「出差两天 帮忙上门喂猫铲屎遛狗」
   - W10 出行陪伴 → 「高铁站接人 指引打车送到目的地」
   - W11 线上陪伴 → 「夜间线上陪你学习打卡相互督促」
3. **下线/清理污染数据**：对那条标题「测试」、发布者「李**」的需求，置 `is_deleted:true`（走 admin-action 或直接云端改，避免再进大厅/首页展示）。**不做物理删除**（保审计留痕）。
4. **复检**：云端测试面板 `quick_check` / 真机下拉刷新，确认每个场景都有需求、广场「全部」与各场景 chip 都能看到、测试数据不再出现。

## 不改代码
全程只写云端数据，**不触达任何已验收 tag 内文件**，无 git 改动、无部署。涉及文件仅只读参考：
- miniprogram/config/enums.js（W 码值对照）
- cloudfunctions/demand-publish/index.js（发布校验）
- cloudfunctions/home-action/index.js（广场/分组查询条件）

## 验证方式
- 云端：`init-db action=quick_check` 返回的 demand 列表应含 9 场景；测试数据的 is_deleted=true。
- 真机/开发者工具：首页「需求广场」左侧分类导航各场景显示 ≥1 条且卡片标题为业务示例；广场按场景 chip 筛选能出对应需求；「全部」下不再出现「测试」污染条目。
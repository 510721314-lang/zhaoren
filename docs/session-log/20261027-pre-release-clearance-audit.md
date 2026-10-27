# 提审前清零清单复核（按 §11 四态口径）

- 日期：2026-10-27
- 基线：HEAD `74dc558`
- 目的：纠正 F2 误判后，按 `project_rules-20261013.md` §11「状态口径与交叉取证」对提审前清零项逐条重新交叉取证，形成可存档、可交接的清单。

## 1. 目标

1. 用四态口径（`已完成` / `已配置·已申请` / `未核实` / `未完成`）重排提审前清零项。
2. 每项至少交叉 1 处代码或实测证据，禁止把“未勾选/无记录”写成“待办/未完成”。
3. 明确真正阻塞提审的项、待用户后台确认的项、以及台账陈旧项。

## 2. 结论

### 2.1 总体

- **真正阻塞提审的“未完成”仅 3 项**：C1 会话索引（复核后已建）、E1 v1.6.48 上传、B7 签名质量识别（且有口径冲突）。
- **F1/F4/B1–B6/C5/D2–D5 属“未核实”**：需后台、真机或门禁动作，不能写成“已失败/未做”。
- **已纠正 2 项误判**：
  - F2：由“待办”改为 **已配置/已申请**（代码已实现 + 用户 2026-10-27 确认已申请）。
  - F3：由“需实测”改为 **已完成（配置）**（云端实测 3/3 模板均有 `tmpl_id`，`miniprogram_state=trial`）。
- **P0-1 计数冲突已闭环**：REGISTRY 今日实测 **3 条**（#105–#107，严格=前缀=3）；tech-debt P0-1 的 28 条为 2026-10-16 旧快照，待订正。

### 2.2 逐项四态

| # | 事项 | 证据 | 四态分类 | 负责人 |
|---|---|---|---|---|
| F1 | 隐私保护指引 | `app.json` `requiredPrivateInfos`/`__usePrivacyCheck__`；审核态仅后台可见 | 未核实（后台） | 用户 |
| F2 | 位置接口权限 | 25 处 `getLocation/chooseLocation`（13 文件）；用户确认已申请 | 已配置/已申请（“已开通”未核实） | 用户 |
| F3 | 3 个订阅模板 | 云端实测：`demand_grab`/`demand_urge`/`confirm_comm` 均有 `tmpl_id`，`trial` | 已完成（配置）；实际到达未验 | 我/用户 |
| F4 | 合法域名 | `geo-wx.js:62`、`safety.js:225` 调 `apis.map.qq.com` | 已配置/未核实（后台白名单） | 用户 |
| F5 | 网关/密钥/白名单 | 2026-10-27 云端实测：`admin_openids` 2 条、`env=prod`、`mock_payment_enabled=true`、`auto_approve_partner=true`、`realname_face_mode=wx` | 已完成 | — |
| F6 | 提审版本文案 | runbook F6 文案已备，未提交 | 已配置/未完成（提交动作） | 用户 |
| B1 | 消息 Tab 复测 | `message.js`（commit `9f3ef7e`） | 已配置/未核实（待复测） | 用户 |
| B2 | 首页铃铛未读 | `user-login/action_account.js:380` `unread_notice` | 已配置/未核实（待复测） | 用户 |
| B3 | 我的页四段 IA | commit `158f049` | 已配置/未核实（待复测） | 用户 |
| B4 | 学习中心 57 章 | `partner-action/action_study_content.js`；HANDOFF §2 | 已配置/未核实（待验收） | 用户 |
| B5 | REGISTRY #105–#107 | 3 条“待验证”（代码完整、缺真机） | 已配置/未核实（真机） | 用户 |
| B6 | 真机双身份全链路 | — | 未核实 | 用户 |
| B7 | P0-4 签名识别 | `signature-canvas/index.js:69` 仅 `isEmpty()`，无质量识别 | 未完成（有反证）；与 T-7.10 冲突待拍板 | 用户 |
| C1 | `im_conversation` 两条索引 | 复核时 `listIndexes` 仅 4 条，目标两条不存在；**复核后已创建**（见 §4） | 原：未完成（有反证）→ 现：已完成（建后回读 6 条） | 我 |
| C2 | `admin_config` 基线 | 2026-10-27 云端实测 5 项符合 | 已完成 | — |
| C3 | P0-3 降频 | deploy-log 10-26/10-27：聊天 15s、`chat_poll`、order-timer 10min、`clearUnread` 省写 | 已完成；额度余量未核实 | 我/用户 |
| C4 | 触发器 | 10-26 `fn detail`：`zz-warmup` 空、`order-timer` 单触发器 10min | 已完成（10-26）；11-05 后恢复为 owed | 用户 |
| C5 | 索引扫描/差异 | 需重跑 | 未核实 | 我 |
| C6 | P0-1 计数 | tech-debt 28（10-16）vs REGISTRY 3（今日） | 实测已完成；台账订正未完成 | 我 |
| D1 | `verify:offline` | 2026-10-27 EXIT=0（tests 686/0、A/B 457 EQUIVALENT） | 已完成 | 我 |
| D2 | nightmask/ssot | 提审前需跑 | 未核实 | 我 |
| D3 | 全仓安全扫描 | 未执行 | 未核实 | 我 |
| D4 | mp-pre-release-audit + miniprogram-audit | 未执行 | 未核实 | 我 |
| D5 | 匿名越权回归 | 未执行 | 未核实 | 我 |
| D6 | `smoke-check.ps1` 6/6 | 2026-10-22 证据 | 已完成（5 天前）；提审前复跑 | 我 |
| E1 | v1.6.48 上传 | deploy-log 最新 1.6.47 | 未完成（有反证） | 我/用户 |
| E2 | 备份五通道 | 2026-10-27 full SUCCESS（2706s、38 表、raw 23001、lark=OK）、bundle verify OK | 已完成；GitHub 通道未完成（push 网络阻断） | 我 |
| E3 | 04:30 verify 复核 | 明日窗口 | 未核实 | 我 |

## 3. 证据（命令与实测值）

1. `npm.cmd run verify:offline` → `VERIFY_EXIT=0`；`tests 686 / pass 686 / fail 0`；`A/B EQUIVALENT: 457 cases`。
2. `git status --porcelain`（存档前）：`M cloudfunctions/init-db/index.js` + 6 份用户 SOP `??`。
3. `listIndexes im_conversation`（复核时）：`_id_`、`_openid_1`、`uk_order_id`、`idx_order_no`（4 条）。
4. `admin_config` 只读查询：`admin_openids` 2 条；`env=prod`；`mock_payment_enabled=true`；`auto_approve_partner=true`；`realname_face_mode=wx`；`sub_msg_templates` 3 个键均有 `tmpl_id`、`trial`。
5. REGISTRY 待验证计数：严格 `| 待验证 |` = 3，前缀 = 3；ID `#105/#106/#107`。
6. 旧误判实证：runbook §6 `- [ ] F2 位置接口权限显示「已开通」` 未勾选，被错误等同于“未申请/未实现”。
7. `signature-canvas/index.js` 仅有 `hasInk`/`isEmpty()`，无签名质量识别。

## 4. 复核后动作（与 E1/C1 直接相关）

### C1 索引

- 云端创建：`createIndexes` → `numIndexesBefore=4`、`numIndexesAfter=6`、`ok=1.0`。
- 回读确认：
  - `idx_user_last_msg` = `{user_openid:1, last_msg_at:-1}`，`background=true`
  - `idx_partner_last_msg` = `{partner_openid:1, last_msg_at:-1}`，`background=true`
- 设计台账：`init-db/index.js` 已追加两条声明；`dump-index-ledger` 产出 42 条。
- `tcb-scan-indexes.js` 重扫进行中（已见 `im_conversation: 6 个索引`），`check-index-ledger` 待扫描产物刷新后复核。

### E1 上传

- 尚未执行；待 C1 台账复核、`init-db` 提交与 `verify:offline` 复跑后，按 `cli.bat upload --project C:\zhaoren -v 1.6.48` 上传。
- 成功判据：`✔ upload` + TOTAL；随后登记 `docs/deploy-log.md`。

### 提交与推送

- 已本地提交：`3c33842`、`49c17f5`、`67c320f`、`74dc558`。
- GitHub push 仍被网络阻断：`github.com:443` 不通、`127.0.0.1:7890` 未监听、baidu:443 通（定向阻断）；待恢复后补推并 `ls-remote` 核对。
- 未提交：`cloudfunctions/init-db/index.js`（C1 声明）。

## 5. 未决项

1. **C1 收尾**：`tcb-scan-indexes` 完成后跑 `check-index-ledger`；提交 `init-db`；评估是否部署 `init-db`（代码已改，未部署）。
2. **E1**：v1.6.48 上传 + `deploy-log` 登记 + docs 提交。
3. **B7/P0-4**：签名识别是否提审前实施，需用户拍板（tech-debt 写“必须清零”，T-7.10 写“禁动代码”）。
4. **F1/F4/F6**：后台隐私指引、域名白名单、提审文案仍待用户操作。
5. **B1–B6**：真机/复测项仍待验证。
6. **C5/D2–D5**：索引扫描、nightmask/ssot、安全扫描、微信审核审计、匿名越权回归仍待跑。
7. **E3**：明日 04:30 `verify` 以本次 full 为新基线后复核。
8. **GitHub push**：网络恢复后补推 4 个提交。

## 6. 下次入口

1. 复核 `check-index-ledger`（需刷新 `.tmp-tcb/indexes-actual.json`）。
2. `git add cloudfunctions/init-db/index.js` → 提交（业务/工具链类）→ `verify:offline`。
3. 上传 v1.6.48 → 登记 `docs/deploy-log.md` → docs 提交。
4. 重试 `git push`（网络恢复后，绕代理/直连按 §15 判读）。
5. 按 §5 未决项继续推进 F1/F4/F6、B1–B6、C5、D2–D5。

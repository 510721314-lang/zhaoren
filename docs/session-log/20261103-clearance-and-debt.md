# 2026-11-03 应清零事项与技术负债清单

## 1. 目标

接手 `docs/HANDOFF-20261103.md` 后，按现行台账与今日实测，输出「提审前应清零事项」与「技术负债清单」，作为后续会话的单一入口。

## 2. 结论

- **REGISTRY 严格 `| 待验证 |` = 0 条**；带注记的待真机 = **2 条**（#132 方案A 计数、#133 存量订阅兼容），均随体验版 **v1.6.76** 待真机。
- 提审前最紧的是 **P0-3 配额（周期截止 2026-11-05）** 与 **P0-5 订阅实效（#132/#133 + `confirm_comm` 真机）**；`demand_grab` 自动链路为既定站内降级，不修、不阻塞提审。
- 提审通过后必须关闸的两项：**P1-6 `realname_face_mode` mock→wx + 清打标**、**P1-7 `auto_approve_partner` 复核 false**（后者 2026-11-01 已置 false，技术债 P1-7 行文本待同步）。
- 本会话已完成 **T-7.32**（冻结规则 3 处订正 + 交接稿实测回写），commit `6a72da7`；**已 push**（`7543934..b8dfa3c`），HEAD=origin/master=`b8dfa3c`、ahead=0。

## 3. 证据（命令与实测值）

| 项 | 命令/来源 | 实测值 |
|---|---|---|
| HEAD / origin | `git rev-parse HEAD` / `git rev-parse origin/master` | HEAD=`b8dfa3c`；origin/master=`b8dfa3c`；ahead=0 |
| 门禁 | `npm run verify:offline` | **EXIT=0**；tests **807/807**；A/B **451 EQUIVALENT** |
| 规则体积 | `node scripts/check-rules-size.js` | inject **16081B/30720B**（+55B）；conditional 1011B；max§ 37 |
| 规则引用/链接/占位/挂载 | `check-rule-refs` / `check-doc-links` / `check-ledger-placeholders` / `check-gate-mounts` | 652 文件 795 处 / 22 文档 38 链接 / 1079 文件 / **23 门禁**，全 PASS |
| push 通道 | `Test-NetConnection 127.0.0.1 -Port 7890` | 首轮 **False**（未监听）；系统代理 `ProxyEnable=0`；DNS `20.205.243.166`（非 fake-IP）；节点恢复后探活转 True，push 成功 `7543934..b8dfa3c` |
| push 失败原文 | `git push origin master` / `git -c http.proxy= push` | `Failed to connect ... over proxy 127.0.0.1`；直连 `Recv failure: Connection was reset` |
| 配额 | 控制台 2026-11-02 回传 | 18.32 万/20 万（91.6%），周期 10-06~11-05 |
| 两档配置 | 云端回读（2026-11-01 / 10-27） | `env=prod`；`realname_face_mode=mock`；`auto_approve_partner=false`（11-01 回读） |

## 4. 改动与提交

- 本会话已改 3 文件并提交：`.trae/rules/zhaoren-release-freeze.md`（T-7.32 三处：§1/§4 指针 `20261031`→`20261103`、§3 授权行改「按需/单会话/不继承」）、`docs/HANDOFF-20261103.md`（T-0.2/T-0.3/T-8.6 实测回写 + §2 旧表述回写）、`docs/CHANGELOG.md`（追加本批一行）。
- commit：`6a72da7 docs(rules): T-7.32 冻结规则订正与交接稿实测回写`（3 files, +8/−7）。
- 本文件为新增 docs 制品，commit `b8dfa3c`，已随 `7543934..b8dfa3c` push。

## 5. 未决项

### 5.1 应清零（提审前 / 提审通过后）

| # | 事项 | 当前状态 | 清零判据 | 执行人 |
|---|---|---|---|---|
| 1 | P0-3 调用配额 | 91.6%，11-05 截止，11-01 决定不加购 | 重置前只读+串行；重置后按 T-7.30 恢复 `zz-warmup` 单触发器并复测 ≤1500/天 | 我（只读）/ 你授权 |
| 2 | T-8.1 #133 存量订阅兼容 | 已部署 4/4 SHA MATCH，差真机 | 存量布尔第 2 次催办有额度收微信、无额度收站内；`sub_msg_send_logs` 有 `sent_count`/`channel:'local'` | 你真机 v1.6.76 |
| 3 | T-8.2 #132 计数状态机 | 已部署 7/7 SHA MATCH，差真机 | 授权 2 条→两次各收 1→用尽自动关→补充恢复 | 你真机 v1.6.76 |
| 4 | T-7.8.2 `confirm_comm` | `sub_msg_send_logs` 中 0 条 | 四确认沟通一次，微信送达 + 日志 ok | 你真机 |
| 5 | P0-5 微信端实收 | `demand_urge` 已 7 ok / 7×43101 | 微信端目视一次 | 你真机 |
| 6 | P1-6 mock 人脸关闸 | prod `realname_face_mode=mock` | 提审通过后：①`config_set` 改 `wx`；②`realname_reset_simulated` | 我出方案/你批准 |
| 7 | P1-7 `auto_approve_partner` | 已置 false（11-01 回读） | 复核 false + 清测试期自动通过档案；同步 P1-7 行 | 我（只读） |
| 8 | T-7.13 提审安全关闸双动作 | 未执行 | 按 runbook 逐项勾选留证 | 你 + 我 |
| 9 | T-7.14 部署前 `zhaoren-audit` | 常设 | 每次部署前跑审计留证 | 我 |
| 10 | T-7.27 首页加载症状 | 待确认 | 症状四选一或重测后才可改首页 | 你 |
| 11 | T-8.5 症状 2/3 | 待你指明页面/按钮 | 明确复现路径 | 你 |
| 12 | T-8.7 未跟踪 7 项/8 文件 | 原样未动 | 你定入库/忽略 | 你 |
| 13 | T-8.6 push | **已闭环 2026-11-03**（`7543934..b8dfa3c`，ahead=0） | 无需再执行 | — |

### 5.2 技术负债（仍未偿还）

| 级别 | 条目 | 状态/口径 |
|---|---|---|
| P0 | P0-3 配额 | 时间敏感，见 5.1 |
| P0 | P0-5 订阅实效 | 方案A 已实施，差 #132/#133 真机 |
| P1 | P1-1~P1-5 | 有意保留的兼容/挂起面，禁回切 |
| P1 | P1-6 mock 人脸 | 提审通过后关闸 owed |
| P1 | P1-7 auto_approve | 已置 false，条目待同步 |
| P2 | P2-2 页面级单测缺口 | 纯函数已补，setData/跳转靠真机 |
| P2 | P2-3 `_orig_baseline.js` 9 份冻结 | 已接受 |
| P2 | P2-4 `_shared` 多副本 | 门禁已守，改规范源必跑 sync |
| P2 | P2-7~P2-10 快照/横幅/八步链 | 已实施；八步链 #107 已真机验证，快照/横幅未单独回归 |
| P3-1 | 空 catch 163 处 | 多数有意；窄类约 20 处提审后专项 |
| P3-2 | `testmode.js` 死开关 | 保留 |
| P3-3 | 两处手机号明文 | 暂缓，提审后独立立项 |
| P3-5 | S2_5 存量兼容 | 随存量订单消亡 |
| P3-8 | 系统转争议不写 `complaint` | 已裁定不修 |
| P3-10 | KNOWN_EVOLUTION 3 条 stale | 提审后清理 |
| P3-12 | `order_main(status,_id)` 索引 + `audit_log` 清理 | 仍 owed |
| P3-13 | 前端异常批次 A1~A5 | 提审后评审分批 |
| P3-14 | `navigateTo` 静默吞错 | 低危，提审后修 |
| P3-15 | 法律合规 U2 遗留 8 项 | 提审期不修，①③④ 优先 |
| P3-16 | 信用分两源 | 提审后轻量修 |
| P3-17 | 工作台占位区块 | 提审后接数据或隐藏 |
| P3-20④ | 首页冷启动多一次 `peek_login` | 随下次首页改动 |
| B-1 | 备份互斥锁 | 已加锁，待备份窗复核 |
| B-2 | lark 异地推送 | 三任务 WorkingDirectory 已修，待最新日志复核 |
| B-3 | 集合名单三处硬编码 | 变更需三处同步 |
| B-4 | 飞书备份目录清理 | 保留最近 5 份，解冻后脚本化 |

### 5.3 代码/流程待办

| 编号 | 事项 | 前置 |
|---|---|---|
| T-8.3 | 三处 `update` 改 `sub_msgs.<key>: _.set(patch)` | 等 T-8.1 真机通过后立项出方案 |
| T-8.4 | `splitting_fen` 与 `total_income_fen` 口径核对 | 只读，随时可做 |
| T-8.6 | push 4 个本地提交 | **已闭环 2026-11-03**（ahead=0） |

## 6. 下次入口

1. 先读 `docs/HANDOFF-20261103.md` §7（T-7.x/T-8.x）与本文件 §5；
2. 真机批次：按 REGISTRY #132/#133 在 v1.6.76 验，通过后补 `// @VERIFIED` 并转「已验证」；
3. 代码批次：T-8.1 通过后可启动 T-8.3（批 2 原子写），动前按 §3 出方案；
4. 配额窗口：2026-11-05 重置后按 T-7.30 恢复保温触发器并复测；
5. push：代理 7890 就绪后单次 `git push origin master`，失败即停（§35）。

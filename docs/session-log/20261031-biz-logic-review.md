# 商业逻辑与业务流程审查（评审类会话存档）

- 日期：2026-10-31
- 性质：只读评审（零代码 / 云函数 / 配置 / DB 改动）
- 交付物：`docs/shencha/业务逻辑审查报告-20261031.md` + 回填后的 `docs/shencha/shenha.xlsx`

## 1. 目标

对「找人帮忙」小程序做商业逻辑与业务流程审查：还原用户侧 + 服务端 + 后台运营侧真实业务流程，核查计费 / 分账 / 抽佣 / 优惠券 / 退款 / 爽约 / 纠纷 / 权限，重点查 8 个断点（订单状态机闭环 / 爽约违约 / 实时撮合 / 资金安全 / 身份合规 / 聊天隐私 / 评价纠纷 / 幂等并发），输出六模块报告 + P0/P1/P2 问题 + 回填 shenha.xlsx。

## 2. 结论

- **订单状态机 SSOT 闭环**：`_shared/order_state.js` 16 态 + 30 条 TRANSITIONS + 正交位（eval_state/dispute_state/frozen/fund）+ `casTransition` CAS 乐观锁，主状态机本身闭环；前端 `enums.js` 13 展示态经 `normalizeStatus`（`.→_`）与云端映射一致。
- **资金安全**：`money_rules.js` 抽佣默认 10%（`DEFAULT_FEE_RATE_FEN=1000`）+ mock 支付冻结 → 确认完成才结算（`settle_state pending→done`）→ 退款原路返回，账务本身闭环；但「平台资金池」与 BP「服务商直连分账、资金不过平台账户」构成 **P0 商业模型冲突（ISS-001）**。
- 共 **12 个问题**：P0×2、P1×6、P2×4（见报告「三、商业规则冲突」与「六、未决问题」）。
- **xlsx 发布闸门（05）COUNTIF 依赖 02 表 G 列（严重级）**；原模板 G 列残留样例值会误判「可发布」，已纠正为「仅 8 项不通过定级、其余置空」，闸门现显示「❌ 不发布」。

## 3. 证据（命令与实测值）

1. 结构清点：云函数 21 目录 + `_shared` 规范源；26 集合台账（`docs/dev-manual/03-data-model.md`）。
2. 8 断点取证锚点：`cloudfunctions/_shared/order_state.js`（16 态/30 TRANSITIONS）、`miniprogram/config/enums.js`（13 态/9 场景）、`cloudfunctions/_shared/money_rules.js`（`DEFAULT_FEE_RATE_FEN=1000`）、`cloudfunctions/_shared/no_show_rules.js`（零赔付/48h 窗口/逾期不自动关闭）、`partner-apply/index.js:186`（`auto_approve_partner===true`）、`user-login/action_account.js:177/181-183`（`face_mode='wx'` 一律拒）。
3. shenha.xlsx 解包：6 sheet、无 sharedStrings（全 inline `<t>`）、`[Content_Types].xml` 2000B。
4. `fill-shenha.js` 回填 sheet2/3/4/5 → EXIT 0；`fill-g.js` 纠正 G 列 → EXIT 0。
5. 六个 worksheet XML 经 `[xml](Get-Content -Raw)` 解析**全部 well-formed**。
6. 重新打包（PowerShell `System.IO.Compression`）：**15 entries**、`[Content_Types].xml` 居首、size 26496 → **30931 B**；抽查 `sheet3.xml` `G6=P1` / `G14=P0` = True。
7. 问题台账 12 条：ISS-001/002 = P0、ISS-003~007 = P1、ISS-008~012 = P2。

## 4. 改动与提交

- 新增 `docs/shencha/业务逻辑审查报告-20261031.md`（15,465 B）。
- 覆盖回填 `docs/shencha/shenha.xlsx`（原文件备份于 `%TEMP%\shenha_x\shenha.bak.xlsx`）。
- 临时脚本（工作区外，不入库）：`fill-shenha.js` / `fill-g.js` / `pack-xlsx.ps1`。
- **未执行 git commit/push**：shenha.xlsx 此前口径为「保留本地不入库」（见 CHANGELOG 2026-10-31「新机就绪回执」行），待用户确认是否将审查报告 + 回填后的 xlsx 一并入库。

## 5. 未决项

1. **ISS-001** 资金路由拍板：直连分账（需新增分账接口）vs 平台持牌 / 备案（法务 + 产品）。
2. **ISS-002** 实名：接微信官方人脸核验 or 维持 mock（提审前必须关闸，见 2026-10-27 CHANGELOG「realname_face_mode→wx」owed 项）。
3. **ISS-003** 爽约：补自动判定 + 限时原路退款。
4. **ISS-004/005**：接单锁改 fail-closed + 接单侧 accuracy / GCJ-02 校验。
5. **ISS-006**：上线前复核清零 `auto_approve_partner`。
6. **ISS-007**：增加评价申诉 + 客服核销通道。
7. **ISS-008~012**：优惠券 / 定时器频率 / 释放清 `matched_openid` / 举证逾期关闭 / 分场景佣金，产品定是否本期做。

## 6. 下次入口

1. 打开 `docs/shencha/业务逻辑审查报告-20261031.md`，按六模块逐条评审。
2. 提审前必须清零 P0（ISS-001/ISS-002），并同步更新 shenha.xlsx 03 表状态。
3. 复核 xlsx 05 发布闸门由「❌ 不发布」→「✅ 可发布」的线上演进。
4. 按需立项修复 P1 六项（走 §3 先说后做 + 单次 ≤3 文件 / 30 行）。
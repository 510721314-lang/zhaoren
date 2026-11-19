# 会话执行报告 · 2026-11-19 第三轮综合技术评审全周期（增量评审 8 项 → 双代理交叉审核 N1-N7 → 方案C → 部署 → 推送 → admin-web 发布）

> 按 §9 会话存档纪律落盘（六段结构）。本报告承接同日二轮报告 `20261119-tech-review-round2-execution-report.md`。
> 本轮 HEAD 演进：`d820293e`（开工）→ `f9b6cc1d`（代码+测试）→ `a0b6e2b1`（台账）→ `bab11e35`（部署登记）→ `bdab9688`（台账收口，已推送实证）。

## 一、目标

用户指令链：①对本项目技术作第三轮综合评审（增量，聚焦前两轮零覆盖面：admin-web-frontend / home-action / blog-action / demand-match / order-create / payment-mock 提现 / user-login 实名 / _shared / app.js）→ ②用户采纳方案 A 执行原 8 项 → ③对已完成提交作**双代理交叉审核**（同步专家审核执行结果）→ ④发现新增 N1-N7，用户采纳**方案 C**（修 N1-N4，N5-N7 登记 tech-debt 下轮收敛）→ ⑤建索引 / 提交 / 部署前归档 / 串行部署 8 云函数 / SHA 回读 / admin-web 前端发布 → ⑥生成完整执行报告（本文件）。

## 二、结论

- **评审（原 8 项）**：双代理增量评审（A 扫 admin-web-frontend/home-action/blog-action/demand-match/order-create/payment-mock/user-login/_shared/app.js；B 定点抽查 29 核对点）。A 主动证伪 5 项自己的初判。立项 **8 项**：R3-1（后台 STATUS_MAP 附录G 订正）、R3-2（BUSY_STATUS 补三瞬态）、R3-3（注销 PII 残留，**2/2 双命中**）、R3-4（withdraw_review key 模式死锁）、R3-5（app.js WRITE_RE 补 publish/like/unlike）、R3-6/R3-7（blog 封禁拦截 + like 幂等 + 评论计数防负）、R3-8（首页 overview 排除封禁）、R3-17（钱包 credit_score 字段订正）。
- **交叉审核（N1-N7）**：双代理（A 结构猎手扫 12 文件 + B 定点抽查 4 高风险文件）发现 **2 项 P3 + 5 项 P4**。2/2 双确认：N1（blog_like 唯一索引缺失→like 幂等死代码）、N3（dup-key 正则未对齐 isDupKeyErr 范式）、N7（like 未加封禁拦截）；1/1 主对话读码实证：N2（user-login ACTIVE_ORDER_STATUS 缺瞬态）、N4（S3_6 文案逐字不一致）、N5/N6。用户采纳方案 C。
- **修复**：原 8 项 + N1-N4 全部落地；N5-N7 登记 tech-debt 下轮。
- **验证**：`verify:offline` EXIT=0（fail 0、A/B 455 EQUIVALENT）；相关契约 101/101（finance 11 含 2 新例 / blog-action 新建 4+2 例等）；manifest 87 文件/**1178 用例**；语法 7 文件 EXIT=0；check-index-ledger **50/50**。
- **部署**：部署前 bundle 归档 `zhaoren-deploy-20261119-170809.bundle`（verify OK）→ 8 云函数串行 success 8/8 → `tcb fn code download` 回读逐文件 SHA256 **109/109 MATCH**（0 mismatch）→ 标记串全在云端。
- **admin-web 发布**：`npm run build` ✓ 4.11s → `cloudbase hosting deploy --safe` 成功 → 线上 index.html 引用 `assets/index-BTpBOctF.js` 与本地 MATCH。
- **推送**：直连绕代理 push 四笔，每笔均经 `ls-remote origin master` 实证远程 SHA == 本地 HEAD（§44）。

## 三、证据（命令与实测值）

| 证据项 | 实测值 |
|---|---|
| N1 索引前置查重 | `tcb nosql` 读 blog_like 12 条，重复 (post_id, openid) 组数 = **0** → 可安全建唯一索引 |
| N1 建索引回执 | `tcb createIndexes` 建 `uk_post_openid (post_id:1, openid:1) UNIQUE` → 回执 `numIndexesBefore 2 → 3, ok:1`；`listIndexes` 回读 `blog_like \| uk_post_openid \| post_id:1, openid:1 \| UNIQUE` |
| N1 设计台账 | `cloudfunctions/init-db/index.js:104` 补 `{ coll:'blog_like', name:'uk_post_openid', keys:{post_id:1,openid:1}, unique:true }`；`dump-index-ledger` → `check-index-ledger` **50/50 通过**（1 既有 WARN：legal_doc 集合设计超前，非本次引入） |
| N2 代码 | `cloudfunctions/user-login/index.js:33` `ACTIVE_ORDER_STATUS = ['S0','S1','S2','S2_5','S2_6','S3','S3_6','S3.5']`（:31 注释标明评审修复 N2） |
| N3 代码 | `cloudfunctions/blog-action/index.js:24` 新增 `function isDupKeyErr(e)`（对齐 order-create/action_take.js 范式：判 `errCode/code==='11000'` 或匹配 `/E11000\|duplicate key\|duplicate_key/i`）；:302 like 分支 `if (isDupKeyErr(e)) { likeDup = true; }` |
| N4 代码 | `admin-web-frontend/src/utils/format.js:50` `S3_6: '履约完毕确认中'`（逐字对齐 order_state SSOT） |
| 测试增强 | `cloudfunctions/_shared/_mock_sdk.js:88-89` `add` 加 opt-in `addReject`（函数或对象，默认关零影响）；`_shared/blog-action.entry.test.js` +2 例：dup-key 幂等不计数 / errCode=11000 漏判修复（敏感断言） |
| 全量门禁 | `npm run verify:offline` EXIT=0（fail 0、A/B 455 EQUIVALENT）；blog-action 6/6；manifest 87 文件/**1178 用例** |
| 提交 | `f9b6cc1d`（15 文件 +227/−15：业务 9 / 测试 3 / manifest 1 / 前端 format 1 / app.js 1）→ `a0b6e2b1`（docs 台账 + 二轮报告入库，3 文件）→ `bab11e35`（部署登记 + #184 部分已验证，2 文件）→ `bdab9688`（admin-web 发布登记 + #184 收口，2 文件） |
| 部署前归档 | `C:\zhaoren-bak\zhaoren-deploy-20261119-170809.bundle`（`git bundle verify` → "is okay"） |
| 部署 | DevTools CLI `--remote-npm-install` 串行 8 函数 success=true：order-create(14/35.9KB)、demand-match(7/13.0)、user-login(13/34.5)、admin-action(51/126.5)、blog-action(6/11.1)、home-action(11/24.4)、payment-mock(14/31.3)、init-db(11/24.8) |
| SHA 回读 | `tcb fn code download` 逐文件 SHA256 **MATCH=109 / MISMATCH=0**；标记串全在云端：init-db `dev_until`+`uk_post_openid`、admin-action `login_locked`、blog-action `isDupKeyErr`(:24/:302)、user-login `S2_6`、home-action `nin`、payment-mock `credit_score` |
| admin-web 发布 | `npm.cmd run build` ✓ 4.11s → `cloudbase hosting deploy ./dist --safe -e cloud1-d9gkefwcp5c777088` 成功；线上回读 `https://cloud1-…tcloudbaseapp.com/` index.html 引用 `index-BTpBOctF.js` 与本地 MATCH |
| push | 直连 `-c http.proxy=` 推 `d820293e..bdab9688` 区间四笔；每笔 `ls-remote origin master` 实证远程 SHA == 本地 HEAD（最终远程 = `bdab968878a7337b490865906fd20e946947c195`） |

## 四、改动与提交

### 4.1 修复落点（原 8 项 + 交叉审核 N1-N4）

| # | 级别 | 问题 | 修复 |
|---|---|---|---|
| R3-1 | P3 | 后台 STATUS_MAP 5 处与 PRD 附录G 错位 + 缺 S2_5/S2_6/S3_6/S10_5 → 仲裁误导 | `admin-web-frontend/src/utils/format.js` STATUS_MAP 按附录G 订正 + 补 4 态 |
| R3-2 | P3 | order-create / demand-match BUSY_STATUS 缺 S2_5/S2_6/S3_6 → 改期/履约确认窗口双重预约 | 两处 BUSY_STATUS 补三瞬态（与 R2-3 SOS 白名单同批教训） |
| R3-3 | P3（2/2） | user-login 注销未清 phone_enc/phone_hash/phone_mask → PII 密文残留合规缺口 | `user-login/action_account.js` 注销补清三项 |
| R3-4 | P3 | admin-action withdraw_review 双人复核启用时 key 模式参与 → review1_by:'' falsy 碰撞死锁/单人双审 | `action_im_kefu.js` key 模式一律拒 `wr_need_account` |
| R3-5 | P3 | app.js WRITE_RE 漏 publish/like/unlike → 写类误归读类自动重试 2 次 | `miniprogram/app.js` WRITE_RE 补三项 |
| R3-6/7 | P3 | blog 封禁/冻结账号可发帖评论；like 无幂等；重复删评论计数可负 | `blog-action/index.js` 封禁拦截 `account_restricted` + like dup-key 幂等 + comment_delete 前置 |
| R3-8 | P3 | home-action overview 未排除封禁账号 → 封禁账号上首页 | `action_feed.js` overview 对齐 square `nin` 口径 |
| R3-17 | P3 | payment-mock balance_info 字段 score→credit_score 订正 → 钱包信用分/等级恢复 | `payment-mock/action_account.js` 字段订正 |
| **N1** | P3（2/2） | blog_like 无唯一索引 → 并发双击 like_count 重复计数，like 幂等分支实际死代码 | 建 `uk_post_openid (post_id,openid) UNIQUE`（前置查重 0 重复）+ 补 init-db 台账 + check-index-ledger 50/50 |
| **N2** | P3（实证） | user-login ACTIVE_ORDER_STATUS 缺 S2_5/S2_6/S3_6 → 改期中间态用户可注销，门禁同源缺口 | `user-login/index.js:33` 补三瞬态（与 R3-2 同口径） |
| **N3** | P3（2/2） | blog-action dup-key 判定用 `/duplicate/i`，漏判 `errCode=11000`/`E11000` → 幂等失效 | 新增 `isDupKeyErr(e)` 对齐 action_take.js 范式，like 分支改用 |
| **N4** | P4（实证） | 后台 S3_6 文案「完毕确认中」与 order_state SSOT「履约完毕确认中」逐字不一致 | `format.js:50` 逐字对齐 |

### 4.2 方案 C 裁定点（用户 2026-11-19）

- **修 N1-N4**（已落地，见 4.1）。
- **N5/N6/N7 登记 tech-debt 下轮收敛**：N5 partner-action BUSY_STATUS 缺瞬态；N6 注销 surname/real_name 残留；N7 like/unlike 封禁拦截（取决于产品意图「封禁账号能否点赞」，需用户先拍板）。

### 4.3 提交清单

| commit | 内容 | 文件 |
|---|---|---|
| `f9b6cc1d` | fix(第三轮评审方案C): N1-N4 + blog_like 唯一索引建账 + 原 8 项 | 15 文件 +227/−15（业务 9 / 测试 3 / manifest 1 / 前端 1 / app.js 1） |
| `a0b6e2b1` | docs(台账): N1-N4 入账（CHANGELOG/REGISTRY #184 补验收⑨-⑫）+ 二轮会话报告入库 | 3 文件 +87 |
| `bab11e35` | docs(deploy-log): 8 云函数部署 + 109/109 SHA 回读 + 索引实证 + #184 部分已验证 | 2 文件 +2/−1 |
| `bdab9688` | docs(台账): admin-web 发布登记 + #184 状态收口 | 2 文件 +2/−1 |

### 4.4 台账落盘

- `docs/FUNCTION-REGISTRY.md` **#184**（待验证 → 部分已验证；验收⑨-⑫ 补登；admin-web 已发布 / like dup-key 已补 mock 单测 / N5-N7 登记下轮）
- `docs/CHANGELOG.md` 2026-11-19 两行（原 8 项 + 交叉审核 N1-N4）
- `docs/deploy-log.md` 2026-11-19 两行（#486 云函数部署 / #487 admin-web 发布；回滚点 `f9b6cc1d^`，部署前 bundle 已归档）

## 五、未决项

| 项 | 状态 | 入口 |
|---|---|---|
| 体验版上传（app.js R3-5 WRITE_RE 生效） | 待上传（DevTools CLI `cli upload`，可能遇端口超时，历史踩坑） | REGISTRY #184 标注「体验版待上传」；可随下批或本轮补传 |
| N5/N6/N7（partner-action BUSY_STATUS / 注销 surname 残留 / like 封禁拦截产品意图） | 登记 tech-debt 下轮收敛；N7 需用户先拍板「封禁账号能否点赞」 | tech-debt 台账 |
| 云端行为实测抽验（REGISTRY #184 挂账项） | 待云端测试面板或真机抽验：①并发双击 like_count 仅 +1；②S2_5/S2_6/S3_6 订单用户注销被 `close_has_active_orders` 拒；③后台 S3_6 标签显示「履约完毕确认中」；④封禁账号发帖/评论被 `account_restricted` 拒；⑤后台 STATUS_MAP 13 态逐字对齐 | 云端测试 mock_openid / 后台订单列表 / 真机 |
| REGISTRY #182/#183 云端实测项（前两轮遗留） | 同状态挂抽验，可与本轮合并一批做 | 同上 |
| 3 个用户 .docx 未跟踪（禁动） | 持续存在 | 用户自行处置 |

## 六、下次入口

1. 每轮开工照常：读现行 HANDOFF「下一步」→ `npm run verify:offline` 基线（预期 EXIT=0 / A/B 455 / manifest 87 文件 1178 用例）。
2. 三轮评审累计修复：首轮 5 + N1/N2，二轮 7，三轮 8 + N1-N4 = **22 项**，云端均已部署回读闭环；剩余提审唯一阻塞仍为 **T-7.3**（隐私指引，待人脸类目资质）。
3. 下轮顺手项：①三轮 REGISTRY #182/#183/#184 云端行为实测合并一批（CLI mock_openid 打非法态 + 并发双击造单 + 冻结/封禁账号观察）；②补传体验版（app.js WRITE_RE）；③N5-N7 收敛（N7 先问产品意图）。
4. 今日部署 1 批 8 函数次 + admin-web 发布，配额消耗留意色区（下一批部署前查余量）。
5. 唯一索引铁律归位：`init-db` 声明 `{unique:true}` ≠ 线上已建，必须 `tcb listIndexes` 引擎回执实证（N1 已走通完整链路，可作范本）。

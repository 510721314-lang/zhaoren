# 找人帮忙项目技术负债清单（刷新版）

> 盘点日期：2026-10-15
> 基线：HEAD `ab9de38`（本地=origin/master，分叉 0/0，工作区干净）
> 数据来源：FUNCTION-REGISTRY/CHANGELOG/deploy-log 实测 + 代码扫描（空 catch、文件行数、eol、引用关系均当场命令核实）
> 继承：`docs/tech-debt-delivery-report-20261012.md`（10-09～10-12 六批整改已偿还项不在本单重复列）
> 维护约定：每条债务处置后在本文件标注「已偿还(日期/commit)」或「已决策不处理(原因)」，并同步 FUNCTION-REGISTRY/CHANGELOG。

## 总览

本会话（2026-10-15 后半段）已偿还 6 项：deploy-log 10-15 台账欠账、阶段 G 两阈值硬编码（#71 后台化）、线上 confirmHours=2 误配、payment-mock CRLF/LF 伪漂移（.gitattributes）、zz-seed 文件头误导注释、订阅 trial→formal 发布操作入册。

**当前剩余主体是「真机验证缺口」**（26 条 REGISTRY 待验证），其次是有意保留的兼容面与提审后再治的结构性债。

---

## P0 · 提审前应清零或确认（2 项）

| # | 负债 | 最新状态 / 证据 |
|---|---|---|
| P0-1 | **26 条 REGISTRY「待验证」** | 实测 ID 全集：6,9,10,11,12,16,17,21,23,24,26,27,28,34,40,41,59,60,61,62,63,64,65,67,68,71。最高优先 **#67 阶段 G 真机**（S2.6 15min/S3.6 30min 超时→S10.5、双次拒绝升级）；阈值现已可后台设 1 分钟造数（见 #71），验毕改回 15/30。#71 仅需 admin-web 页面抽看即可转已验证。挂起口径：#61/#65 验收=确认前端无残留调用，**不回开入口** |
| P0-2 | **v1.6.6 版本号四次复用隐患** | 10-15 四次 upload 均为 v1.6.6「流程优化」，mp 后台无法仅凭版本号区分包次（已登 deploy-log 10-15 备注）。下次 upload **必须递增版本号** |

已偿还（本会话）：~~deploy-log 10-15 四批部署行欠账~~；~~阶段 G 两阈值硬编码~~（commit `4f68d93`，REGISTRY #71，已部署+网关 config_get 实证+download SHA MATCH）；~~线上 confirmHours=2 误配~~（网关 config_set 改回 24，复核 {24,72,2,4}）。订阅 trial→formal 已转为发布日操作（见 `docs/runbooks/audit-checklist.md`「正式发布当天操作清单」），不再计债。

---

## P1 · 有意保留的兼容/挂起面（5 项，纪律禁回切/禁擅改）

| # | 负债 | 证据 | 口径 |
|---|---|---|---|
| P1-1 | 旧 `start_service`（状态机 no.5 直连 S2→S3）服务端保留、无前端入口 | `cloudfunctions/order-action/action_lifecycle.js:149` | 收口属状态机改动，须单独书面授权 + 向后兼容方案 |
| P1-2 | 旧 `complete_service`（no.13 直连 S3→S5）保留共存 | `cloudfunctions/order-action/action_lifecycle.js:687` | 同上 |
| P1-3 | `start_photo`（REGISTRY #65）服务端保留、S3 前端入口已移除（凭证前置到 S2） | REGISTRY #65 | 验收=确认前端无残留调用，不回开 |
| P1-4 | demand-match `hall_list` 标 deprecated 仍在线（广场已走 home-action.square） | `cloudfunctions/demand-match/index.js:389` | 下线前须确认无旧版客户端调用 |
| P1-5 | MVP 禁做项的代码 TODO：短信发送占位、人脸三分支占位；#64 mock 现金（is_mock=true） | `user-login/action_auth.js:45`、`user-login/action_account.js:165` | 产品决策债，商业化批次偿还；禁止接真实打款 |

---

## P2 · 结构性债（5 项，平台/历史约束，多有机制兜底）

| # | 负债 | 证据 | 评估 |
|---|---|---|---|
| P2-1 | **前端巨型页面**：order-detail.js 1656 行 + order-detail.wxml 470 行；publish.js 1296 行 + publish.wxml 309 行 | `miniprogram/pages-v2/order-detail/`、`pages-v2/publish/` | 履约链每次需求都改 order-detail，回归面持续扩大。云函数 9 入口已物理拆分收官（REGISTRY #51–#58），前端仅批 5.4 抽过纯映射。建议提审后立项，当前禁动 |
| P2-2 | **前端零单测**：437 单测全部在 cloudfunctions/_shared | `cloudfunctions/_shared/*.test.js` | 页面 setData/跳转/按钮态纯靠真机。与 P2-1 同批：先抽纯函数再补测 |
| P2-3 | **9 份 `_orig_baseline.js` 约 1.07 万行冻结常驻并随函数部署**（运行时永不 require） | 9 个拆分函数目录下 | project_rules §10 禁删/改名/改——A/B 锚点价值交换包体与暴露面，已接受的债 |
| P2-4 | `_shared` 多副本物理同步：openid.js 17 份、logger.js 16 份、audit.js 11 份等 | 14 个 sync-*.ps1 + check-shared-sync 门禁 | CloudBase 无 layer 的必然结果；改规范源忘跑 sync 已被门禁拦截 |
| P2-5 | 考试题库硬编码双份，无 sync 守护 | `partner-action/index.js:98`、`admin-action/action_exam.js:8` | 改题需两处手改。低成本可治，但触业务代码须先走批准 |

---

## P3 · 卫生级 / 已接受的债（5 项，均已决策）

| # | 负债 | 决策与依据 |
|---|---|---|
| P3-1 | **空 catch 74 处 / 18 个云函数**（已排除 _shared 副本、_orig_baseline、测试；2026-10-15 复核仍 74） | 抽样定性多为**有意设计**：①配置 doc 读取失败降级返回代码默认值（im-send/index.js:66、order-action/index.js:101）②抢锁失败的并发控制流（payment-mock/index.js:98）③尽力而为副作用（admin-action 通知、demand-match/index.js:405 单条 lazy_expire CAS）。无差别加日志会刷噪声甚至改变行为。仅「副作用静默失败」窄类（约 10–15 处）值得补 log.w → **提审后立专项**，逐处证明不改变返回/不阻断主流程，多函数分批+全量部署回归 |
| P3-2 | `miniprogram/utils/testmode.js` 死开关（isTestMode 恒 false、setTestMode 空操作，全仓零 require） | **保留**作定位链路事故的降级旁路（2026-09-15 隐私整改时刻意留），删除收益≈0 |
| P3-3 | 两处手机号明文历史保留：`emergency_contact.phone`、`demand.contact_phone` | **维持 2026-10-12 拍板暂缓**。`scripts/backfill-phone-enc.js` 实测只覆盖 user_account.phone；真做需把这两处的业务读写一并改为 phone_crypt 加密写/解密读+掩码展示+存量两阶段回填，触隐私/联系人能力链路。提审后单独立项（设计+评审+真机） |
| P3-4 | G3「超时前提醒 2 次」未做（阶段 G 仅做超时即转 S10.5） | **属新功能不是隐蔽债**。需定义 S2.6/S3.6 到期前提醒的时机/次数/渠道、与现有催办 urge 的防骚扰关系、订阅 -501001 降级站内信、幂等标记字段。另出 PRD 级方案 |
| P3-5 | S2_5 存量兼容路径（历史 S3 发起的在途改期走旧逻辑，不再新增） | `.trae/rules.md §三.1` 红线载明，随存量订单自然消亡，不动 |

已偿还（本会话）：~~zz-seed-orders 文件头「验收视觉后删除」误导~~（已订正为「自测造数工具·保留·不部署·fail-closed·REGISTRY #34」，该目录有 6 例入口契约测试 + admin-web 种子代理分支，非孤儿）；~~payment-mock CRLF/LF 伪漂移~~（新增 `.gitattributes` 强制 cloudfunctions js/json eol=lf，工作区 w/crlf 实测归零，commit `ab9de38`）。

---

## 治理成本（非缺陷，登记备查）

- **KNOWN_EVOLUTION 33 例**：A/B 有意演进白名单（ab_equivalence.js），每登记一例均配独立行为断言，符合 project_rules §10。
- **26 条待验证中的两个挂起项**（#61 旧 start_service、#65 start_photo）：服务端保留无入口，验收口径=确认前端无残留调用。

## 建议处置优先级

1. **真机回归**（#67/#68/#63/#64/#59/#60/#62 及存量 16 个 ID）——唯一能让 P0-1 下降的动作，需人工真机/开发者工具执行；#71 登录 admin-web 抽看一眼即可关闭。
2. **提审决策项**：下次 upload 递增版本号；正式版发布当天按 runbook 把订阅两模板 trial→formal 并真机验送达。
3. **提审后主线**：P2-1/P2-2（前端巨页拆分 + 纯函数补测），P2-5（题库双份）、P3-1（空 catch 窄类）可并入同批。
4. **独立立项、不与卫生债混做**：P3-3（两处手机号加密改造）、P3-4（G3 超时前提醒）。
5. **持续不动**：P1 全组（兼容/挂起）、P2-3（基线）、P2-4（多副本，门禁已守）、P3-2/P3-5。

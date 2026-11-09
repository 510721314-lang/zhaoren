# 2026-11-09 · 全项目 BUG 扫描第二轮（P2-1 + P3 五项修复）

## 目标
- 在首轮扫描（`20261109-bug-scan.md`）基础上做第二轮只读扫描，去重已知项（11-08 导航 36 处、11-09 两个 P2 时区 + P3-26~30、既有技术债）。
- 按严重度产出清单后，经用户批准依次修复 P2-1 与 P3 五项，并按纪律完成门禁、部署、回读、提交与推送。

## 结论
- 第二轮扫描：**0 P0 / 0 P1 / 1 P2 / 5 P3**，无新增越权、资损、状态机破坏。
- P2-1 已修：管理员强制取消 S0/S1 订单时一并释放需求并清 `matched_openid`（原仅 S1 释放且不清，导致需求卡死或仅原耍伴可接）。
- P3 五项已修：需求释放静默 catch 留痕（order-timer + admin-action）、admin-web 账号启停二次确认 + 防双击、AA 承诺书全档校验对齐、活动 CTA 补 fail 兜底、导出日期与身份证算龄改北京时间。
- 门禁全绿；四函数部署 success 且回读 **94/94 SHA256 MATCH**；代码与台账已推送 origin/master（`35a38e3`）。

## 证据（命令与实测值）
- `npm.cmd run verify:offline` → EXIT=0；`tests 868 / pass 868 / fail 0`；`A/B EQUIVALENT: 455 cases`。
- `node scripts/check-shared-sync.js` → `SHARED SYNC ALL OK`（2 项 KNOWN-DRIFT 为既有登记）。
- admin-web `npm.cmd run build` → `✓ built in 11.20s`（仅 chunk >500kB 警告）。
- P2-1 admin-action 部署：`success=true / 51 files / 121.0 KB`；回读 **51/51 SHA256 MATCH**。
- P3 四函数串行部署：order-timer `18 files / 51.5 KB`、admin-action `51 / 121.1 KB`、payment-mock `12 / 26.3 KB`、user-login `13 / 34.1 KB`；`tcb fn code download` 回读 **18/18 + 51/51 + 12/12 + 13/13 = 94/94 MATCH**。
- `node scripts/check-doc-links.js` → `DOC-LINKS OK: 27 个 live 文档 / 65 条链接全部可达`。
- push：`48a6569..35a38e3 master -> master`（代理 7890 + openssl + HTTP/1.1）；推送后 `ahead=0`，HEAD = origin/master = `35a38e3`。
- A/B 夹具修正依据：payment-mock 取消 AA 0-50 档豁免后，`pm_pay_ok` / `auto_pm_*` 订单 `aa_tier:'0-50'` 未带 `aa_promise_checked` 致 2 例失败；补 `aa_promise_checked: true` 后恢复 455 EQUIVALENT。

## 改动与提交
- `d080097` fix(admin)：强制取消 S0/S1 一并释放需求并清 `matched_openid`（1 文件）。
- `c0fa2d4` docs：P2-1 修复与 admin-action 部署台账。
- `ff60e2a` fix(P3 五项)：8 文件 +26/−16 —— `order-timer/action_timeout.js`、`admin-action/action_order_demand_ops.js`、`admin-action/action_misc.js`、`payment-mock/action_pay.js`、`user-login/index.js`、`admin-web-frontend/src/views/Accounts.vue`、`miniprogram/pages-v2/pkg-low/activity-detail/activity-detail.js`、`cloudfunctions/_shared/ab_equivalence.js`（夹具）。
- `35a38e3` docs：CHANGELOG + deploy-log 登记 P3 修复与四函数部署。
- 未改：`app.json`、`project.config.json`、`project.private.config.json`、状态机与金额口径、`miniprogram` 业务逻辑（仅活动 CTA 补 fail）。
- 部署记录偏差如实登记：先 commit 后部署，未建 bundle；回滚点 `c0fa2d4`（本地与远端均可用）。

## 未决项
- 人工/真机回归未做：后台账号启停二次确认、AA 0-50 档支付全档校验、活动 CTA 跳转、导出文件名日期与生日当天算龄边界、需求释放失败日志可见性。
- admin-web 仅完成构建，未发布托管（如需要另行授权 `hosting deploy`）。
- `docs/FUNCTION-REGISTRY.md` 未更新，待人工验证通过后补登。
- 首轮遗留已核对闭环：P3-26/27 = `1616d74`、P3-28/30 = `c9277ca`、P3-29 = `6b50de3`，均已入提交链（deploy-log 当日「未提交」仅为部署时状态，不代表最终未提交）。
- 已知未闭合：T-9.14 管理端鉴权与留痕、`paid_fen`/`total_fen` 口径、场景白名单 9 vs 11、前端空 catch 技术债。

## 下次入口
- 先跑 `npm run verify:offline` 取基线，再核对 `git log --oneline -8` 与 deploy-log 最近行。
- 人工验证五项通过后：更新 `docs/FUNCTION-REGISTRY.md` 状态与 `docs/CHANGELOG.md` 回归结论，单独 docs 提交。
- 若继续清 P3：优先首轮「前端空 catch」技术债分批收敛（每批 ≤3 文件 / ≤30 行）。

# 找人帮忙小程序 · 工作衔接提示词（2026-10-10）

> 用途：新建会话开始工作前整段投喂，含技能继承段。生成规则（衔接提示词必含「技能继承」段）见 project_memory「Lessons Learned」末尾条目。

## ⚠️ 开场回执校验（先做，缺项/数值不符即视为未理解，先纠正再动手）

请回执确认以下四项，数值须与本提示词完全一致：
1. `git -C C:\zhaoren log --oneline -1` → `695c34c`
2. 云环境 ID → `cloud1-d9gkefwcp5c777088`
3. 工作目录 → `C:\zhaoren`（唯一可信目录；IDE 可能打开旧的 Desktop\zhaoren 克隆，编辑/部署一律用 C:\zhaoren）
4. 部署状态：`docs/deploy-log.md` 最近 2 行 = order-timer 诊断版（bcf4fcf，13.5KB）+ 9 函数权限治理（eda406c）；`git rev-list --left-right --count origin/master...HEAD` → `0 7`

## 一、工作目录

- 项目根：`C:\zhaoren`（微信原生小程序 + CloudBase；cloudfunctionRoot = cloudfunctions/，miniprogramRoot = miniprogram/）
- IDE：`C:\Users\DC\Desktop\微信WEB开发者工具\cli.bat`（唯一可信，勿用 C:\Program Files (x86) 旧装残留）
- 云环境：`cloud1-d9gkefwcp5c777088`（prod，环境判定以 admin_config.global.env 云端值为准）
- 小程序 appid：`wxbc4a4afacdf234f5`
- 备份目录：`C:\zhaoren-bak`（bundle/CHECKSUMS.txt/密钥 均在此，现 14 个 bundle）
- 环境切换：提审演示可临时 dev，演示完立即回 prod；dev 有 4 小时自动回 prod 兜底

## 二、基线（2026-10-10 当前状态）

- **git**：HEAD=`695c34c`，master 领先 origin/master **7 个 commit 待 push**（`d88fede`(订阅权限声明) → `eda406c`(9函数权限+log.w) → `6527870`/`33e2cac`(部署记录) → `c4d7a50`(专家评审) → `bcf4fcf`(订阅诊断落库) → `695c34c`(真因修正)，含代码 3 个 + 文档 4 个；此前因 github.com:443 网络不可达暂缓，**网络恢复后 push**，工作树干净）
- **云函数**：实际 20 个目录。**正式业务 17 个**：user-login / demand-publish / demand-match / partner-apply / partner-action / order-create / order-action / order-timer / payment-mock / safety-report / im-conv / im-send / evaluation-submit / admin-action / init-db / **home-action / blog-action**；另有 **admin-web**（网关函数，代理 Vue SPA）与 **zz-seed-orders / zz-warmup**（临时自测，勿动勿部署；zz-selftest-timer 已删）。部署记录在 `docs/deploy-log.md`，回滚点=各 commit
- **索引**：设计台账 32 条已全部建成（2026-10-09 实证补建 28 条 + uk_account）；9 个幽灵集合不存在（user_profile/partner_exam/partner_apply/dispute/withdraw_request/credit_log/report/sms_log/device_bind）
- **门禁**：gate.ps1 8 步（nightmask/SSOT/syntax/shared-sync/npm test 130 条/index-ledger/smoke/heartbeat），需 `$env:AWK_KEY`（在 `C:\zhaoren-bak\admin-key-20261009.txt`）；跑法 `powershell -ExecutionPolicy Bypass -File C:\zhaoren\scripts\gate.ps1`

## 三、约束（硬约束，违反即返工）

- **提审前冻结结构性重构**：admin-action 拆分/状态机收敛/鉴权收敛/Node 升级/CI 串门禁 全部提审后做
- fail-closed：AI/云调用/审核快照失败一律降级不阻塞主流程；资料展示只读 `profile_audited_snapshot`，未过审不上线
- 生产环境 mock_openid 全部失效；init-db 种子分支须管理员鉴权
- 打赏生产自动关闭；信用分等级 L1 620-799 / L2 800-899 / L3 900-949 / L4 950-1000，数据源 `user_account.partner_credit_score`
- **云调用触发约束（2026-10-10 定论）**：cloud.openapi.* 只在「小程序端 wx.cloud.callFunction 触发的云函数」鉴权成功；定时触发器/HTTP 网关/控制台测试/CLI 触发必然 -501001。order-timer 订阅发送与 admin-action 的 msgSecCheck 属已知失效边界
- 已验收基线内容修改必须先经用户同意

## 四、约定（工作纪律）

- **部署**：云函数串行逐个：`cli.bat cloud functions deploy --env cloud1-d9gkefwcp5c777088 --names <单个名> --project C:\zhaoren --remote-npm-install`；先 bundle 归档 C:\zhaoren-bak + CHECKSUMS，再 commit，部署后 90-120s 验证；config.json 的 timeout/triggers CLI 不生效（控制台手动），文件须 UTF-8 无 BOM
- **门禁**：代码改动后先 gate 全绿再 commit；push 前跑一遍
- **DB/索引命令**：`node scripts/tcb-exec.js <cmd.json>`（MgoCommands，$set 不支持点号路径）；索引扫描 `node scripts/tcb-scan-indexes.js`；**tcb fn log 不可用，排障靠云函数落库/读库**
- **单测**：`node C:\Program Files\nodejs\node.exe --test cloudfunctions/_shared/*.test.js`（130 条）；新增纯逻辑模块必补 test
- **共享模块**：`_shared/*.js` 用 sync-partner-audit.ps1 同步 + SHA256 校验，改规范源后必跑
- **订阅模板**：tmpl_id=`x1TfKgMBQCa2PpfpW10AVewcaFfm8BfuPCKOLk2Dx3Q`（admin_config.sub_msg_templates.demand_grab，thing2→subject / time22→start_time，fields 须给未用默认键置空串防 47003；miniprogram_state=trial，正式发布后改 formal）
- **测试身份**：发布者 `oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c`（易错 Yy_6yN5MrxhVl）；耍伴 `test_partner_001`
- **Git 提交格式**：`type(scope): description`
- **收工备份**：git bundle + robocopy + 云端 DB 导出 + L6 云函数下载 + L7 索引台账核对，全落 C:\zhaoren-bak
- 决策文档统一归档 docs/

## 五、经验教训（近期，直接复用）

1. **云调用 -501001**：定时器/网关触发函数发云调用必然失败，非权限/登录问题；权限声明是必要非充分条件（缺声明报 -604101）
2. **无日志通道验证**：调用结果 try/finally 落库（如 demand.sub_msg_send_logs），靠读库拿 errCode
3. **部署批量 40001** = IDE 登录凭据失效；`cli login -f image -o <png> -r <json>` 扫码重登；islogin 假阳性，以 deploy success 为准
4. **索引只能经 tcb 扫描验证**，台账≠实际；新增 collection 必须同步 admin-action EXPORT_COLLECTIONS + backup.ps1 白名单两处
5. **tcb MgoCommands update**：$set 不支持点号路径，须嵌套对象整字段赋值，写完 find 读回
6. **重启后 node/git 不在 PATH**：用全路径 `C:\Program Files\nodejs\node.exe` / `C:\Program Files\Git\bin\git.exe`
7. **网关 gateway_timeout ≠ 失败**：可能已落库，先复核再重试防重复
8. **PS 传 JSON 给 CLI 剥引号**：一律走 scripts/tcb-exec.js 包装器

## 六、技能继承（`.trae/skills/`，按场景触发；命中时先加载对应 Skill 再动手）

技能是**可执行指令集**（封装已验证命令/坑/回退路径），区别于上节被动文字经验；两者是两套正交资产，均须继承。

**项目技能（`C:\zhaoren\.trae\skills\`，均入 git）**

| 场景 | 技能 |
|---|---|
| 云函数部署/排障 | `wx-cloud-deploy`（CLI 串行部署+config.json 不生效+40001 重登）、`wechat-cloudfunction-deploy`、`cloud-console-test-driver`（无 CLI 时走 IDE 控制台云端测试）、`error-message-tracing` |
| 运维/身份/补丁 | `zhaoren-ops`（openid 映射、双角色、cloudbase aggregate 链式坑、init-db、待支付/待履约按钮 role 过滤） |
| 备份 | `cloud-backup-restore`（三重备份 + L6/L7 层 + 索引核对与创建机制） |
| 提审审计 | `zhaoren-audit`（新会话开场方向校准/提交前合规）、`miniprogram-audit`（7 项静态对齐）、`mp-pre-release-audit`（未开发功能全量审计）、`mp-privacy-release`（隐私指引+真机发布）、`zhaoren-config-sync`（前后端+云端配置一致性） |
| 管理端 admin-web | `admin-web-remote-access`（Vite/CloudBase 网关/登录 400）、`admin-web-write-ui-pattern`、`admin-web-deploy-checklist.md` |
| 小程序 UI | `wxapp-ui-polish`、`mini-ui-beautify`、`mini-a11y-perf-check`、`mini-interaction-motion` |
| Windows 坑 | `powershell-windows-traps`（PS5.1 引号/JSON 传参陷阱） |

**全局技能（`C:\Users\DC\.trae-cn\skills\`，相关子集）**：`wechat-miniprogram-skill`（小程序开发总纲）、`miniprogram-development`（构建/调试/发布）、`webapp-testing`（前端 Playwright 验证）、`git-commit`（规范提交）、`code-reviewer`（代码评审）、`requirements-analyst`（需求分析）、`security-best-practices`（安全评审）

**使用规则**：任务命中上表场景时，先加载对应技能（`Skill` 工具）再动手；技能内容与本提示词冲突时，以本提示词"约束"节与用户确认为准。

## 七、待办

**提审前（当前优先级）**
1. **push 本地 7 个 commit**（网络恢复后 `git push origin master`，含 d88fede/eda406c/bcf4fcf 等）
2. **走查③举证环节补测**（3B 爽约：提交申诉→对方举证→管理端裁定；测试账号信用分已复原 800；举证环节上次留待补测）
3. **上传体验版**（提审前最后一步；订阅 miniprogram_state 保持 trial）
4. 订阅闭环已定论（-501001 真因），无需再测

**提审后迭代清单**（均在 project_memory「上线后版本迭代重要项目」）
- 【遗留问题·订阅消息定时发送】方案 A=HTTPS stable_token+subscribe/send / B=挪回 demand-publish / C=维持现状（当前决策暂缓，站内通知已可用）
- admin-action 拆分（3257 行）→ 订单状态机收敛 _shared/order_state.js → 云函数入口层 mock 测试 → 鉴权收敛 → Node 升级 → AI 第一应用 → 资源点计费迁移 → 联系体系二期 → CI 串门禁

## 八、用户核对要点

- 回执校验四项确认后再动工
- 本次会话起点任务由你指定
- 涉及生产数据/已验收功能改动必须先确认
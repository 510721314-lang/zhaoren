【项目衔接｜找人帮忙小程序 — 新电脑接手提示词·最终版】

你是本项目的 AI 开发助手，接手一个正在推进的项目。先读完本提示，按「新机环境 → 读参考文件 → 执行待办」工作。

## 一、项目概况（已核实，勿改）
- 产品：微信原生小程序「找人帮忙」（陪伴型协助 C2C 撮合）；我是产品负责人，零基础，技术执行全交给你
- 仓库：https://github.com/510721314-lang/zhaoren.git（master）
- 栈：原生小程序(miniprogram/) + 微信云开发(cloudfunctions/) + admin-web 后台
- 云环境：cloud1-d9gkefwcp5c777088（唯一来源 miniprogram/envList.js）｜appid：wxbc4a4afacdf234f5
- 身份：管理员 openid=oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c｜耍伴测试号=test_partner_001
- admin_web_key（已轮换为 AWK-3c632b… 开头）：完整值从云开发控制台→数据库→admin_config→global 读取（登录 admin-web、备份脚本 -AdminKey 都用它）

## 二、新机环境（必做）
1. 装微信开发者工具并登录 → clone 仓库 → 用 IDE 打开
2. IDE「设置→安全设置→服务端口」务必开启，否则 CLI 全报错
3. 探测本机 CLI 真实路径（旧机=c:\Users\Administrator\Desktop\微信WEB开发者工具\cli.bat；「C:\Program Files (x86)\Tencent\...」是旧装残留勿用；新机需自查）
4. push 超时则：git -c http.proxy= -c https.proxy= push（默认 proxy 指死端口 7890）

## 三、技能/经验/资产继承（★重要：无需手动拷贝）
本仓库已把全部运维资产**入库**，clone 即有，无须额外拷贝：
- `.trae/skills/` 18 个 skill 已入 git（.gitignore 仅忽略 `.trae/cache/`）——含 zhaoren-ops、wx-cloud-deploy、cloud-backup-restore、zhaoren-audit、zhaoren-config-sync、mp-privacy-release、wechat-cloudfunction-deploy 等，每个 skill 是沉淀好的部署/备份/提审经验库
- `docs/runbooks/` 已入 git——含 backup-restore / deploy / ops / troubleshooting / key-rotation 等
- `docs/deploy-log.md`、`docs/*.md` 设计/方案/回滚点均入库
故新机 clone 后**项目经验零损耗继承**。开工前先读以下三个入口：
1. docs/runbooks/backup-restore.md（备份/恢复）
2. docs/deploy-log.md（部署记录 + 各批次回滚点/备注）
3. .trae/skills/zhaoren-ops/SKILL.md + wx-cloud-deploy/SKILL.md + cloud-backup-restore/SKILL.md

## 四、当前进度（截至 2026-10-09，已核实）
- 十·八批次已交付并部署成功：①站内抢单通知=demand-publish 落 grab_notify_pending + order-timer 定时分批推 system_notice；②代他人发布=强制手写签字授权+服务端门禁。云端最新（demand-publish 31.9KB / order-timer 12.1KB）
- 备份体系完备：git bundle / robocopy 热备 / 配置快照 / 36 集合 DB / L6 20 云函数代码 / L7 32 索引台账，三级校验全过；异地副本已同步飞书（folder_token=RCsff3kGUlKhpud1KVFckJOhnGc）
- 环境既有配置（历史成就）：admin_web_key 已轮换生效；云存储权限此前按「所有用户可读，仅创建者可读写」配置（跨账号图片修复项）——**此项无本会话实证，新机可顺手在控制台核验一次存储权限**
- git：远端=origin/master=f2607d2，工作区除一条未跟踪走查 md 外干净；无 push 待办
- 3B 爽约链路已部署（init-db/order-action/admin-action/admin-web），但**行为走查此前挂起**，需本次补跑

## 五、待办（按序执行，每步先读现有代码再改）
1.【用户】控制台手工建索引：demand 复合索引 {grab_notify_pending:1,status:1,created_at:-1} —— 不建则抢单通知推送扫描不生效
2. 走查①站内消息闭环：发布者发广播需求(match_mode=broadcast 且带经纬度) → order-timer 云端测试发定时触发器事件({"Type":"Timer","TriggerName":"orderTimer","Time":"<now+1min>","Message":"manual"}，不带 mock_openid) → 查 system_notice 有 type=demand_grab/action_key=jump_demand/demand_id → 模拟器耍伴消息中心收并点跳详情
3. 走查②代他人发布：正向(填被代发人→勾《委托授权书》→手写签字→发布落 publish_type=proxy/service_target/proxy_auth_signed)＋反向门禁(不签字→publish_proxy_sign_required；不勾授权→publish_proxy_authorized；不填人→publish_proxy_target)
4. 走查③3B 爽约(补挂起)：order-action no_show_report_submit(发布者；前置=S2/S3.5 且过开始时间、48h 内)→no_show_report_defense(被诉方)→admin-web「爽约申诉」裁定(upheld=扣20信用分+写 credit_score_log；rejected=免罚；重复裁定幂等)
5. 走查结果回填 docs/deploy-log.md 备注区

## 六、云函数部署名单（准确，批量下载/部署用）
user-login、demand-publish、demand-match、partner-apply、partner-action、order-create、order-action、order-timer、payment-mock、safety-report、im-conv、im-send、evaluation-submit、admin-action、init-db、home-action、blog-action、admin-web、zz-seed-orders、zz-warmup
（zz-* 为自测类，验收后可删）

## 七、关键经验（实测过，避免重踩）
- 云函数必须串行逐个部署（并发报 Updating 冲突）；CLI 部署不应用 config.json 的 timeout/triggers → 只能控制台手动配
- 免费版硬超时 3 秒 → 冷启动函数并行化 DB 读；长流程拆「每步落库+幂等+断点续跑」
- wx-server-sdk 无 createIndex 也**无 listIndexes** → 索引只能控制台手工建；init-db 的 INDEXES 只是设计台账，恢复时人工核对
- 云端测试身份用 mock_openid（定时触发器事件除外）；订单/需求参数用文档 _id（32 位十六进制），不是 ORD/DR 单号
- 备份正脚本=.predeploy/manual-backup.ps1（backup.ps1 缺 confirm 导空表）；异地同步 lark-cli（先 +status → +push，--if-exists overwrite 覆盖同名；--local-dir 只能放 cwd/temp/home/files）
- 备份各层脚本若 $ErrorActionPreference='Stop'，node stderr 会误判 FAIL → node 调用前临时置 Continue

## 八、工作纪律（本项目惯例）
- 云函数改动=必须重部署才生效；部署前先 git bundle 归档 + 记 deploy-log(含回滚点)
- 提交前跑门禁：npm test(130 条) + node --check；不主动 commit/push，等我确认
- 金额/状态机改动要保守：先读码再改，不臆造字段
- 写在 docs/onboarding-prompt-*.md 的旧版提示词为历史快照，以此最终版为准
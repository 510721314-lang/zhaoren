# 找人帮忙小程序 · 新电脑工作衔接提示词（投喂用）

> 用法：在新电脑新建会话，将下方【提示词正文】整段粘贴给 AI。AI 必须先输出「开场回执」并核对基线数值，全部一致后才可动工。

---

## 提示词正文（从这里开始复制）

你是「找人帮忙」微信小程序（原生 + 微信云开发）项目的开发助理。项目托管于 GitHub：`https://github.com/510721314-lang/zhaoren.git`，唯一工作目录为 `C:\zhaoren`。本会话为新电脑上的新任务，请先完成环境初始化与基线核对，再等待我确认任务。

### 第一步 · 环境初始化（新电脑首次必做）
1. 用 Git 克隆仓库到 `C:\zhaoren`（若目录存在则 `git fetch origin && git reset --hard origin/master`）
2. 确认 `project.config.json` 中 appid 为 `wxbc4a4afacdf234f5`，miniprogramRoot 指向 `miniprogram/`
3. 确认本机已安装：微信开发者工具、Node.js（`C:\Program Files\nodejs\node.exe`）、Git（`C:\Program Files\Git\bin\git.exe`）
4. 用微信开发者工具导入 `C:\zhaoren`，云环境选择 `cloud1-d9gkefwcp5c777088`（env id），AppID 选择 `wxbc4a4afacdf234f5`
5. 云函数部署命令（**cli.bat 路径需动态定位**，不可硬编码当前电脑路径）：
   - 先检查 `C:\Users\DC\Desktop\微信WEB开发者工具\cli.bat` 是否存在
   - 不存在则用 `Get-ChildItem -Path 'C:\Users' -Recurse -Filter 'cli.bat' -ErrorAction SilentlyContinue | Select-Object -First 1` 定位
   - 模板：`<cli.bat路径> cloud functions deploy --env cloud1-d9gkefwcp5c777088 --names <单个函数名> --project C:\zhaoren --remote-npm-install`
6. **管理后台网关调用约定（核对环境/切环境/导出数据均用此通道）**：
   - 端点：`POST https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api`
   - 鉴权 Header：`X-Admin-Key: 1e4ea9609e1ff33abf9a6ded228f0f17cefc5ead67982006b46fc915b1251a8b`
   - Body 格式：`{ action: 'init_db', __init_db_action: 'quick_check' }`（UTF-8 JSON，Content-Type: application/json; charset=utf-8）
   - 切回 prod 调用：`{ action: 'init_db', __init_db_action: 'force_set_env', env: 'prod', reason: '<说明>' }`
   - 注意：此 admin_web_key 属敏感凭证，仅限本会话/开发者本机使用，不得写入公开文档

### 第二步 · 输出「开场回执」（必出，逐项核对）
请以「回执」开头，逐项输出以下内容，并用只读命令验证（不得编造）：

| 校验项 | 当前基准值 | 验证命令 |
|---|---|---|
| 工作目录 | `C:\zhaoren` 存在 | `Test-Path C:\zhaoren` |
| git remote | `origin → github.com/510721314-lang/zhaoren.git` | `git remote -v` |
| 当前 HEAD | `358f3be1a17c9f581efefedc4121b4f0b43d1f67`（master） | `git log -1 --format=%H` |
| 工作区状态 | 有未提交改动（见下） | `git status --short` |
| appid | `wxbc4a4afacdf234f5` | 读 project.config.json |
| 云端环境 env | 当前为 `dev`（上次切出测试支付未切回） | 调网关 init_db quick_check |
| 单测运行 | 17/17 全过 | `& 'C:\Program Files\nodejs\node.exe' --test 'cloudfunctions/_shared/*.test.js'` |
| 已部署云函数 | 近期部署过：home-action / admin-action / admin-web / partner-action | 开发者工具云函数列表核对 |

**工作区未提交改动（git status 已确认）**：
- `cloudfunctions/admin-web/public/` 下旧 hash 资源文件被删除（D）+ 新 hash 资源文件未跟踪（??）
- `cloudfunctions/admin-web/public/index.html` 已修改（M）
- `.trae/documents/activity-detail-page.md` 未跟踪

> 说明：这是 admin-web 前端重新构建后产生的资源 hash 变化（旧资源删除+新资源待添加），属于正常的构建产物变更。**严禁 `git reset --hard`**——须先 `git add cloudfunctions/admin-web/public/` 将构建产物提交，避免误判为冲突而丢失构建结果。

### 第三步 · 核心约束（不可违反）
- 已验收基线内容的修改必须先经我同意
- 信用分等级映射：L1 620-799 / L2 800-899 / L3 900-949 / L4 950-1000
- 动态信用分数据源为 `user_account.partner_credit_score`
- 需求发布时 status≠cancelled 的需求参与时间窗冲突判定
- 生产环境 mock_openid 全部失效，身份验证用真实 OPENID
- 生产环境下打赏功能自动关闭
- 所有备份文件必须保存在 `C:\zhaoren-bak` 目录
- 提审演示/截图期间可临时切 dev 环境，演示完成后必须立即切回 prod
- 新开任务必须进行工作目录验证，并经我确认后才能动工
- AI 应用需遵循 fail-closed 原则，AI 失败时按开关降级，不影响主流程
- AI 请求不得携带全量订单、位置或联系方式等私有数据
- AI 输出需标注「AI 建议」，不触碰核心交易链路，隐私指引无新增
- 微信云开发环境启用 AI 模型需先切换至资源点计费模式
- 环境切换至 dev 后有 4 小时自动回 prod 兜底机制
- 耍伴展示端资料只读 `profile_audited_snapshot`，未过审内容一律不上线（fail-closed 双缓冲）
- 资质/荣誉标题长度限制为 ≤20，图片数量限制为 ≤6，单张 ≤3M
- 资质/荣誉添加入口必须恒显示，满额时通过 toast 提示上限
- 环境判定依赖 `admin_config.global.env` 云端运行值，读取失败时按 prod 兜底
- 场景白名单从 `admin_config.scene_list` 动态读取
- 地图位置共享双向对称：双方均需开启 `allow_map_share` 且定位 15 分钟内有效
- 关闭 `allow_map_share` 时系统自动清除已上报坐标

### 第四步 · 工程约定
- 信用分 level 由后端按 score 推导
- 订单列表/消息页/订单详情页的订单概况统一通过 buildOrderSummary 生成
- 场景中文映射需全仓同步（order-action/im-conv/im-send/payment-mock/home-action 的 SCENE_CN 常量）
- 工作目录验证需执行 Test-Path + git remote -v + project.config.json appid 三合一检查
- 三重备份包括 git bundle、robocopy 热备和云端 DB 导出
- 审核逻辑单一实现维护在 `_shared/partner_audit.js`，修改后需同步到 partner-action/ 和 admin-action/ 本地副本
- 云函数部署需使用全路径 cli.bat 命令，一次部署一个云函数
- admin-web 前端修改后需先设置 node 路径再 npm run build，将 dist 内容清空重拷至 cloudfunctions/admin-web/public，最后部署 admin-web 云函数
- git 提交消息格式：`type(scope): description`
- 每栏目独立审核模型：保留整份 pending 锁，通过栏目并入快照并清 pending，全部处理完解锁 approved

### 第五步 · 经验教训（避免踩坑）
- 旧 expired 种子需求未软删会导致新种子发布时触发 publish_time_conflict 拦截
- 前端样式修改后需重新编译或重新上传体验版才能生效
- 微信原生 button 与 input 同行时键盘失焦吞 bindtap → 用 view bindtap
- 重启后 node/git 不在系统 PATH → 用全路径
- 编辑页审核历史时间线不能直接绑定 Page 方法 → 需 JS 预计算 timeStr
- WebView 直接导航到 hash 路由可能触发 SPA 重载卡顿，需等待并重试
- 样式修改需一次性覆盖同类控件，避免逐点补丁（深色模式文字隐形问题三轮才修完）
- 后端判空逻辑检查 titles 与 photos，两者都空才算空（曾漏 photos 导致误判「缺少审核项」）
- 审核死锁：status=pending 但所有待审字段为空时，healAuditLock 会自动解锁 approved
- 云存储 fileID 需用 getTempFileURL 转临时 URL 才能前端显示

### 第六步 · 当前待办总览（按优先级）

**P0 · 当前紧急（接上次会话）**
1. **提交 admin-web 构建产物（最先做）**：`git add cloudfunctions/admin-web/public/` + `.trae/documents/activity-detail-page.md`，提交消息如 `build(admin-web): 更新构建产物`，推送 origin master（这是新电脑工作区安全的唯一保障，先落库再谈其他）
2. **环境复位**：云端 env 当前为 `dev`（上次为测试虚拟支付切换）。调用网关 `init_db quick_check` 核对：若为 dev，询问我是否立即切回 prod；确认后执行 `force_set_env env='prod' reason='测试完成切回生产'` 并再次 quick_check 复核 env=prod（注意 4h 自动回退可能已生效，以实测为准）

**P1 · 真机验证闭环**
- 活动详情页：首页 banner → 详情 → CTA 跳发布页
- 审核死锁治愈回归：编辑页按钮恢复、独立提交、后台审核
- 深色模式文字可见性（编辑页/详情页）

**P2 · 待办**
- 安全加固评估建议（曾多次要求，因会话切换未产出）
- wallet 发票/完税/银行卡占位入口收口（提审抽查点）
- 支付/虚拟提现链路测试（上次切 dev 后未完成，若 env 已回 prod 需重新规划）

**P3 · 上线后迭代**
- AI 第一应用 + 迁资源点计费（需先切计费模式才能启用 AI 模型）

### 第七步 · 待我确认后再动手
回执输出完毕后，请列出你识别到的「最紧急待办」并询问我确认，经我同意后才可开始执行（不要擅自提交 git、切换环境或部署云函数）。

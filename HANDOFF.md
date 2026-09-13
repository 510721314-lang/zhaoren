# 找人帮忙小程序 · 收工交接与商用化指引

> 更新：2026-09-12　环境：`cloud1-d9gkefwcp5c777088`　AppID：`wxbc4a4afacdf234f5`
> 项目根：`c:\Users\DC\Desktop\zhaoren`（2026-09-11 从 H 盘迁出，H 盘已不存在）
> 备份：git tag `backup-2026-09-12`（=提交 e208e01）；全量归档 `C:\Users\DC\Desktop\临时备份文件\zhaoren-backup-2026-09-12.zip`
> IDE：`c:\Users\DC\Desktop\微信WEB开发者工具\cli.bat`，服务端口 11841；最新代码提交 `092e6b7`

---

## ★ 上线前阻断项（2026-09-12 登记）

1. **隐私指引未闭环（最高优先）**：真机 `wx.getLocation` 被微信拦截（后台《用户隐私保护指引》的"位置信息"声明未审核通过/未找到添加入口）。
   - 代码侧已定稿：直接调 API，由**微信官方自动弹窗**接管（自定义 privacy-popup 组件已在 `092e6b7` 删除）；后台声明生效后无需再改代码。
   - 商用前必做：① mp.weixin.qq.com → 账号设置 → 服务内容声明 → 用户隐私保护指引，添加 位置信息(wx.getLocation)/选中的位置信息(wx.chooseLocation)/选中的照片或视频信息(wx.chooseMedia)/手机号(getPhoneNumber)，等审核通过；② 真机验证官方弹窗→同意→真实 GPS 成功；③ **删除自测模式**：`miniprogram/utils/testmode.js`、mine.js 的 `onVersionLongPress`、mine.wxml 的 `bindlongpress`（自测模式：我的页长按版本号开启，storage key `dev_test_mode`，开启后真机定位降级成都坐标，仅供测试）。
2. ~~**云函数超时锁死 3 秒**~~ **✅ 2026-09-13 已解决**：个人版（免费体验版）IDE 内置云开发控制台的超时输入框实际可编辑（1~60 秒），无需升级套餐。已逐个设置并经 `cli cloud functions info` 读回核验：order-timer=60、demand-publish/order-create/order-action/demand-match=20、payment-mock=10，全部 Active / Nodejs16.13。腾讯云网页控制台才需扫码，IDE 面板直接可改。
3. **order-timer 超时流转未验收**：自驱链新版只存在于 git `cf138e0`（zz-selftest-timer），本地/云端均已删除且从未跑通 all_pass；商用前需在测试环境重建验收 S1/S0/S3.5/S5 四个超时流转。
4. **全链路实测未完成**：发布→匹配→四确认→S0→模拟支付→S3→S5→评价→打赏（含时间冲突拦截、50km 校验）。当前可用模拟器或真机自测模式走查。

### 2026-09-12 完成项
- 环境迁移收尾：IDE 新路径验证、部署 skill 更新、端口 11841 联通；9-09～9-11 全部工作入库（4 提交）；PRD 三文件从 git 恢复
- zz-selftest-timer 本地删除 + 云端删除（用户手动），云端 17 个正式函数
- 定位问题修复链：模拟器/系统定位误判修复(e208e01) → 真机隐私拦截修复尝试(51344c1) → 重试熔断(b0d0285) → 自测模式(2fdad32) → 移除自定义弹窗回归官方机制(092e6b7)
- 三层备份（git tag / .backup-2026-09-12 / zip 全量归档，含 SHA256 校验）

---

## ★ 2026-09-13 阶段B（事务/CAS 加固）进度 —— A+B 批次已完成

> 状态：代码改造与部署 100% 完成；**A（3 个 broadcast + hall_list 终验）与 B（n02~n09 共 10 个参数校验）已全部 PASS**（2026-09-13 晚）。
> 剩余：接单/四确认/支付/履约/评价/IM 等订单链路 mock 回归（见"未完成"清单），可单独续跑。续跑入口见文末"剩余工作"。

### ✅ 已完成

1. **阻断项2 关闭**：6 个云函数超时已在 IDE 内置云开发控制台改好并经 CLI 读回（order-timer=60，demand-publish/order-create/order-action/demand-match=20，payment-mock=10）。
2. **9 个云函数阶段B 改造完成并全部部署成功**（串行部署，success / filesCount=3）：
   - `order-create`：接单 CAS 防超卖（demand matching→matched）+ runTransaction 三文档（order/demand/流水）+ 失败补偿。
   - `order-action`：全状态流转 casStatus（S1→S0 等）+ 四确认位点路径原子写 + version OCC。
   - `payment-mock`：支付 CAS S0→S2 + 事务 + tip_total_fen `_.inc` 累加。
   - `evaluation-submit`：CAS S5→S8 + 幂等 + 信用分事务（delta：5★+2/4★+1/3★0/2★-2/1★-5，clamp 0-1000）。
   - `order-timer` / `demand-publish` / `demand-match` / `admin-action`：配套 CAS。
   - `im-send`：补 `const _ = db.command` + 未读数 `_.inc(1)`。
   - 新冲突码约定：`*_status_conflict` / `oa_conflict` / `*_db_fail`；幂等成功返 `idempotent:true`。
3. **回归数据已重建**（ID 以 `.tmp-cloud-runner/vars.json` 为准；D_MAIN/新D2/D3 均已 broadcast=true 在厅、未接单）：
   - `D_MAIN=f9ecc4af6aa5de120afd3da669b6ddee`（W1 取药送药，start=1789736400000=**2026-09-18 21:00**，"阶段B回归主单"）
   - `D2=e04f59456aa632dc045c64450c5c640b`（W2 自习陪伴，start=1789729200000=**2026-09-18 19:00**，DR20260913475712）
   - 旧 D2 `e04f59456aa5de66044bb8ef0b01f29b4`（09-18 21:00，DR20260912589508）：**33 位异常 _id，where 可查但 `doc(id).get()` 抛错**（broadcast/top5 均 not_found），云函数不可寻址；保留为 TC15 同时段冲突夹具（重发 21:00 W2 实测撞 `publish_time_conflict`）。
   - `D3=a9defcfd6aa5debc01423920402335ca`（W1 陪诊解压，start=1789974000000=**2026-09-21 15:00**，IM 测试单）
   - 注意：旧 vars 的 D_MAIN/D2/D3/O_MAIN/O_IM 全部作废。发布成功返回字段是 **`data._id`**（不是 demand_id），列表用 `action=my_demands` → `data.list`；hall_list 条目字段叫 `demand_id`。
4. **已实际验证的回归点**：
   - demand-publish 3 个需求发布全部 `ok:true`（主单最初用 09-16 18:00 撞旧数据返回 `publish_time_conflict`，改 09-18 21:00 冷门时段后成功）。
   - 参数校验 **n01 PASS**：非法场景返回 `publish_scene_invalid`，**场景白名单实际为 W1/W2/W8/W10/W11**。
   - **A 批次 PASS（2026-09-13）**：demand-match `broadcast` 对 D_MAIN/新D2/D3 均返 `{"ok":true,"data":{"broadcast":true}}`；`hall_list` total=6，三单全部在厅。
   - **B 批次 PASS（2026-09-13）**：n02~n09 实测码序 `publish_start_time` / `publish_time_too_far` / `publish_duration` / `publish_rate_range`(20元) / `publish_rate`(0.5元) / `publish_aa_promise` / `publish_content_invalid` / `publish_content_option` / `publish_remark_long`(220字) / `publish_remark_blocked`（明细已回填 tests/full-link-cases.md）。

### ⛔ 未完成（订单链路回归）

1. ~~参数校验 n02~n09~~ **✅ 2026-09-13 全部 PASS**（含 n02，明细见 tests/full-link-cases.md 与 vars.json）。
2. ~~3 个需求的 broadcast（main/d2/d3）~~ **✅ 2026-09-13 完成**（新 D2 替换 33 位坏 _id 旧单；hall_list 已终验）。待续：B 接主单（matching→matched CAS，得 O_MAIN）+ 防超卖重放；A 接自己单被拒；B 重复接 `order_demand_closed`；B 接同时段单时间冲突拒（可用旧 D2 21:00 或再发一单）。
3. order-action 确认流（get/pre/full，S1→S0 CAS + 位点原子写 + version）；payment-mock cashier/mock_pay（S0→S2）/重复支付幂等；start_service（S2→S3 权限）/SOS/checkin/complete_service（S3→S5）；evaluation-submit（S5→S8，违规词拒、非 owner 拒、信用分事务）；mock_tip 0/超限/1000/500 分（inc 累加，重读取真值）。
4. D3 IM 单（得 O_IM）：send_text/send_template（S1 可发、违规词拦截）、confirm_all A+B、cancel（→S6 + 需求释放）、关闭后发消息拦截。
5. 重点验证幂等重放与新冲突码；order-timer `{action:'run'}` 四个超时流转（可加 `s0_force:true`）。
6. ~~文档回填 tests/full-link-cases.md~~ ✅ 2026-09-13 已追加 A+B 回归小节；**git 提交**：只 add cloudfunctions + 文档 + `.trae/skills/`；`.tmp-cloud-runner/`、preview-info.json/preview-qr.png 不入库；单行中文 commit。
7. 阶段A#3 索引（控制台手动，清单见下）；阻断项1（隐私审核+真机验证+删自测模式）；阻断项3（order-timer 定时触发器控制台手动重建，CLI 不应用 triggers）。

### 🔧 续跑技术要点（Computer Use 云端测试面板，本次新踩的坑，务必照做）

- 唯一调用通道：IDE 云开发控制台 → 云函数列表 → 搜索 → "云端测试"面板（WS 直连/CLI 均不可用，已定论勿重试）。
- **get_app_state 内联树约 5000 字符截断；完整树落盘**：`C:\Users\DC\AppData\Local\Temp\trae\computer-use\YYYYMMDD\trees\tree-<uuid>.txt`，输出末尾有 `read <路径>`。**必须读该文件**解析元素 id；但 Shell stdout 对大输出也截断，取内容用 `Select-String` 精准取行，勿整文件 cat。
- 树文件里 JSON 引号**不转义**：编辑器行形如 `edit [set_value,set_focus] val="{"action":...}" id=251`（id 在行尾，与"运行测试"按钮 id 同行不同模式）。
- **set_value 防静默写错**：面板内有多个 edit（如行号 val="1" id=102）；只认特征行 `edit [set_value,set_focus] val="{` 且行尾 id；set_value 后**必须重新读树校验该行包含新事件标记**（如 start_time 数字），否则会重发旧事件（本次 n02/n03 就是这样白跑的）；set_value 后 id 会变，操作前现取现用。
- 结果识别：树文件中返回节点为行首缩进 `text "{...}"`（引号不转义，直接 JSON.parse）；出现"历史测试结果"横幅=旧结果；`data-item "<uuid>"`=RequestId，与上次不同且无横幅才算新结果。
- webview DOM 被大结果撑爆后树长期只有 ~5900 字符缓存：`perform_action set_focus element_id=3`（文档节点）→ `press_key key=r modifiers=[ctrl]` 重载 webview（会话态保留，停在云函数列表），重新搜索函数开面板即可。
- 后台坐标 click 穿不透 webview（再确认），一切点击用 `perform_action invoke element_id`；导航后树失效先跑 `.tmp-cloud-runner/fg.ps1` 置前（pid 17872 / windowId 307760310，IDE 重启需更新）。
- 单个 Exec 内 ≤4 个用例、控制在 ~1000 秒内（10 用例+复杂轮询约 900~1100 秒，1800 秒必超时且无中间输出）。
- 事件文件：`.tmp-cloud-runner/ev/*.json`（d3-publish.json 时间已改 1789974000000；main-publish.json 占位符需同步为 1789736400000）。mock 身份 A=`oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c`，B=`test_partner_001`；_id 必须 32 位 hex。

#### 2026-09-13 晚补充（IDE 2.02.2609102 Nightly / 控制台 v2.0.3）

- **新版 IDE 2.0 工具栏没有"云开发"文字按钮**：入口=右上角 **∞ 双环图标**，悬停 tooltip「云开发」。2026-09-13 窗口化主窗口（rect 277,50,1502,800）时逻辑坐标约 **(1173,70)**；图标左边紧邻的是"上传"（误点会弹上传确认框，点"取消"即可）。菜单栏（项目/工具/设置）鼠标与 Alt 助记键均不展开下拉，勿走。
- 控制台 v2.0.3 独立窗口标题「云开发控制台 v2.0.3 (2.0.34@...)」，pid 跟随 IDE（19660），windowId 每次重开都变（当晚 33753470 → 关闭重开 28967582）。
- **结果节点布局变化**：短结果是 12 空格缩进 `text "{...}" id=N`（在 `text "返回结果"` 之后、`button "arrowdown 摘要"` 之前）；长结果（如 hall_list/my_demands）是 `group` 节点内嵌 14 空格 `text "{...}"`，且一行可能上千字符，要用 `/text "(\{.*\})" id=\d+\s*$/` 整行提取再 JSON.parse。
- **读结果用"固定等待+单次读树"比 RequestId 轮询可靠**：invoke「运行测试」后 sleep 12~16 秒（msgSecCheck 类 16 秒），再定位 `text "返回结果"` 行向下找含 `"ok"` 的行；按 RequestId 变化轮询在 v2.0.3 多次误判 NO_RESULT（实际调用已成功）。
- **切函数必须先关面板**：树里标题区找 `button "关闭"`（v2.0.3 在 `text "demand-xxx"` 后面）invoke，确认「测试普通云函数」消失再搜索下一个函数；只换搜索词直接点云端测试会停留在旧函数（本次踩过：demand-publish 的 my_demands 发到 demand-match 返 `match_unknown_action`）。Ctrl+R 重载有时导致 a11y 树退化成 ~1600 字符骨架，**整窗关闭从工具栏重开最稳**。
- **33 位 hex _id 陷阱**：CloudBase 自动 id 为 32 位；若夹具 _id 异常为 33 位，`where` 能查到但 `collection.doc(id).get()` 直接抛错（被 catch 成 not_found），广播/top5/取消全部不可用。发单后校验 _id 长度，异常就重发。
- **锁屏根因**：反复锁屏的真凶是 ToDesk（已改 config.ini `PrivateScreenLockScreen=0`/`autoLockScreen=0`），非系统空闲锁；360 安全卫士抢前台问题已随其卸载消失。防锁屏只能用 keybd_event 硬件级 F15（SendKeys 无效），LogonUI 合成输入无法解锁。
- 坐标点击一律 PowerShell `SetCursorPos`+`mouse_event`(0x0002/0x0004)；MCP click 偶尔不移动光标。

---

## 2026-09-10 测试反馈六项整改（云函数均已部署 success，待编译实测）

| # | 反馈 | 改动 |
|---|---|---|
| 1 | 首页选场景后发布页焦点不在该场景 | 根因：草稿恢复 `Object.assign(patch, draft)` 覆盖了带入场景；草稿功能已整体移除（见#2），场景预选恢复正常 |
| 2 | 进发布页无需恢复草稿 | demand-publish.js 删除草稿自动存/恢复/定时器，onLoad 清旧 `demand_publish_draft_v1` |
| 3 | 服务时间距发布≤30天 | 前端日期 picker 加 `end=今天+30` + 提交校验；云端 demand-publish 加 `publish_time_too_far` |
| 4 | 接单时耍伴实际位置距履约地址≤50km | order-create 加 Haversine 距离校验（`order_too_far`/`order_location_required`，真实客户端必传 `partner_location`，mock 自测链路豁免）；hall.js 接单前先 `wx.getLocation`；订单落 `take_distance_km` |
| 5 | 发布者位置=发布时实际定位不可改 | 发布页删 `wx.chooseLocation`，改为进页自动 GPS 定位 + 提交瞬间重新取点；地点卡仅显示/可重新定位不可手选；app.json 权限描述更新、requiredPrivateInfos 去掉 chooseLocation |
| 6 | 已履约完成订单可打赏 | payment-mock 新增 `mock_tip`（S5/S8/S9/S10 发单人，1-500 元，可多次，is_mock=true，流水 type=tip，订单累计 `tip_total_fen`）；order-detail 加「🎁 打赏耍伴」按钮（5/10/20/50 元档，提示模拟支付不扣款）+ 费用卡累计打赏行 |

部署：demand-publish(104.6KB)、order-create(5.1KB)、payment-mock(3.9KB)、order-action(6.9KB)、zz-selftest-timer(7.5KB，补 partner_location 以适配 50km 校验)。

---

## 一、今日问题收口（状态与解法）

| # | 问题 | 根因 | 解法 / 状态 |
|---|---|---|---|
| 1 | 发布提示"当前城市未开通服务" | 前端正则 `/([\u4e00-\u9fa5]{2,4}?)市/` 对"四川省成都市"跨段误匹配成"川省成都"；云端对空数组白名单无兜底 | 前端改 `parseCity()`（先剥省/自治区再取段首市）；云端归一化 + 空数组兜底"成都" + 包含匹配容错。**已部署**，待"编译"后实测 |
| 2 | 发布后匹配页空白 | pages/match 原为占位 | 已实现：需求摘要卡 + top5 候选耍伴（头像/信用/时薪）+ 定向邀约（≤3）+ 广播大厅 + 空态 + 下拉刷新；demand-match top5 增返需求摘要/已邀约、排除自己。**已部署**，待编译实测 |
| 3 | 自测单不出 / order-timer 验证受阻 | ① 云函数被锁在 **3 秒超时**且定时触发器 CLI 不生效（不自动跑）；② take_a 无订单复用，超时建单后重跑被"该需求已不可接单"拒；③ error.step 记录错误；④ 手动 run 与定时器并发互相覆盖；⑤ 复用误捞历史 S5 残留单 | 全部已修并部署 zz 6.7KB（cleanup 关全量残留单+epoch、复用只认本轮、error.step、8s 锁）。**需手动连点 run 验收，步骤见下** |
| 4 | 云函数 3 秒超时 | **CLI 部署不应用 config.json 的 `timeout`；免费体验版控制台锁死 3 秒** | 见下文"商用化"。临时缓解：DB 读并行化（demand-publish 已示范）+ 每步落库断点续跑 |

### 挂起项（order-timer 自测验收，2026-09-10 决定暂不阻塞，后续处理）

背景：云函数被免费版锁死 3 秒、CLI 不应用 timeout/triggers，定时触发器不触发。
- 旧手动连点方案问题：reset 后连点 run 多次，report 长期停在 `phase:cleanup / steps:[]`——每次调用在 3s 内刚做完 cleanup 就被杀，步骤日志没来得及落库。
- **2026-09-10 已部署新版（7.5KB，success 已确认）**：① cleanup 两条查询+全部更新改 `Promise.all` 并行；② 新增自驱动链 `scheduleNext()`——每次 run 开始时发射后不管地 `cloud.callFunction` 预约下一次 run（500ms 超时不等结果，chain_gen 上限 40，done/重试耗尽不预约）；③ `reset` 返回 `auto_started:true` 并自动点火。
- **新版尚未验证通过**（用户决定先挂起）。下次续做：云端测试 `{"action":"reset"}` → 等 3～5 分钟（什么都不用点）→ `{"action":"report"}`。
  - 目标：`all_pass:true / phase:done / a_pass、b_pass、idempotent_pass 全 true`；steps 第一条为当天时间戳 `0-cleanup`（orders_closed≥1），随后全新 `A1-publish`（非 reuse）。
  - 若仍停在 cleanup/steps 为空：说明链式 callFunction 未真正发出（疑似免费版限制函数内 callFunction 或 500ms 内请求未发出），备选方案：scheduleNext 改为先 await 一次极快的状态写入再发、或放弃自驱动改回手动但把每步落库提前到阶段开头（先 log 占位再干活）。
  - 若报 error：看 `error.step` + `error.message`（已能精确定位）。
  - 通过 → **删除临时函数**（云端删除 + 本地删 `cloudfunctions/zz-selftest-timer/` 目录）。
- 不阻塞前端实测：自测链路用 test_partner_001 独立身份，与本人账号前端验证互不影响。

前端项（点开发者工具「编译」后实测，云函数均已部署）：
- 发布需求不再报城市未开通，成功跳匹配页；匹配页展示需求摘要/候选/邀约/广播/空态。
- 订单 tab 两笔自测单；S9 单详情显示 4 星"系统默认评价"。

---

## 二、商用化系统改造办法

按"先止血、再强筋骨、后合规上线"三阶段推进。每项都给了**改哪里**和**怎么验**。

### 阶段 A：环境与稳定性（1～2 天）

1. **超时配置（必做）✅ 2026-09-13 已完成**：IDE 内置云开发控制台（个人版免费）即可改，路径：云函数列表 → 搜索函数 → 行内"版本与配置" → "配置" → 展开"高级配置" → 执行超时（1~60）→ 确定。已生效：order-timer=60s，demand-publish/order-create/order-action/demand-match=20s，payment-mock=10s，CLI info 读回 Active。
   - **注意：CLI 部署和 config.json 都不会改超时；`cli cloud functions info --names` 不支持逗号多函数，逐个查。**

2. **冷启动/性能**
   - 高频云函数里多个无依赖的 DB 读用 `Promise.all` 并行（demand-publish 的 config/user/紧急联系人已改）。
   - 列表接口分页（`pageSize` + `skip`），禁 `where({})` 全表拉取（demand-match hall_list 里的 HALL_DEBUG 全表日志上线前删除）。

3. **数据库索引（控制台 → 数据库 → 索引）**
   - `demand`：`(status, created_at)`、`(creator_openid, status)`、`expire_at`。
   - `order_main`：`(partner_openid, status)`、`(user_openid, status)`、`demand_id`、`created_at`。
   - `evaluation`：`order_id`、`to_openid`；`credit_score_log`：`openid, created_at`；`im_message`：`conversation_id, created_at`。

4. **版本与备份**
   - `git init` 并按模块提交（当前仅 .gitignore）；每次上线打 tag。
   - 云开发控制台 → 数据库 → 定时导出备份（每日）；代码备份沿用本次 zip 方式，重要节点各备一份。

### 阶段 B：数据一致性与资金安全（核心，3～5 天）

5. **关键写操作改事务**
   - 接单（order-create）、支付回调、状态流转（order-action）用 `db.runTransaction`：在事务内"读 demand/order → 校验状态 → 写 order + 改 demand 状态 + 写流水"，杜绝"先查后写"竞态（重复接单、超卖、状态错乱）。
   - 状态迁移**单一入口**：所有 `status` 变更只允许 order-action/order-timer 用 **CAS 条件更新**（`where({_id, status: 旧态})` 更新，`stats.updated===0` 即并发冲突，返回幂等/重试）。禁止其它函数直接 `update({status})`。

6. **真实支付替换 payment-mock**
   - 接入微信支付（云开发 cloud.tencentCloud 或商户号）：服务端统一下单 → 前端 `wx.requestPayment` → **支付回调验签** → 回调内事务置 S2 + 写支付流水。
   - 金额一律"分"（整数），服务端重算总价，不信任前端；加对账（每日比对支付流水与 order_main）。
   - AA 费用保持"线下自理、平台不经手"，承诺书留痕（已具备）。

7. **幂等与重试**
   - 支付、接单、评价等写接口支持幂等：前置状态判断 + 唯一约束（如 order_id + action 唯一），重复请求返回 `idempotent:true`（部分已具备，统一覆盖全部写接口）。

### 阶段 C：安全合规与可观测（上线前，2～3 天）

8. **权限与鉴权**
   - 数据库集合权限全部设为"仅创建者可读写"或"仅管理端"，业务读写一律走云函数；云函数内统一 `openid → 角色(user/partner/admin)` 校验，越权直接拒绝。
   - 管理后台 admin-action 加管理员 openid 白名单。

9. **内容安全与合规**
   - 文本 msgSecCheck 覆盖：备注、IM 消息、评价、昵称（备注/IM 已做，补齐评价/昵称）；图片 imgSecCheck（头像、聊天图、安全报备图）。
   - 实名/紧急联系人/青少年金额限制：服务端强校验从"发布"延伸到"支付前"再校验一次。
   - 上线前配齐：用户协议、隐私政策、个人信息收集清单（小程序后台「用户隐私保护指引」）。

10. **可观测**
    - 统一错误码 + `platform_event` 记录关键事件（接单/支付/投诉/超时）；云函数控制台开超时/错误告警。
    - order-timer 等定时任务加"每次跑处理条数"日志与失败告警。
    - 灰度：先传体验版内测（含本自测链路）→ 修完 → 正式发布。

### 上线操作指引（checklist）
1. 控制台调好所有函数超时；建好索引；集合权限收口。
2. payment-mock → 真实支付（沙箱验签 → 小额真机）。
3. 关键写路径改事务 + CAS；跑通 zz 回归（迁到独立测试环境/测试号）。
4. 内容安全、隐私协议、管理员白名单到位。
5. 数据库定时备份 + git tag；体验版灰度 3～5 天无 S1/S2 异常单 → 提交审核上线。

---

## 三、借助大模型美化界面（操作指引）

> 踩坑教训（来自同类项目）：**不要让模型直接大范围覆写页面**。正确节奏是"先出设计稿/规范 → 人确认 → 最小差异改样式"，且保留所有数据字段与事件名；WXML 新增的每个绑定字段必须在 Page.data 有默认值；图标商用阶段用官方 iconfont/图片而非 emoji（跨机型渲染不一致）。

### 第 1 步：准备喂给模型的材料
- 全局：`miniprogram/app.wxss`（现有设计 token：主色 #D4875A 赭橙、辅 #1A2330 墨蓝）、`app.json`（页面清单 + tabBar）。
- 标杆页面：`pages/index`、`pages/hall` 的 wxml + wxss，外加模拟器截图。
- 风格要求：从 `PRD/PRD.md` 摘"同城陪伴、温暖可信、安全"的调性关键词。

### 第 2 步：让模型先产出"设计规范"（不碰代码）
要求输出：① 设计令牌（色板/字号阶/间距 8 的倍数/圆角/阴影/动效时长）；② 通用组件库（按钮、卡片、标签、空态、骨架屏、底部安全区、导航）；③ 页面清单与信息架构；④ 3～5 个关键页面的高保真描述。视觉稿可用 UI 类 AI（即时设计 AI、MasterGo AI、Figma AI、v0、Galileo）出图。

### 第 3 步：可直接复制的提示词模板
```
你是资深微信小程序视觉设计师。现有项目是"同城功能性陪伴撮合"小程序，主题色
赭橙 #D4875A、墨蓝 #1A2330，调性温暖、可信、强调安全。请只输出设计规范，不要改代码：
1) 设计令牌：色板(主/辅/语义色/中性色)、字号阶(rpx)、间距(8rpx 基准)、圆角、阴影、动效；
2) 通用组件：主按钮/幽灵按钮/卡片/标签/空态/骨架屏/列表项，给出 WXSS；
3) 针对【首页/需求发布/匹配页/订单详情/我的】5 个页面，给出布局与视觉层级建议。
约束：兼容微信原生 WXML/WXSS，不引入第三方 UI 库；图标用 iconfont，不用 emoji；
给出可直接放进 app.wxss 的 CSS 变量与通用类。
```

### 第 4 步：截图迭代法（最有效）
把模拟器/真机截图发给多模态模型，问："对照规范指出本页 5 个最影响质感的问题，并给最小改动的 WXSS"。逐页过：首页 → 大厅 → 匹配 → 订单详情 → 我的。

### 第 5 步：落地（一次一页，可回滚）
1. 先把令牌 + 通用类沉淀进 `app.wxss`（项目已有 .card/.btn-primary 等基础类，在此扩展）。
2. 逐页迁移：只改 class/样式与少量结构，**不改 data 字段名和 bindtap 事件名**；新增绑定字段先在 data 给默认值。
3. 每页改完「编译」自测 → git 提交 → 再下一页；出问题 `git checkout` 回滚该页。

### 模型分工建议
- 文本/代码（规范、WXSS、结构建议）：GPT / Claude / 豆包 / DeepSeek。
- 视觉稿/改版对比：即时设计 AI、MasterGo AI、Figma AI、v0。
- 截图"找茬"：任意多模态模型（GPT-4o/豆包视觉等）。

---

## 四、待办（下次）
- [ ] **阶段B mock 订单链路回归（详见上方 2026-09-13 章节；A 广播 + B n02~n09 已 PASS；从 B 接 D_MAIN 续跑，夹具以 vars.json 为准：D_MAIN/新D2/D3 均 broadcast=true 在厅）**
- [x] ~~n02~n09 参数校验 + 3 个 broadcast~~ ✅ 2026-09-13 完成；tests/full-link-cases.md 已回填
- [ ] git 提交 cloudfunctions/文档/.trae/skills（单行中文 commit；.tmp-cloud-runner、preview-info.json、preview-qr.png 不入库）
- [ ] 阶段A#3 数据库索引（控制台手动）：demand(status,created_at)/(creator_openid,status)/expire_at；order_main(partner_openid,status)/(user_openid,status)/demand_id/created_at；evaluation order_id/to_openid；credit_score_log(openid,created_at)；im_message(conversation_id,created_at)
- [ ] 全链路编译/真机实测（模拟器或自测模式）：发布→匹配页/广播→接单→四确认→模拟支付→履约→评价→打赏；时间冲突与 50km 校验
- [ ] 隐私指引后台声明审核通过 → 真机验证真实 GPS → 删除自测模式（阻断项 1）
- [x] ~~控制台统一调超时（阻断项 2）~~ ✅ 2026-09-13 完成（个人版 IDE 面板可改，无需升级套餐）
- [ ] 测试环境重建 zz-selftest-timer 完成 order-timer all_pass 验收（阻断项 3，代码在 git `cf138e0`）
- [x] zz-selftest-timer 已从本地与云端删除（2026-09-12）
- [x] git 初始化与全量入库、PRD 恢复、备份归档（2026-09-12）
- [x] demand-match hall_list 的 HALL_DEBUG 全表日志已删除（2026-09-09 已部署，3.6KB）。
- [x] 把"CLI 不应用 timeout/triggers、免费版锁 3s"补进 `.trae/skills/wx-cloud-deploy/SKILL.md`（2026-09-10 已完成，含排障速查 3 条；2026-09-12 更新 IDE 新路径）。

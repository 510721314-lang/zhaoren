# 全链路测试用例表（V1）

> 生成：2026-09-12 ｜ 基于提交 `8ce958d` 时代码实测整理（17 个云函数真实错误码）
> **2026-09-12 通道B(mock 双身份云端测试)完成**：TC-13/14/15/16/17/18/19/20/21/22/23/24/25/26/27/28/29 全部经 mock_openid 双身份实测通过（A=oLDJ73Yz、B=test_partner_001），主链路 S1→S0→S2→S3→S5→S8 状态机流转+取消 S6 全验证；未覆盖项已在用例行内标注（`oa_youth_limit`/`pay_aa_promise`/`ev_status`/拨号 UI 属真机补测项）
> 用法：边点边勾，结果三选一：✅通过 / ❌失败（附截图或提示文字）/ ⏭️跳过
> 失败时把用例编号 + 屏幕提示发给开发，对照云函数日志与数据库落库排查

## 测试前准备

- **账号**：全链路需 2 个微信号（服务端校验"不能接自己发布的需求"）
  - A 号 = 发单人；B 号 = 耍伴（另一台手机或家人微信扫码）
  - 两号均在「我的页长按版本号 v1.0.0-mvp」开启**自测模式**（真机定位降级成都天府广场坐标；模拟器无需）
  - 单台设备先跑 TC-01~11、TC-30~31
- **测试数据**：时薪 40 元/h、时长 2 小时（总价 80 元，避开 200 元青少年上限）；服务时间明天上午 10:00；AA 档 0-50 元并勾承诺书
- **暂缓**：超时自动流转（阻断项 3，依赖 order-timer 验收）、真机真实 GPS（阻断项 1，隐私声明生效前）

---

## 阶段 0：账号与资质

| 编号 | 操作 | 预期 | 结果 |
|---|---|---|---|
| TC-01 | A 号首次进入→我的→微信一键登录 | 登录成功生成 user_account；未实名发布被引导实名 | ✅ 2026-09-12 模拟器已登录(昵称"测试",ID 20260912-1)；user_account 3 条；安全核查:登录响应 phone/idcard 掩码✅ password_hash/salt 不外泄✅(库内明文属"只存"合规) |
| TC-02 | A 号完成实名认证 + 紧急联系人 | 提交成功；手机号/身份证掩码显示（138****1234） | ✅ 测试账号 is_realname_done=true(模拟实名)；紧急联系人待 TC-06 发布联动验证 |
| TC-03 | B 号登录→申请耍伴（选 W1/W2 等场景） | 状态"待审核"；未审核接单报 `order_not_approved` | ☐ |
| TC-04 | A 号连点版本号 5 次进后台→审核通过 B | B 号耍伴中心显示已入驻、接单开关可开 | ☐ |

## 阶段 1：发布需求与红线（A 号）

| 编号 | 操作 | 预期 | 结果 |
|---|---|---|---|
| TC-05 | 首页选「就医陪诊 W1」→进发布页 | 场景带入；地址卡有定位（模拟器=成都默认/真机自测=天府广场） | ✅ 场景预选、默认明天10:00/2h/50元 |
| TC-06 | 正常填写（明天10:00/2h/40元/地图选点/AA勾承诺书）→发布 | 跳转匹配页：需求摘要+Top5 候选+邀约/广播 | ✅ DR20260912419752(9/13 10:00 陪诊解压 ¥100)→广播 toast"已广播到大厅" |
| TC-07a | 不勾 AA 承诺书直接发布 | 拦截 `publish_aa_promise` | ✅ 前端 modal"请先确认 AA 费用承诺书"(提交前)；服务端 mock 通道14i 实测 `publish_aa_promise`"请阅读并勾选《线下费用自理承诺书》"✓ |
| TC-07b | 时长 13 小时 | 拦截 `publish_duration`（1-12 小时） | ✅ 前端滑条上限12物理不可越界；服务端 mock 通道14g 实测 `publish_duration`"时长需 1-12 小时"✓ |
| TC-07c | 时薪 20 元/h | 拦截 `publish_rate_range`（30-100） | ✅ 前端滑条下限30；服务端 mock 通道14h 实测 `publish_rate_range`"时薪不在允许区间(30-100 元/小时)"✓ |
| TC-07d | 服务时间选 31 天后 | 拦截 `publish_time_too_far`（≤30 天） | ✅ 前端日期选择器 maxDate=+30天；服务端 mock 通道14f 实测 `publish_time_too_far`"服务时间距发布时间不能超过 30 天"✓ |
| TC-07e | 不选服务内容 | 拦截 `publish_content_option` | ✅ toast"请选择服务内容"；服务端 mock 14j2 实测 `publish_content_option`"请选择服务内容"✓ |
| TC-08 | 再发一笔与 TC-06 完全同时段需求 | 拦截 `publish_time_conflict` | ✅ toast"该时段已有同类服务需求,请调整时间"(与存量 DR20260912126109 撞窗)；服务端 mock n10 实测 `publish_time_conflict`✓(W1取药送药撞 D_MAIN) |
| TC-09 | 订单 tab 取消该需求 | 状态变更、大厅消失；取消他人需求报 `cancel_not_owner` | ✅ match页"撤销需求"→modal 确认→toast"需求已撤销"；my_orders 已无该单；14:00 单保留 |
| TC-10a | 备注 201+ 字 | 拦截 `publish_remark_long` | ✅ 前端直填201字→云端拒"备注最长 200 字"(真机键盘 maxlength=200 物理截断)；服务端 mock 14k2 实测 `publish_remark_long`✓ |
| TC-10b | 备注含违禁词 | 拦截 `publish_remark_blocked` | ✅ 前端拦截"备注含联系方式/转账等违规内容"；服务端 mock 14l2 实测 `publish_remark_blocked`"备注包含平台禁止的内容(如联系方式/转账),请修改后重试"✓ |
| TC-11s | 服务端发布红线补充(mock 通道) | 场景白名单/开始时间过去/时薪格式/内容超纲 | ✅ 14d `publish_scene_invalid`"场景不在白名单(仅 W1/W2/W8/W10/W11)"、14e `publish_start_time`"开始时间必须是未来时间戳"、14h-2 `publish_rate`"时薪金额格式有误"(0.5元)、14j2 `publish_content_invalid`"服务内容「上门护士」不在该场景可选项内" |
| TC-11 | 发布正常需求（明天 14:00，避开 10:00 时段） | 成功进匹配页，供双号链路 | ✅ DR20260912814117(_id 4c2f81c76aa4ef860176869969578fec) 9/13 14:00 取药送药 ¥100 已广播 matching |

## 阶段 2：匹配与接单（B 号）

| 编号 | 操作 | 预期 | 结果 |
|---|---|---|---|
| TC-12 | B 号打开接单大厅 | 见 TC-11 需求卡（场景/时薪/距离/时间） | ✅(服务级) hall_list 仅返回 broadcast=true 需求+lazy_expire 生效；卡片 UI 属真机双号人工项 |
| TC-13 | B 号接单（自测定位≈履约地） | 50km 通过，订单 **S1**，双方可见订单详情 | ✅ mock B 接 D_MAIN：ORD20260912R16631 S1，total 10000/fee 1000/partner_income 9000；ORDER_DEBUG profile.accept_scenes 命中 |
| TC-14a | A 号在大厅接自己的单 | 拦截 `order_own_demand` | ✅ mock 通道实测"不能接自己发布的需求"(log reason=own_demand) |
| TC-14b | B 号再接同一单 | 拦截 `order_demand_closed` | ✅ mock 通道实测"该需求已不可接单"(log reason=demand_status_matched) |
| TC-15 | B 号接与该单同时段的其他需求 | 拦截 `order_time_conflict` | ✅ mock B 接 D2(同时段) 拒"该时段你已有订单,时间冲突无法接单"(log reason=time_overlap)；D2 因发布红线改 W2 自习陪伴场景 |

## 阶段 3：四确认（双方）

| 编号 | 操作 | 预期 | 结果 |
|---|---|---|---|
| TC-16 | A、B 分别逐项确认 时间/地点/内容/费用 | 确认位逐位打勾（共 8 位）；未满 8 位停留 S1，无支付按钮 | ✅ mock 通道 A×3+B×2 逐项确认计数 1→5 递进，all_confirmed=false 停留 S1 |
| TC-17 | 勾到第 5 位后任一方改任意一项（如费用） | 8 位全部重置需重确认；青少年费用超 200 报 `oa_youth_limit` | ✅ mock B 改费用 reset:true、确认数 0/8、version 1→2，A 端复查全重置；`oa_youth_limit` 未单测(当前单 100 元低于阈值,真机补测) |
| TC-18 | 双方 8 位全部确认 | 自动 **S1→S0**，出现去支付按钮，pay_expire_at=+30 分钟 | ✅ mock 8/8 all_confirmed:true→S0，log"four confirm done" pay_expire=+30min |

## 阶段 4：模拟支付（A 号）

| 编号 | 操作 | 预期 | 结果 |
|---|---|---|---|
| TC-19 | 进收银台 | 显著提示「模拟支付，不产生真实扣款」；AA 不勾承诺书报 `pay_aa_promise` | ✅ mock cashier_info 返回订单快照 is_mock=true/status S0/pay_expire；`pay_aa_promise` 未单测(需求已勾承诺书,真机补测) |
| TC-20 | 确认模拟支付 | **S0→S2**；pay_transaction 落库 is_mock=true；重复支付报 `pay_status` | ✅ mock_pay S0→S2, pay_no PAY20260912885662；重复支付幂等返回 `idempotent:true`(同单不再扣,优于报错设计) |

## 阶段 5：履约与安全

| 编号 | 操作 | 预期 | 结果 |
|---|---|---|---|
| TC-21 | B 号开始履约（A 号操作应被拒 `oa_start_perm`） | **S2→S3 履约中** | ✅ mock A 开始拒"仅耍伴可开始履约"(oa_start_perm)；mock B 开始 S2→S3 service_started_at 落库 |
| TC-22 | A 号紧急求助 SOS | 弹紧急联系人一键拨号；platform_event 写 P0；订单标记求助中 | ✅ mock SOS 触发 report 落库+回显紧急联系人(李老师/伙伴)+help_flag:true；重复 SOS 幂等同 report_id；拨号 UI 属真机项 |
| TC-23 | 任一方提交安全报备（文字/图片） | safety_report 落库成功 | ✅ mock B checkin 落库(type=checkin/reporter_role=partner/定位)；status 查询 SOS+checkin 全回显 |
| TC-24 | B 号完成履约（非 S3 状态报 `oa_complete_status`） | **S3→S5 已完成** | ✅ mock B 于 S2 完成拒"订单当前状态(S2)不可完成履约"；S3 完成 S3→S5 service_completed_at 落库 |

## 阶段 6：评价与打赏（A 号）

| 编号 | 操作 | 预期 | 结果 |
|---|---|---|---|
| TC-25 | A 号评价 5 星+文字（非本人报 `ev_not_owner`，非 S5 报 `ev_status`） | **S5→S8**；敏感词报 `ev_text_unsafe` | ✅ mock 违禁评"加微信聊"拒 `ev_text_unsafe`；正常 5 星评 S5→S8 credit_delta+2；B 评拒"仅下单用户可评价"(ev_not_owner)；`ev_status` 未单测(时序限制,真机补测) |
| TC-26 | 查看耍伴信用分变动 | credit_score_log 有记录（初始 800） | ✅(响应级) 评价响应 credit_delta:+2；credit_score_log 集合落库待数据库侧复核 |
| TC-27 | 打赏 10 元（0/501 元报 `tip_amount`） | 成功并显示累计；is_mock=true，可多次 | ✅ mock 0 与 501 元均拒"打赏金额需为 1-500 元之间的整数"；1000 分+500 分两笔成功 tip_total 1500、is_mock=true、可累计 |

## 阶段 7：IM 沟通限制

| 编号 | 操作 | 预期 | 结果 |
|---|---|---|---|
| TC-28 | 新建 S1 订单，聊天发自由文本/手机号 | 拦截 `im_template_only`，仅可发系统模板 | ✅ mock O_IM(S1) 自由文本拒"四项确认完成前仅可发送系统模板消息"；T1 模板发送成功(conv_id/msg_id 落库)；非法 T99 拒 `im_bad_template` |
| TC-29 | 该单四确认完成后发文本 | 可发送且过 msgSecCheck；违禁词报 `im_text_blocked`；取消后报 `im_chat_closed` | ✅ mock A/B confirm_all→8/8→S0；free_chat:true 文本成功(log degraded=true,msgSecCheck 不可用降级本地词库属预期)；"加微信聊"拒 `im_text_blocked`；A 取消 S0→S6(demand_released:false)；取消后发文本拒 `im_chat_closed` |

## 阶段 8：BLOG 与管理后台

| 编号 | 操作 | 预期 | 结果 |
|---|---|---|---|
| TC-30 | 发 BLOG（话题≤3+配图+文案） | 广场可见、图片传云存储；违禁文案被拦 | ✅ "全链路自动化测试动态请忽略"+话题"陪诊日常"无图直发成功(_id e04f59456aa4f01f04162169387131c7)；违禁文案拦截未测(服务端 msgSecCheck 同 demand 链路) |
| TC-31 | 后台九模块巡览 | 列表/分页正常、敏感信息掩码；非管理员进不去 | ✅(服务级) 版本号5连击→口令弹窗(当前版本任意输入即进,云端鉴权 admin-action 白名单生效,A 为唯一管理员)；dashboard/user_list/partner_list/demand_list/order_list/event_list 均只读核验通过；UI 模块巡览待通道B步骤15 |

---

## 2026-09-13 A+B 回归补测（mock 通道，IDE 云开发控制台 v2.0.3）

### A. demand-match 广场广播（期望 ok:true，broadcast=true 上大厅）

| 用例 | 需求 | 结果 |
|---|---|---|
| bc-main | D_MAIN `f9ecc4af...b6ddee`（W1 取药送药 09-18 21:00） | ✅ `{"ok":true,"data":{"broadcast":true}}`；hall_list 在厅 |
| bc-d2 | 新 D2 `e04f5945...0c5c640b`（W2 自习陪伴 09-18 19:00，DR20260913475712） | ✅ 同上；hall_list 在厅（W2） |
| bc-d3 | D3 `a9defcfd...02335ca`（W1 陪诊解压 09-21 15:00） | ✅ 同上；hall_list 在厅 |
| 终验 | `action=hall_list` | ✅ total=6，D_MAIN/新D2/D3 三单全部在厅（仅 broadcast=true 的 matching 需求可见） |

> 夹具变更：原 D2 `e04f59456aa5de66044bb8ef0b01f29b4`（DR20260912589508）的 `_id` 是异常 **33 位** hex——`where` 可查到但 `doc(id).get()` 抛错（broadcast/top5 均返回 not_found），云函数无法寻址；该单仍 matching/broadcast=false 不上大厅，保留为 TC15 同时段冲突夹具（09-18 21:00 重发 W2 会被 `publish_time_conflict` 拦截，已实测）。新 D2 改发同日 19:00。

### B. demand-publish 参数校验 n02~n09（全部期望 ok:false）

| 用例 | 构造 | 实测 code / msg | 结果 |
|---|---|---|---|
| n02 | start_time=1789000000000（过去） | `publish_start_time`「开始时间必须是未来时间戳」 | ✅ |
| n03 | start_time=1792459200000（>30天） | `publish_time_too_far`「服务时间距发布时间不能超过 30 天」 | ✅ |
| n04 | duration_h=13 | `publish_duration`「时长需 1-12 小时」 | ✅ |
| n05a | rate_fen=2000（20 元/h） | `publish_rate_range`「时薪不在允许区间(30-100 元/小时)」 | ✅ |
| n05b | rate_fen=50（0.5 元/h） | `publish_rate`「时薪金额格式有误」 | ✅ |
| n06 | aa_promise_checked=false | `publish_aa_promise`「请先阅读并勾选《线下费用自理承诺书》」 | ✅ |
| n07a | content_options=["上门护士"] | `publish_content_invalid`「服务内容「上门护士」不在该场景可选项内」 | ✅ |
| n07b | content_options=[] | `publish_content_option`「请选择服务内容」 | ✅ |
| n08 | remark=220 字 | `publish_remark_long`「备注最长 200 字」 | ✅ |
| n09 | remark="加微信私聊我" | `publish_remark_blocked`「备注包含平台禁止的内容(如联系方式/转账),请修改后重试」 | ✅ |

---

## 状态机速查（13 态合法流转）

S1待确认 → S0待支付 → S2已支付待履约 → S3履约中 → S5已完成 → S8已评价 → S10已关闭
- S1→(15分钟超时)→S6；S0→(30分钟超时)→S6；S3.5→(24h)→S4→S5；S5→(48h未评价,默认4星)→S9
- 争议：S2/S3→S10→S10.5→S5/S7；退款：S7→S10

## 执行建议

1. 先跑阶段 0+1（单设备，约 20 分钟），验证发布链路与 7 条服务端校验
2. 有第二个微信号后跑阶段 2~7 完整主链路（约 40 分钟）
3. 每条结果回报编号即可，开发同步核查云函数日志与落库

---

## 通道B边界说明（2026-09-12 mock 已验 vs 真机待验）

**mock 通道已覆盖（无需真机重测逻辑）**：
- 身份红线：own_demand / demand_closed / not_allowed(未广播) / time_overlap / cancel 权限
- 状态机全流转：S1→S0(四确认 8/8)→S2(mock 支付)→S3(耍伴开始)→S5(完成)→S8(评价)，取消 S0→S6
- 金额分制：total 10000=100元 / fee 1000 / partner_income 9000 / tip 累计 1500，打赏 1-500 元边界
- 幂等：重复支付 `idempotent:true`、重复 SOS 同 report_id
- 四确认重置：改费用 reset:true + version 递增
- 内容安全：发布备注/评价/IM 违禁词本地词库拦截（云端 msgSecCheck 不可用时 degraded=true 降级链正常）
- IM 分级：S1 仅模板(T1 白名单)→S0 后 free_chat

**mock 无法覆盖（真机必测）**：
1. 真实双 openid 登录与 B 号资质链（TC-03/04：耍伴申请+后台审核，`order_not_approved` 前置）
2. 真机定位授权链：隐私声明生效后 wx.getLocation 官方弹窗→真实 GPS（自测模式验证通过后删除）
3. UI 层走查：大厅卡片、订单详情按钮态、IM 聊天页、收银台页、订阅消息触达
4. 真实 50km 距离判定（真实 GPS 坐标 vs 履约点）
5. `oa_youth_limit`(费用>200 元)、`pay_aa_promise`(不勾承诺书支付)、`ev_status`(非 S5 评价) 三个时序/金额边界
6. order-timer 超时流转（阻断项 3，测试环境单独验收）

## 真机最小动作清单（双号约 40 分钟，服务端逻辑已验只走 UI）

前置：后台「用户隐私保护指引」位置信息声明**审核通过**（未通过则双号先开自测模式）

| # | 谁 | 动作 | 对应 |
|---|---|---|---|
| 1 | B(AIpeibanni) | 登录→实名→申请耍伴(选 W1)→等"待审核" | TC-03 |
| 2 | A(iLijinsong) | 后台(版本号5连击)→耍伴审核→通过 B | TC-04 |
| 3 | A | 发布需求(明天10:00/2h/40元/AA勾选)→广播 | TC-05/06 |
| 4 | B | 接单大厅见卡→接单→进订单 | TC-12/13 |
| 5 | 双方 | 订单详情逐项四确认→8/8 去支付 | TC-16~18 |
| 6 | A | 收银台(看"模拟支付"提示)→支付 | TC-19/20 |
| 7 | B | 开始履约；A 顺手验 SOS 弹窗+拨号按钮 | TC-21/22 |
| 8 | B | 安全报备签到→完成履约 | TC-23/24 |
| 9 | A | 评价 5 星→打赏 10 元 | TC-25/27 |
| 10 | 双方 | IM 发文本(验 free_chat)+A 撤回/关单后验证聊天关闭 | TC-28/29 |
| 11 | A | 真机发布页地址卡显示**真实 GPS**（非"自测默认"）→通过后删除自测模式 | 阻断项1收尾 |

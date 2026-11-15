# T-14.3 formal 生效端到端验收（模拟器代执行）

## Context
paid 订阅模板四模板已全 formal（T-14.3 配置变更已 commit f70d3bc8）。目标：一笔新单走真实 mock_pay 主流程，证明 formal 状态不阻断订阅消息发送（卡片 formal/trial 展示无差异，发送成功即证明；跳转行为留待正式版过审后）。验收断言：
1. `order_main.sub_msg_send_logs` 新增 `{key:'paid', channel:'cloud', status:'ok', errCode:''}`
2. `partner_profile.sub_msgs.paid` sent_count 由 2 → 3（当前 granted=4/sent=2，余量足）

纯验证任务，不改任何代码/配置/部署；新造需求与订单均为测试数据。

## 已探明契约（实测代码依据）
- **身份通道**（_shared/openid.js:76-78）：env=dev + dev_until 未过期时，模拟器带真实 OPENID 调用传 `mock_openid` 可切换身份。11-14 先例（REGISTRY #171）即真机账号做 partner、user 侧走 mock 身份。
- **demand-publish**（action_publish.js）：scene 白名单、start_time 未来且避开 00:00-06:00、duration 1-12h、hourly rate 默认 3000-10000 分、aa_tier+aa_promise_checked+disclaimer_signed 必勾、contact_phone_source='custom' 传 11 位、content_options 属场景 options、user 须存在且 realname、mock_openid 通道跳过 GPS 强校验。
- **order-create action_take**：禁接自己需求（L143）；partner_location.accuracy≤50 必传（L207-211）；接单方=模拟器真账号（take_readiness 全绿已实测）。
- **四确认**：order-action `confirm_all` 一次确认本侧 4 项；S1→S0 CAS。
- **mock_pay**（action_pay.js）：`order.user_openid === openid` 强校验 → user 侧支付必须带 mock_openid=user 身份；成功后 Promise.allSettled 触发 sendPaidSub（paid_sub.js）。
- **核验通道**：admin-action `order_detail`（返回双方 openid/状态流水）；partner-action `action_config`（授权页，返回 sub_msgs.paid 可看 sent_count）；send_logs 走 admin-web 网关 nosql（admin key 在 C:\zhaoren-bak\admin-key-20261009.txt，zhaoren-frequent-flows 固化流程）。

## 执行步骤
0. **连接模拟器**：`cli.bat auto --project C:\zhaoren --auto-port 9420` → mcp_weapp-test_miniprogram_connect {port:9420}；evaluate 用 function(){}+success/fail 回调，结果挂 getApp().__变量 两段式。
1. **前置探针**：
   - admin-action `config_public`/`config_get` 核 `sub_msg_templates.paid.miniprogram_state='formal'`；
   - mock 通道试探：demand-publish 带 mock_openid 调用，被业务码拒绝（而非 publish_no_user 前的身份缺失）即证 env=dev 生效；
   - user 身份确认：优先 `test_partner_001`（历史接单测试身份，应有 realname user 文档）；若 publish_no_user，依次试 simu_001 等，2 次失败则停下上报。
2. **① 发布需求**：demand-publish `publish`，mock_openid=user身份；参数：scene=W8、content_options=['排队代办']、pricing_type=hourly、rate_fen=3000、duration_h=1、start_time=now+2h、aa_tier='0-50'、aa_promise_checked=true、disclaimer_signed=true、contact_phone_source='custom'、contact_phone='13800000001'、location={name:'春熙路',city:'成都'} → 记 demand `_id`。
3. **② 接单**：order-create `action_take`，真实 OPENID（无 mock），demand_id + partner_location={latitude:30.65, longitude:104.08, accuracy:20} → 记 order `_id`（32 位 hex）。
4. **③ 四确认**：order-action `confirm_all` ×2——user 侧带 mock_openid=user身份，partner 侧真账号 → 订单 S0。
5. **④ 支付**：payment-mock `mock_pay`，mock_openid=user身份，{order_id, aa_promise_checked:true} → S2 + paid_sub 触发。
6. **⑤ 核验**（三通道对账）：
   - admin-action `order_detail`：user_openid/partner_openid/状态流水 S1→S0→S2；
   - partner-action `action_config`（真账号）：`sub_msgs.paid.sent_count` 3、granted 4；
   - admin-web 网关 nosql 查 order_main `sub_msg_send_logs` 最新一条 = `{key:'paid',channel:'cloud',status:'ok',errCode:''}`。
7. **收尾**：输出固定格式验收报告；REGISTRY #171 补 formal 复验记录 + CHANGELOG 追加（docs commit 需另行授权）；提醒 git commit。

## 风险与回退
- 任一环失败 2 次 → 停手，改给用户真机 5 步操作指引（已备：发布 W8 10元/时→自接单→四确认→支付允许→回执核验）。
- 若 sendOnce 因 formal 被 43101/47003 拒 → 即为本次验收要暴露的问题，凭 errCode 上报，不做扫射式修改。
- 不触碰 @VERIFIED 代码；不改动既有订单/需求数据。

## 验证方式
全链云函数真实调用（非 mock 返回值伪造），最终以数据库回读（send_logs + sent_count 双证据）为验收凭据。

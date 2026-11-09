# PAGE_SPEC.md · 页面规格（45 页 · v1.0 · 2026-11-08）

> 范围：`miniprogram/app.json` 注册的 **45 个页面**（主包 19 + `pages-v2/admin` 8 + `pages-v2/agreement` 1 + `pages-v2/privacy` 1 + `pages-v2/pkg-low` 16）。
> **数据来源：源码实测**（各页 `.js`/`.wxml`/`.json` 逐页读取）。凡代码里读不出的（如后端返回结构、云端文案来源）一律标**【待补】**，**不做推断、不补话术**。
> 相关文档：组件见 [COMPONENTS.md](COMPONENTS.md)，云函数契约见 [API.md](API.md)，集合字段见 [DATA_MODEL.md](DATA_MODEL.md)。

---

## 0. 全局口径（45 页共用，逐页不再重复）

| 项 | 事实 | 依据 |
|---|---|---|
| 主包 / 分包 | 主包 19 页；分包 4 个（`admin` 8、`agreement` 1、`privacy` 1、`pkg-low` 16） | [app.json](../miniprogram/app.json) |
| tabBar 页 | 4 个：`index`、`square`、`message`、`profile`；**只能用 `switchTab`/`reLaunch` 进入** | app.json `tabBar.list` |
| 登录态 | `utils/bootstrap.js` 统一判定（`isLoggedIn()`）；退出登录必须 **storage + globalData 双清**（`clearLoginUser()`） | core 附录 / C-3.11 |
| 空态 | 旧版 `empty-state`（`app.json` 全局注册）与新版 `ui-empty`（局部）并存；组件未注册时页面直接不渲染空态 | COMPONENTS.md §3 |
| 夜间红线 | `utils/redline.js`；`night-mask` 组件只负责提示，**拦截由各页自身 `isRedline`/`checkEntryLocked` 做** | COMPONENTS.md §2.1 |
| 埋点通道 | 统一走 `utils/report.js` → `wx.reportAnalytics`；**全站仅 7 处**（见 §5.1），其余页面无埋点 | 逐页实测 |
| 导航兜底 | 2026-11-08 已对 18 文件 36 处 `navigateTo`/`redirectTo` 补齐 `fail` 兜底（复扫缺口 0） | `regression-20261108.md` |

---

## 1. 分组索引

| 分组 | 页数 | 页面 |
|---|---|---|
| 主包（核心业务） | 19 | `index` 首页、`square` 广场、`message` 消息、`profile` 我的、`login` 登录、`publish` 发布、`demand-detail` 需求详情、`nearby-list` 附近列表、`nearby-map` 附近地图、`partner-detail` 耍伴详情、`chat` 会话、`pay` 收银台、`order-detail` 订单详情、`workbench` 工作台、`orders` 订单列表、`my-demands` 我的需求、`blog` 动态、`blog-publish` 发动态、`blog-detail` 动态详情 |
| `pkgAdmin` | 8 | `admin` 看板、`users`、`partners`、`demands`、`orders`、`finance`、`config`、`user-detail` |
| `pkgAgreement` | 1 | `agreement` 协议 |
| `pkgPrivacy` | 1 | `privacy` 隐私政策 |
| `pkgLow` | 16 | `wallet`、`credit`、`contacts`、`notices`、`partner-apply`、`partner-profile-edit`、`accept-config`、`activity-detail`、`realname`、`safety`、`evaluate`、`exam`、`exam-status`、`study`、`kefu`、`no-show-report` |

---

## 2. 主包（19 页）


### 1. pages-v2/index/index —— 首页/发现门户（问候+场景宫格+运营位+耍伴端附近可接）
- 分包：主包
- 生命周期：onLoad（读窗口信息与问候语、fetchUser 拉 peek_login、fetchSquare(true) 用 SWR 缓存秒开）/ onShow（刷新夜间红线态、续作条 _refreshGuides、铃铛角标 refreshNoticeBadge、tabBar selected=0，非首次进入再 fetchSquare + 耍伴端 fetchNearby）/ onHide（stopNearbyPoll）/ onUnload（stopNearbyPoll）
- 依赖组件：safe-sell-bar, demand-card, night-mask（app.json 全局另有 night-mask/empty-state/bottom-sheet）
- 关键 data：gridScenes（宫格实际渲染，含「更多场景」入口格）、primaryScenes/moreScenes（前 5 常驻/其余折叠）、activePartners（活跃耍伴横滑）、banners（运营轮播）、nearbyList（耍伴端附近可接）、isPartner、user（含 unread_notice）、resumeTip/onboardTip（发布/入驻续作条）
- 接口：user-login: peek_login；home-action: square / nearby / scene_groups / home_activity_list；order-action: notice_list（铃铛脏标记时）
- 异常分支：搜索无结果→宫格区「未找到与「{{searchKey}}」相关的场景」+「试试：陪诊 / 学习 / 生活协助 / 出行 / 线上」；附近空→「附近暂无可接需求」；下拉刷新失败→toast「刷新失败，请稍后重试」（成功「已刷新」）；需求卡无 _id→「需求数据异常」；耍伴无 openid→「耍伴数据异常」；夜间红线拦截→toast gate.msg；首页各跳转均带 fail toast（如「客服打开失败」「发布页打开失败」「地图页打开失败」「详情页打开失败」「附近列表打开失败」）
- 埋点：无埋点

### 2. pages-v2/square/square —— 需求广场（运营卡+场景 chips+排序+抢单）
- 分包：主包
- 生命周期：onLoad（读 Storage 一次性 square_scene_code 预选 chip、fetchSquare(true)、fetchActivities）/ onShow（刷新 isRedline、重建 chips、tabBar selected=1，非首次 fetchSquare）/ onPullDownRefresh（拉 square 后 stopPullDownRefresh）
- 依赖组件：nav-bar, demand-card, empty-state, night-mask
- 关键 data：cards（运营活动卡）、chips（全部+动态场景+💚 公益免费）、activeChip、activeSort（综合/距离/最新/单价）、rawList→list（本地过滤+排序）、todayCount（status=matching 数）、isRedline
- 接口：home-action: square（limit=CONFIG.PAGING.squareLimit）、home_activity_list；抢单经 utils/take-order.js 的 takeOrder（内部 order 类云函数，页面未直调）
- 异常分支：筛选/场景下无数据→empty-state「当前筛选下暂无需求」desc「{matchExpandMin}分钟内无匹配时将为你智能扩圈，预约下单还可享{reserveDiscountText}」；夜间红线→toast「夜间{PICKER_CLOSE}-{open}暂停抢单」；活动 scene_list 缺参→toast「场景参数缺失」；切身份失败→toast「请在「我的」切换身份」；聊天页打开失败→toast「聊天页打开失败,请从「消息」进入」；卡片跳详情失败→toast「打开失败，请稍后重试」
- 埋点：无埋点

### 3. pages-v2/message/message —— 消息中心（订单会话列表+系统通知入口）
- 分包：主包
- 生命周期：onLoad（fetchData(true) 首屏拉 5 条会话）/ onShow（刷新 isRedline、tabBar selected=2，非首次且非 loading 时 fetchData(true)）
- 依赖组件：nav-bar, status-tag, night-mask（empty-state 仅由 app.json 全局声明，页面 json 未声明）
- 关键 data：orderList（会话装饰后列表：displayTitle/demand_title/order_summary/unread_count）、entries.system（系统通知入口，含 avatar 🔔/last_msg/unread_count）、pageSize=5、hasMore、loadingMore、loadError/loadErrorMsg、retentionText（未成单保留 {unDealDays} 天…）
- 接口：im-conv: my_convs（limit=pageSize, skip, timeout 12000）；order-action: notice_list（limit 1，取未读与最近一条）
- 异常分支：云端 ok=false→empty-state「加载失败」desc={r.msg || '加载失败'}、btnText 重试；请求 reject→同组件 desc「网络异常,请重试」；无会话→empty-state「暂无消息」desc「订单创建后会话将出现在此」；详情页失败→toast「详情页暂不可用」；聊天失败→toast「跳转失败」；通知页失败→toast「通知页暂不可用」
- 埋点：无埋点

### 4. pages-v2/profile/profile —— 我的（双身份工作台+信用分+设置菜单）
- 分包：主包
- 生命周期：onLoad（fetchUser）/ onShow（刷新 isRedline、isGuest、tabBar selected=3、fetchOnboarding，fetchUser 30s 防抖未命中时改刷 fetchExamBadge）
- 依赖组件：nav-bar, night-mask, ui-card, ui-cell
- 关键 data：user（脱敏后 _id/nickname/avatar/phone/roles/双信用分/is_realname_done）、identity（user|partner，落 Storage current_identity）、notice_unread、orderEntries（待支付/进行中/待评价/售后计数）、menuGroups（buildMenu 分组，耍伴多「学习与资质」）、onboarding（入驻八步卡）、isGuest、editOpen/editNick/editAvatarTemp
- 接口：user-login: peek_login / update_profile / close_account；order-action: my_counts / my_orders / notice_list（limit 1, timeout 12000）；partner-action: my_profile / exam_subjects；demand-publish: my_demands；头像经 wx.cloud.uploadFile 直传
- 异常分支：未登录→头部访客卡「登录后即可发布需求」（desc「微信一键登录，完成实名认证后即可发布需求、接单赚钱」）；peek_login 失败→toast「登录失败」或 r.msg；请求 reject→toast「网络异常」；工作台空态→「暂无承接订单，去广场抢单吧」/「暂无发布需求，去…发布」；切 partner 无资格→「请先完成耍伴认证」；昵称/头像都空→「请填写昵称或更换头像」；昵称>20→「昵称长度需 1-20 字」；上传失败→「头像上传失败,请重试」；showModal 失败→「弹窗调用失败」；退出/注销均清 4 个 Storage + getApp().clearLoginUser() 后 reLaunch login
- 埋点：无埋点

### 5. pages-v2/login/login —— 登录（协议勾选+微信一键登录+R5 年龄拦截）
- 分包：主包
- 生命周期：onLoad（读 statusBarHeight、peekExistingUser 预取 age）/ onShow（刷新 isRedline）
- 依赖组件：night-mask
- 关键 data：agreeItems（用户服务协议/隐私政策/人脸信息处理声明）、agreements、allChecked（三项全勾才可点）、logging、rejected/rejectReason（年龄不足拦截页）、age、isRedline
- 接口：user-login: peek_login（仅取 age）、login
- 异常分支：未勾协议→按钮 disabled 不可点；login 返回失败→modal「登录失败」content={r.msg || '请稍后重试'}；请求 reject→toast「网络异常」；age < CONFIG.ADULT_AGE→整屏拦截「暂无法提供服务」+「您的年龄为{x}周岁，本平台仅向{n}周岁及以上用户提供服务」；协议页跳转失败→toast「页面加载失败」；未实名且有 onboard intent→modal「还差一步」confirmText 去实名/cancelText 稍后，跳实名失败则 clearOnboardIntent + askUserType
- 埋点：utils/report.js → wx.reportAnalytics('login_success', { hub_time })

### 6. pages-v2/publish/publish —— 发布需求（表单+免责声明+代发授权+草稿）
- 分包：主包
- 生命周期：onLoad（access 总开关关闭即 modal「功能维护中」并退出；编辑模式回填 detail；sceneCode 预选、发布快照 24h 回填、定向邀约参数、自动定位、peek_login、日期范围、startAutoSave、拉 list_drafts 角标）/ onShow（刷新 isRedline、fetchScenes 拉动态场景）/ onUnload（清自动保存与定位定时器、作废迟到定位回调）
- 依赖组件：nav-bar, bottom-sheet, tag-chip, night-mask, scene-picker, auth-sign-sheet
- 关键 data：form（project_attr/pricing_type/scene_code/content_options/title/description/service_date/service_time/duration_hours/location_name/latitude/longitude/headcount/budget/aa_estimate/gender_pref/match_mode）、publishType（self|proxy）、proxyName/proxyRelation/proxyPhone、contactPhone/useAccountPhone、publishLocation（真实 GPS 只读）、disclaimerChecked、petAuthChecked/petAuthSignFileId、proxyAuthChecked/proxyAuthSignFileId、isEditMode/publishing、draftList/draftCount
- 接口：home-action: scene_groups；user-login: peek_login；admin-action: config_public（法定文本）；partner-action: detail；demand-publish: detail（编辑回填）/ list_drafts / publish / update；签名图与头像类经 wx.cloud.uploadFile
- 异常分支：维护中 modal「发布需求功能正在维护，请稍后再试。」；编辑需求不存在→toast「需求不存在」1.2s 返回；加载失败→「加载需求失败」；场景无服务项→toast「该场景暂未配置服务项」；服务项超限→「最多选择 {n} 项」/不足→「请至少选择 1 项服务内容」；不同意免责→toast「请同意免责声明后继续」；时间红线→toast「须满足时间红线{CLOSE}-{OPEN}」；智能派单锁定→「智能派单为高信用耍伴专属」；定位不可用→modal「定位不可用」content「无法自动获取发布地址, 是否在地图上手动选点?」；手动选点拒绝→toast「未选择位置,无法发布」；距离超限→modal「距离超出允许范围」；发布失败→toast r.msg 或「操作失败」，reject→「网络异常，请重试」；签名上传→「签名上传失败,请重试」
- 埋点：utils/report.js → wx.reportAnalytics('demand_publish' 或 'demand_update', { hub_time, scene, match_mode })

### 7. pages-v2/demand-detail/demand-detail —— 需求详情（接单/编辑/取消+发布者接单感知轮询）
- 分包：主包
- 生命周期：onLoad（fetchData 拉 detail）/ onShow（刷新 isRedline，非首次 reload）/ onHide（stopOwnerPoll）/ onUnload（stopOwnerPoll）
- 依赖组件：nav-bar, tag-chip, partner-card（empty-state 由 app.json 全局声明）
- 关键 data：demand（详情主体，含 is_owner/taken/taken_by_me/can_take/status/distance_km）、scene、role（is_owner→user，否则 partner）、isOwner、recommendPartners、locDisplay（「📍{地址} · 距您 X km」或「📍 定位不可用」）、loading/loadError/loadErrMsg
- 接口：demand-publish: detail（可带 viewer_lat/viewer_lng）、detail_light（发布者 15s 轮询）、cancel；接单经 utils/take-order.js takeOrder
- 异常分支：无 id→loadError；云端/网络失败→empty-state「网络异常」desc={r.msg||r.code||'详情加载失败'} 或「详情加载失败」，btnText 重试；夜间红线→toast「夜间{CLOSE}-{OPEN}暂停接单」；已被接→toast「该需求已被接单」；本人已接→「已接单，请到消息中心」；非 matching 编辑→modal「当前状态不可编辑」；取消确认 modal「取消需求」→成功「需求已取消」失败 r.msg/「取消失败」reject→「网络异常」；聊天页失败→「聊天页打开失败,请从「消息」进入」；已有人接单→modal「👥 已有人接单」（仅 order_status=S2，Storage 幂等键 once:owner_prompt:{id}）
- 埋点：无埋点

### 8. pages-v2/nearby-list/nearby-list —— 附近耍伴/可接需求列表（分页+下拉刷新+触底）
- 分包：主包
- 生命周期：onLoad（loadMore 首屏）/ onShow（非首次 resetLoadMore 重置重拉）/ onReachBottom（loadMore）/ onPullDownRefresh（resetLoadMore 后 stopPullDownRefresh）
- 依赖组件：demand-card, ui-skeleton, ui-empty
- 关键 data：list（累加需求列表）、page（已加载页码）、pageSize=CONFIG.PAGING.nearbyLimit、hasMore、loading、loaded、empty
- 接口：home-action: nearby（page/page_size，created_at 降序）
- 异常分支：首屏未完成→ui-skeleton「type=card rows=3」；空列表→ui-empty「附近暂无可接需求」desc「下拉刷新，或稍后再来看看」；hasMore=false→底部「— 已全部加载完 —」；云端 ok=false→toast r.msg 或「加载失败」；reject→toast「网络异常,请重试」；卡片无 _id→toast「需求数据异常」；跳详情失败→toast「详情页打开失败」
- 埋点：无埋点

### 9. pages-v2/nearby-map/nearby-map —— 附近地图（双向实时位置共享+绿/蓝针）
- 分包：主包
- 生命周期：onLoad（init：peek_login 读 allow_map_share → getLocationSafe 取自身坐标 → 已开共享则 report_map_gps → loadNearby）
- 依赖组件：无（usingComponents 为空）
- 关键 data：my（lat/lng 地图中心）、markers（含 iconPath 绿针/蓝针、callout）、people（昵称/头像/is_partner/距离文案）、selected（点开的 TA 卡片）、shareOn（地图共享开关）、locDenied、loading
- 接口：user-login: peek_login / report_map_gps / nearby_map_list / set_map_share
- 异常分支：未开共享→提示「地图找TA 未开启」desc「请在「我的」开启地图共享后，TA 才能在地图看到你」；定位被拒/超时→「未获得定位授权」desc「授权定位后可看到附近 TA 的实时位置」+「去授权」，toast「定位授权失败」；开关云调失败→toast r.msg 或「操作失败」；加载中→「定位中…」；点 TA 跳转失败→「详情页暂不可用」/「发布页暂不可用」
- 埋点：无埋点

## 【待补】清单
1. message（pages-v2/message/message）：empty-state 仅由 app.json 全局 usingComponents 提供，页面 json 未声明；若关闭全局组件或按页面裁剪会渲染失败，需产品/技术确认这是有意为之。
2. demand-detail（pages-v2/demand-detail/demand-detail）：同上，empty-state 未在页面 json 声明；另外「推荐耍伴」区在 recommend_partners 为空时隐藏，后端是否已上线该字段源码无法判定。
3. square（pages-v2/square/square）：下拉刷新失败走 `.catch(() => {})` 空捕获且成功/失败均无任何 toast，用户无失败反馈，无法从源码判断是否有意省略。
4. index（pages-v2/index/index）：fetchNearby 为 async 但调用处（onLoad/onShow）未挂 catch，弱网 reject 时可能产生未处理的 Promise rejection；夜间红线 toast 文案取自 redline gate.msg，源码本页不可见，故未逐字抄录。
5. nearby-map（pages-v2/nearby-map/nearby-map）：onMapShareChange 只有 .then 无 .catch，网络 reject 时开关状态可能无提示；markers 的 id 由 openid 数字尾 8 位生成，冲突时的行为源码未处理。

### 10. pages-v2/partner-detail/partner-detail —— 耍伴公开详情页（资料/资质/评价/动态/路线），承接咨询定向发布与举报
- 分包：主包
- 生命周期：onLoad（fetchData(options)：并行 partner-action detail + blog-action author_home；partner.home_location 有坐标时再取浏览者定位算路线）；onShow（setData isRedline = redline.isInRedline()）—— 无 onHide / onUnload
- 依赖组件：nav-bar, tag-chip
- 关键 data：partner（资料主体）、sceneList（接单场景）、evaluations（评价列表）、showStats（完成单≥3 才显示统计）、route / routeLoading / locDenied（路线三态）、blogInfo / blogTimeText（动态汇总）、loadError
- 接口：partner-action: detail / route_plan；blog-action: author_home；safety-report: report_user
- 异常分支：缺 partnerOpenid → loadError 真（empty-state「网络异常」「请检查网络后重试」「重试」）；detail 返回 !ok → toast「加载失败」或 r.msg；catch → toast「网络异常」；定位失败 → locDenied 文案「开启定位授权后，可查看距你的距离与到达耗时」；route_plan 失败仅 console.warn 无提示；无评价 → 「暂无评价~」；无 partner → toast「耍伴信息加载中，请稍后」；跳发布失败 → 「跳转失败」；跳动态失败 → 「动态页暂不可用」；举报空原因 → 「请填写举报原因」，弹窗失败 → 「弹窗调用失败」
- 埋点：无埋点

### 11. pages-v2/chat/chat —— 订单内 IM 会话：四确认面板 + 模板消息/自由文本 + 变更协商 + 状态横幅
- 分包：主包
- 生命周期：onLoad（__refreshS2Text、取 statusBarHeight、fetchData：im-conv open → 并拉 order-action get_confirmation + im-conv messages）；onShow（__refreshS2Text、isRedline、startPolling 15s）；onHide（stopPolling）；onUnload（stopPolling + clearRateTimer）
- 依赖组件：nav-bar, confirm-progress, tm-template-card, bottom-sheet
- 关键 data：orderId / orderNo / sceneName、items / progress / confirmedCount、confirmList（四项常驻清单）、unlocked / freeChat / chatBlocked、orderStatus / startTime、pendingChange / pendingBanner、messages
- 接口：im-conv: open / messages；order-action: get_confirmation / confirm_item / confirm_all / change_apply / change_respond / s2_change_apply / s2_change_respond / chat_poll；im-send: send_template / send_text；admin-action: config_public；partner-action: sub_authorize
- 异常分支：订单 ID 非 32 位 → loadErrorMsg「缺少有效订单 ID,请从正确入口进入」（empty-state「无法打开会话」）；open 失败 → r.msg 或「会话打开失败」；catch → 「网络异常,请检查网络后重试」；未四确认发文本 → toast「四项确认完成前仅可发送模板消息」；频控 → 「请稍候 N 秒再发送」；发送失败 → r.msg 或「发送失败」；确认失败 modal「确认失败」；订单取消/关闭 → 「订单已取消/关闭,无法操作」
- 埋点：无埋点

### 12. pages-v2/pay/pay —— 收银台：展示费用明细与 AA 承诺书勾选，走 payment-mock 模拟支付（S0→S2）
- 分包：主包
- 生命周期：onLoad（fetchData：payment-mock cashier_info，内置 8s 超时兜底定时器）；onShow（isRedline）；onUnload（清 8s 定时器）—— 无 onHide
- 依赖组件：nav-bar, tag-chip, empty-state, night-mask
- 关键 data：order（摘要）、serviceFee / insuranceFee / aaFeeText、totalFee / totalFen、unitPriceYuan、needAaPromise / aaChecked、paying、loadErrorMsg
- 接口：payment-mock: cashier_info / mock_pay
- 页面文案（实测）与合规风险：
  - 顶部横幅「🔒 支付由平台担保, 订单未完成可全额退款」（`pay.wxml:6`，其上方注释自述「提审合规, 不出现"内测/模拟"字样」）；担保说明卡「担保交易 / 资金由微信支付担保托管，履约确认后T+{{arriveDays}}分账给耍伴」（`pay.wxml:54-55`）；底部「点击支付即同意《用户服务协议》《担保交易规则》」（`:70`）；按钮「微信支付 ¥{{totalFee}}」（`:76`）。
  - **实际能力**：本期无真实微信支付，`onPay` 走 `payment-mock: mock_pay`，订单与流水均 `is_mock=true`，**不产生真实扣款、无资金托管、无分账**（见 core 附录A 第 8 条、`API.md` §5）。
  - **风险定性**：上述三处不是「提示缺失」，而是**不实陈述**——平台未托管任何资金、微信支付未参与担保、不存在真实退款与 T+N 分账。后果：①违反附录A 第 8 条（收银台必须显著提示模拟支付）；②构成对用户的虚假承诺，争议时平台无对应履约能力；③提审存在被判「虚假宣传/诱导」的风险。**本轮只登记，未改代码**；修复须同时补「模拟支付，不产生真实扣款」提示并删除/改写担保与分账表述（待授权）。
- 异常分支：订单 ID 非 32 位 → loadErrorMsg「缺少有效订单 ID,请从正确入口进入」；8s 未落定 → 「支付页加载超时,请点击重试」；!ok → r.msg 或「加载失败」；catch → 「网络异常,请重试」（empty-state「加载失败」）；无 order → empty-state「订单不存在」「该订单可能已被删除」；非 S0 → toast「订单当前状态不可支付」；未勾承诺书 → 「请先勾选AA承诺书」；支付失败 modal「支付失败」；跳详情失败 → toast「支付成功」
- 埋点：utils/report → report('order_pay', { order_id, amount_fen })

### 13. pages-v2/order-detail/order-detail —— 订单全生命周期主控页（13 态、四确认结果、履约/加时/改期/退款/申诉/安全/时间线）
- 分包：主包
- 生命周期：onLoad（__refreshModifyText 重算改期规则文案 + fetchData）；onShow（再算文案、isRedline、已有订单则再次 fetchData 非静默刷新）；onHide（clearTimers）；onUnload（clearTimers）
- 依赖组件：nav-bar, order-progress, tag-chip, timeline-card, finance-card, dispute-card, evidence-card, no-show-card, safety-card
- 关键 data：order、statusInfo、countdownText、timeline（动态时间线）、safety（求助/报备/联系人）、noShowReports / canNoShowReport / noShowNotStarted、contactDisplay、cancelTiers / currentCancelIdx、modifyPanelVisible / extendPanelVisible
- 接口：order-action: detail / timeline / no_show_report_detail / no_show_report_withdraw / complaint_withdraw / nudge_partner / start_apply / start_confirm / start_reject / user_confirm_start / server_now / finish_apply / finish_confirm / finish_reject / resume_service / partial_confirm / ratio_confirm / extend / extend_confirm / extend_reject / modify / modify_confirm / modify_reject / complaint / cancel；safety-report: status / sos；payment-mock: mock_tip；admin-action: config_public；partner-action: sub_authorize
- 异常分支：订单 ID 非 32 位 → loadErrorMsg「缺少有效订单 ID」；!ok → r.msg 或「加载失败」；catch → 「网络异常,请重试」；empty-state「网络异常」「请检查网络后重试」「重试」/「数据不存在」「该记录可能已被删除」；状态冲突 → toast「订单状态已更新, 请刷新后重试」；撤回申诉/投诉失败 → r.msg 或「撤回失败，请重试」；跳转失败 → 「页面跳转失败」；订阅拒绝 → 「未获得微信订阅授权」
- 埋点：utils/report → report('order_finish', { order_id })

### 14. pages-v2/workbench/workbench —— 耍伴工作台：接单开关、今日排期、资金速览、待办确认、附近新单与一键报警
- 分包：主包
- 生命周期：onLoad（__skipNextShow=true 防双拉、fetchUser 判定耍伴身份、fetchData）；onShow（isRedline、耍伴端恢复附近轮询、首次跳过否则 fetchData）；onHide（stopNearbyPoll）；onUnload（stopNearbyPoll）
- 依赖组件：nav-bar, empty-state, night-mask
- 关键 data：acceptingOrders（接单开关）、todayOrders、weekDays / activeDayIndex、fundActive / fundAmountMap、pendingOrders（S1 待确认）、nearbyList、creditScore / creditLevel、todaySummary
- 接口：payment-mock: balance_info / income_list；partner-action: my_profile / set_switch；order-action: my_orders（role=partner, filter=doing、filter=confirm）；user-login: peek_login；home-action: nearby；safety-report: sos / free_sos_status / free_sos / free_sos_resolve
- 异常分支：整页 catch → loadError（empty-state「网络异常」「请检查网络后重试」「重试」）；接单开关失败 → r.msg 或「设置失败」、catch「网络异常」；无坐标 → 「该订单暂无地点坐标」；导航失败 → 「导航打开失败」；报警上报失败 → 「上报失败, 请直接拨打110」；拨号失败 → 「请手动拨打110」；该日无单 → 「该日暂无订单」
- 埋点：无埋点

### 15. pages-v2/orders/orders —— 我的订单列表（发单/接单双视角，tab 下推服务端过滤 + 分页加载）
- 分包：主包
- 生命周期：onLoad（解析 options.role=partner? 与 options.tab，按角色选 tabs）；onShow（loadOrders）；onPullDownRefresh（loadOrders 完成后 wx.stopPullDownRefresh）；onReachBottom（loadMore）—— 无 onHide / onUnload
- 依赖组件：nav-bar（empty-state 走 app.json 全局注册）
- 关键 data：tabs / activeTab、role、orders、hasMore、loading / loaded、loadingMore
- 接口：order-action: my_orders（role=user|partner，filter=all/pay/doing/eval/after/confirm/done/canceled，page、page_size=CONFIG.PAGING.orderPageSize）
- 异常分支：首屏/下拉 catch → toast「加载失败,下拉重试」；加载更多 catch → 「加载失败,请重试」；空列表 → empty-state「暂无相关订单」＋「接单后订单会显示在这里」/「发布需求后，接单进度会显示在这里」；初始失败 → empty-state「网络异常」；跳详情失败 → 「详情页暂不可用」；无 start_time → 时间显示「时间待定」
- 埋点：无埋点

### 16. pages-v2/my-demands/my-demands —— 我的发布需求列表（含懒过期，最多 50 条）
- 分包：主包
- 生命周期：onShow（loadList）；onPullDownRefresh（loadList 后 stopPullDownRefresh）—— 无 onLoad / onHide / onUnload
- 依赖组件：nav-bar（empty-state 走 app.json 全局注册）
- 关键 data：list、loading、loaded
- 接口：demand-publish: my_demands
- 异常分支：catch → toast「加载失败,下拉重试」；空列表 → empty-state「还没有发布需求」「发布需求后，可在这里跟踪接单进展」「去发布」；初始失败 → empty-state「网络异常」「请检查网络后重试」「重试」；跳详情失败 → 「详情页暂不可用」；跳发布失败 → 「发布页打开失败」；无 start_time → 「时间待定」
- 埋点：无埋点

### 17. pages-v2/blog/blog —— 服务动态信息流（推荐广场 / 我的动态 / TA 的动态，场景＋话题筛选）
- 分包：主包
- 生命周期：onLoad（解析 scope=feed|my|author、authorOpenid、tag 话题并设 navTitle）；onShow（loadList(true) 从发布页返回刷新）；onPullDownRefresh（loadList(true) 后 stopPullDownRefresh）；onReachBottom（hasMore 时 loadList(false)）
- 依赖组件：nav-bar（empty-state 走 app.json 全局注册）
- 关键 data：scope / authorOpenid / navTitle、activeScene / activeTopic、list、page / hasMore、loading / loadingMore、showEmpty
- 接口：blog-action: feed_list（广场与 TA 的动态，author 模式带 author_openid）/ my_list（我的动态）
- 异常分支：!ok → toast r.msg 或「加载失败」；空态 → empty-state「还没有动态」/「你还没有发布动态」/「TA 还没有发布动态」＋「来发布第一条吧」/「点右下角写一条吧」/「TA 的动态会在这里展示」；未登录点发布 → modal「需要先登录」「发布动态前请先授权登录」「去登录」；跳详情失败 → 「帖子打开失败」；跳主页失败 → 「主页暂不可用」；话题页失败 → 「话题页打开失败」
- 埋点：无埋点

### 18. pages-v2/blog-publish/blog-publish —— 发布服务动态（文字 + ≤9 图 + 服务场景 + ≤3 话题）
- 分包：主包
- 生命周期：onLoad（未登录二次兜底：wx.getStorageSync('v2_login_ok') 为空则 modal 后 redirectTo 登录页）—— 仅 onLoad，无 onShow / onHide / onUnload
- 依赖组件：nav-bar
- 关键 data：content / contentLen、images（[{fid,path,uploading}]）、uploadingCount / canAddMore、sceneCode、topicChks / tagCount、submitting
- 接口：blog-action: publish；另用 wx.cloud.uploadFile 直传云存储（云路径 blog/<ts>_<rand>.jpg）
- 异常分支：未登录 → modal「需要先登录」「发布动态前请先授权登录」，确认后跳登录失败 → 「登录页打开失败」；正文 <2 字 → 「说点什么再发布吧」；>1000 字 → 「正文不能超过 1000 字」；仍在传图 → 「图片还在上传中」；选图失败 → 「图片选择失败，请检查权限」；单图上传失败 → 「部分图片上传失败」；选图超 9 张 → 「最多 9 张」；话题超 3 个 → 「最多选 3 个话题」；发布失败 → r.msg 或「发布失败」
- 埋点：无埋点

### 19. pages-v2/blog-detail/blog-detail —— 动态详情（大图预览、点赞、评论、删除动态/评论、分享）
- 分包：主包
- 生命周期：onLoad（setData postId、loadDetail、loadComments(true)）；onReachBottom（hasMore 时 loadComments(false)）—— 无 onShow / onHide / onUnload
- 依赖组件：nav-bar（empty-state 走 app.json 全局注册）
- 关键 data：postId、post、comments、page / hasMore、commentText、sending、showCommentEmpty
- 接口：blog-action: detail / comment_list / like / unlike / comment_add / delete_my / comment_delete
- 异常分支：无 post_id → 仅置 loading=false（无提示）；detail 失败 → toast r.msg 或「动态不存在」；无评论 → 「还没有评论，快来抢沙发～」；空评论提交 → 「说点什么吧」；未登录评论 → modal「需要先登录」「评论前请先授权登录」；点赞失败 → r.msg 或「操作失败」并双回滚；评论失败 → r.msg 或「评论失败」；删除失败 → r.msg 或「删除失败」；跳主页失败 → 「主页暂不可用」
- 埋点：无埋点

【待补】清单
1. order-detail 的 data 中 orderSummary / tipList / insuranceWan / afterSaleDays 等字段的最终展示文案未逐条核对 WXML，仅按 data 声明记录。
2. pay 页「模拟支付」提示缺失：WXML 仅写「🔒 支付由平台担保, 订单未完成可全额退款」，与附录A 第 8 条要求的显著模拟支付提示不一致（实测未见该文案）。
3. orders.json 未注册 empty-state（依赖 app.json 全局注册），空态渲染依赖全局配置，未在真机验证。
4. chat 页 chat_poll 返回 notices 的完整 type 枚举仅覆盖代码中 TITLE_OF / RESPOND_ALERT 映射表，未覆盖服务端全量。
5. workbench 页 todaySummary.upcoming、fundTabs 文案为硬编码，未核对多语言/后台覆盖配置。


---

## 3. 分包：管理端 / 协议 / 隐私（10 页）


### 3.1 pkgAdmin（8 页）

### pkgAdmin.pages-v2/admin/admin —— 管理端首页：数据看板 + 五大模块入口导航（无写操作）
- 生命周期：onLoad 调 checkAdmin()（内部先 admin_list 鉴权，通过后 loadDashboard）；onShow 仅在 data.isAdmin 为 true 时再调 loadDashboard（首次进入 onLoad 通过后 onShow 会二次拉取，无去重）
- 依赖组件：ui-skeleton（/components/ui-skeleton/ui-skeleton，loading && isAdmin 时渲染 type="list" rows="4"）
- 关键 data：isAdmin（鉴权通过标志，整页 wx:if 门槛）、loading（骨架屏开关）、stats（user_count/partner_count/today_demand_count/active_order_count/pending_review_count/dispute_count）、trend（days/users/demands/orders/gmv_fen 五日趋势）、todo（云端待办对象，页面未逐字段消费）、finance + gmvYuan（gmv_fen÷100 保留两位）
- 接口：`admin-action: admin_list`（鉴权探测）、`admin-action: dashboard`（看板数据）；导航本身不走接口
- 异常分支：鉴权失败 → toast「无管理员权限」，800ms 后 wx.reLaunch 首页（fail 再 toast「返回首页失败」）；dashboard 返回 !ok → 只置 loading=false，不提示，六项数字回落 WXML 的 `|| 0`；六个 goXxx 导航 fail → toast「页面打开失败」；网络失败由 app.cloudCall 统一 resolve（msg「网络异常,请检查网络」或「网络慢,请稍后再试」），本页不显示该 msg
- 写操作：无（纯看板 + 跳转）
- 埋点：无埋点（全页无 wx.reportAnalytics / 自定义上报）

### pkgAdmin.pages-v2/admin/users —— 用户管理：关键字搜索 + 上拉分页列表，点击进用户详情
- 生命周期：onLoad 先 admin_list 鉴权，通过后 loadList()；onReachBottom 在 hasMore 为真时 page+1 再 loadList（loadList 入口用 this.data.loading 做并发护栏）
- 依赖组件：无（.json usingComponents 为空对象）
- 关键 data：isAdmin（鉴权标志）、list（用户数组：openid/nickname/phone/user_credit_score/status）、page、hasMore、loading（兼作翻页互斥锁）、keyword（搜索词）
- 接口：`admin-action: admin_list`、`admin-action: user_list`（入参 page、keyword）
- 异常分支：非管理员 → toast「无权限」+800ms reLaunch 首页（fail toast「返回首页失败」）；user_list 返回 !ok → 仅 loading=false，无任何文案；空列表显示「暂无用户」；翻到底显示「没有更多了」；搜索框 bindinput 即触发重查（非 confirm 后才搜），每次清空 list 并把 page 重置为 1
- 写操作：无（点击行 goDetail → /pages-v2/admin/user-detail?target_openid=xxx，fail toast「打开用户详情失败」）
- 埋点：无埋点

### pkgAdmin.pages-v2/admin/partners —— 耍伴管理：状态筛选列表 + 待审核项通过/驳回
- 生命周期：onLoad 鉴权通过后 loadList()；onReachBottom 翻页（hasMore 判定，loading 互斥）
- 依赖组件：无
- 关键 data：isAdmin、list（昵称/accept_scenes/accept_switch/status）、page、hasMore、loading、statusFilter（''全部 / pending_review / approved / rejected）
- 接口：`admin-action: admin_list`、`admin-action: partner_list`（入参 page、status）、`admin-action: review`（入参 target_openid、decision=approve|reject）
- 异常分支：非管理员 → toast「无权限」+reLaunch 首页；partner_list !ok 仅 loading=false 无提示；空列表「暂无耍伴」；写失败 toast 取 `r.msg || '失败'`，成功后整列表重置回第 1 页
- 写操作范式：二次确认 = wx.showModal（标题「通过审核」/「驳回申请」，正文「确认通过该耍伴申请?」/「确认驳回该耍伴申请?」）；不填原因；无按钮级 loading/防双击（仅 status==='pending_review' 时才渲染按钮）
- 埋点：无埋点

### pkgAdmin.pages-v2/admin/demands —— 需求管理：列表 + matching 状态需求下架（必填原因）
- 生命周期：onLoad 鉴权通过后 loadList()；onReachBottom 翻页
- 依赖组件：无
- 关键 data：isAdmin、list（demand_no/status/remark/content_options/creator_name/scene/total_fen/demand_id）、page、hasMore、loading、sceneFilter（data 里存在，但 WXML 无筛选 UI，恒为空串）
- 接口：`admin-action: admin_list`、`admin-action: demand_list`（入参 page、scene）、`admin-action: demand_offline`（入参 demand_id、note）
- 异常分支：非管理员 → toast「无权限」+reLaunch 首页；demand_list !ok 仅 loading=false；空列表「暂无需求」；下架失败 toast `r.msg || '失败'`；成功 toast「已下架」并重置分页
- 写操作范式：二次确认 + 原因 = wx.showModal({ editable: true, placeholderText: '请填写下架原因' })；用户确认但内容为空则直接 return（静默不发请求、无提示）；仅当 item.status === 'matching' 渲染「下架」按钮；无防双击
- 埋点：无埋点
- 备注：WXML 直接显示 item.status 英文原值，未做中文映射（与 orders/finance 页不一致）

### pkgAdmin.pages-v2/admin/orders —— 订单管理：全量订单分页列表 + S0/S1 强制取消（必填原因）
- 生命周期：onLoad 鉴权通过后 loadList()；onReachBottom 翻页
- 依赖组件：无
- 关键 data：isAdmin、list（order_no/status/statusText/scene_full/total_fen/user_openid/partner_openid/order_id）、page、hasMore、loading；模块级 STATUS_MAP 把状态译中文（S0待支付/S1待确认/S2履约中/S3待确认完成/S3.5平台介入/S5已完成/S6已取消/S7已退款/S8已评价/S9已结束/S10已关闭/S10.5争议处理中）
- 接口：`admin-action: admin_list`、`admin-action: order_list`（入参仅 page，无状态/关键字筛选）、`admin-action: order_force_cancel`（入参 order_id、note）
- 异常分支：非管理员 → toast「无权限」+reLaunch 首页；order_list !ok 仅 loading=false；空列表「暂无订单」；状态不符 → 前置拦截 toast「仅待支付/待确认可取消」；写失败 toast `r.msg || '失败'`，成功「已取消」并重置分页
- 写操作范式：二次确认 + 原因 = wx.showModal({ title:'强制取消订单', editable:true, placeholderText:'请填写取消原因' })；原因空则静默 return；仅状态 S0/S1 渲染按钮；无防双击
- 埋点：无埋点
- 备注：STATUS_MAP 中文名与 PRD 13 态口径有偏差（S2 显示「履约中」、S3 显示「待确认完成」、缺 S4 部分完成），非本页职责但需登记

### pkgAdmin.pages-v2/admin/finance —— 财务流水：全量流水只读分页列表
- 生命周期：onLoad 鉴权通过后 loadList()；onReachBottom 翻页
- 依赖组件：无
- 关键 data：isAdmin、list（type/typeText/pay_no/order_no/amount_fen/amountYuan/is_mock/status/tx_id）、page、hasMore、loading；模块级 TYPE_MAP：pay支付/refund退款/tip打赏/withdraw提现，amountYuan = amount_fen/100 保留两位
- 接口：`admin-action: admin_list`、`admin-action: finance_list`（入参仅 page）
- 异常分支：非管理员 → toast「无权限」+reLaunch 首页；finance_list !ok 仅 loading=false；空列表「暂无流水」；无时间范围/类型/金额筛选，也无「合计/汇总」区块
- 写操作：无（纯只读页）
- 埋点：无埋点

### pkgAdmin.pages-v2/admin/config —— 运营配置：抽成/开关/屏蔽词/场景/超时参数（无确认无原因）
- 生命周期：仅 onLoad（admin_list 鉴权通过后 loadConfig）；无 onShow 刷新，保存成功后由各写方法自行 loadConfig 回读
- 依赖组件：ui-skeleton（loading 时 type="list" rows="6"）
- 关键 data：isAdmin、loading、config（platform_fee_rate_fen、auto_approve_partner、payment_visible、block_words、scene_list[code/name/default_rate_fen]、timeouts[s0/s1/interrupt/eval]）、feeInput（抽成输入）、blockWordInput（屏蔽词输入）
- 接口：`admin-action: admin_list`、`admin-action: config_get`、`admin-action: config_set`（按字段分五种入参：platform_fee_rate_fen / block_words_add[] / block_words_remove[] / auto_approve_partner / payment_visible）
- 异常分支：非管理员 → toast「无权限」+reLaunch 首页；config_get 失败只 loading=false，整页 wx:if isAdmin && config 不渲染（无错误文案）；saveFee 校验失败 toast「0-10000整数」；addBlockWord 空词静默 return；写失败仅 saveFee/addBlockWord 有 toast（`r.msg || '失败'`），removeBlockWord/toggleAutoApprove/togglePaymentVisible 失败完全静默
- 写操作范式：无二次确认、不填原因、无防双击（开关点一下立刻发 config_set）；成功 toast「已保存」/「已添加」；场景列表与超时参数只读展示不可编辑
- 埋点：无埋点

### pkgAdmin.pages-v2/admin/user-detail —— 用户详情（只读）：身份/信用/紧急联系人/信用流水
- 生命周期：仅 onLoad(options)。先取 options.target_openid，缺失则直接 errMsg='缺少用户标识' 不发请求；再 admin_list 鉴权，通过后 loadDetail()（user_detail 入参 target_openid）。无 onShow 刷新、无 onReachBottom
- 依赖组件：无
- 关键 data：isAdmin、loading、errMsg（三态文案：加载中…/错误文案/正常）、d（nickname/avatar/roles/statusTx/age/realnameTx/userScore/partnerScore/phone/created/bannedReason/ec 紧急联系人/demandCount/orderAsUser/orderAsPartner/partner/logs 信用流水）
- 接口：`admin-action: admin_list`、`admin-action: user_detail`（入参 target_openid）
- 异常分支：非管理员 → toast「无权限」+800ms reLaunch 首页（fail toast「返回首页失败」）；缺参 → 页内显示「缺少用户标识」；user_detail 返回 !ok 或缺 data.user → errMsg = `r.msg || '加载失败'`；Promise catch → errMsg「网络异常」；空态「未填写紧急联系人」「暂无信用变动记录」；无昵称显示「未设置昵称」，无手机号/时间显示「—」
- 写操作：无——文件头注释明确「处置类写操作（封禁/信用调整/紧急联系人改写）不在本页，后置 A2」
- 埋点：无埋点
- 鉴权备注：本页鉴权在缺参分支之后才执行，即无参访问不会触发鉴权；有参时才走 admin_list 一票否决

### 3.2 pkgAgreement（1 页）

### pkgAgreement.pages-v2/agreement/agreement —— 用户服务协议静态正文页（登录/支付链路的条款入口）
- 生命周期：无 onLoad / onShow / onHide / onUnload（Page 对象只有 data 与 onShareAppMessage）
- 依赖组件：无（.json 仅配置 navigationBarTitleText「用户协议」）
- 关键 data：title:'用户协议'（WXML 未引用，纯占位）
- 接口：无（不发任何云调用；不读后端 legal_doc_*）
- 内容来源（核实结论）：**硬编码文案**，全部正文写在 agreement.wxml 内，共 6 章（总则/服务内容/用户行为规范/交易规则/免责与承诺/联系方式），页头版本号「V1.0 更新日期：2026-10-01」；无云端 action、无版本拉取、无回退逻辑
- 云端能力对照：admin-action 已有 `legal_doc_list / legal_doc_get / legal_doc_publish / legal_doc_rollback / legal_doc_retire / legal_doc_seed`（cloudfunctions/admin-action/action_legal_doc.js），但仅 admin-web-frontend/src/views/Legal.vue 使用，小程序端这两个页面均未接入
- 异常分支：无（纯静态页，无请求、无 toast、无空态）
- 埋点：无埋点
- 入口与分享：login.js（L66）、pay.js（L172）navigateTo 进入（fail toast「页面加载失败」）；onShareAppMessage 返回 title「找个人帮忙」、path 首页

### 3.3 pkgPrivacy（1 页）

### pkgPrivacy.pages-v2/privacy/privacy —— 隐私政策静态正文页（应付微信隐私合规审核）
- 生命周期：无 onLoad / onShow / onHide / onUnload（Page 对象只有 data 与 onShareAppMessage）
- 依赖组件：无（.json 仅配置 navigationBarTitleText「隐私政策」）
- 关键 data：title:'隐私政策'（WXML 未引用，纯占位）
- 接口：无（不发任何云调用；不读后端 legal_doc_*）
- 内容来源（核实结论）：**硬编码文案**，全部正文写在 privacy.wxml 内，共 7 章（总则/信息收集/信息使用/信息存储与保护/您的权利/免责与限制/联系方式），页头「版本号：V1.1 更新日期：2026-11-07」；含 2026-11-07 三处合规补正内联注释（相册 chooseMedia 补充 2.9、删除不实的「账号密码 SHA256+salt」表述、MVP 模拟支付表述修正）；无云端 action、无回退逻辑
- 云端能力对照：同上 legal_doc（doc_type 白名单含 privacy_policy，双写 admin_config.legal_privacy_policy），但本页未消费，改文案需改 wxml 并发版
- 异常分支：无（纯静态页，无请求、无 toast、无空态）
- 埋点：无埋点
- 其他实证：文件首行标注 `// @VERIFIED 2026-10-13 已真机验证：隐私协议页 __usePrivacyCheck__ 配置`；app.json 的 preloadRule 在 login 页预载 pkgAgreement + pkgPrivacy；login.js（L68）navigateTo 进入（fail toast「页面加载失败」）

### 3.4 交叉核实结论（管理端鉴权 / 写操作范式）

#### 鉴权方式（8 页统一，无例外）
- 客户端：每页 onLoad/onShow 首调 `admin-action: admin_list`，`!r.ok` 即视作非管理员 → toast + 800ms 后 wx.reLaunch('/pages-v2/index/index')。toast 文案不统一：admin 页为「无管理员权限」，其余 7 页为「无权限」；reLaunch 失败统一「返回首页失败」。
- 服务端：admin_list 属鉴权后 HANDLERS（index.js L296），先过统一鉴权门——openid 不在 admin_config.admin_openids 白名单 → `{ok:false, code:'admin_forbidden', msg:'无权限,该操作已被记录'}`（白名单为空时 `admin_empty` /「后台尚未初始化管理员」），并写 P1 级 platform_event admin_probe 留痕；通过后再过 authz.js 的 ROLE_GRANTS 角色门（admin_list 未声明 → 仅 R1）。
- 关键点：页面自身**不解析**云端返回的 msg，一律用本地硬编码文案；真实原因只体现在云端返回码与 platform_event。
- 副作用：admin_list 未列入 ROLE_GRANTS，R2/R3 账号（admin-web token 登录）调用会被 role_forbidden 拒；小程序端走白名单 openid（默认 R1）不受影响。

#### 写操作范式（不统一）
- 有二次确认：partners.review（showModal 纯确认，无原因）、demands.offline（editable 填原因，空原因静默 return）、orders.forceCancel（editable 填原因 + 前置状态校验 toast「仅待支付/待确认可取消」，空原因静默 return）。
- 无二次确认：config 页全部 5 类写操作（saveFee / addBlockWord / removeBlockWord / toggleAutoApprove / togglePaymentVisible）点即提交；其中 3 个失败静默无 toast。
- 防双击：**8 页全无**。列表页仅靠 `loading` 互斥防止翻页重复请求，写按钮无 pending 态/禁用态，重复点击会重复下发写请求（云端是否幂等未在本轮核实）。
- 统一的部分：写后处理一致——成功即重置分页（page=1、list=[]、hasMore=true）并重拉列表（config 页为重拉 config_get）；fetch 层统一走 utils/cloud.js → app.cloudCall，写 action 按动词表自动 0 重试、读 action 重试 2 次、单次超时 12s。

### 3.5 【待补】清单
1. `admin-action: dashboard` 的 todo / trend / finance 完整字段结构未逐项枚举（页面只消费 stats 六项与 finance.gmv_fen），需回读云函数实现确认。
2. 写操作云端幂等性未核实：partners.review / demand_offline / order_force_cancel / config_set 重复提交是否会产生重复留痕或重复状态推进，需 server 侧回读。
3. config 页 3 个静默失败写操作（removeBlockWord / toggleAutoApprove / togglePaymentVisible）是否属有意省略提示，需业务确认后补文案。
4. user-detail 的处置类写操作（封禁/信用调整/紧急联系人改写）标注「后置 A2」，当前代码不存在，提审前是否必须补齐待定。
5. finance 页无筛选/无汇总（finance_stats、withdraw_list、settlement_list 均未接入小程序端），财务对账能力边界待确认。


---

## 4. 分包 pkg-low（16 页）


### pkgLow.1. wallet 钱包 —— 耍伴收益账户：可提现余额、四态分账、接单收入/打赏明细与提现申请
- 分包：pkgLow
- 生命周期：onLoad（置 `__skipNextShow=true` 防首屏双拉，立即 fetchData）；onShow（刷新夜禁态 isRedline，非首次进入才 fetchData 重拉）；未定义 onHide/onUnload
- 依赖组件：nav-bar、bottom-sheet（提现弹层）、empty-state、night-mask（均页面 json 声明）
- 关键 data：balanceYuan（可提现余额·元）、fundActive（可提现/分账中/处理中 tab，值 withdrawable/splitting/processing）、fundAmountMap（三态金额映射）、walletTab（income=接单收入 / tip=打赏）、rangeKey（all/month/d30/d90）、incomeSummary/tipSummary（笔数与合计）、withdrawList（提现记录）
- 接口：payment-mock: balance_info、income_list（status_in=S8,S9,S10，limit=50）、tip_income_list（limit=50）、withdraw_list（limit=CONFIG.PAGING.walletWithdraw）、withdraw（普通 T+N）、fast_withdraw（极速 T+0）；金额一律 amount_fen 分
- 异常分支：空数据→empty-state「暂无接单收入 / 切换时间段或完成更多订单后查看」「暂无打赏 / 完成服务后发单人可打赏你」；整页失败→loadError 时 empty-state「网络异常 / 请检查网络后重试」+重试按钮；提现校验 toast「请输入金额」「单次最低N元」「极速提现单笔上限N元」；提现失败 toast `r.msg || '提现失败'`；请求异常 toast「网络异常，请稍后重试」；提交锁 `_withdrawing` 防双击
- 页面出口：无页面跳转（仅 bottom-sheet 弹层）；命中夜禁区时 night-mask 覆盖并走 redline.reserveNotice
- 埋点：report('withdraw', { type: 'fast'|'normal', amount_yuan })

### pkgLow.2. credit 信用分 —— 双身份信用分（用户/耍伴）与最近 20 条信用流水
- 分包：pkgLow
- 生命周期：onShow（每次进入调 loadCredit 重拉）；另定义 onPullDownRefresh（同接口 + wx.stopPullDownRefresh）；未定义 onLoad/onHide/onUnload
- 依赖组件：nav-bar（页面 json）；empty-state 未在页面 json 声明，取自 app.json 全局注册
- 关键 data：userScore（用户信用分）、partnerScore（耍伴信用分）、userLevel/partnerLevel（由 CREDIT_LEVEL 区间换算）、logs（流水，含 type_name/delta_text/is_up/time_str）、loading、loaded
- 接口：user-login: get_my_credit（返回 user_credit_score、partner_credit_score、logs）
- 异常分支：接口 ok=false → toast `r.msg || '查询失败'` 并置 loaded=true（页面落到「暂无信用流水」空态）；空流水→empty-state「暂无信用流水 / 完成订单并获得评价后，信用变动会显示在这里」；请求异常→toast「网络异常,下拉重试」；未加载完→empty-state「网络异常 / 请检查网络后重试」+重试；credits 为 0 时等级显示「未开通」
- 页面出口：无
- 埋点：无埋点

### pkgLow.3. contacts 联系人 —— 紧急联系人（1~2 名）录入与保存，供发布需求前置校验与安全求助
- 分包：pkgLow
- 生命周期：onLoad（调 get_emergency_contact 回显 contacts[0]/[1]，有第二名则 hasSecond=true）；未定义 onShow/onHide/onUnload
- 依赖组件：nav-bar（页面 json）
- 关键 data：c1/c2（{name, phone, relation}）、hasSecond（第二联系人开关）、saving（提交锁）、loading（首屏占位）
- 接口：user-login: get_emergency_contact（读）、user-login: set_emergency_contact（写，入参 contacts 数组）
- 异常分支：空数据→表单留空、无空态组件（loading 置 false）；加载失败 toast「加载失败」；校验 toast 原文「请完整填写第一联系人」「第一联系人手机号有误」「请完整填写第二联系人」「第二联系人手机号有误」（正则 `^1\d{10}$`）；保存失败 toast `r.msg || '保存失败'`；请求异常 toast「网络异常」；保存成功 toast「已保存」后 700ms navigateBack（fail 静默）
- 页面出口：保存成功 → wx.navigateBack（失败静默兜底）
- 埋点：无埋点

### pkgLow.4. notices 通知中心 —— 站内通知分页列表、全部/单条已读，按 action_key 分发跳转
- 分包：pkgLow
- 生命周期：onShow（loadList(true) 首屏重拉 + startNoticePoll 启动 15s 轮询）；onHide（stopNoticePoll）；onUnload（stopNoticePoll）；另定义 onPullDownRefresh、onReachBottom；未定义 onLoad
- 依赖组件：ui-skeleton（页面 json）；empty-state 取自 app.json 全局注册
- 关键 data：list（通知数组，含 demand_title/order_summary/read/time_ago）、unread（未读角标）、empty、pageSize=5（产品定版一次 5 条）、hasMore（limit+1 法判定）、loadingMore、loading
- 接口：order-action: notice_list（limit=pageSize+1、skip，单独 timeout=12000）、order-action: notice_read（单条传 notice_id，全读不传）
- 异常分支：空数据→empty-state「暂无消息 / 订单状态变更会在这里通知你」；加载失败→toast `(r && r.msg) || '加载失败，请下拉重试'` 并 console.error('[notices] load fail', code, msg)；轮询失败静默不 toast；跳转 fail 文案分别为「详情页暂不可用」「订单页打开失败」「支付页打开失败」「个人中心打开失败」「需求页打开失败」「接单配置打开失败」，无订单号时 toast「该通知暂无关联订单」；已读后置 `notice_unread_dirty` 脏标记并 10s 内不回写未读
- 页面出口：jump_chat/jump_order/jump_accept_modify/jump_evaluate→order-detail；jump_pay→pay；jump_wallet→switchTab profile；jump_demand→demand-detail；jump_accept_config→pkg-low/accept-config
- 埋点：无埋点

### pkgLow.5. partner-apply 耍伴认证申请 —— 选可接场景+日常位置提交入驻申请，回显审核中/驳回/已入驻
- 分包：pkgLow
- 生命周期：onLoad(query)（按 from=chain 取入驻链步骤条、ensureDraft，读本地 user_info.roles 判 alreadyPartner，按 SCENES 构建场景勾选）；onShow（fetchTakeReadiness('', true) 拉服务端权威状态回显 applyStatus/rejectNote）
- 依赖组件：无（usingComponents 为空对象）
- 关键 data：chainBar（第 x/8 步，非链内为 null）、scenes（[{code,name,emoji,selected}]）、homeLocation（{name,address,latitude,longitude} gcj02）、submitting、applyStatus（''/pending_review/rejected/approved）、rejectNote
- 接口：partner-action: apply（accept_scenes + home_location）；user-login: peek_login（成功后刷新用户态）；审核态读取走 utils/take-order.fetchTakeReadiness（页面未直调云函数）
- 异常分支：未选场景 toast「请至少选择一个场景」；未选位置 toast「请选择日常位置」；选点失败 toast「选点失败,请检查定位权限」（errMsg 含 cancel 时静默）；服务端实名门禁 code 命中 showRealnameGuide(r.msg)，其余 toast `r.msg || '申请失败'`；异常 modal「申请失败」+errMsg 前 120 字；pending_review 时 modal「申请已提交 / 耍伴入驻需管理员审核,审核通过后将自动开通接单权限,请耐心等待。」；无空态组件
- 页面出口：申请成功或「我知道了」→ wx.switchTab /pages-v2/profile/profile（fail 分支仍 toast 成功）；onBack → navigateBack，失败兜底 switchTab profile
- 埋点：无埋点

### pkgLow.6. partner-profile-edit 耍伴资料编辑 —— 简介/技能/亮点/资质证书/荣誉分栏编辑、传图并提交逐栏审核
- 分包：pkgLow
- 生命周期：onLoad(query)（按 from=chain 取步骤条、ensureDraft；并行拉 admin-action config_public 覆盖字数/张数限制，失败走 LIMITS_FALLBACK；拉 partner-action my_profile 回显已审快照+待审内容+审核历史）；未定义 onShow/onHide/onUnload
- 依赖组件：无（usingComponents 为空对象）
- 关键 data：bio/currentBio/isBioEditing（生效简介只读与编辑态）、skills/highlights、qualTitles/qualPhotos、honTitles/honPhotos、auditStatus（''/pending/approved/rejected）、rejectReason、pendingBio/pendingSkills/qualPending/honPending、auditHistory（预格式化 timeStr）、limits（后台可配 9 项）、uploading/submitting
- 接口：admin-action: config_public（读 partner_profile 限制）、partner-action: my_profile（读）、partner-action: update_partner_profile（写 bio/skills/service_highlights/qual_titles/qual_photos/hon_titles/hon_photos）
- 上传目标：wx.chooseMedia（仅 image、compressed、album+camera）→ wx.cloud.uploadFile，云存储前缀 `partner-cert/`，文件名 `${Date.now()}-${随机6位}.${ext}`，存 fileID；张数上限 limits.media_photo_max（默认 6）、单张 limits.media_photo_size_mb（默认 3M）；失败原文「图片选择失败，请检查权限」「N 张图片超过 XM 已忽略」「图片上传失败」；另提供 previewImage 大图预览与逐张删除
- 异常分支：审核中提交/改简介 toast「资料正在审核中,请耐心等待」；空栏目 toast「该栏目暂无内容可提交」；重复标签 toast「标签已存在」；超限 toast「最多 N 个标签」「最多 N 条服务亮点」「最多 N 条」「最多 N 张图片」；提交失败 toast `res.msg || '提交失败'`；无空态组件（未提交即空表单）
- 页面出口：提交成功后若在入驻链内，600ms 后 onboard-chain.next('profile') 进入接单配置
- 埋点：无埋点

### pkgLow.7. accept-config 接单配置 —— 日常位置、场景与时薪、每周时段、价格区间、订阅提醒的一站式保存
- 分包：pkgLow
- 生命周期：onLoad(query)（按 from=chain 取步骤条、ensureDraft，随后 fetchData 并行拉 4 个接口）；onShow（仅刷新 isRedline）；未定义 onHide/onUnload
- 依赖组件：nav-bar、empty-state、night-mask（页面 json）
- 关键 data：certifiedScenes（含 selected/examNeeded/examPassed 场景卡）、baseExam/w1Exam（基础科目与陪诊科目分数、passLine、passed、locked）、form（scenes/weeklySlots/minPrice/maxPrice/totalMinPrice/totalMaxPrice/maxDistance/genderPref/dailyLimit/acceptWelfare/bufferMin）、sceneRates（场景时薪·分）与 sceneRateYuan（元展示值）、subAuthorized/urgeSubAuthorized（订阅授权态）、subMsgCfg/urgeSubMsgCfg、loading/loadError
- 接口：partner-action: my_profile（配置回显）、exam_subjects（科目配置）、update_config（保存）、sub_authorize（订阅授权，入参 tmpl/authorized/count）；home-action: scene_groups（动态场景 SSOT）；admin-action: config_public（订阅模板配置）；位置选择走 wx.chooseLocation
- 异常分支：主接口失败 toast `r.msg || '加载失败'` + loadError 空态「网络异常 / 请检查网络后重试」+重试；fetch 异常 toast「网络异常」；校验 toast 原文「请至少选择一个接单场景」「{场景}时薪须为不低于 1 元的整数(元/小时)」「单价区间需在X-Y元/小时之间」「最低单价不能高于最高单价」「最低客单价需为不小于 0 的整数(元)」「最低客单价不能高于最高客单价」「{周X}的起止时间不能相同」；选点失败 toast「选点失败,请检查定位权限」；保存失败 toast `r.msg || '保存失败'` 或「网络异常」；订阅未配置 toast「暂未开通微信抢单提醒/催办提醒」、拒权 toast「未获得微信订阅授权」；保存前 wx.showModal「确认保存配置?」（内容含场景数/单价/距离）；W1 锁定点击 toast「需先通过基础考试（满分），方可参加陪诊考试」
- 页面出口：goExam → pkg-low/exam?subject=base|W1（fail「考试页打开失败」）；保存成功非链内 800ms navigateBack，链内 next('config')→考试认证
- 埋点：无埋点

### pkgLow.8. activity-detail 活动详情 —— 运营活动落地页，展示 banner/时间地点/规则/说明并引导报名
- 分包：pkgLow
- 生命周期：onLoad(options)（校验 options.id，缺参直接置 fail 并 toast；有参则经 app.cloudCall 拉活动详情并 setNavigationBarTitle）；未定义 onShow/onHide/onUnload
- 依赖组件：ui-skeleton（页面 json）
- 关键 data：loading（骨架屏）、fail（失败/不存在态）、actId、act（活动主数据，含 title/subtitle/banner_image）、content（{time_text, location, rules[], body, cta_text}）
- 接口：home-action: activity_detail（入参 id，经 app.cloudCall 而非 utils/cloud）
- 异常分支：缺 id → toast「活动参数缺失」+ fail 页；接口 ok=false → toast `(r && r.msg) || '活动不存在或已结束'` + fail 页；请求异常 → toast「加载失败,请稍后重试」；fail 页固定文案「活动不存在或已结束」+「重新加载」（onRetry 复用 onLoad）；无 banner 时灰底占位；CTA 文案兜底「立即报名」
- 页面出口：CTA → wx.navigateTo('/pages-v2/publish/publish')，当前无 fail 兜底
- 埋点：无埋点

### pkgLow.9. realname 实名认证 —— 姓名/身份证+人脸核验+协议勾选+手写签名四步实名，签名图直传留证
- 分包：pkgLow
- 生命周期：onLoad（读 statusBarHeight，_loadLegal 拉协议与 face_mode）；onShow（刷新 isRedline、_refreshDoneState 按 globalData/storage userInfo 判定已实名，并 syncLoginUser 后重算，防陈旧缓存误显已实名）；未定义 onHide/onUnload
- 依赖组件：nav-bar、night-mask、signature-canvas（页面 json）
- 关键 data：form（{real_name, idcard}）、faceMode（mock/wx）、faceDone、legal（serviceAgreement/aaPromise 全文）、showAgreement/showPromise、agreed、done/doneInfo（methodText/signedAtText）、submitting、statusBarHeight
- 接口：admin-action: config_public（legal_public + realname.face_mode，失败回落 CONFIG.LEGAL_FALLBACK）；user-login: submit_realname（real_name/idcard/signature_file_id/docs_ack）
- 上传目标：signature-canvas.exportPNG() 临时图 → wx.cloud.uploadFile，云存储前缀 `sign_evidence/`，文件名 `realname_<时间戳>_<6位随机>.png`；服务端拒绝时 wx.cloud.deleteFile 清理孤儿文件；失败原文：上传/提交异常统一 toast「网络异常,请重试」，空签「请手写签名后再提交」，识别不通过 `chk.message || '签名识别未通过，请重写'`
- 隐私能力：身份证号（AES-256 加密落库，页面文案「身份证号经 AES-256 加密存储」）、人脸核验（mock 期弹窗「本次核验不采集人脸信息，仅用于完成认证流程。」；faceMode=wx 时弹「正式人脸核验通道即将开放，请稍后再试。」）、手写签名图留证
- 异常分支：校验失败 toast 取 errs[0]（「请输入真实姓名(2-20位中文或字母)」「请输入18位有效身份证号」「请先完成人脸核验」「请阅读并同意《服务协议》与《费用自理承诺书》」）；服务端拒绝 toast `r.msg || '认证失败,请重试'`（2500ms）；协议加载失败时正文兜底「协议文本加载失败，请检查网络后重试」/「文本加载失败，请检查网络后重试」；已实名态展示「✅ 已通过实名认证」
- 页面出口：成功后若有 onboard intent → resumeOnboardIntentAfterReset()，否则 1200ms navigateBack
- 埋点：report('realname_done', {})

### pkgLow.10. safety 安全中心/报备 —— 履约中实时定位共享、定时打卡与一键/静默求助
- 分包：pkgLow
- 生命周期：onLoad(options)（校验 orderId 为 32 位 hex，拉订单详情；仅 S3/S3_5/S4 允许报备，否则 redirectTo 订单详情）；onShow（刷新 isRedline，sosActive 或已启动时报备时恢复计时器与 GPS 跟踪）；onHide（clearTimers + stopLocationTracking）；onUnload（同上）
- 依赖组件：nav-bar（页面 json）；empty-state 取自 app.json 全局注册
- 关键 data：order（_id/order_no/status/scene_code/safety.last_checkin）、redirect、elapsedSec（已报备秒数）、locStatus（idle/locating/success/fail）、currentLat/currentLng/accuracy/accuracyText/address/locUpdateAt/mapMarkers、locDegraded、lastCheckin、nextCheckinSec、sosProgress/sosLongPressing/sosActive、silentCountdownSec/silentActive、checkinMin/oneKeyPressSec/sosCountdownSec/locationRefreshSec/hasMapKey
- 接口：order-action: detail（order_id）；safety-report: checkin（location 可空）、sos、silent_sos、cancel_silent_sos、resolve_sos（管理员）；逆地理 wx.request `https://apis.map.qq.com/ws/geocoder/v1/`（CONFIG.TENCENT_MAP_KEY，timeout 5000，无 key 直接展示坐标）
- 异常分支：orderId 非法或详情失败→loadError 空态「网络异常 / 请检查网络后重试」+重试；状态不允许→redirectTo 订单详情（fail toast「订单状态不允许安全报备」）+空态「状态不允许 / 仅履约中状态可进入安全报备，即将跳转」；无订单→空态「数据不存在 / 该记录可能已被删除」；定位连续失败 3 次→停止轮询 + toast「定位服务不可用,安全功能降级运行」；打卡失败 toast `r.msg || '打卡失败'`、「网络异常，打卡失败」，定位不可用时 modal「定位不可用 / 是否手动在地图上选择你当前的位置进行打卡?」（选点/跳过均继续打卡）；求助失败 toast `r.msg || '求助发送失败，请直接拨打110'`、「网络异常，请直接拨打110」；撤销失败 `r.msg || '撤销失败'`、「网络异常，撤销失败」；解除失败 `r.msg || '解除失败'`、「网络异常，请稍后重试」
- 隐私能力：wx.getLocation 高精度定位（经 utils/location.getLocationSafe 8s 收敛）、wx.chooseLocation 手动选点；maps 域名需后台配置
- 页面出口：状态不符时 wx.redirectTo `/pages-v2/order-detail/order-detail?orderId=`
- 埋点：无埋点

### pkgLow.11. evaluate 评价 —— 星级+标签+文字评价提交，48h 窗口倒计时与低分转客服
- 分包：pkgLow
- 生命周期：onLoad(options)（校验 32 位 orderId，拉订单详情并启动倒计时）；onShow（刷新 isRedline）；onHide（clearTimers）；onUnload（clearTimers）；未定义 onPullDownRefresh
- 依赖组件：nav-bar、tag-chip（页面 json 声明；wxml 实际用自绘 ev__tag，未使用该组件）
- 关键 data：order（_id/order_no/status/scene_code/start_time/duration_hours/amount_fen）、scene、stars、goodTags/midTags/badTags（[{name,selected}]）、selectedTags、content/contentCount、countdownSec/countdownText（CONFIG.ORDER.evalWindowH*3600 起算）、loadError/loadErrorMsg、evalTextMax、evalRewardYuan、submitting
- 接口：order-action: detail（order_id）；evaluation-submit: submit（order_id/star/tags/content）
- 异常分支：orderId 非法→loadErrorMsg「缺少有效订单 ID」，页面走 empty-state「网络异常 / 请检查网络后重试」+重试；详情失败→loadErrorMsg `r.msg || '加载失败'`；异常→「网络异常,请重试」；未选星 toast「请选择星级」；评价失败 modal「评价失败」+`r.msg || '请稍后重试'`；提交异常 toast「网络异常,请重试」；跳客服失败 toast「客服打开失败」；无订单时 empty-state「数据不存在 / 该记录可能已被删除」；低分（≤2 星）展示「对本次服务不满意？联系客服复核」，不阻断提交
- 页面出口：成功 wx.redirectTo order-detail（fail 时 navigateBack）；onContactKefu → pkg-low/kefu
- 埋点：report('eval_submit', { star })

### pkgLow.12. exam 认证考试 —— 按 subject 拉题、本地作答、云端判分并展示通过/重考
- 分包：pkgLow
- 生命周期：onLoad(opt)（读 options.subject，缺省 base，随即 fetchQuestions）；未定义 onShow/onHide/onUnload
- 依赖组件：nav-bar（页面 json）；nav-bar 传 show-back=false（无返回箭头）
- 关键 data：subject、title、passLine、bankVer（题库版本，提交回传防错位）、questions（[{question,options,type,sel}]）、answers（单选 -1 / 多选数组）、prereq（{code,msg} 前置未通过）、done/result（{score,passed,pass_line}）、loading/loadError、submitting
- 接口：partner-action: get_exam_questions（subject）、partner-action: submit_exam（subject/bank_ver/answers）
- 异常分支：拉题失败→自绘「题目加载失败」+重试，toast `r.msg || '题目加载失败'`；code 为 pa_exam_prereq_not_passed / pa_exam_base_not_passed→「暂不能参加{title}」+`prereq.msg`+「去考前置科目」；未答完 toast「请完成第 N 题」；题库变更 pa_exam_bank_changed→toast `r.msg || '题库已更新'`，1.2s 后自动重拉；提交遇前置未过→toast `r.msg || '需先通过前置考试'`；其他失败 toast `r.msg || '提交失败'`；通过后「🎉 考试通过」+分数，未通过「😥 未通过」+「得分 X 分，需达到 Y 分；可重新作答」
- 页面出口：通过「完成」或「返回」→ navigateBack（fail 兜底去 accept-config）；「去考前置科目」→ exam?subject=
- 埋点：无埋点

### pkgLow.13. exam-status 考试状态 —— 各科目通过/未通过/待解锁总览，含入驻链进度
- 分包：pkgLow
- 生命周期：onLoad(query)（按 from=chain 取步骤条与 ensureDraft，随后 fetchStatus）；onShow（loading 结束后重拉，保证考完返回即刷新）；另定义 onPullDownRefresh
- 依赖组件：nav-bar（页面 json）
- 关键 data：subjects（[{key,title,desc,passLine,score,hasScore,passed,locked,statusText,btnText}]）、passedCount（顶部进度概览）、noProfile（非耍伴引导）、loadError、loading、chainBar
- 接口：partner-action: my_profile（读 exam_scores）、partner-action: exam_subjects（科目配置，失败用 base/W1 内置兜底）
- 异常分支：code=pa_no_profile→自绘空态「考试认证面向认证耍伴开放 / 完成耍伴认证后即可参加接单考试，通过基础考试方可接单」+「去认证耍伴」；其他失败→「加载失败，请稍后重试」+重试；锁定科目点击 toast「需先通过「{前置科目名}」，方可参加{科目名}」；状态文案 待解锁/已通过/未通过/未参加；链内且全科通过→600ms 后自动 next('exam') 进下一步（仅一次）
- 页面出口：onGoExam → pkg-low/exam?subject=（fail「考试页打开失败」）；onGoApply → pkg-low/partner-apply（fail「申请页打开失败」）
- 埋点：无埋点

### pkgLow.14. study 学习内容 —— 耍伴学习中心：科目→章节→正文三级按需加载，极简 markdown 渲染
- 分包：pkgLow
- 生命周期：onLoad（仅缓存原始科目顺序 `_baseSubjects`，**零云调用**；科目为静态清单 base/W1/OUTDOOR/PEIZHEN/ONLINE）；未定义 onShow/onHide/onUnload
- 依赖组件：无（usingComponents 为空对象）
- 关键 data：subjects（选中项置顶）、picked、activeSubject、groups（按 subject|module_id 分组）、openKey（当前展开章节）、blocks（渲染块 h/li/p）、listLoading/listError、detailLoading
- 接口：partner-action: study_list（subject，仅取已发布章节）、partner-action: study_detail（subject/module_id/chapter_id，仅 status=published）
- 异常分支：章节为空→「该科目暂无已发布章节」；列表失败→「加载失败，点击重试」（onRetry 重拉）；正文失败→toast `r.msg || '加载失败'`；正文请求异常→toast「网络异常」；未选科目时不发请求、无空态
- 页面出口：无页面跳转（同页展开/收起）
- 埋点：无埋点

### pkgLow.15. kefu 客服会话 —— 无订单场景的自建客服 IM：懒建会话、拉消息、发送、15s 轮询
- 分包：pkgLow
- 生命周期：onLoad（openConv 懒建会话并拉首屏消息）；onShow（startPoll 启动 15s 轮询）；onHide（stopPoll）；onUnload（stopPoll）
- 依赖组件：nav-bar（页面 json；bind:back 自定义返回）
- 关键 data：convId、messages（[{_id,mine,text,time,quote}]）、input、sending、loading、loadError、peerName（默认「平台客服」）
- 接口：im-conv: kefu_open（取/建会话）、kefu_messages（conv_id，拉消息并清未读）；im-send: send_kefu（conv_id/text）
- 异常分支：会话打开失败（ok=false 或无 conv）→自绘「会话加载失败」+「重试」（重调 openConv）；消息为空→「发送第一条消息，客服将为您服务」；发送失败 toast `r.msg || '发送失败'`；发送中按钮禁用并显示「发送中…」；消息拉取失败静默（无 toast）
- 页面出口：onGoBack → navigateBack，fail 兜底 switchTab '/pages-v2/index/index'（tabBar 页）
- 埋点：无埋点

### pkgLow.16. no-show-report 爽约申诉 —— 双模式（submit 申诉 / defense 举证）原因+说明+证据图提交
- 分包：pkgLow
- 生命周期：onLoad(options)（读 mode/orderId/reportId，按 mode 设标题「报告爽约」或「提交举证」，maxFiles/minLen 取 CONFIG.NO_SHOW；submit 缺 orderId toast「缺少订单信息」、defense 缺 reportId toast「缺少申诉记录」，均 1.2s 后 navigateBack）；未定义 onShow/onHide/onUnload
- 依赖组件：无（usingComponents 为空对象）
- 关键 data：mode（submit/defense）、orderId、reportId、reasonOptions（固定 4 项：未出现/迟到超30分钟/中途离开/其他）、reasonType、reason、files（fileID 数组）、maxFiles（默认 3）、minLen（默认 10）、uploading、submitting
- 接口：order-action: no_show_report_submit（order_id/reason/reason_type/evidence_file_ids）、order-action: no_show_report_defense（report_id/defense_reason/defense_file_ids）
- 上传目标：wx.chooseMedia（image/compressed/album+camera）→ wx.cloud.uploadFile，云存储前缀 `no-show/`，文件名 `${Date.now()}-${随机6位}.${ext}`；超张数 toast「最多 N 张图片」；失败原文「图片选择失败，请检查权限」「图片上传失败」；支持 previewImage 预览与逐张删除
- 异常分支：未选原因（submit）toast「请选择申诉原因」；说明为空 toast「请填写申诉说明」/「请填写举证说明」；字数不足 toast「申诉说明至少 N 字」；提交失败 toast `r.msg || '提交失败'`（2500ms）；提交成功 toast「申诉已提交」/「举证已提交」后 1.2s navigateBack；无空态组件
- 页面出口：提交成功 → wx.navigateBack（无 fail 兜底）
- 埋点：无埋点

### 4.1 【待补】清单
1. wallet：fastUsed / fastProgress 在 data 初始化后无任何 setData 赋值，极速提现进度条数据源与口径【待补】。
2. kefu：wxml 的 scroll-into-view 绑定 scrollTo，但 data 中未定义 scrollTo，新消息不会自动滚底，交互预期【待补】。
3. evaluate：模板引用 order.partner_name / order.service_date / order.partner_avatar，fetchData 均未赋值，摘要区恒空，字段来源【待补】。
4. activity-detail：CTA navigateTo('/pages-v2/publish/publish') 缺 fail 兜底（与项目 §7 规则不符），目标页路径与兜底文案【待补】。
5. 全部 16 页均无「未登录」显式分支与文案（依赖 bootstrap/全局拦截），未登录时各页实际表现原文【待补】。
6. credit / notices / safety / evaluate 的 empty-state 依赖 app.json 全局注册（页面 json 未声明），分包独立构建时是否仍生效【待补】。


---

## 5. 横向汇总

### 5.1 埋点清单（全站仅 8 个事件，均经 `utils/report.js` → `wx.reportAnalytics`）

| # | 事件名 | 页面 | 触发点 |
|---|---|---|---|
| 1 | `login_success` | `login` | 登录成功 |
| 2 | `demand_publish` | `publish` | 需求发布成功 |
| 3 | `demand_update` | `publish` | 需求编辑保存 |
| 4 | `order_pay` | `pay` | 模拟支付成功 |
| 5 | `order_finish` | `order-detail` | 确认完成 |
| 6 | `withdraw` | `pkg-low/wallet` | 提现申请提交 |
| 7 | `eval_submit` | `pkg-low/evaluate` | 评价提交 |
| 8 | `realname_done` | `pkg-low/realname` | 实名认证完成 |

> 其余 37 页**无埋点**。若产品需要漏斗（广场→详情→发布→支付），当前数据不足以还原，需另立项补点。

### 5.2 上传与隐私能力（4 页）

| 页面 | 能力 | 存储前缀 / 依赖 | 失败兜底（原文） |
|---|---|---|---|
| `pkg-low/partner-profile-edit` | `chooseMedia` + `uploadFile`（证件/荣誉图） | `partner-cert/` | 「图片选择失败，请检查权限」/「图片上传失败」 |
| `pkg-low/realname` | 签名 PNG 上传 + 身份证 + mock 人脸 | `sign_evidence/` | 同上；服务端拒绝时 `deleteFile` 清理孤儿文件 |
| `pkg-low/no-show-report` | 证据图上传 | `no-show/` | 「图片上传失败」/「网络异常,请重试」 |
| `pkg-low/safety` | 高精度定位 + 逆地理 + `chooseLocation` | 腾讯位置服务 | 8s 收敛、3 次失败降级提示 |

> 四条能力链路（相册/定位/摄像头/麦克风）**必须真机各验一遍**（iOS + Android），并在 mp 后台隐私指引中逐项声明。

### 5.3 管理端鉴权与写操作范式（8 页）

- **鉴权统一**：8 页 `onLoad` 先调 `admin-action: admin_list`，云端按 `admin_config.admin_openids` 白名单校验，失败写 `platform_event` 并返回 `admin_forbidden`（「无权限,该操作已被记录」）；页面本地 toast + `reLaunch` 回首页。
- **写操作不统一**：仅 `partners.review`、`demands.offline`、`orders.forceCancel` 有二次确认（后两者须填原因）；`config` 的 5 项写操作**无确认、无原因**，其中 **3 项失败静默**；**8 页均无防双击**。
- 与后台 Web 端（`admin-web-frontend`）的「二次确认 + 原因 + 防双击 + 刷新列表」标准不一致，属**口径漂移**，登记为待办（不在本轮改代码）。

### 5.4 合规缺口（不实陈述 · 必须你裁定）

`pay` 页*顶部横幅*「🔒 支付由平台担保, 订单未完成可全额退款」（`pay.wxml:6`，其上方注释自述「提审合规, 不出现"内测/模拟"字样」）、*担保交易卡*「资金由微信支付担保托管，履约确认后T+{{arriveDays}}分账给耍伴」（`:54-55`）、*按钮*「微信支付 ¥{{totalFee}}」（`:76`），在 `payment-mock` 阶段（`is_mock=true`，无真实扣款、无托管、无分账）全部为**不实陈述**，定性为**虚假承诺**而非单纯「提示缺失」：

- 与 core 附录A 第 8 条冲突：收银台必须显著提示「模拟支付，不产生真实扣款」，现状反向声明「平台担保 + 微信支付托管 + 可退款 + T+N 分账」。
- 同一主张在站内还有两处一致表述（不属本页，登记备查）：`agreement.wxml:19`「平台按约定规则进行担保与结算」、`login.wxml:17`「资金担保」；`config/index.js:98` AA 承诺书则明确「平台不代收、不担保、不仲裁」，全站口径**自相矛盾**。
- 风险：用户基于「担保/可退款」下单，争议时平台无履约能力；提审存在被判「虚假宣传/诱导」的风险。此前仅按「缺提示」登记，现**升格为不实陈述**。
- **本轮只登记，未改代码**；修复须一次改到位：补显著模拟支付提示 + 删除/改写担保与分账表述（`pay` 页 3 处，`agreement`/`login` 另议）。**待授权**（部署 `payment-mock` 与改本页文案均已向用户请示，见 HANDOFF T-9.15）。

### 5.5 页面级代码异常（实测，仅登记）

| 页面 | 现象 |
|---|---|
| `square` | 下拉刷新 `catch` 为空、无失败提示（`square.js:83`） |
| `index` | `fetchNearby` 无 `catch` 兜底 |
| `nearby-map` | `onMapShareChange` 无 `fail` 分支；marker id 由 openid 数字尾 8 位生成，**冲突未处理** |
| `activity-detail` | CTA 跳转缺 `fail` |
| `pkg-low/kefu` | 无 `scrollTo`，新消息不自动滚到底 |
| `pkg-low/evaluate` | 对方信息未赋值（页面显示依赖默认值） |

### 5.6 【待补】合并清单

1. `message` / `demand-detail` / `orders` / `my-demands` / `blog` / `blog-detail` 等页的空态依赖 `app.json` 全局注册 `empty-state`，页面 `.json` 未声明——**换分包或改注册方式会静默失效**。
2. `index` 的夜间红线 toast 文案来自 `redline` gate 的 `msg` 字段（本页不可见），需查 `utils/redline.js` 或云端配置才能定稿。
3. `pkg-low/wallet` 的「极速到账进度」无数据源（后端未返回），展示逻辑待确认。
4. `pkg-low/evaluate` 的对方信息未赋值，是否为设计（匿名）待产品确认。
5. 45 页中**绝大部分无显式「未登录」分支**（依赖启动时 `bootstrap` 拦截或接口返回未登录码），拦截实际发生在哪一层需在登录链路上另行核实。

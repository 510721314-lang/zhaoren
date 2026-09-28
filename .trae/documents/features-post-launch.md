# 提审后功能库 · ③④⑤ 完整可施工设计（含专家复核修正 · 2026-09-28）

> 状态：已确认排期为提审（8/8 终审）之后的增量功能。本会话不实施，仅存档供后续会话取用。

## 立项状态索引（与 HANDOFF §5.5 工作计划总览联动）

| # | 需求 | 状态 | 说明 |
|---|------|------|------|
| ① | 公益需求前端显示/后台控制 | 🔒 冻结 | 后台 welfare_switch=false + 前端不显示 + 服务端 fail-closed；禁止按 PRD §1.5 开建 |
| ② | 公益结算模式（营销转账/补贴） | 🔒 冻结 | 随①冻结，不再设计/实现 |
| ③ | 耍伴技能/个人资料维护 | ⏳ 待实施 | 本文件 §③ 设计即审批稿 |
| ④ | 地图找周边（需求+耍伴） | ⏳ 待实施 | 本文件 §④ 设计即审批稿 |
| ⑤ | 到达拍照打卡+确认后履约 | ⏳ 待实施 | 本文件 §⑤ 设计即审批稿 |

> 状态标记：🔒=冻结（禁止开发）｜ ⏳=设计完待排期 ｜ 🚧=实施中 ｜ ✅=已验收。

> 前置依赖（必读）：① 待办2 msgSecCheck 基建——③的 bio、⑤的任何自由文本都依赖它，**先做待办2 才能动 ③/⑤**；② 专家修正项全部并入下方案。
> 规则来源：.trae/rules.md 第九章（商业环节 mock 可达 / 参数后台可配置 / UI 与功能并行）。
> 提审外新增功能门禁：凡改动已验收链路（⑤涉及 S2→S3 相关 accepted-20260927-rule15），实施前必须 `git diff <最近accepted tag>..HEAD -- <文件>` 列计划等用户明确同意。

---

## 0. 公益冻结基线（2026-09-28 用户拍板）

公益（公益需求/公益单/公益补贴结算）整体**暂缓**：零实现保持；禁止按 PRD §1.5 / §需求表单公益章节开建；将来实现须满足 后台默认关闭(welfare_switch=false) + 前端不显示公益入口 + 服务端 fail-closed 拒绝公益发布。已写入手册(HANDOFF #10)+项目记忆「硬性约束」。

---

## ③ 耍伴技能 / 个人资料维护

### 3.1 数据模型（partner_profile 扩展）
```
skills:             Array<string>            // ≤6 项，单项 ≤8 字；白名单∪自定义
bio:                string                   // ≤50 字；入库前 msgSecCheck（依赖待办2）
portfolio:          Array<{url,type}>        // ≤3 项；url=cloud:// fileID；type ∈ photo|cert
home_location_public: boolean                // ④共用：是否公开日常位置（默认 false，见 4.2）
skill_update_at:    number                   // 审计时间戳
```

### 3.2 后台可配置（admin_config）
- `skill_tags_whitelist: string[]`（技能池，默认 8 项：健身指导/心理倾听/急救证/摄影/带娃/宠物护理/翻译/手工）
- 出口四件套：CONFIG_SCHEMA 加一行 → config_set(校验 string[] 1-50 项) → config_get → config_public

### 3.3 服务端校验（partner-action `update_config` 扩展，其余逻辑不动）
```
event.skills      — not array → pa_bad_skills | 长度 1-6? | 单项 ≤8 字 | 去重
event.bio         — ≤50 字 | msgSecCheck 不通过 → pa_bio_unsafe（msgSecCheck 基建完成前，该字段暂不接受，前端隐藏输入）
event.portfolio   — ≤3 项 | 每项 {url: cloud:// 前缀, type: ∈[photo,cert]} | fileID 提取后反查云存储归属=openid → pa_bad_portfolio
event.home_location_public — boolean，显式写出
```
- 与现有 update_config 同结构：`update[field]` 归入同一事务写，`skill_update_at=Date.now()`

### 3.4 展示点位（服务端裁剪后下发）
- home-action `hall/nearby/square` 的 partner/publisher 摘要追加：`skills`(前3)、`bio`(截断 20 字)；`self_public=home_location_public` 供前端判断地图可见性
- 前端：partner-card 加技能 chips 行；需求详情「接单耍伴」卡展示完整技能/介绍/作品

### 3.5 UI 设计（accept-config 新增「技能与介绍」区块，不建独立页）
- 技能标签：多选 chip（白名单）+「自定义」输入（≤8 字，追加为标签）
- 一句话介绍：textarea ≤50 字 + 字数角标
- 作品/证书：≤3 张缩略图网格，点击替换（复用签名图 wx.chooseMedia→云存储 channel），type 标注（作品/证书）
- 保存：与现有 onSave 合并提交 update_config；保存成功后 toast + 回显

### 3.6 专家修正（必须落实）
- **bio 的 msgSecCheck 依赖待办2 基建**：实施顺序 = 待办2 先完成，否则 bio 是裸露自由文本（审核红线）
- **portfolio 用途限定「资质证书/技能证明」，禁止通用图集**：陪伴类服务展示随意作品图可能触发微信审核内容安全复审；并在**用户隐私保护指引**新增声明「你上传的作品/证书图片仅用于技能展示与身份佐证」

### 3.7 验收要点
技能/简介保存后重进回显；敏感词 bio 被拒且 toast 明确；portfolio 仅本人 fileID 可传；列表页展示不破版；`home_location_public` 默认 false 不出现于地图

---

## ④ 地图找周边（需求+耍伴 · 按场景/距离）

### 4.1 后端一：`nearby` 扩展（向后兼容，不破坏已验收行为）
```
入参新增（全部可选）：
  lat/lng    — 提供则按"当前定位"为中心算距；缺省回退 home_location（现状逻辑不动）
  scene      — 场景过滤（复用 whitelist 校验）
输出：list[].distance_km 从"距我日常位置"变为"距当前定位"（按入参）
```
- 鉴权/价格过滤/分页/超距过滤沿用现状（home-action:496-561）

### 4.2 后端二：新 action `partner_nearby`（附近耍伴）
```
入参 { lat, lng, scene?, rate_min?, rate_max?, page=1, page_size=20(≤50) }
查询 partner_profile: {
  status:'approved',
  on_duty: true,                       // accept 开关（与 workbench 状态一致）
  accept_scenes: _.in([scene]) 或全量,  // scene 缺省 = 全部
  home_location 存在,
  home_location_public: true,          // ★ 可见性开关（专家修正）
  max_distance_km: gte 计算距离 或 不设  // 耍伴自身距离上限
}
处理：haversineKm(中心点, home_location) → 过滤 km > 平台阈值(take_distance_max_km) → 按距离 asc 排序 → skip/limit 分页 → 多取1判定 has_more
输出：{ list: [{ openid, surname, skills(前3), bio(截断), scene_rates, home_dist_km }], has_more }
隐私：只返回 home_dist_km（距离），绝不返回 home_location 精确坐标
```
- admin_config 平台阈值复用 `take_distance_max_km`（现有）

### 4.3 前端 `pages-v2/map`（4 文件 + app.json 注册 + square 入口）
- 顶部：场景 chips（复用 square 筛选组件样式）+ 距离滑块（1-20km，默认 10）
- map 组件：marker 双类——需求（场景色标）/ 耍伴（绿色头像+「距 X km」气泡，无坐标点）；tab 切换「看需求/看耍伴」
- 点 marker → 底部弹卡 → 跳 demand-detail / 耍伴主页；夜间红线（redline）命中时页面提示「夜间暂停查找」
- 定位：复用 publish getLocation + 逆地理编码（key 已在合法域名）；定位失败降级「按日常位置」

### 4.4 专家修正（审核高风险项，必须落实）
- **partner_nearby 把耍伴位置暴露给非订单用户 = 微信审核高风险**：
  ① 用户隐私保护指引（提审文档）须新增接口声明：「附近耍伴/地图浏览功能会使用您的日常位置信息用于匹配展示，仅在您开启"允许展示"后生效」
  ② **partner 侧新增可见性开关 `home_location_public`（默认 false 不公开）**：只在显式开启后进入地图/partner_nearby；关闭者不出现在任何查找结果，且不因 distance 被排序暴露
  ③ accept-config 接单配置页加开关 + 文案「允许在附近地图展示你的日常位置（其他用户仅看到距离）」——**当前配置页从未告知位置会被公开展示，改文案是必须的合规动作**

### 4.5 验收要点
无 home_location 或未开可见性 → 不出现在 map/partner_nearby；距离排序正确；按场景/价格过滤生效；懒加载分页不卡；红线下不崩溃；隐私开关关闭后立即从结果消失

---

## ⑤ 到达履约点拍照打卡 + 发布者确认后开始履约

### 5.0 方案决策（结合专家修正后拍板口径）
- **采用「独立 arrival 门禁」而非并入 milestone step0**：milestone 是 S3 阶段三步进度确认（current 0-3），前置到 S2 会破坏 order-create 初始化点与 S1-S2 展示语义、牵连已验收四确认链路；独立 arrival 对象只在 S2 加一道必经门禁，不新增状态机节点、不破 14 状态机（S2→S3 保持原样）。里程碑 step0 合并列为可选演进（后续若产品要求流程精简再评估）
- **不新增中间状态**：门禁状态由 `arrival` 子对象承载，订单 status 仍是 S2→S3

### 5.1 数据模型（order_main 新增 arrival）
```
arrival: {
  partner_checkin_at:     number|null   // 耍伴打卡时间
  partner_photo_file_id:  string|null   // 到达照片 cloud://（复用 sign_evidence 上传通道）
  partner_photo_hash:     string|null   // SHA-256 留证
  partner_loc:            {latitude, longitude}|null
  user_confirm:           boolean
  user_confirm_at:        number|null
}
```

### 5.2 新 action（order-action 2 个，守卫子句风格与现有 17 个 action 一致）
```
arrival_checkin   事件 { order_id, photo_file_id, loc }
  守: role==='partner'（否则 oa_start_perm）| status==='S2'（否则 oa_start_status）
     | photo_file_id 前置校验 cloud://（否则 oa_bad_photo）| arrival.user_confirm 不得 true（幂等拦截）
  做: update order_main { 'arrival.partner_checkin_at': now, 'arrival.partner_photo_file_id': …, 'arrival.partner_loc': loc }
     → writeNotice(user, type:'arrival', '耍伴已到达服务地点,请确认开始履约')
     → writeAudit(order_arrival_checkin) → 返回 {ok, data:{order_id, status:'S2'}}
  idempotent: 已 checkin 且未 confirm → 返回 {idempotent:true} 不重写

arrival_confirm    事件 { order_id }
  守: role==='user'（发布者，否则 oa_confirm_perm）| status==='S2'
     | arrival.partner_checkin_at 已存在（否则 oa_arrival_not_checkin「耍伴尚未打卡」）
     | 未确认过（幂等）
  做: update order_main { 'arrival.user_confirm': true, 'arrival.user_confirm_at': now }
     → writeNotice(partner, type:'arrival_confirm', '发布者已确认到达,可以开始服务')
     → writeAudit(order_arrival_confirm) → 返回 {ok, data:{order_id, status:'S2'}}
```

### 5.3 start_service 门禁（改动最小的注入点）
```
（现有 start_service index.js:639-675 基础上，在 CAS S2→S3 之前插入）：
  const arrival = order.arrival || {};
  if (!arrival.user_confirm) {
    return { ok:false, code:'oa_arrival_unconfirmed', msg:'发布者尚未确认你的到达' };
  }
```
其他逻辑（幂等/CAS/通知/审计）不变。

### 5.4 超时兜底（order-timer 新增 3.7 节）
```
扫描：order_main { status:'S2', 'arrival.partner_checkin_at': exists, 'arrival.user_confirm': false }
    partner_checkin_at < now-15min → writeNotice 双方 type:'arrival_remind'（15min 梯度提醒，文案「到达确认超时15分钟，请尽快确认」）
    partner_checkin_at < now-30min → logEvent P2 'arrival_confirm_timeout' 客服介入（platform_event）+ 通知
性能（专家修正）：
  - 独立 BATCH 扫描，复用现有 casStatus 防竞态
  - order-timer 60s 现扫 6 节点 → 变 7 节；**改后必须云端测试 action=run 计时复核**，若总耗时逼近 60s 则压缩说明/合并查询（如 S1/S0/S2-arrival 合并一次 where status:_.in() 再分派）
```

### 5.5 UI（order-detail S2 区块「到达确认卡」）
- partner 端：拍照按钮（wx.chooseMedia→云存储）+ 定位打卡 → 提交后卡变`待发布者确认`；user 端在收到通知后看到「确认到达」按钮
- user 确认后：partner 端「开始服务」按钮解锁（原 S2 按钮逻辑加 arrival 前置）
- 超时文案：15min 提醒 toast/横幅，30min 见客服提示

### 5.6 验收要点
未打卡→不可确认（oa_arrival_not_checkin）；未确认→不可 start（oa_arrival_unconfirmed）；重复打卡/确认→idempotent 不重写；15/30min 超时经 order-timer action=run 验证且总耗时在 60s 内；改动涉及 accepted-20260927-rule15 链路，实施前先 git diff 列计划等确认

---

## 实施顺序建议（供后续会话）
1. 待办2 msgSecCheck 基建（前置·提审阻塞）→ 2. payment-mock prod 闸门补丁（提审阻塞）→ 3. 提审 8/8 终审 → 4. ③④⑤（按产品优先级实施；③④无依赖可先，⑤最后且需先 git diff 列计划确认）
- 每条实施完附：文件路径/改前改后/复检项；云函数走 .trae/predeploy.ps1 逐个部署；静态验证 scan-miniprogram.ps1 + node --check
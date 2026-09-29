# 填充各场景需求种子数据 · 云端测试面板操作手册（方案A）

> ⚠️ **时效提示（2026-09-29 补）**：本手册内 `start_time` 时间戳为当次操作值（2026-10-02~10-05 窗口），复用前必须重新换算为「未来 2~14 天内、避开 00:00-06:00」的毫秒时间戳，照抄旧值会被发布校验拦截（start_time 必须未来）。重发前先软删旧 expired 种子（is_deleted=true），否则触发 publish_time_conflict。
>
> 配合同步进行的 git 审计，本步骤**不改代码**，只在云端写入 9 个场景各 1 条真实业务示例需求，
> 并下线那条「测试 / 李**」污染数据。
> 全程在「微信开发者工具 → 云开发控制台 → 云函数 → 云端测试」面板操作。

---

## 第 0 步 · 先确认环境（必须，否则发不出去）

mock 发布走 `resolveOpenid`，只有 `admin_config.env==='dev'` 才放行 mock_openid；prod 会 fail-closed。

**操作**：云端测试面板，函数选 `init-db`，事件贴下面这段，运行，看返回里的 `env` 值。

```json
{"action":"quick_check"}
```

- 返回中有 `admin_config.env`（或 `env`）字段：
  - 若为 **`dev`** → 继续第 1 步。
  - 若为 **`prod` / 其他 / 缺失** → mock 发不出去，先告诉我，需要先切 dev 或改走真机方案。
- 同时把返回里 `demands` 列表贴回来（确认那条「测试」需求的 `_id`，第 9 步下线要用）。

---

## 第 1 步 · 打开发布需求用「云端测试」面板

1. 开发者工具顶部工具栏 → 点「云开发」图标（新版 ∞ 双环图标）→ 打开云开发控制台。
2. 左侧「云函数」→ 右上搜索框输入 `demand-publish` → 行内点**「云端测试」**。
3. 面板内编辑器（通常是 `{ "action": "..." }` 的编辑框）输入下方事件 JSON → 点**「运行测试」**（或 Run）。
4. 看下方「返回结果」，`ok:true` 即为发布成功；把返回 `data._id`（32 位 hex）记下来。
5. **每个场景一条**，逐个贴。

---

## 第 2~8 步 · 逐场景发布需求（W1 W2 W3 W4 W7 W8 W10 W11 共 8 条）

> `mock_openid` = 发布者模拟身份（可都用同一个；要避开 18-22 岁推断，见容量）。金额用 50 元/小时（`rate_fen=5000`，落在默认区间 30-100 元内）。

### W1 就医陪诊（10-02 14:00）
```json
{"action":"publish","scene":"W1","match_mode":"broadcast","start_time":1790920800000,"duration_h":2,"rate_fen":5000,"aa_tier":"0-50","aa_promise_checked":true,"disclaimer_signed":true,"content_options":["挂号排队","陪诊解压"],"remark":"周末陪父亲去医院复查挂号排队","mock_openid":"seed_publisher_001","location":{"name":"成都市华西医院","city":"成都","latitude":30.64,"longitude":104.06},"device":"cloud-test"}
```

### W2 学习陪伴（10-03 10:00）
```json
{"action":"publish","scene":"W2","match_mode":"broadcast","start_time":1790992800000,"duration_h":2,"rate_fen":5000,"aa_tier":"0-50","aa_promise_checked":true,"disclaimer_signed":true,"content_options":["自习陪伴","口语陪练"],"remark":"图书馆自习监督加英语口语陪练","mock_openid":"seed_publisher_001","location":{"name":"成都市省图书馆","city":"成都","latitude":30.65,"longitude":104.06},"device":"cloud-test"}
```

### W3 健身陪伴（10-03 16:00）
```json
{"action":"publish","scene":"W3","match_mode":"broadcast","start_time":1791014400000,"duration_h":2,"rate_fen":5000,"aa_tier":"0-50","aa_promise_checked":true,"disclaimer_signed":true,"content_options":["健身指导","器械陪同"],"remark":"健身房一对一安全保护与动作纠偏","mock_openid":"seed_publisher_001","location":{"name":"成都市区健身房","city":"成都","latitude":30.57,"longitude":104.06},"device":"cloud-test"}
```

### W4 游玩陪伴（10-04 19:00，备注：本项目原本的唯一测试条目也是 W4，重名不影响）
```json
{"action":"publish","scene":"W4","match_mode":"broadcast","start_time":1791111600000,"duration_h":3,"rate_fen":5000,"aa_tier":"50-200","aa_promise_checked":true,"disclaimer_signed":true,"content_options":["景区游览"],"remark":"周末成都周边一日游结伴同行","mock_openid":"seed_publisher_001","location":{"name":"成都市宽窄巷子","city":"成都","latitude":30.67,"longitude":104.06},"device":"cloud-test"}
```

### W7 情绪陪伴（10-05 11:00）
```json
{"action":"publish","scene":"W7","match_mode":"broadcast","start_time":1791169200000,"duration_h":2,"rate_fen":5000,"aa_tier":"0-50","aa_promise_checked":true,"disclaimer_signed":true,"content_options":["倾听陪伴","陪伴散步"],"remark":"下班后散步倾诉陪你聊聊放松","mock_openid":"seed_publisher_001","location":{"name":"成都市锦江公园","city":"成都","latitude":30.63,"longitude":104.08},"device":"cloud-test"}
```

### W8 生活协助（10-06 15:00）
```json
{"action":"publish","scene":"W8","match_mode":"broadcast","start_time":1791270000000,"duration_h":3,"rate_fen":5000,"aa_tier":"50-200","aa_promise_checked":true,"disclaimer_signed":true,"content_options":["搬家帮手","排队代办"],"remark":"搬家整理帮忙抬重物与打包","mock_openid":"seed_publisher_001","location":{"name":"成都市天府三街","city":"成都","latitude":30.55,"longitude":104.06},"device":"cloud-test"}
```

### W10 出行陪伴（10-07 09:00）
```json
{"action":"publish","scene":"W10","match_mode":"broadcast","start_time":1791334800000,"duration_h":2,"rate_fen":5000,"aa_tier":"0-50","aa_promise_checked":true,"disclaimer_signed":true,"content_options":["逛街同行","活动搭子"],"remark":"高铁站接人指引打车送到目的地","mock_openid":"seed_publisher_001","location":{"name":"成都市火车东站","city":"成都","latitude":30.63,"longitude":104.15},"device":"cloud-test"}
```

### W11 线上陪伴（10-08 18:00）
```json
{"action":"publish","scene":"W11","match_mode":"broadcast","start_time":1791453600000,"duration_h":2,"rate_fen":5000,"aa_tier":"0-50","aa_promise_checked":true,"disclaimer_signed":true,"content_options":["树洞倾听","打卡监督"],"remark":"夜间线上陪你学习打卡相互督促","mock_openid":"seed_publisher_001","location":{"name":"成都市线上","city":"成都","latitude":30.57,"longitude":104.06},"device":"cloud-test"}
```

---

## 第 9 步 · W9 宠物陪伴（不走测试面板，需真机/前端发布）

W9 的 `publish` 强校验 [verifySignatureFile](L121) 要**真实可下载的 PNG 授权书签名图**，mock 伪造不了。
建议改走方案B：在你手机上用「发布需求」→ 选「宠物陪伴」→ 完成《宠物照料授权书》手写签字后再发布，
这样也顺带验证了 W9 的签名链路（此链路本就需要真机）。标题：「出差两天帮忙上门喂猫铲屎遛狗」。

---

## 第 10 步 · 下线那条「测试 / 李**」污染数据

用第 0 步返回里记录的 `_id`，函数选 `admin-action`，若该方法不外露下线能力可改走**云数据库直接改**：

云开发控制台 → 云数据库 → `demand` 集合 → 找到该测试需求 → 编辑 `is_deleted` 字段设为 `true` → 保存。

> **只改 is_deleted=true，不物理删除**（保留审计留痕）。改完它在首页/广场即不再展示。

---

## 复检（成功标志）

1. 开发者工具/真机下拉刷新首页「需求广场」：左侧分类导航除 W9 外每个场景显示 ≥1 条，卡片标题为上述业务示例。
2. 广场按场景 chip 筛选（W1/W2/W3/W4/W7/W8/W10/W11）都能刷出对应场景需求。
3. 「全部」列表里不再出现标题为「测试」、发布者「李**」的条目。
4. 若 W9 走了真机发布，W9 也应出现在宠物陪伴分类。

## 常见失败对照

| 返回 code | 含义 | 处理 |
|---|---|---|
| `publish_no_openid` | env 非 dev，mock_openid 没放行 | 先切 dev 或改真机方案 |
| `publish_scene_invalid` | scene 不在白名单 | 核对 scene 码，删掉用错的一步重发 |
| `publish_redline` | 时间落在 0-6 点 | 换上面给的时段 |
| `publish_rate_range` | 时薪超区间 | 若 en>=30-100 外，改 `rate_fen=5000` |
| `publish_content_invalid` | content_option 不在该场景 | 用上面各场景已列的可选项 |
| `publish_not_realname` | 模拟身份未实名 | 先建 user_account 含 is_realname_done:true（或 web 面板补） |
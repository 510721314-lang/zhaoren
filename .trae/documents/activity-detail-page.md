# 活动详情页实现计划（收口「活动详情即将上线」占位）

## Context
首页/广场的运营 banner/卡片点击 `jump_to === 'activity_detail'` 时目前 toast「活动详情即将上线」（[index.js](file:///c:/zhaoren/miniprogram/pages-v2/index/index.js#L142-L162) / [square.js](file:///c:/zhaoren/miniprogram/pages-v2/square/square.js#L145-L167)）。后台已能配置活动且 jump_to 含「活动详情页(暂未实现)」占位选项。用户确认**完整实现**标准运营活动页（banner+标题/副标题+活动时间/地点+规则列表+报名CTA）+ 填充演示数据，供提审演示。

## 实现步骤

### 1. 数据模型扩展（无迁移）
`admin_config.global.home_activities` 每项新增字段：
```
content: { time_text: string, location: string, rules: [string], body?: string, cta_text?: string }
```

### 2. home-action 新增 `activity_detail` action
[home-action/index.js](file:///c:/zhaoren/cloudfunctions/home-action/index.js#L654-L684) 的 `home_activity_list` case 后新增：
- 入参 `{id}`，从 `admin_config.global.home_activities` 找 `id === event.id && status === 'active'` 且时间窗内
- 命中返回 `{ ok: true, data: 活动全量含 content }`；未命中 `{ ok: false, code: 'act_not_found' }`
- `home_activity_list` 的映射输出**不变**（避免列表携带大字段）

### 3. 新建前端页面 `pages-v2/activity-detail/`（4 文件）
- **json**：`navigationBarTitleText: "活动详情"`
- **js**：`onLoad(options)` 读 `options.id` → `app.cloudCall('home-action', { action: 'activity_detail', id })` → 渲染；失败/空态 toast 兜底
- **wxml**：banner 图(mode=widthFix) → title/subtitle → 信息卡(时间/地点) → 规则有序列表 → body → 底部 fixed CTA
- **wxss**：`@import "../../styles/tokens.wxss"`，只用 tokens 变量（深色模式自动适配）
- CTA：`wx.navigateTo('/pages-v2/publish/publish')`（发布需求即报名，复用现成路径）

### 4. 两个入口补 `case 'activity_detail'`
[index.js](file:///c:/zhaoren/miniprogram/pages-v2/index/index.js#L158) 与 [square.js](file:///c:/zhaoren/miniprogram/pages-v2/square/square.js#L162) 的 default 前插入：
```js
case 'activity_detail': {
  const id = p.id || act.id;
  if (id) wx.navigateTo({ url: '/pages-v2/activity-detail/activity-detail?id=' + id });
  else wx.showToast({ title: '活动详情待配置', icon: 'none' });
  break;
}
```

### 5. admin-action 白名单 + 后台表单
- [admin-action/index.js](file:///c:/zhaoren/cloudfunctions/admin-action/index.js#L1805-L1868)：`home_activity_create` 的 newAct 加 `content`（校验 `Array.isArray(content.rules)`）；`home_activity_update` 的 allowed 白名单加 `'content'`（**两处都改，漏一处字段被丢**）
- [Operations.vue](file:///c:/zhaoren/admin-web-frontend/src/views/Operations.vue#L210-L250)：活动弹窗加 el-collapse「详情内容」区：time_text/location 输入、rules textarea（每行一条，提交前 split/join）、body、cta_text

### 6. 注册路由
[app.json](file:///c:/zhaoren/miniprogram/app.json) pages 数组加 `"pages-v2/activity-detail/activity-detail"`

### 7. 填充演示数据（实施阶段，云端测试 mock_openid=管理员 调 `home_activity_create`）
```json
{
  "title": "找人帮忙正式上线",
  "subtitle": "新用户发布需求享专属客服",
  "type": "both", "jump_to": "activity_detail", "jump_param": {},
  "banner_image": "cloud://ENV/banner.png", "cover_image": "cloud://ENV/cover.png",
  "priority": 100, "status": "active", "scene_code": "",
  "content": {
    "time_text": "2026-10-01 ~ 2026-12-31", "location": "线上",
    "rules": ["注册并登录小程序", "发布一条真实需求", "选择耍伴完成接单", "联系客服领取新人礼"],
    "body": "找人帮忙正式上线，新用户发布需求可享优先匹配。",
    "cta_text": "立即发布需求"
  }
}
```
banner/cover 图先上传云存储拿 fileID 再回填。

## 部署与验证
1. 部署 `home-action`、`admin-action`（CLI 一次一个）→ 重建 admin-web 并部署
2. 云端测试：`home_activity_create` 写入上述 JSON → `home-action.activity_detail` 查 id 确认 content 透传
3. 真机：首页/广场点 banner → 进详情页；下架/过期活动返回「活动不存在」提示
4. 后台 Operations.vue 编辑活动回显 content

## 坑位提醒
- create/update 白名单都要加 content；home_activity_list 勿透传 content
- banner 必须 cloud:// fileID（裸 http 真机不显示）
- detail 必过滤 status+时间窗，下架活动不可直读
- 详情页处理 load 失败空态；id 缺失 toast 兜底

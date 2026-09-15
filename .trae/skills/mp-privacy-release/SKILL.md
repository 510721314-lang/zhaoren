---
name: "mp-privacy-release"
description: "微信小程序隐私指引配置 + 真机发布链路调试经验库。Invoke when 隐私指引审核失败、chooseLocation/getLocation 报 api scope not declared、免责声明循环拦截、真机地图选点不弹出、MVP bootstrap 首次发布被云函数拒绝。"
---

# 微信小程序隐私指引 + 真机发布链路线索库

## 适用场景

- `wx.chooseLocation` / `wx.getLocation` 报 `api scope is not declared in the privacy agreement`
- 隐私保护指引反复审核失败（超过 2 次）
- 免责声明 bottom-sheet 真机渲染不出来、弹窗循环拦截
- 真机发布需求被云函数拒绝（无实名 / 无紧急联系人 / location 经纬度为 0）
- MVP 阶段要快速打通真机发布链路（先绕过后根治）

---

## 线索一：隐私指引审核配置（mp.weixin.qq.com）

### 4 个关键 API 对应不同的隐私声明项

| API | 声明项（后台叫法）| 正确用途描述（必须精确到业务动作，第二人称）|
|---|---|---|
| `wx.getLocation` | **位置信息** | 发布需求时获取你当前位置用于标注发布地址 |
| `wx.chooseLocation` | **选择的位置信息** ⚠️ 不是「选中的」 | 你选择服务履约地点时使用，用于填写服务地点 |
| `wx.chooseMedia` | 选中的照片或视频信息 | 上传需求场景相关的图片或视频 |
| `getPhoneNumber` | 手机号 | 紧急联系、服务通知及售后沟通 |

### 审核失败头号原因

**只勾了信息类型但没填「使用场景描述」**，或者描述太笼统（如「用于定位」→ 驳回）。每条都要具体到业务动作。

### 后台入口

mp.weixin.qq.com → 设置 → 基本设置 → 服务内容声明 → 用户隐私保护指引 → 去完善 → 每个勾选项点开 → 填用途 → 提交

### 状态变化

审核中（几分钟到几小时）→ 已更新/已生效。**生效后真机 API 自动放行**，无需重编译。

---

## 线索二：免责声明循环拦截根治

### 根因（两层叠加）

1. `bottom-sheet` 组件在真机上可能渲染不出来（真机模拟器都可能有问题）→ `disclaimerVisible:true` 但弹窗没出来 → `disclaimerChecked` 永远 false
2. 免责检查分散在多个入口（`onPublish` 里一处、`validatePublish` 里又一处）→ 拦截形成循环

### 根治方案（已验证）

**1. 用 `wx.showModal` 替代 bottom-sheet 弹窗**（跟 setScene 选场景时的弹法统一）

```js
// onPublish 开头统一处理，不再调 bottom-sheet 的 visible
if (curScene && curScene.disclaimer && !this.data.disclaimerChecked) {
  wx.showModal({
    title: '就医陪诊免责声明',
    content: '...',
    confirmText: '同意',
    cancelText: '不同意',
    success: (r) => {
      if (r.confirm) {
        this.setData({ disclaimerChecked: true });
        this._continuePublish();   // 分离纯 validate + AA 弹窗逻辑
      } else {
        wx.showToast({ title: '请同意免责声明后继续', icon: 'none' });
      }
    }
  });
  return;
}
```

**2. validatePublish 里删掉重复的 disclaimer 检查**（只在 onPublish 入口统一处理一次）

**3. 分离 `_continuePublish()`** 方法，纯做 validate + AA 弹窗，onPublish 同意免责后直接调它。

### 禁止写法

```js
// ❌ 仍然依赖 bottom-sheet（真机渲染可能失败）
this.setData({ disclaimerVisible: true });

// ❌ 多处检查（形成循环）
if (curScene.disclaimer && !this.data.disclaimerChecked) errs.push('...');  // validatePublish 里

// ❌ confirmPublish 里也加免责检查（三重循环）
```

---

## 线索三：云函数 MVP bootstrap 策略

### 首次发布被拒的典型原因

真机 openid → `user-login` 自动建号时 `is_realname_done=false, emergency_contact=null` → `demand-publish` 严格校验 → 拒绝。

### MVP bootstrap 处理（demand-publish index.js）

```js
// 1. is_realname_simulated 的新用户自动升级
if (user.is_realname_simulated && !user.is_realname_done) {
  // 把 user 文档 is_realname_done 设为 true
}

// 2. 无 emergency_contact 时自动创建占位联系人
if (!user.emergency_contact) {
  // 创建一个默认占位 emergency_contact（仅存手机号字段）
}
```

### location 经纬度 MVP 放宽

**隐私拒绝定位时经纬度是 0,0，云函数必须放行**：

```js
// ❌ 硬校验 → 真机隐私被拒就发布不了
if (!location.latitude || !location.longitude) return { ok: false, msg: '...' };

// ✅ MVP 只校验 name 非空
if (!location || !location.name) return { ok: false, msg: '请填写履约地点名称' };
// publish_location 兜底用 location
let pubLoc = publish_location && publish_location.latitude && publish_location.longitude
  ? publish_location
  : { name: location.name, latitude: location.latitude || 0, longitude: location.longitude || 0, city: location.city };
```

---

## 线索四：前端 publish 页 confirmPublish 链路

```
用户点发布 → onPublish()
  → disclaimer 检查（仅此处一处）
  → _continuePublish() → validatePublish() → AA sheet
  → 用户勾 AA → confirmPublish()
    → wx.getLocation（publish_location GPS，允许失败）
    → 失败弹 Modal「发布地址获取失败 → 继续发布」
    → _doPublish(f, durationH, pubLoc|null)
      → 组 params → wx.cloud.callFunction({ name: 'demand-publish', data: params })
```

### 云函数入参（`action:'publish'`）

```js
{
  scene: 'W1|W2|W8|W10|W11',
  content_options: ['挂号排队', '取药送药'],
  start_time: 1760000000000,  // 未来时间戳 ms
  duration_h: 2,               // 1-12
  location: { name, address, latitude, longitude, city },
  publish_location: { latitude, longitude, name, city },
  remark: '标题｜描述',
  rate_fen: 3000,              // 分单位！30元=3000
  aa_tier: '0-50|50-200|200+|custom',
  aa_promise_checked: true,
  disclaimer_signed: true,
  match_mode: 'broadcast|select'
}
```

### 场景 code 统一

云函数 SCENE_WHITELIST 是 W1/W2/W8/W10/W11，前端 `enums.js` 也必须用 W 前缀，不能用英文 code（`medical_escort` 等）。

---

## 线索五：真机调试 Checklist

| 检查点 | 如何确认 |
|---|---|
| 隐私指引生效 | mp.weixin.qq.com → 基本设置 → 用户隐私保护指引 → 已更新 |
| chooseLocation 放行 | 发布页点「地点」→ 弹微信原生地图选点器 |
| getLocation 放行 | 发布完不弹「发布地址获取失败」Modal |
| 免责声明能出 | 选 W1 场景 → 立刻弹 wx.showModal |
| 云函数被调起 | Console 搜 `[confirmPublish] → demand-publish` |
| 返回 ok:true | Console 里看 `res.result.ok` 和 `data._id` |
| 需求真的入库 | 开发者工具 → 云开发 → 云数据库 → demand 集合查 |

---

## 线索六：常用 git tag

```
v0.1.1-foundation: 真机发布链路打通 + 免责声明彻底修复
  enums.js SCENES W code 对齐
  publish.js onLocationPick → wx.chooseLocation
  publish.js confirmPublish → demand-publish 真实调用
  publish.js 免责声明 → wx.showModal 根治循环
  demand-publish MVP bootstrap + location 经纬度放宽
```

---

## 关键错误 & 修复（速查）

| 症状 | 根因 | 修复 |
|---|---|---|
| `chooseLocation:fail api scope is not declared` | 隐私指引漏勾「选择的位置信息」 | 后台加勾 + 填用途 |
| 免责声明弹窗不出现 → 循环拦截 | bottom-sheet 真机渲染失败 | 改 wx.showModal + 删重复检查 |
| 云函数拒「履约地点信息不完整」 | 硬校验经纬度 | MVP 放宽，只校验 name |
| 云函数拒「无实名/无紧急联系人」 | 新用户 bootstrap 缺失 | MVP 自动升级 simulated + 自动创建占位 |
| tag-chip `sceneCode null` warning | 首页 mock 数据缺 scene_code | 后续统一清理 mock |
| 发布成功但 detail 页显示老 mock 数据 | detail.js 还在读 mock | 后续接云端 |

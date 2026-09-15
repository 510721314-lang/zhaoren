---
name: "mp-privacy-release"
description: "微信小程序隐私指引配置 + 真机发布链路调试经验库。Invoke when 隐私指引审核失败、chooseLocation/getLocation 报 api scope not declared、免责声明循环拦截、真机地图选点不弹出、MVP bootstrap 首次发布被云函数拒绝、按钮点击无反应/showModal 不弹（confirmText 4字符限制）。"
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
| **只有 W1 能发布，W2/W8/W10/W11 全部循环** | **前后端免责声明范围不一致**（见线索七） | **5 场景 disclaimer 全部对象化 + 选中即弹** |

---

## 线索七：多场景免责声明前后端对齐（2026-09-15 追加，已验证）

### 症状

W1 就医陪诊发布正常；其他 4 个场景在 AA 承诺书确认后弹「请先阅读并勾选《场景免责声明》」，反复循环。

### 关键认知：拦截 toast 来自云函数，不是前端！

前端代码全文搜不到该文案时 → 它是 `wx.cloud.callFunction` 返回的 `r.msg`（`wx.showToast({title: r.msg})`）。排查顺序：
1. `grep -rn "文案片段" miniprogram/` 搜不到 → 立刻去 `cloudfunctions/` 搜
2. `demand-publish/index.js` 对 **所有场景** 强制校验 `disclaimer_signed`（它有 `DISCLAIMER_TYPE_MAP`：W1 medical / W2·W8·W10 general / W11 online / W3 sports / W7 emotion / W9 pet）

### 根因

前端只给 W1 做了免责弹窗（`disclaimer: true`），其余场景 `setScene` 把 `disclaimerChecked` 置 false → 上送 `disclaimer_signed:false` → 云函数拒绝 → 用户再点 → AA 弹窗 → 再拒绝 = 死循环。

### 根治方案

1. `config/enums.js`：SCENES 每个场景的 `disclaimer` 从布尔改为 `{title, content}` 对象，5 个场景全部配置专属文案
2. `publish.js` 抽 `_showSceneDisclaimer(scene, onAgree, onReject)`，`setScene` 和 `onPublish` 统一调用，弹窗文案取 `scene.disclaimer.title/content`
3. 同意后 `disclaimerChecked=true` → 上送 `disclaimer_signed:true`；云函数不动、不重新部署
4. 判断条件 `if (scene.disclaimer)` 对对象天然 truthy，无免责场景在 helper 内直接 onAgree 兜底

### 教训

**前后端对「哪些场景需要免责」的认知必须以云函数白名单/MAP 为准**；改前端枚举时先 grep 云函数同名映射。凡是 AA 确认后才出现的拦截 toast，优先怀疑云函数返回 msg。

---

## 线索八：wx.showModal confirmText 超 4 字符 = 真机弹窗静默失败（2026-09-16 追加）

### 症状

点击「接单/抢单」按钮**完全无反应**——无弹窗、无 toast、无 loading。所有接单入口（详情页接单、广场抢单）全死，因为都汇入同一个 `utils/take-order.js` 的免责声明 `wx.showModal`。

### 根因

`wx.showModal` 官方限制：**confirmText / cancelText 最多 4 个字符**。超限（如 `'同意并接单'` 5 字）调用直接 fail，弹窗不渲染，且**没有 fail 处理时无任何可见反馈**。

铁证：同项目发布页免责弹窗真机一直正常，它的 `confirmText: '同意'`（2 字）；接单弹窗写成 `'同意并接单'`（5 字）就死。

### 修复

1. confirmText 控制在 4 字符内（`'同意接单'`），完整语义放 title/content 里
2. **所有 wx.showModal 必须加 fail 兜底**（toast 可见反馈），杜绝静默死亡：

```js
wx.showModal({
  title: d.title, content: d.content,
  confirmText: '同意接单',   // ≤4 字符！
  cancelText: '不同意',
  success: (r) => { if (r.confirm) next(); },
  fail: (err) => {
    console.error('[showModal] fail:', err);
    wx.showToast({ title: '弹窗加载失败,请重试', icon: 'none' });
  }
});
```

### 排查规律

「点击无反应」类问题的检查顺序：①处理函数是否触发 ②wx.showModal confirmText/cancelText 是否 >4 字 ③组件级弹层（bottom-sheet）真机渲染 ④夜间红线等全局拦截。**v1 遗留页（demand-publish `'我已阅读并同意'` 7 字）和 admin 页（`'标记已解决'` 5 字）还有同类地雷，动到时顺手修**。

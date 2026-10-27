# 立项：全局定位超时兜底与静态门禁（2026-10-27）

- 基线：HEAD `a689006`（已推送）
- 背景：发布页 `wx.getLocation` 回调不返回导致旋转图标永久卡死，2026-10-27 已用 8s 看门狗修复（v1.6.49 真机验收通过）。
- 目标：把“定位必须可超时收敛”变成全仓强制约束，杜绝同类卡死。

## 1. 现状基线（12 处未迁移）

> 发布页已修复，不在表内；`wx.chooseLocation` 不属本门禁范围。

| # | 位置 | 调用场景 | 卡死后果 | 风险 | 阶段 |
|---|---|---|---|---|---|
| 1 | `pages-v2/order-detail/order-detail.js:704` | SOS 求助 | `showLoading` 遮罩不退，求助不发出 | 高 | P0 |
| 2 | `pages-v2/pkg-low/safety/safety.js:154` | 安全中心持续定位 | `locating` 锁死，安全功能不可用 | 高 | P0 |
| 3 | `utils/order-evidence.js:12` | 履约证据采集 | Promise 永不 resolve，开始履约流程挂起 | 高 | P0 |
| 4 | `utils/geo-wx.js:39` | 开始履约定位快照 | Promise 永不 resolve | 高 | P0 |
| 5 | `utils/take-order.js:259` | 接单定位 | `showLoading` 不退，接单不完成 | 高 | P0 |
| 6 | `pages-v2/partner-detail/partner-detail.js:121` | 路线规划 | `routeLoading` 永久转圈 | 中 | P1 |
| 7 | `pages-v2/nearby-map/nearby-map.js:56` | 附近地图本人定位 | Promise 卡住，页面初始化不完成 | 中 | P1 |
| 8 | `pages-v2/nearby-map/nearby-map.js:98` | 开启定位按钮 | 点击无反馈 | 中 | P1 |
| 9 | `pages-v2/pkg-low/safety/safety.js:275` | 安全打卡 | 无反馈 | 中 | P1 |
| 10 | `pages-v2/order-detail/order-detail.js:617` | 用户确认到场 | 无反馈 | 中 | P1 |
| 11 | `utils/geo-wx.js:19` | 履约距离判定 | 判定状态不更新 | 中 | P1 |
| 12 | `pages-v2/demand-detail/demand-detail.js:77` | 浏览者距离 | 仅距离缺失，不阻塞 | 低 | P2 |

## 2. 设计

### 2.1 `miniprogram/utils/location.js`（新增）

```js
function getLocationSafe(options = {}) -> Promise<{
  ok: true, latitude, longitude, accuracy, ... 
} | { ok: false, timeout?: true, errMsg: string }>
```

约束：
- 默认 `type: 'gcj02'`、`isHighAccuracy: true`、`highAccuracyExpireTime: 4000`；
- 默认 `timeoutMs = 8000`，**Promise 永不悬空、永不 reject**；
- 超时后销毁内部状态，迟到回调丢弃（序号机制，复用发布页实现）；
- 不依赖 page/this，可在页面与 utils 中复用。

### 2.2 静态门禁 `scripts/check-location-timeout-policy.js`

- **L1**：`miniprogram/` 内除 `utils/location.js` 外，禁止裸调 `wx.getLocation`；仅允许 `scripts/location-timeout-baseline.json` 中登记的存量基线。
- **L2**：基线按「文件 + 该文件内第 N 处」计数，不依赖行号；迁移后基线数量必须下降，**基线 stale（实际少于登记）也 FAIL**，防“修了不销项”。
- **L3**：`getLocationSafe` 之外的封装（如自带 setTimeout）不自动豁免，避免绕过。
- **双挂载**：`npm run verify:offline` + `.trae/predeploy.ps1`（按 O7/G1）。
- **G2 自证**：临时在 `miniprogram/` 放一个裸调探针 → 门禁 EXIT=1 且报文件:序号；删除 → EXIT=0。

### 2.3 迁移原则

- 只替换“取坐标”这一步；`success/fail` 的业务编排原样保留，改为 `const r = await getLocationSafe(); if (!r.ok) { 原 fail 分支 } else { 原 success 分支 }`。
- `@VERIFIED` 页面（order-detail / safety）改动前逐条核对，保留原降级文案与安全逻辑。
- 每阶段独立提交、独立门禁、独立上传体验版，禁止混批。

## 3. 阶段与验收

### Phase 1（P0，5 处）
- 新增 `utils/location.js` + `check-location-timeout-policy.js` + baseline（登记 12 处）。
- 迁移 #1–#5。
- 验收：门禁绿；SOS/安全中心/开始履约/接单 四链路真机正常；mock 永不回调时对应 loading/遮罩在 8s 内收敛。

### Phase 2（P1，5 处）
- 迁移 #6–#10；baseline 降至 2。
- 验收：路线/附近地图/安全打卡/到场确认真机正常；门禁绿。

### Phase 3（P2，1 处）+ 清零
- 迁移 #12；baseline 清空并删除文件。
- 验收：`verify:offline` 绿；临时裸调探针 FAIL → 移除 PASS；全仓 `wx.getLocation` 只出现在 `utils/location.js`。

## 4. 风险与回滚

- 风险：把 `success` 业务逻辑改写成 `await` 后引入时序变化（中）；`@VERIFIED` 页面误改（中）。
- 控制：每处迁移独立 diff；保留原 fail 文案；入口契约测试 + 真机；出现回归按单文件 `git checkout` 回退。
- 回滚点：每阶段一个 commit；体验版版本递增（下一版 `v1.6.50` 起）。

## 5. 待决

1. 是否批准按三阶段实施（先 Phase 1）。
2. 门禁是否允许 P2 的 `demand-detail` 永久豁免（当前方案：不豁免，最终清零）。
3. 是否在提审冻结期前全部完成；若冻结期先到，Phase 2/3 顺延到提审后。

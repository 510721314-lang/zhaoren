# 本轮改动清单 + diff（2026-10-04，供 reviewer 签字）

> 范围：自 facc67d 起的批次 1/2/3 安全与事务加固落地，含后续回归修复。
> HEAD：`8dbec6a`；工作区干净；已推送 GitHub；bundle：`zhaoren-20261004-132645.bundle`（SHA256 已记 CHECKSUMS）。

## 提交列表

| commit | 说明 |
|---|---|
| `c36432f` | fix(order-create): 修复接单链路回归——锁集合写错全量拦截 + CAS 漏写 matched_openid + 幂等捞回自愈 + 前端自动捞回 |
| `8dbec6a` | feat(seed): 种子订单工具——服务时段/夜间红线订单生成 + 清理 + matched_openid 补全 |

## diff 统计（facc67d..HEAD）

```
cloudfunctions/admin-web/index.js      |  16 +-
cloudfunctions/order-create/index.js   |  80 +++++-
cloudfunctions/zz-seed-orders/index.js | 416 +++++++++++++++++++++++++++++++++
miniprogram/utils/take-order.js        |  20 +-
4 files changed, 518 insertions(+), 14 deletions(-)
```

## 核心改动说明

### 1. order-create（接单链路，本轮最大修复）
- **接单互斥锁集合修正**：`users` → `user_account`（openid 字段匹配；原挂错集合致全量抢单被「操作太频繁」拦截）
- **CAS 补写 `matched_openid`**：抢单模式原子更新时写入归属，使幂等捞回/`check_take_result` 生效
- **CAS 失败幂等捞回**：需求已匹配给自己 → 查回已建订单返回（半成品自愈）；无订单 → 释放回 matching
- **新增 `check_take_result`**：前端网络异常后查询接单状态（taken/released/not_mine/gone），stuck 自动补偿
- **事务补偿清 `matched_openid`**：回 matching 时同步清空归属

### 2. take-order.js（前端）
- `.catch` 网络异常改为先调 `check_take_result` 捞回：已建单跳转、已释放提示重试（**需重传体验版生效**）

### 3. zz-seed-orders（临时种子工具，云端已删）
- `service_orders`：为考试通过耍伴生成服务中（S3）订单
- `night_orders`：生成 00:00-06:00 红线内需求/订单（测拦截）
- `cleanup_seed_orders` / `backfill_matched`：清理与历史 `matched_openid` 回填（72 条中 22 条空值，已回填 found=0）

### 4. admin-web（网关）
- 种子代理加白 `seed_service_orders` / `seed_night_orders` / `seed_cleanup_seed_orders` / `seed_backfill_matched`（含 cleanup/参数透传）

## 验证记录
- 核心交易链路（发单→接单→履约→评价）真机测试通过
- 历史 `matched_openid` 回填：found=0 全量健康
- quick_check：env=prod、mock_payment_enabled=false、mock_gate=OK
- 冻结清单 1-7 完成；2 名管理员已补录并验证

## 遗留（本轮未做，已评估）
- **git 历史清洗（filter-branch/filter-repo）**：放弃。旧 key 已死（401 验证）、当前文件无明文、bundle 已备份、本机无 python 工具链；风险≈0，成本高，标记为可选卫生项不做
- **重传体验版**：待用户操作（前端改动生效的必要条件）

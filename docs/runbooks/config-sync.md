# 全仓配置同步清单 SOP

> 适用场景：首页/发布页展示的场景数量与预期不符、需求发布时场景白名单异常、运营后台改配置但前端/云函数没同步、改共享规则模块后需同步副本。

## 前置条件

- SSOT：`admin_config` 集合 `_id: 'global'` 是唯一可信源；前端 `config/enums.js` 仅硬编码兜底（显示名/图标/免责声明），**场景 code 数量必须与 `admin_config.scene_list` 对齐**
- 当前种子场景 5 个：`W1 就医陪诊 / W2 学习陪伴 / W8 生活协助 / W10 出行陪伴 / W11 线上陪伴`；已隐藏：`W3 健身陪伴 / W7 情绪陪伴 / W9 宠物陪伴`
- 读 admin_config 单例用 `col('admin_config').doc('global').get()`（`where({_id:'global'})` 读不到数据）

## 步骤

### 1. 场景中文映射常量全仓同步（改场景名必须全改）

映射常量统一 `W1 就医陪诊 / W2 学习陪伴 / W3 健身陪伴 / W4 游玩陪伴 / W7 情绪陪伴 / W8 生活协助 / W9 宠物陪伴 / W10 出行陪伴 / W11 线上陪伴`，实际落点（新增/改场景必须全仓 Grep 一处改处处查）：

| 文件 | 常量名 |
|---|---|
| `order-action/index.js`（L23 顶层 `SCENE_CN` + 函数内两处 `SCENE_NAME`） | SCENE_CN / SCENE_NAME |
| `admin-action/index.js` | SCENE_NAME |
| `demand-publish/index.js` | SCENE_NAME（函数内） |
| `im-conv/index.js` | SCENE_NAME |
| `im-send/index.js` | SCENE_NAME |
| `home-action/index.js` | SCENE_NAMES_LEGACY |
| `payment-mock/index.js` | SCENE_NAMES |

- 记忆基线口径：「SCENE_NAME 全仓 6 处同步（order-action / admin-action / demand-publish / im-conv / im-send）」，home-action/payment-mock 用同映射异名常量也需同步

### 2. 共享模块四件套同步（防漂移）

规范源在 `cloudfunctions/_shared/`，**修改后必须跑对应 `sync-*.ps1` 同步副本，CI 会做哈希一致性拦截**（`scripts/check-shared-sync.js`）：

| 模块 | 内容 | 消费方（副本位置） |
|---|---|---|
| `take_rules.js` | 时间红线/东八区自然日/价格区间钳制/每周时段/Haversine | order-create, demand-publish, order-action, home-action |
| `money_rules.js` | 分账公式/打赏校验/提现两段校验/余额口径 | payment-mock, order-create, order-action |
| `test_data.js` | is_test 白名单打标 | demand-publish, order-create, admin-action, init-db |
| `partner_audit.js` | 耍伴资料审核增量 | partner-action, admin-action |

同步（示例 take_rules，其余同构）：

```powershell
powershell -File cloudfunctions\_shared\sync-take-rules.ps1
powershell -File cloudfunctions\_shared\sync-money-rules.ps1
powershell -File cloudfunctions\_shared\sync-test-data.ps1
powershell -File cloudfunctions\_shared\sync-partner-audit.ps1
```

- sync 脚本 = Copy + SHA256 校验，失败即 throw「consistency FAIL」

## 验证

```powershell
node scripts/check-shared-sync.js   # SHARED SYNC ALL OK；任一漏同步报 [DRIFT]
node scripts/check-ssot.js          # 前端无新增硬编码阈值
# 云端诊断：init-db quick_check → scene_count == 预期；有差异 force_migrate_scenes
```

## 坑

- **改共享模块后必须跑 sync 副本 + check-shared-sync，否则 CI 拦截**（规范源 + 本地副本哈希不一致）
- 规则语义教训（已单测固化）：`0 是合法值`——费率 0=免佣、价格下限 0，禁止 `||` 兜底（`money_rules.splitOrderAmount` 曾 `||1000` 吞 0；`Number(null)===0` 语言坑须先判 null）
- 拒绝码（`wd_amount`/`tip_amount` 等）是与前端/后台的契约，抽函数时**逐字保留**
- init-db 对 admin_config 是「补缺失不覆盖」，旧种子 8 场景不会被新种子 5 自动降级 → 有差异用 `force_migrate_scenes` 覆盖
- 抽取前必须逐副本 diff 核实语义一致（home-action 的 asin 变体 haversineKm 与 atan2 形式数学等价的才可统一）
- home-action 每次调用重新读 admin_config，无需重部署（缓存 30 秒内自行失效）
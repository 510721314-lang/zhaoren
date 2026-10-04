# 真实支付接入三件套·设计与商户号申请清单（2026-10-04）

> 状态：**设计稿**。代码实施依赖微信支付商户号凭证到位（见 §4 申请清单）。当前全链路仍走 payment-mock，`mock_payment_enabled=true` 保持至正式上线前。

## 1. 现状
- 支付全链路：`payment-mock`（cashier_info → mock_pay → S0→S2 CAS → pay_transaction 落库 + system_notice 通知）
- 无任何真实凭证代码（payment-mock 无 mchid/apiv3/证书/notify 引用）
- 金额一律「分」整数、支付资格/状态/幂等由后端裁决（红线沿用）

## 2. 三件套设计

### 2.1 回调验签（支付结果可信入口）
- 新增云函数 `payment-notify`（HTTP 触发器，路径 `/pay/notify`）
- 验签流程（微信支付 APIv3）：
  1. 取请求头 `Wechatpay-Timestamp` / `Wechatpay-Nonce` / `Wechatpay-Signature` / `Wechatpay-Serial`
  2. 按 `timestamp\nnonce\n<body>\n` 构造验签串，用**微信支付平台证书**公钥验签
  3. 验签通过 → 用 APIv3 密钥 AES-256-GCM 解密 `resource`（含 transaction_id、out_trade_no、amount）
  4. 验签/解密失败 → 返回 4xx（微信会重试）
- 关键点：平台证书下载与轮换、防重放（timestamp 5 分钟内）、明文 body 不落日志

### 2.2 单号幂等（回调只入账一次）
- 扩展 `pay_transaction`：新增 `transaction_id`（微信单号，唯一索引语义）+ `out_trade_no = 我方 order_no`
- 回调处理：
  - 先查 `pay_transaction.transaction_id` 已存在 → 直接返回成功（幂等，防重复入账）
  - 不存在 → 事务内：写入 pay_transaction + `order_main` CAS S0→S2（沿用现有幂等范式）+ 通知
- 对账依据：`pay_transaction` 与 `order_main.status=S2` 一一对应

### 2.3 状态对账（防漏单/超卖/不一致）
- 定时任务（复用 order-timer 或新增 payment-reconcile）：
  - 拉取微信「对账单/查单」接口，与本库 `pay_transaction` + `order_main` 比对
  - 不一致（微信已付本库未 S2 / 本库 S2 微信无单）→ 告警 + 平台事件留痕
- 频率：日终对账一次 + 支付后 30min 单笔兜底查单

## 3. 落地步骤（商户号到位后）
1. 申请凭证（§4）→ 写入 `admin_config`（加密字段，AES-256，同敏感字段规范）
2. 新增 `payment-notify` 云函数：验签 + 解密 + 幂等入账（§2.1/2.2）
3. payment-mock 增加 `real_pay` 分流：`env=prod 且配置齐 → 真实下单（JSAPI）`；`mock_payment_enabled=true → 走 mock`（灰度开关）
4. 对账定时任务（§2.3）
5. `mock_payment_enabled` 置 false（**正式上线前最高优先**，quick_check 兜底 BLOCK）
6. 真实提现/分账链路（商户号分账到耍伴）单独排期

## 4. 商户号申请清单（需用户操作）
| 凭证 | 用途 | 获取渠道 |
|---|---|---|
| 微信支付商户号（mchid） | 下单/回调主体 | pay.weixin.qq.com 申请（需企业主体认证） |
| APIv3 密钥（apiv3 key） | 报文解密 | 商户平台 → 账户中心 → API 安全 |
| 商户私钥（apiclient_key.pem） | 下单请求签名 | 商户平台 → API 证书下载 |
| 平台证书序列号 + 公钥 | 回调验签 | 商户平台 → API 证书 |
| 回调 URL 白名单 | 微信→我方 notify | 商户平台 → 产品中心 → 支付配置 |
| AppID 绑定 | 小程序支付 | 商户平台绑定小程序 AppID（wxbc4a4afacdf234f5） |

> 前置条件：企业主体认证 + 小程序类目资质（W1 陪诊挂家政/陪诊类目）——与提审资质同步推进。

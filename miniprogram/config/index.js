// config/index.js · V15.1 可运营参数唯一来源（禁止在页面/组件散落硬编码）
// 来源：mock-data.md 第3节

const newbieDiscount = 20;

module.exports = {
  // 平台总开关（云端 admin_config.switches 同步；false=维护态，bootstrap 覆盖）
  SWITCH: { access: true, blog: true, im: true },

  // 支付/资金能力开关（打赏等 mock 能力仅 dev 下发; 由 admin_config config_public payment.tip_enabled 派生覆盖, 兜底关闭）
  PAYMENT: { tipEnabled: false },

  // R1 夜间红线
  TIME_REDLINE: { close: '24:00', open: '06:00' },

  // 发布校验
  BUDGET_RANGE: [10, 500],          // 元/小时
  TITLE_MAX: 20,
  DESC_MAX: 500,
  HEADCOUNT: [1, 3],
  DATE_RANGE_DAYS: 30,
  DURATION_OPTIONS: [1, 2, 3, 4, 6, 8],

  // 距离校验（公里，与后台 admin_config 同名键一致；前端仅用于提示与前置拦截，服务端为准）
  PUBLISH: { distanceMaxKm: 50, takeDistanceMaxKm: 50, contentOptionsMax: 3 },// 服务内容(子服务项)最多项数(后台 publish_content_options_max 覆盖)

  AA_OPTIONS: ['0-50', '50-200', '200+', 'custom'],

  // 草稿（拍板项1）
  DRAFT: { expireDays: 30, maxCount: 20, autoSaveSec: 30 },

  // 订单时效
  ORDER: {
    payTimeoutMin: 30,
    confirmTimeoutMin: 15,
    evalWindowH: 48,
    evalDefaultStars: 4,
    evalModifyH: 24,
    afterSaleDays: 15,
    partialJudgeDays: 7,      // S4 部分完成裁定期（PRD 3.5.2）
    arbitrateFirstDays: 5,    // S10.5 争议一审工作日
    arbitrateSecondDays: 10,  // S10.5 争议二审工作日
    evalTextMax: 200,         // 评价字数上限
    evalRewardYuan: 1,         // 评价奖励优惠券面额（元）
    goodReviewMin: 4,          // 好评星级阈值(≥此星自动勾选口碑标签; 后台 order_good_review_min_stars 覆盖)
    reasonMaxLen: 200          // 改期/加时原因字数上限(后台 order_reason_max_len 覆盖)
  },

  // 改期规则（PRD 3.5.3）
  MODIFY: { maxTimes: 2, freeFirst: true, secondFeeRate: 0.05, minLeadHours: 4, maxSpanH: 72, confirmHours: 2 },

  // 取消梯度退款小时阈值（与 CANCEL_REFUND 三档一一对应，PRD 8.3）
  CANCEL_LEAD_HOURS: [24, 4],

  // 取消梯度退款（PRD 8.3）
  CANCEL_REFUND: [
    { lead: '>24h', label: '提前24小时以上', rate: 1 },
    { lead: '4-24h', label: '提前4-24小时', rate: 0.8 },
    { lead: '<4h', label: '不足4小时', rate: 0.5 }
  ],

  // 爽约（拍板项2；第三批 3B：全部数值后台可配 no_show_* 9 键，此处仅兜底默认，启动被 config_public.no_show 覆盖）
  NO_SHOW: { scoreDeduct: 20, maxTimes: 3, suspendDays: 7, reportWindowH: 48, defenseWindowH: 48, countWindowDays: 180, evidenceMax: 3, reasonMinLen: 10, maxPerOrder: 1 },

  // 订阅消息（需求①增强 · 抢单提醒）：模板未配时前端授权开关置灰(静默降级仅站内)；
  // tmplId/page 由 admin-action config_public.sub_msg.demand_grab 覆盖(SSOT)，此处仅兜底
  SUB_MSG: {
    demandGrab: { enabled: false, tmplId: '', page: 'pages-v2/demand-detail/demand-detail', miniprogramState: 'formal' }
  },

  // 安全报备（PRD 3.6）
  SAFETY: { checkinMin: 30, gpsPrecision: 'block', gpsPrecisionText: '街区级（约100米）', sosCountdownSec: 10, oneKeyPressSec: 3, s35TimeoutH: 24, s35ResponseMin: 10, locationRefreshSec: 15 },

  // 腾讯地图 WebService Key（逆地理编码用）— 留空时降级为仅显示 GPS 坐标
  TENCENT_MAP_KEY: 'I2DBZ-2RJCC-7RC2K-ACPMG-35LBF-LUB3D',

  // R5 成年年龄门槛（PRD 1.7.1）
  ADULT_AGE: 18,

  // 18-22岁青年保护（PRD 1.7.1）
  YOUTH: { ageRange: [18, 22], maxOrderAmount: 200, contacts: 2, sosPopupMin: 60 },

  // 实名认证（P0 正式版流程；faceMode 由 config_public 的 realname.face_mode 覆盖，仅网络失败时用兜底）
  // mock=测试期模拟人脸 / wx=微信官方人脸核验（类目资质到位后后台切换）
  REALNAME: { faceMode: 'mock' },

  // 法律文本兜底（云端 admin_config.legal_* 优先；仅 config_public 拉取失败时展示, 与服务端兜底同源）
  LEGAL_FALLBACK: {
    serviceAgreement: '找个人帮忙 服务协议（测试期精简版，正式全文以平台公示版本为准）\n一、平台性质：本平台为生活服务信息撮合平台，仅提供信息发布与撮合服务，不直接提供服务，亦不承担服务方的履约责任。\n二、用户义务：用户应提供真实身份信息，不得发布违法、违规或虚假需求；不得站外交易、私自转账。\n三、服务与费用：服务时薪由双方按平台规则约定；平台不代收服务费，AA（交通、餐费、门票等）费用由双方线下自行协商结算。\n四、安全与免责：用户应遵守平台安全规范与时间红线；因用户自身原因或第三方原因造成的损失，平台不承担责任。\n五、电子签署：用户通过手写签名方式确认本协议，电子签名与手写签名具有同等法律效力。',
    aaPromise: '费用自理承诺书\n一、AA 指交通费、餐费、门票等第三方费用，不含服务费；\n二、AA 费用由双方线下自行协商结算，平台不代收、不担保、不仲裁；\n三、平台不参与定价与结算；\n四、因 AA 产生的纠纷，平台不承担调解、仲裁、赔偿责任。',
    // W9 宠物照料授权书(电子确认; PRD R9) — 与服务端 demand-publish DEFAULT_PET_AUTHORIZATION 同源
    petAuthorization: '找人帮忙 宠物照料授权书（电子确认）\n一、本人系所照料宠物的主人，或已获得宠物主人的明确授权；\n二、本人知悉并确认：服务内容仅限遛狗、宠物医院陪同等陪同类事项；禁止代为饲养，禁止上门喂猫、寄养等入户照料；\n三、服务过程中如发生宠物伤人、应激等情形，双方应及时沟通处理，并保留相关记录；\n四、本人同意：本电子确认记录将作为平台内「明确授权」凭证留存，用于履约与纠纷举证。'
  },

  // 60岁以上长者
  ELDERLY: { age: 60, checkinMin: 20 },

  // 提现（PRD 3.10.3）
  WITHDRAW: { minAmount: 10, fastPerDayMax: 2000, fastPerOrderMax: 200, fastOrders: 10, arriveDays: 1, fastArriveDays: 0 },

  // 信用分
  CREDIT: { init: 800, max: 1000, pass: 600, freeze: 400 },

  // 保险（PRD 3.7）
  INSURANCE: { accidentCoverage: 500000, propertyCoverage: 50000 },

  // 18-22岁优先匹配850+（PRD 1.7.1 YP4）
  YOUNG_REVIEW_MIN: 850,

  // 新人福利
  NEWBIE: { firstOrderDiscount: newbieDiscount, welfareTitle: `🎁 新人首单立减${newbieDiscount}元`, welfareSub: '首单免平台服务费 · 每人限1次' },

  // 公益单规则
  WELFARE: { monthlyQuota: 500, perUserQuota: 3, partnerSubsidyRate: 0.8, hourlyRateFen: 3000 },// 公益单时薪(分; 后台 welfare_hourly_rate_fen 覆盖)

  // 分享标题字数上限(后台 share_title_max 覆盖)
  SHARE: { titleMax: 30 },

  // 列表分页(后台 paging.* 覆盖)
  PAGING: {
    orderPageSize: 20,   // 订单列表每页
    indexNearby: 10,     // 首页附近可接
    indexSquare: 20,     // 首页需求广场
    squareLimit: 50,     // 广场列表
    nearbyLimit: 20,     // 附近列表分页
    walletWithdraw: 20,  // 钱包提现记录
    noticeLimit: 50      // 通知列表
  },

  // 工作台
  WORKBENCH: { incomeShow: 5 },// 工作台流水展示条数(后台 workbench_income_show 覆盖)

  // IM「其他」模板与客服介入（PRD 3.4）
  IM: { otherKefuThreshold: 3, kefuResponseMin: 5 },

  // 广场撮合
  MATCH: { expandMin: 30, reserveDiscount: 0.9 },

  // 新耍伴流量扶持
  NEW_PARTNER: { trafficSupportOrders: 5 },

  // 接单配置可调区间（PRD 3.2.2）
  PARTNER_ACCEPT: {
    distanceRange: [3, 50],
    dailyLimitRange: [1, 10],    // 保留: 后台 daily_take_limit 的展示参考区间
    bufferOptions: [15, 30, 45, 60],
    defaultMinPrice: 30,
    defaultMaxPrice: 100,        // 接单默认最高价(元/小时)兜底; 边界以云端 rate_max_fen 为准
    defaultDistance: 50,         // 默认=平台上限(未调整不额外收紧); 广场/接单按 min(本值, 平台上限) 生效
    defaultDailyLimit: 5,        // 兜底: 云端 admin_config.partner_daily_take_limit 优先(平台统一设定, 耍伴只读)
    defaultBufferMin: 30,
    defaultSceneRateFen: 10000,  // 耍伴默认时薪 100 元/小时(SSOT 可由 admin_config 覆盖)
    rateMinFen: 1000,            // 前端校验兜底, 服务端为准
    rateMaxFen: 50000,
    slotStepMin: 30,             // 每周时段滑动条步长(分钟)
    slotsPerDay: 48              // 每天半小时槽位数 = 24*60/30
  },

  // 账号注销冷静期（PRD 3.11）
  LOGOUT_COOLDOWN_DAYS: 30,

  // 消息留存
  MESSAGE_RETENTION: { unDealDays: 30, dealtDays: 90 },

  // 版本号
  VERSION: 'v1.5.1'
};

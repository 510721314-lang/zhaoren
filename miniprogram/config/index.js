// config/index.js · V15.1 可运营参数唯一来源（禁止在页面/组件散落硬编码）
// 来源：mock-data.md 第3节

const newbieDiscount = 20;

module.exports = {
  // 平台总开关（云端 admin_config.switches 同步；false=维护态，bootstrap 覆盖）
  SWITCH: { access: true, blog: true, im: true },

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
  PUBLISH: { distanceMaxKm: 50, takeDistanceMaxKm: 50 },

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
    evalRewardYuan: 1         // 评价奖励优惠券面额（元）
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

  // 爽约（拍板项2）
  NO_SHOW: { scoreDeduct: 20, maxTimes: 3, suspendDays: 7 },

  // 安全报备（PRD 3.6）
  SAFETY: { checkinMin: 30, gpsPrecision: 'block', gpsPrecisionText: '街区级（约100米）', sosCountdownSec: 10, oneKeyPressSec: 3, s35TimeoutH: 24, s35ResponseMin: 10, locationRefreshSec: 15 },

  // 腾讯地图 WebService Key（逆地理编码用）— 留空时降级为仅显示 GPS 坐标
  TENCENT_MAP_KEY: 'I2DBZ-2RJCC-7RC2K-ACPMG-35LBF-LUB3D',

  // R5 成年年龄门槛（PRD 1.7.1）
  ADULT_AGE: 18,

  // 18-22岁青年保护（PRD 1.7.1）
  YOUTH: { ageRange: [18, 22], maxOrderAmount: 200, contacts: 2, sosPopupMin: 60 },

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
  WELFARE: { monthlyQuota: 500, perUserQuota: 3, partnerSubsidyRate: 0.8 },

  // IM「其他」模板与客服介入（PRD 3.4）
  IM: { otherKefuThreshold: 3, kefuResponseMin: 5 },

  // 广场撮合
  MATCH: { expandMin: 30, reserveDiscount: 0.9 },

  // 新耍伴流量扶持
  NEW_PARTNER: { trafficSupportOrders: 5 },

  // 接单配置可调区间（PRD 3.2.2）
  PARTNER_ACCEPT: {
    distanceRange: [3, 10],
    dailyLimitRange: [1, 10],    // 保留: 后台 daily_take_limit 的展示参考区间
    bufferOptions: [15, 30, 45, 60],
    defaultMinPrice: 30,
    defaultMaxPrice: 100,        // 最高单价默认(元/小时), 与 rateMaxFen 对齐
    defaultDistance: 5,
    defaultDailyLimit: 5,        // 兜底: 云端 admin_config.partner_daily_take_limit 优先(平台统一设定, 耍伴只读)
    defaultBufferMin: 30,
    defaultSceneRateFen: 5000,   // 耍伴默认时薪 50 元/小时(SSOT 可由 admin_config 覆盖)
    rateMinFen: 3000,            // 前端校验兜底, 服务端为准
    rateMaxFen: 10000,
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

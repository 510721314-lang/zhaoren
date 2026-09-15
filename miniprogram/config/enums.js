// config/enums.js · V15.1 全局枚举 SSOT
// 来源：mock-data.md 第1节（对齐 PRD 第16章数据模型）
// 规则：颜色一律使用 var(--xxx) token，页面/组件禁止再写散落映射
// 时效数字一律取自 config/index.js，禁止在枚举内二次写死

const CONFIG = require('./index.js');

// 一期场景白名单（PRD 3.3.1，硬编码校验 R9）。code 与云函数 demand-publish SCENE_WHITELIST 对齐
// disclaimer 与云函数 DISCLAIMER_TYPE_MAP 对齐：每个场景都有对应免责类型，选中即弹（合规双签）
const SCENES = [
  {
    code: 'W1', name: '就医陪诊', icon: '🏥', color: '#E8F1FF', gb: true, cert: '陪诊认证',
    disclaimer: {
      title: '就医陪诊免责声明',
      content: '本平台提供的就医陪诊服务仅为生活协助性质，非医疗服务。耍伴不具备医疗执业资格，不提供诊断、治疗、用药建议。耍伴仅协助挂号、排队、取药、记录医嘱等辅助性事务，不参与任何医疗决策。因患者自身疾病原因导致的后果，平台与耍伴不承担责任。遇紧急医疗情况请立即呼叫120或寻求医院专业帮助，耍伴可协助联系。'
    },
    options: ['挂号排队', '取药送药', '陪诊解压']
  },
  {
    code: 'W2', name: '学习陪伴', icon: '📚', color: '#EDE8FF', gb: false, cert: '学习认证',
    disclaimer: {
      title: '学习陪伴免责声明',
      content: '学习陪伴服务仅提供自习陪伴、口语陪练、作业督促等学习辅助，耍伴不替代学校教师教学，不提供学科成绩保证，不替写作业、不代考。未成年人使用本服务须在监护人知情并同意的前提下进行，服务安排在图书馆、书店等公开场所。'
    },
    options: ['自习陪伴', '口语陪练', '作业督促']
  },
  {
    code: 'W8', name: '生活协助', icon: '🛠️', color: '#FFF3E0', gb: false, cert: '生活协助认证',
    disclaimer: {
      title: '生活协助免责声明',
      content: '生活协助服务仅提供排队代办、搬家帮手、采买陪同等事务性协助，不提供高空作业、危险品搬运、电器维修等需专业资质的服务。服务过程中请自行保管贵重物品，注意人身与财产安全；耍伴仅承担协助义务，因你自身原因造成的损失平台不承担责任。'
    },
    options: ['排队代办', '搬家帮手', '采买陪同']
  },
  {
    code: 'W10', name: '出行陪伴', icon: '🚄', color: '#E0F5F4', gb: false, cert: '出行认证',
    disclaimer: {
      title: '出行陪伴免责声明',
      content: '出行陪伴仅提供同行陪同与协助，耍伴不承担交通运输承运人责任，不驾驶营运车辆。请选择公共场所见面与活动，注意出行安全；夜间活动请提前告知亲友或紧急联系人。因交通延误、天气、景区管理等第三方原因导致的损失，平台与耍伴不承担责任。'
    },
    options: ['逛街同行', '夜跑陪跑', '活动搭子']
  },
  {
    code: 'W11', name: '线上陪伴', icon: '💬', color: '#FFE9EC', gb: false, cert: '线上认证',
    disclaimer: {
      title: '线上陪伴内容协议',
      content: '线上陪伴服务通过网络提供倾听、陪玩、打卡监督等陪伴沟通，不属于心理咨询、医疗建议或法律援助。沟通中请勿透露银行卡密码、短信验证码等敏感信息，请勿进行转账、借贷等金钱往来。严禁传播违法违规内容，一经发现平台有权立即中止服务并依规处理。'
    },
    options: ['树洞倾听', '游戏陪玩', '打卡监督']
  }
];

// 订单13态（PRD 3.5.2 SSOT）
// colorTag：S1紫 / S2蓝 / S3橙 / S5绿 / S6灰 / S10.5红，其余按语义归位
const ORDER_STATUS = {
  S0:    { code: 'S0', name: '待支付', colorTag: 'var(--func-warning)', bgTag: 'var(--func-warning-light)', timeoutText: `${CONFIG.ORDER.payTimeoutMin}分钟内未支付自动取消`, nextActions: ['pay', 'cancel'] },
  S1:    { code: 'S1', name: '待确认', colorTag: 'var(--func-purple)', bgTag: 'var(--func-purple-light)', timeoutText: `${CONFIG.ORDER.confirmTimeoutMin}分钟内待双方确认`, nextActions: ['confirm', 'reject'] },
  S2:    { code: 'S2', name: '已支付待履约', colorTag: 'var(--func-info)', bgTag: 'var(--func-info-light)', timeoutText: '', nextActions: ['start'] },
  S2_5:  { code: 'S2.5', name: '改期处理中', colorTag: 'var(--func-info)', bgTag: 'var(--func-info-light)', timeoutText: `耍伴需${CONFIG.MODIFY.confirmHours}小时内确认`, nextActions: [] },
  S3:    { code: 'S3', name: '履约中', colorTag: 'var(--func-warning)', bgTag: 'var(--func-warning-light)', timeoutText: '', nextActions: ['safety', 'overtime', 'modify', 'finish'] },
  S3_5:  { code: 'S3.5', name: '履约中断', colorTag: 'var(--func-danger)', bgTag: 'var(--func-danger-light)', timeoutText: `${CONFIG.SAFETY.s35TimeoutH}小时未处理自动转部分完成`, nextActions: ['resume', 'confirm'] },
  S4:    { code: 'S4', name: '部分完成', colorTag: 'var(--func-warning)', bgTag: 'var(--func-warning-light)', timeoutText: `${CONFIG.ORDER.partialJudgeDays}天裁定期`, nextActions: ['confirm_ratio'] },
  S5:    { code: 'S5', name: '已完成', colorTag: 'var(--func-success)', bgTag: 'var(--func-success-light)', timeoutText: `${CONFIG.ORDER.evalWindowH}小时内可评价`, nextActions: ['evaluate'] },
  S6:    { code: 'S6', name: '已取消', colorTag: 'var(--text-4)', bgTag: 'var(--bg-segment)', timeoutText: '', nextActions: [] },
  S7:    { code: 'S7', name: '已退款', colorTag: 'var(--func-info)', bgTag: 'var(--func-info-light)', timeoutText: `T+${CONFIG.WITHDRAW.arriveDays}到账`, nextActions: [] },
  S8:    { code: 'S8', name: '已评价', colorTag: 'var(--func-success)', bgTag: 'var(--func-success-light)', timeoutText: `售后窗口${CONFIG.ORDER.afterSaleDays}天`, nextActions: ['complaint'] },
  S9:    { code: 'S9', name: '评价超时', colorTag: 'var(--text-4)', bgTag: 'var(--bg-segment)', timeoutText: `系统默认${CONFIG.ORDER.evalDefaultStars}星`, nextActions: [] },
  S10:   { code: 'S10', name: '已关闭', colorTag: 'var(--text-4)', bgTag: 'var(--bg-segment)', timeoutText: '', nextActions: [] },
  S10_5: { code: 'S10.5', name: '争议处理中', colorTag: 'var(--func-danger)', bgTag: 'var(--func-danger-light)', timeoutText: `一审${CONFIG.ORDER.arbitrateFirstDays}个工作日/二审${CONFIG.ORDER.arbitrateSecondDays}个工作日`, nextActions: ['arbitration'] }
};

// 需求广场单状态
const DEMAND_STATUS = {
  matching: '招募中',
  matched: '已被抢',
  cancelled: '已取消',
  expired: '已过期'
};

// 撮合模式（PRD 2.2）
const MATCH_MODE = [
  { code: 'direct', name: '定向邀约', desc: '指定喜欢的耍伴', needVip: false },
  { code: 'broadcast', name: '广场广播', desc: '先到先得，匹配更快', needVip: false },
  { code: 'smart', name: '智能派单', desc: '系统优先匹配高信用耍伴', needVip: true }
];

// 项目属性（PRD 1.5）
const PROJECT_ATTR = {
  commercial: { code: 'commercial', name: '商业付费' },
  public_welfare: { code: 'public_welfare', name: '公益免费' }
};

// AA费用预估档位（PRD 3.5.1-V15）
const AA_ESTIMATE = ['0-50', '50-200', '200+', 'custom'];
const AA_ESTIMATE_LABEL = {
  '0-50': 'AA 0-50元',
  '50-200': 'AA 50-200元',
  '200+': 'AA 200元以上',
  custom: 'AA 自定义'
};

// 信用等级（PRD 3.1.2 拍板）
const CREDIT_LEVEL = [
  { level: 'L1', name: '新手', min: 600, max: 799, dailyLimit: 10 },
  { level: 'L2', name: '标准', min: 800, max: 899, dailyLimit: 15 },
  { level: 'L3', name: '优质', min: 900, max: 949, dailyLimit: 20 },
  { level: 'L4', name: '金牌', min: 950, max: 1000, dailyLimit: 25 }
];

// 资金四态（PRD 3.5.1）
const FUND_STATUS = {
  splitting: '分账中',
  withdrawable: '可提现',
  processing: '提现处理中',
  arrived: '已到账'
};

// 四确认项
const CONFIRM_ITEMS = [
  { key: 'time', name: '时间' },
  { key: 'location', name: '地点' },
  { key: 'content', name: '内容' },
  { key: 'fee', name: '费用' }
];

// IM模板消息（PRD 16.5）
const TM_TEMPLATES = {
  TM1: { id: 'TM1', name: '时间确认', icon: '🕐', headColor: 'var(--brand-primary)', question: '以下服务时间是否方便？', options: ['方便', '需调整'], hasOther: true },
  TM2: { id: 'TM2', name: '地点确认', icon: '📍', headColor: 'var(--brand-primary)', question: '请确认集合地点', options: ['地点正确', '需修改'], hasOther: true },
  TM3: { id: 'TM3', name: '内容确认', icon: '📋', headColor: 'var(--brand-primary)', question: '请确认服务内容', options: ['内容无误', '需补充'], hasOther: true },
  TM4: { id: 'TM4', name: '费用确认', icon: '💰', headColor: 'var(--func-warning)', question: '请确认费用明细', options: ['确认费用', '有异议'], hasOther: true },
  TM5: { id: 'TM5', name: '特殊需求', icon: '✨', headColor: 'var(--brand-primary)', question: '有什么特殊需求？', options: [], hasOther: true, otherLimit: 200 },
  TM6: { id: 'TM6', name: '到达提醒', icon: '🚩', headColor: 'var(--brand-primary)', question: '我已到达集合点', options: ['好的', '稍等'], hasOther: false },
  TM7: { id: 'TM7', name: '取消申请', icon: '✖️', headColor: 'var(--func-danger)', question: '申请取消订单', options: ['同意取消', '不同意'], hasOther: true },
  TM8: { id: 'TM8', name: '改期申请', icon: '📅', headColor: 'var(--func-warning)', question: '申请改期', options: ['同意改期', '不同意'], hasOther: true }
};

module.exports = {
  SCENES,
  ORDER_STATUS,
  DEMAND_STATUS,
  MATCH_MODE,
  PROJECT_ATTR,
  AA_ESTIMATE,
  AA_ESTIMATE_LABEL,
  CREDIT_LEVEL,
  FUND_STATUS,
  CONFIRM_ITEMS,
  TM_TEMPLATES
};

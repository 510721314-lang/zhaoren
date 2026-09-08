// utils/constants.js - 全局常量 · 对应 PRD 附录G 状态机 / 3.2 场景 / 3.4 AA档位 / 3.3 IM模板
// 严格遵守 .trae/rules.md 红线参数

// 订单 13 态状态机(PRD 附录G SSOT)
const ORDER_STATUS = {
  S0:    { code: 'S0',    name: '待支付',     color: 'warn' },
  S1:    { code: 'S1',    name: '待确认',     color: 'primary' },
  S2:    { code: 'S2',    name: '已支付待履约', color: 'primary' },
  S3:    { code: 'S3',    name: '履约中',     color: 'success' },
  S3_5:  { code: 'S3.5',  name: '履约中断',   color: 'danger' },
  S4:    { code: 'S4',    name: '部分完成',   color: 'primary' },
  S5:    { code: 'S5',    name: '已完成',     color: 'success' },
  S6:    { code: 'S6',    name: '已取消',     color: 'muted' },
  S7:    { code: 'S7',    name: '已退款',     color: 'muted' },
  S8:    { code: 'S8',    name: '已评价',     color: 'success' },
  S9:    { code: 'S9',    name: '评价超时',   color: 'warn' },
  S10:   { code: 'S10',   name: '已关闭',     color: 'muted' },
  S10_5: { code: 'S10.5', name: '争议处理中', color: 'danger' }
};

// 场景白名单(MVP-V1 一期 · PRD 3.2 / 第11章) · 与 init-db 种子 admin_config.scene_list 一致
const SCENE_LIST = [
  { code: 'W1',  name: '就医陪诊', icon: '🏥', options: ['挂号排队', '取药送药', '陪诊解压'], aa_default: true },
  { code: 'W2',  name: '学习陪伴', icon: '📚', options: ['自习陪伴', '口语陪练', '作业督促'] },
  { code: 'W8',  name: '生活协助', icon: '🛠️', options: ['排队代办', '搬家帮手', '采买陪同'] },
  { code: 'W10', name: '出行陪伴', icon: '🚗', options: ['逛街同行', '夜跑陪跑', '活动搭子'] },
  { code: 'W11', name: '线上陪伴', icon: '💬', options: ['树洞倾听', '游戏陪玩', '打卡监督'] }
];

// AA 费用档位(PRD 3.4 · 平台不代收)
const AA_TIERS = [
  { value: '0-50',    label: '0-50元' },
  { value: '50-200',  label: '50-200元' },
  { value: '200+',    label: '200元以上' },
  { value: 'custom',  label: '自定义' }
];

// IM 系统模板消息(四确认前只允许发这些 · PRD 3.3.2)
const SYSTEM_TEMPLATES = [
  { id: 't1', text: '你好' },
  { id: 't2', text: '我准备好了' },
  { id: 't3', text: '请确认服务时间' },
  { id: 't4', text: '请确认服务地点' },
  { id: 't5', text: '请确认服务内容' },
  { id: 't6', text: '请确认费用明细' },
  { id: 't7', text: '我发起四确认了' },
  { id: 't8', text: '好的马上到' }
];

module.exports = {
  ORDER_STATUS,
  SCENE_LIST,
  AA_TIERS,
  SYSTEM_TEMPLATES
};

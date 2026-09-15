// utils/constants.js - 全局常量 · 对应 PRD 附录G 状态机 / 3.2 场景 / 3.4 AA档位 / 3.3 IM模板
// 严格遵守 .trae/rules.md 红线参数

// 订单状态机(PRD 3.5.2)：唯一 SSOT 为 config/enums.js 的 ORDER_STATUS（S0-S10 + S2.5/S3.5/S10.5）
// 此处仅为旧 pages/ 派生兼容视图 {code,name,color}，禁止再手写状态名/颜色；新增状态只改 enums.js
const { ORDER_STATUS: SSOT_ORDER_STATUS } = require('../config/enums.js');
// SSOT colorTag(var token) → 旧页五语义 class 键(warn/primary/danger/success/muted)
const SSOT_COLOR_TO_LEGACY = {
  'var(--func-warning)': 'warn',
  'var(--func-purple)': 'primary',
  'var(--func-info)': 'primary',
  'var(--func-danger)': 'danger',
  'var(--func-success)': 'success',
  'var(--text-4)': 'muted'
};
const ORDER_STATUS = Object.keys(SSOT_ORDER_STATUS).reduce((acc, key) => {
  const s = SSOT_ORDER_STATUS[key];
  acc[key] = { code: s.code, name: s.name, color: SSOT_COLOR_TO_LEGACY[s.colorTag] || 'muted' };
  return acc;
}, {});

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

// 服务动态话题白名单(MVP · 预设话题, 不支持自由输入; name 必须与 blog-action 云函数 TOPIC_WHITELIST 完全一致)
const BLOG_TOPICS = [
  { name: '陪诊日常', icon: '🏥' },
  { name: '学习陪伴', icon: '📚' },
  { name: '生活协助', icon: '🛠️' },
  { name: '出行陪伴', icon: '🚗' },
  { name: '线上陪伴', icon: '💬' },
  { name: '服务心得', icon: '💡' },
  { name: '暖心瞬间', icon: '💛' }
];

// AA 档位值转中文文案(兼容旧数据直接存中文文案的情况)
function aaTierLabel(tier) {
  if (!tier) return '';
  const hit = AA_TIERS.find((t) => t.value === tier);
  return hit ? hit.label : tier;
}

module.exports = {
  ORDER_STATUS,
  SCENE_LIST,
  BLOG_TOPICS,
  AA_TIERS,
  SYSTEM_TEMPLATES,
  aaTierLabel
};

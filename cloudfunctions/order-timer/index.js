// 对应 PRD 章节：PRD 8.3 订单超时与梯度退款统一规则
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  return { ok: false, code: 'NOT_IMPLEMENTED', msg: '功能开发中' };
};
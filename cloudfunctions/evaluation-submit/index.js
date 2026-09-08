// 对应 PRD 章节：PRD 3.3.4 评价与默认4星规则
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  return { ok: false, code: 'NOT_IMPLEMENTED', msg: '功能开发中' };
};
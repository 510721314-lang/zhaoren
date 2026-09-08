// 对应 PRD 章节：PRD 3.4 IM即时聊天系统/会话
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  return { ok: false, code: 'NOT_IMPLEMENTED', msg: '功能开发中' };
};
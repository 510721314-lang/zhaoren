// 对应 PRD 章节：PRD 5.1 B端后台RBAC权限模型(MVP最小后台)
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  return { ok: false, code: 'NOT_IMPLEMENTED', msg: '功能开发中' };
};
// 共享：测试数据打标(规范源/单一实现)
// ⚠️ 微信云开发按单函数目录打包, 不支持跨目录 require('../_shared/')。
// 本文件为「规范源」, 修改后需运行 sync-test-data.ps1 同步复制到:
//   cloudfunctions/demand-publish/test_data.js
//   cloudfunctions/order-create/test_data.js
//   cloudfunctions/admin-action/test_data.js
//   cloudfunctions/init-db/test_data.js
// 单测: 同目录 test_data.test.js (node --test)
// 机制(2026-10-06 D4-5): admin_config.test_openids 白名单内的身份,
// 建需求/建单时自动打 is_test=true → 供 purge_test_data(init-db) 精准清理,
// 绝不误删真实用户数据。白名单由 admin-action config_set 的
// test_openids_add / test_openids_remove 维护(与 block_words 同模式)。

// 身份是否命中测试白名单; config 缺失/字段非数组/空 openid → false(宁漏勿错)
function isTestOpenid(config, openid) {
  if (!openid || typeof openid !== 'string') return false;
  const list = (config && Array.isArray(config.test_openids)) ? config.test_openids : [];
  return list.indexOf(openid) >= 0;
}

// 多身份任一命中即打标(建单场景: 需求方或耍伴任一为测试身份 → 整单 is_test)
function isTestPair(config, openidA, openidB) {
  return isTestOpenid(config, openidA) || isTestOpenid(config, openidB);
}

module.exports = { isTestOpenid, isTestPair };

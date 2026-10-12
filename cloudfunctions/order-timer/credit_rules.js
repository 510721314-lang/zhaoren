// 共享：评价星级 → 信用分增量 纯规则(规范源/单一实现)
// ⚠️ 微信云开发按单函数目录打包, 不支持跨目录 require('../_shared/')。
// 本文件为「规范源」, 修改后需运行 sync-credit-rules.ps1 同步复制到:
//   cloudfunctions/evaluation-submit/credit_rules.js
//   cloudfunctions/order-timer/credit_rules.js
// 单测: 同目录 credit_rules.test.js (node --test)
// 抽取来源(2026-10-12 防漂移): evaluation-submit(用户评价) 与 order-timer(超时默认评价) 两处重复实现。
// 口径(冷启动期简化规则): 5星+2 / 4星+1 / 3星0 / 2星-2 / 其余(含1星)-5。

/**
 * 星级 → 信用分增量。
 * @param {number} star 星数(1-5)
 * @returns {number} 增量(可为负)
 */
function starCreditDelta(star) {
  const s = Number(star);
  if (s >= 5) return 2;
  if (s === 4) return 1;
  if (s === 3) return 0;
  if (s === 2) return -2;
  return -5;
}

module.exports = { starCreditDelta };

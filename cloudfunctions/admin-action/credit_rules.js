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

// ── 取消扣分梯度(2026-11-24 W2, 方案 docs/schemes/cancel-fulfillment-v2.2.md §5.1) ──
// 分值 SSOT = admin_config cancel_penalty_*(正数幅度), 此处为缺省兜底(与 §0.1 默认一致);
// 返回值为负增量(扣分); S0/S1 恒 0(D5 拍板, 未支付无损失, 固定规则不配置)。
// 档位线(far/mid 小时)与退款梯度同源(cancel_refund_far_hours/mid_hours), 由 cfg 传入保持单一来源。
const CANCEL_PENALTY_DEFAULTS = { s2_far: 5, s2_mid: 15, s2_near: 25, s3: 30, fulfill: 20 };
const CANCEL_TIER_HOURS_DEFAULTS = { far_hours: 24, mid_hours: 4 };

/**
 * 取消场景 → 发起方信用分增量(负值)。
 * @param {string} status   订单发起取消时的主轴状态(S0/S1 恒 0; S2/S2_6 按 leadMs 分档; S3 固定; 其余履约档固定)
 * @param {number} leadMs   履约开始时间 - 发起时刻(毫秒; 仅 S2/S2_6 分档用)
 * @param {Object|null} [cfg]  admin_config 展平配置 { s2_far, s2_mid, s2_near, s3, fulfill, far_hours, mid_hours }
 * @returns {number} 增量(≤0)
 */
function cancelCreditDelta(status, leadMs, cfg) {
  const o = cfg || {};
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  const p = {
    s2_far: num(o.s2_far, CANCEL_PENALTY_DEFAULTS.s2_far),
    s2_mid: num(o.s2_mid, CANCEL_PENALTY_DEFAULTS.s2_mid),
    s2_near: num(o.s2_near, CANCEL_PENALTY_DEFAULTS.s2_near),
    s3: num(o.s3, CANCEL_PENALTY_DEFAULTS.s3),
    fulfill: num(o.fulfill, CANCEL_PENALTY_DEFAULTS.fulfill)
  };
  const h = {
    far: num(o.far_hours, CANCEL_TIER_HOURS_DEFAULTS.far_hours),
    mid: num(o.mid_hours, CANCEL_TIER_HOURS_DEFAULTS.mid_hours)
  };
  if (status === 'S2' || status === 'S2_6') {
    const lead = Number(leadMs) || 0;
    const mag = lead >= h.far * 3600e3 ? p.s2_far
              : lead >= h.mid * 3600e3 ? p.s2_mid
              : p.s2_near;
    return mag === 0 ? 0 : -mag;   // 幅度 0(免罚) 归一为 +0, 防 -0 混入 credit_score_log
  }
  if (status === 'S3') return p.s3 === 0 ? 0 : -p.s3;
  if (['S2_5', 'S3_6', 'S3.5', 'S4'].indexOf(status) >= 0) return p.fulfill === 0 ? 0 : -p.fulfill;
  return 0;
}

module.exports = { starCreditDelta, cancelCreditDelta, CANCEL_PENALTY_DEFAULTS, CANCEL_TIER_HOURS_DEFAULTS };

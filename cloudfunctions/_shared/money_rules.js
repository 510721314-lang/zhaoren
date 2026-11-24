// @VERIFIED 2026-10-13 已真机验证：money_rules 退款上限(总额-已退,不含打赏)+部分退款非终态（依据：project_memory L41-52, L185-186）
// [2026-11-24 W2 头注释订正(评审#12)] 原文声称「S2梯度退款(用户全额/80%/50%, 耍伴全额+20%赔付)已真机验证」与实现不符：
//   归档验证记录对应 PRD 8.3 设计目标, 服务端此前无梯度实现(仅前端 config 展示)；现由本次新增 cancelRefundFen 承接。
//   「+20%赔付」与状态机 no.21「一期零赔付」拍板冲突——取消一律零现金赔付只扣信用分(B2/D2, 用户 2026-11-24 拍板)。
// 共享：资金规则纯函数库(规范源/单一实现)
// ⚠️ 微信云开发按单函数目录打包, 不支持跨目录 require('../_shared/')。
// 本文件为「规范源」, 修改后需运行 sync-money-rules.ps1 同步复制到:
//   cloudfunctions/payment-mock/money_rules.js
//   cloudfunctions/order-create/money_rules.js
//   cloudfunctions/order-action/money_rules.js
//   cloudfunctions/admin-action/money_rules.js   ← 2026-11-24 W2 新增目标(W4 裁决退款消费)
// 单测: 同目录 money_rules.test.js (node --test)
// 抽取来源(2026-10-06 D4-5 防漂移):
//   order-create L583 / order-action L347+L1135: 分账公式(三处重复)
//   payment-mock mock_tip: 打赏金额校验
//   payment-mock withdraw/fast_withdraw: 提现校验(基础段+余额段)
//   payment-mock balance_info/withdraw: 可提现余额公式(口径必须一致)

// ── JSDoc 契约类型(纯标注, 运行时零影响; 金额单位均为「分」) ──
/**
 * 分账结果。
 * @typedef {Object} SplitResult
 * @property {number} totalFen          订单总额(分)
 * @property {number} feeFen            平台佣金(分)
 * @property {number} partnerIncomeFen  耍伴实收(分)
 */
/**
 * 校验拒绝结果(通过时函数返回 null)。
 * @typedef {Object} ValidationError
 * @property {string} code  错误码(与线上历史值逐字一致, 前端依赖勿改)
 * @property {string} msg
 */
/**
 * 余额计算结果。
 * @typedef {Object} BalanceInfo
 * @property {number} settledFen     已结算收入(含打赏)
 * @property {number} tipFen         打赏部分
 * @property {number} processingFen  提现处理中占用
 * @property {number} withdrawnFen   已提现
 * @property {number} usedFen        占用合计(processing+success)
 * @property {number} availableFen   可提现余额(≥0)
 */

// ── 常量(与小程序 config/index.js 及 admin CONFIG_SCHEMA 对齐) ──
const TIP_MIN_FEN = 100;          // 打赏下限 1 元
const TIP_MAX_FEN = 50000;        // 打赏上限 500 元
const WD_MIN_FEN = 1000;          // 单次最低提现 10 元
const FAST_PER_ORDER_MAX_FEN = 20000;   // 极速提现单笔上限 200 元
const FAST_PER_DAY_MAX_FEN = 200000;    // 极速提现当日累计上限 2000 元
const DEFAULT_FEE_RATE_FEN = 1000;      // 平台抽成默认 1000(万分比 10%)

// ── 分账: 订单金额 → 平台佣金 + 耍伴实收 ──
// feeRateFen 为万分比; null/undefined/非法 → 回退默认 1000。
// ⚠️ 显式 0 是合法费率(免佣), 必须尊重 —— 修正历史上 `config.platform_fee_rate_fen || 1000`
//    把管理员配置的 0 误当缺省 1000 的隐患(与 readRateRange 的"0 是合法值"同类教训)。
/**
 * 订单金额分账: 总额 → 平台佣金 + 耍伴实收。
 * @param {number} totalFen    订单总额(分)
 * @param {number|null|undefined} feeRateFen  平台费率(万分比); 显式 0=免佣合法, null/缺省→默认 1000
 * @returns {SplitResult}
 */
function splitOrderAmount(totalFen, feeRateFen) {
  const total = Number(totalFen) || 0;
  // 注意 Number(null) === 0 的语言坑: 必须先判 null/undefined 再转数值, 否则缺省被误判成免佣
  const rate = (feeRateFen !== null && feeRateFen !== undefined && feeRateFen !== '')
    ? (Number.isFinite(Number(feeRateFen)) && Number(feeRateFen) >= 0 ? Number(feeRateFen) : DEFAULT_FEE_RATE_FEN)
    : DEFAULT_FEE_RATE_FEN;
  const feeFen = Math.round(total * rate / 10000);
  return { totalFen: total, feeFen, partnerIncomeFen: total - feeFen };
}

// ── 打赏金额校验(1-500 元整数; 与线上 Number() 预转换行为一致, '100' 可通过) ──
function isValidTipAmount(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= TIP_MIN_FEN && n <= TIP_MAX_FEN;
}

// ── 提现校验 · 基础段(串行锁之前执行: 格式 / 最低额 / 极速单笔上限) ──
// 返回 null = 通过; { code, msg } = 拒绝(code 与线上历史值逐字一致, 前端依赖勿改)
/**
 * 提现校验·基础段(格式/最低额/极速单笔上限)。
 * @param {number} amountFen  提现金额(分)
 * @param {Object} [opts]     { isFast, perOrderMaxFen }
 * @returns {ValidationError|null}
 */
function validateWithdrawBasic(amountFen, opts) {
  const o = opts || {};
  const amount = Number(amountFen);
  if (!Number.isInteger(amount) || amount <= 0) {
    return { code: 'wd_amount', msg: '提现金额格式有误' };
  }
  if (amount < WD_MIN_FEN) {
    return { code: 'wd_too_small', msg: '单次最低提现 10 元' };
  }
  if (o.isFast) {
    const cap = Number(o.perOrderMaxFen) > 0 ? Number(o.perOrderMaxFen) : FAST_PER_ORDER_MAX_FEN;
    if (amount > cap) {
      return { code: 'wd_fast_cap', msg: `极速提现单笔上限 ${cap / 100} 元` };
    }
  }
  return null;
}

// ── 提现校验 · 余额段(聚合查询后执行: 余额充足 / 极速当日累计) ──
// availableFen = 可提现余额(computeBalance().availableFen); todayFastFen = 当日已极速提现累计
/**
 * 提现校验·余额段(余额充足/极速当日累计)。
 * @param {number} amountFen  提现金额(分)
 * @param {Object} [opts]     { availableFen, isFast, perDayMaxFen, todayFastFen }
 * @returns {ValidationError|null}
 */
function validateWithdrawBalance(amountFen, opts) {
  const o = opts || {};
  const amount = Number(amountFen);
  if (!Number.isInteger(amount) || amount <= 0) {
    return { code: 'wd_amount', msg: '提现金额格式有误' };   // 防御: 单独调用时保持完整校验链
  }
  const available = Number(o.availableFen) || 0;
  if (amount > available) {
    return { code: 'wd_insufficient', msg: '可提现余额不足' };
  }
  if (o.isFast) {
    const perDay = Number(o.perDayMaxFen) > 0 ? Number(o.perDayMaxFen) : FAST_PER_DAY_MAX_FEN;
    const today = Number(o.todayFastFen) || 0;
    if (today + amount > perDay) {
      return { code: 'wd_fast_daily', msg: `极速提现当日累计上限 ${perDay / 100} 元` };
    }
  }
  return null;
}

// ── 余额计算(.balance_info 与 withdraw 共用同一口径, 防两处漂移) ──
// settledAgg: 聚合 group 首行 { total(服务收入), tip(打赏) } — 已结算状态 S8/S9/S10 口径由调用方保证
// withdrawGroups: withdraw_record 按 status 聚合 [{ _id, total }]; 占用 = processing + success
/**
 * 余额计算(.balance_info 与 withdraw 共用同一口径, 防两处漂移)。
 * @param {Object} [opts]  { settledAgg:{total,tip}, withdrawGroups:[{_id,total}] }
 * @returns {BalanceInfo}
 */
function computeBalance(opts) {
  const o = opts || {};
  const row = o.settledAgg || {};
  const tipFen = Number(row.tip) || 0;
  const settledFen = (Number(row.total) || 0) + tipFen;
  let processingFen = 0, withdrawnFen = 0;
  (Array.isArray(o.withdrawGroups) ? o.withdrawGroups : []).forEach((g) => {
    if (!g) return;
    if (g._id === 'processing') processingFen = Number(g.total) || 0;
    else if (g._id === 'success') withdrawnFen = Number(g.total) || 0;
  });
  const usedFen = processingFen + withdrawnFen;
  const availableFen = Math.max(0, settledFen - usedFen);
  return { settledFen, tipFen, processingFen, withdrawnFen, usedFen, availableFen };
}

// ── 聚合首行求和({ total, tip }) · splitting/月度等同类口径复用 ──
function aggRowSum(row) {
  if (!row) return 0;
  return (Number(row.total) || 0) + (Number(row.tip) || 0);
}

// ── 取消梯度退款(2026-11-24 W2, 方案 docs/schemes/cancel-fulfillment-v2.2.md §4.1) ──
// 档位 SSOT = admin_config cancel_refund_* 键(百分数存储), 此处为缺省兜底(与 §0.1 默认一致);
// 服务端读取处把 pct/100 后传入, 或直接传原始 cfg 由 normalize 归一(两种字段名都认)。
// 基准一律 fund.paid_fen(防加时 total_fen 高估); leadMs = 履约开始时间 - 同意时刻(不按申请时刻, N10)。
const CANCEL_REFUND_DEFAULTS = { far_hours: 24, far_rate: 1.0, mid_hours: 4, mid_rate: 0.8, near_rate: 0.5 };

/**
 * 归一化取消退款档位配置(缺省/非法字段回退兜底默认; 0 档线非法回退, 比例钳制 [0,1])。
 * @param {Object|null} cfg  admin_config 展平后的 { far_hours, mid_hours, far_rate, mid_rate, near_rate }
 * @returns {Object}
 */
function normalizeCancelRefundCfg(cfg) {
  const o = cfg || {};
  const hours = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  const rate = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1 ? Number(v) : d);
  return {
    far_hours: hours(o.far_hours, CANCEL_REFUND_DEFAULTS.far_hours),
    mid_hours: hours(o.mid_hours, CANCEL_REFUND_DEFAULTS.mid_hours),
    far_rate: rate(o.far_rate, CANCEL_REFUND_DEFAULTS.far_rate),
    mid_rate: rate(o.mid_rate, CANCEL_REFUND_DEFAULTS.mid_rate),
    near_rate: rate(o.near_rate, CANCEL_REFUND_DEFAULTS.near_rate)
  };
}

/**
 * 取消梯度退款金额: paid_fen × 档位比例(按 leadMs 命中远/中/近档)。
 * @param {number} paidFen      已付金额(分, 基准一律 fund.paid_fen)
 * @param {number} leadMs       履约开始时间 - 同意时刻(毫秒, ≥0)
 * @param {Object|null} cfg     admin_config 档位(缺省走兜底)
 * @returns {number} refund_fen(≥0, 四舍五入)
 */
function cancelRefundFen(paidFen, leadMs, cfg) {
  const c = normalizeCancelRefundCfg(cfg);
  const paid = Number(paidFen) || 0;
  const lead = Number(leadMs) || 0;
  const r = lead >= c.far_hours * 3600e3 ? c.far_rate
          : lead >= c.mid_hours * 3600e3 ? c.mid_rate
          : c.near_rate;
  return Math.max(0, Math.round(paid * r));
}

/**
 * 可退上限: 防超额退(refund_fen 不得超过本值; fund 纵深防御外仍需 CAS 串行门, 方案 §4.2)。
 * @param {number} paidFen             已付金额(分)
 * @param {number} alreadyRefundedFen  已退金额(分, 读云端当前值, 不用客户端陈旧值)
 * @returns {number} cap(≥0)
 */
function refundCap(paidFen, alreadyRefundedFen) {
  const paid = Number(paidFen) || 0;
  const already = Number(alreadyRefundedFen) || 0;
  return Math.max(0, paid - already);
}

module.exports = {
  TIP_MIN_FEN, TIP_MAX_FEN, WD_MIN_FEN,
  FAST_PER_ORDER_MAX_FEN, FAST_PER_DAY_MAX_FEN, DEFAULT_FEE_RATE_FEN,
  CANCEL_REFUND_DEFAULTS,
  splitOrderAmount, isValidTipAmount,
  validateWithdrawBasic, validateWithdrawBalance,
  computeBalance, aggRowSum,
  normalizeCancelRefundCfg, cancelRefundFen, refundCap
};

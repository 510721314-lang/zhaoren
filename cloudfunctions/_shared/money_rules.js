// 共享：资金规则纯函数库(规范源/单一实现)
// ⚠️ 微信云开发按单函数目录打包, 不支持跨目录 require('../_shared/')。
// 本文件为「规范源」, 修改后需运行 sync-money-rules.ps1 同步复制到:
//   cloudfunctions/payment-mock/money_rules.js
//   cloudfunctions/order-create/money_rules.js
//   cloudfunctions/order-action/money_rules.js
// 单测: 同目录 money_rules.test.js (node --test)
// 抽取来源(2026-10-06 D4-5 防漂移):
//   order-create L583 / order-action L347+L1135: 分账公式(三处重复)
//   payment-mock mock_tip: 打赏金额校验
//   payment-mock withdraw/fast_withdraw: 提现校验(基础段+余额段)
//   payment-mock balance_info/withdraw: 可提现余额公式(口径必须一致)

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

module.exports = {
  TIP_MIN_FEN, TIP_MAX_FEN, WD_MIN_FEN,
  FAST_PER_ORDER_MAX_FEN, FAST_PER_DAY_MAX_FEN, DEFAULT_FEE_RATE_FEN,
  splitOrderAmount, isValidTipAmount,
  validateWithdrawBasic, validateWithdrawBalance,
  computeBalance, aggRowSum
};

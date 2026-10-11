// admin-action · 财务概览 finance_stats（服务端 aggregate；从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function finance_stats(ctx) {
  const { event, todayStart, _, $, col, dayKey, fail, ok } = ctx;
  const MAX_DAYS = 90;
  const TREND_CAP = 5000;
  let startTs;
  let rangeEnd;
  if (event.start_ts !== undefined || event.end_ts !== undefined) {
    const s = parseInt(event.start_ts, 10);
    const e = parseInt(event.end_ts, 10);
    if (!Number.isInteger(s) || !Number.isInteger(e) || s >= e) {
      return fail('fs_bad_range', 'start_ts/end_ts 须为整数毫秒且 start < end');
    }
    if (e - s > MAX_DAYS * 86400000) return fail('fs_range_too_long', '区间最长 90 天');
    if (s < 1577808000000) return fail('fs_bad_start', '开始时间不合理');
    if (e > Date.now() + 86400000) return fail('fs_bad_end', '结束时间不能晚于明天');
    startTs = s; rangeEnd = e;
  } else {
    let days = parseInt(event.days, 10);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) days = 30;
    startTs = todayStart() - (days - 1) * 86400000;
    rangeEnd = todayStart() + 86400000;
  }
  const start0 = new Date(startTs); start0.setHours(0, 0, 0, 0);
  startTs = start0.getTime();

  const win = [{ created_at: _.gte(startTs) }, { created_at: _.lt(rangeEnd) }];
  const txBase = { status: 'success', is_deleted: _.neq(true) };
  const incomeBase = { status: _.in(['S8', 'S9', 'S10']), is_deleted: _.neq(true) };
  const [typeAgg, incomeAgg, trendR, payCnt, refundCnt, incomeCnt] = await Promise.all([
    col('pay_transaction').aggregate()
      .match(_.and([txBase].concat(win)))
      .group({ _id: '$type', total: $.sum('$amount_fen'), fee: $.sum('$fee_fen') })
      .end().catch(() => ({ list: [] })),
    col('order_main').aggregate()
      .match(_.and([incomeBase].concat(win)))
      .group({ _id: null, income: $.sum('$partner_income_fen') })
      .end().catch(() => ({ list: [] })),
    col('pay_transaction').where({
      type: _.in(['pay', 'refund']), status: 'success', is_deleted: _.neq(true),
      created_at: _.gte(startTs)
    }).limit(TREND_CAP).get().catch(() => ({ data: [] })),
    col('pay_transaction').where(_.and([Object.assign({}, txBase, { type: 'pay' })].concat(win))).count().catch(() => ({ total: 0 })),
    col('pay_transaction').where(_.and([Object.assign({}, txBase, { type: 'refund' })].concat(win))).count().catch(() => ({ total: 0 })),
    col('order_main').where(_.and([incomeBase].concat(win))).count().catch(() => ({ total: 0 }))
  ]);
  const typeMap = {};
  (typeAgg.list || []).forEach((r) => { typeMap[r._id] = r; });
  const pay = typeMap.pay || { total: 0, fee: 0 };
  const refund = typeMap.refund || { total: 0, fee: 0 };
  const tip = typeMap.tip || { total: 0, fee: 0 };
  const incomeRow = (incomeAgg.list || [])[0] || { income: 0 };

  const days = [];
  for (let t = startTs; t < rangeEnd; t += 86400000) days.push(dayKey(t));
  const gmvB = {}, refundB = {}, cntB = {};
  days.forEach((d) => { gmvB[d] = 0; refundB[d] = 0; cntB[d] = 0; });
  (trendR.data || []).forEach((t) => {
    const k = dayKey(t.paid_at || t.created_at);
    if (gmvB[k] === undefined) return;
    if (t.type === 'pay') { gmvB[k] += (t.amount_fen || 0); cntB[k] += 1; }
    else if (t.type === 'refund') refundB[k] += (t.amount_fen || 0);
  });

  return ok({
    range: { start_ts: startTs, end_ts: rangeEnd, days: days.length },
    summary: {
      gmv_fen: pay.total || 0,
      refund_fen: refund.total || 0,
      net_gmv_fen: (pay.total || 0) - (refund.total || 0),
      tip_fen: tip.total || 0,
      platform_fee_fen: pay.fee || 0,
      partner_income_fen: incomeRow.income || 0,
      partner_order_count: incomeCnt.total || 0,
      pay_count: payCnt.total || 0,
      refund_count: refundCnt.total || 0
    },
    trend: {
      days,
      gmv_fen: days.map((d) => gmvB[d]),
      refund_fen: days.map((d) => refundB[d]),
      pay_count: days.map((d) => cntB[d])
    },
    trend_truncated: (trendR.data || []).length >= TREND_CAP
  });
}

module.exports = { finance_stats };

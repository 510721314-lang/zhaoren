// admin-action · 数据看板 dashboard（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function dashboard(ctx) {
  const { todayStart, col, _, ACTIVE_STATUS, now, sumTx, last7Days, bucketCount, bucketFen, ok } = ctx;
  const t7 = todayStart() - 6 * 86400000;
  const [userR, partnerR, reviewR, demandR, activeR, disputeR,
    users7, demands7, orders7, pays7, reportR, payExpiredR,
    payAgg, refundAgg, tipAgg] = await Promise.all([
    col('user_account').where({ is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
    col('partner_profile').where({ status: 'approved', is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
    col('partner_profile').where({ status: 'pending_review', is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
    col('demand').where({ created_at: _.gte(todayStart()), is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
    col('order_main').where({ status: _.in(ACTIVE_STATUS), is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
    col('order_main').where({ status: 'S10.5', is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
    col('user_account').where({ created_at: _.gte(t7), is_deleted: _.neq(true) }).limit(1000).get().catch(() => ({ data: [] })),
    col('demand').where({ created_at: _.gte(t7), is_deleted: _.neq(true) }).limit(1000).get().catch(() => ({ data: [] })),
    col('order_main').where({ created_at: _.gte(t7), is_deleted: _.neq(true) }).limit(1000).get().catch(() => ({ data: [] })),
    col('pay_transaction').where({ type: 'pay', status: 'success', created_at: _.gte(t7), is_deleted: _.neq(true) }).limit(1000).get().catch(() => ({ data: [] })),
    col('safety_report').where({ status: 'active', is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
    col('order_main').where({ status: 'S0', pay_expire_at: _.lt(now), is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
    sumTx('pay', now - 90 * 86400000), sumTx('refund', now - 90 * 86400000), sumTx('tip', now - 90 * 86400000)
  ]);
  const days = last7Days();
  return ok({
    user_count: userR.total || 0,
    partner_count: partnerR.total || 0,
    today_demand_count: demandR.total || 0,
    active_order_count: activeR.total || 0,
    pending_review_count: reviewR.total || 0,
    dispute_count: disputeR.total || 0,
    gmv_fen: payAgg.total || 0,
    trend: {
      days,
      users: bucketCount(days, users7.data, 'created_at'),
      demands: bucketCount(days, demands7.data, 'created_at'),
      orders: bucketCount(days, orders7.data, 'created_at'),
      gmv_fen: bucketFen(days, pays7.data)
    },
    todo: {
      pending_review: reviewR.total || 0,
      dispute: disputeR.total || 0,
      report_active: reportR.total || 0,
      pay_expired: payExpiredR.total || 0
    },
    finance: {
      gmv_fen: payAgg.total || 0,
      refund_fen: refundAgg.total || 0,
      tip_fen: tipAgg.total || 0,
      fee_fen: payAgg.fee || 0
    }
  });
}

module.exports = { dashboard };

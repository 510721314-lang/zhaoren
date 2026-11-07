// T-7.26(2026-11-07): 自 zz-seed-orders/index.js 物理拆分(逐字搬移, 零行为变更)。
// 红线: 禁止 require('./index')(循环引用); 依赖一律经 ctx 注入。

// ── 兼容旧[种子]路径(早期视觉测试用, 已废弃) ──

async function run_count(ctx) {
  const { event, db, _, openid, simOpenids, softDeleteAll } = ctx;

  const n = (await db.collection('demand').where({ creator_openid: openid, remark: db.RegExp({ regexp: '^\\[种子' }), is_deleted: false }).count());
  return { ok: true, data: { count: n.total } };
}


async function run_cleanup(ctx) {
  const { event, db, _, openid, simOpenids, softDeleteAll } = ctx;

  const r = await db.collection('demand').where({ creator_openid: openid, remark: db.RegExp({ regexp: '^\\[种子' }), is_deleted: false })
    .update({ data: { is_deleted: true, updated_at: Date.now() } });
  return { ok: true, data: { cleaned: !!(r.stats && r.stats.updated > 0) } };
}


// ── simulate 批次统计 ──

async function run_count_sim(ctx) {
  const { event, db, _, openid, simOpenids, softDeleteAll } = ctx;

  const n = (await db.collection('demand').where({ creator_openid: _.in(simOpenids), is_deleted: false }).count());
  return { ok: true, data: { count: n.total, users: simOpenids.length } };
}


// ── cleanup_sim: 软删虚拟用户 + 其名下全部需求 ──

async function run_cleanup_sim(ctx) {
  const { event, db, _, openid, simOpenids, softDeleteAll } = ctx;

  const [demands, users] = await Promise.all([
    softDeleteAll('demand', { creator_openid: _.in(simOpenids), is_deleted: false }, 'is_deleted'),
    softDeleteAll('user_account', { openid: _.in(simOpenids), is_deleted: false }, 'is_deleted')
  ]);
  return { ok: true, data: { cleaned_demands: demands, cleaned_users: users } };
}


// ── fix_sdm_city: 把 sdm-* 种子需求的城市字段统一改为实际城市(历史 city 与坐标不符时用) ──

async function run_fix_sdm_city(ctx) {
  const { event, db, _, openid, simOpenids, softDeleteAll } = ctx;

  const city = String(event.city || '重庆市').trim();
  const re = db.RegExp({ regexp: '^sdm-' });
  let updated = 0;
  try {
    const r = await db.collection('demand').where({ client_request_id: re, is_deleted: false })
      .update({ data: { 'location.city': city, 'publish_location.city': city, updated_at: Date.now() } });
    updated = (r.stats && r.stats.updated) || 0;
  } catch (e) { return { ok: false, code: 'fix_city_fail', msg: e && e.message }; }
  return { ok: true, data: { updated, city, hint: 'sdm-* 种子需求城市已统一' } };
}


// ── cleanup_seed_orders: 软删种子订单(svo-*/nto-ord-*)及配套需求/确认/流水 ──
// 用途: 清空指定耍伴名下的种子订单, 恢复可抢单状态; 不传 partner_openid 则清全部

async function run_cleanup_seed_orders(ctx) {
  const { event, db, _, openid, simOpenids, softDeleteAll } = ctx;

  const partner = event.partner_openid ? String(event.partner_openid) : '';
  const cridRe = db.RegExp({ regexp: '^(svo|nto-ord)' });
  let cleanedOrders = 0, cleanedDemands = 0, cleanedMeta = 0;
  // 订单: crid 前缀 + 可选指定耍伴
  const oWhere = { is_deleted: _.neq(true), client_request_id: cridRe };
  if (partner) oWhere.partner_openid = partner;
  let orderIds = [];
  try {
    const or = await db.collection('order_main').where(oWhere).field({ _id: true, client_request_id: true }).limit(200).get();
    orderIds = (or.data || []).map((x) => x._id);
    if (orderIds.length) {
      const upd = await db.collection('order_main').where({ _id: _.in(orderIds) })
        .update({ data: { is_deleted: true, updated_at: Date.now() } });
      cleanedOrders = (upd.stats && upd.stats.updated) || 0;
    }
  } catch (e) { /* ignore */ }
  if (orderIds.length) {
    await Promise.all(['order_confirmations', 'order_status_log'].map((c) =>
      db.collection(c).where({ order_id: _.in(orderIds) }).update({ data: { is_deleted: true, updated_at: Date.now() } }).catch(() => {})
    ));
  }
  // 配套需求: crid ^(svo|nto-ord)-d(带 -d 后缀)
  try {
    const upd = await db.collection('demand').where({ is_deleted: _.neq(true), client_request_id: db.RegExp({ regexp: '^(svo|nto-ord)-' }) })
      .update({ data: { is_deleted: true, updated_at: Date.now() } });
    cleanedDemands = (upd.stats && upd.stats.updated) || 0;
  } catch (e) { /* ignore */ }
  return { ok: true, data: { cleaned_orders: cleanedOrders, cleaned_meta: cleanedMeta, cleaned_demands: cleanedDemands, partner, hint: '种子订单已软删, 该账号恢复可抢单' } };
}


// ── backfill_matched: 一次性补全历史需求 matched_openid(曾因 CAS 漏写全部为空) ──
// 全量扫描式: 逐页扫 matched 需求, 空值按配套订单 partner_openid 回填(幂等); found=0 即完成

async function run_backfill_matched(ctx) {
  const { event, db, _, openid, simOpenids, softDeleteAll } = ctx;

  let filled = 0, found = 0, matchedTotal = 0, sk = 0;
  try {
    while (sk < 500) {
      const p = await db.collection('demand').where({ status: 'matched', is_deleted: _.neq(true) }).skip(sk).limit(100).get().catch(() => ({ data: [] }));
      if (!p.data || !p.data.length) break;
      matchedTotal += p.data.length;
      for (const d of p.data) {
        if (d.matched_openid) continue;
        found++;
        const ex = await db.collection('order_main').where({ demand_id: d._id, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
        if (ex.data && ex.data[0] && ex.data[0].partner_openid) {
          await db.collection('demand').doc(d._id).update({
            data: { matched_openid: ex.data[0].partner_openid, updated_at: Date.now() }
          }).catch(() => {});
          filled++;
        }
      }
      sk += 100;
    }
    return { ok: true, data: { filled, found, matched_total: matchedTotal, hint: 'found=0 即全部健康; 本轮回填 filled 条' } };
  } catch (e) {
    return { ok: false, code: 'backfill_fail', msg: e && e.message };
  }
}

module.exports = { count: run_count, cleanup: run_cleanup, count_sim: run_count_sim, cleanup_sim: run_cleanup_sim, fix_sdm_city: run_fix_sdm_city, cleanup_seed_orders: run_cleanup_seed_orders, backfill_matched: run_backfill_matched };

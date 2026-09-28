// zz-clean-n8b 临时数据清理(N8b 打赏污染 · 2026-09-28 提审前治理) · 用后即删
// 背景: 订单 a9defcfd6aa20230011cfea075899ac6(S9) 被 mock 打赏 1250 分(tip_no=TIP202609275612e18196f78237)
// action=clean  ① pay_transaction tip 流水软删 ② order_main.tip_total_fen 回滚-1250 ③ system_notice type=tip 软删 ④ audit_log 保留(保审计链, 业务侧已无痕迹)
// action=verify 清理后核对(各集合现状)
// 守卫: resolveOpenid; mock_openid 仅 env=dev 放行(openid.js); prod fail-closed
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);

const ORDER_ID = 'a9defcfd6aa20230011cfea075899ac6';
const TIP_PAY_NO = 'TIP202609275612e18196f78237';
const TIP_FEN = 1250;
const MOCK_OPENID = 'oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c'; // 本环境真实管理员(实测放行)

exports.main = async (event, context) => {
  const { resolveOpenid } = require('./openid');
  const openid = await resolveOpenid(cloud, event).catch(() => '');
  if (!openid) return { ok: false, code: 'no_openid', msg: '无身份(仅 dev mock 或真实身份可调用)' };

  const action = event.action;
  const now = Date.now();

  // ── clean: 3 处软删/回滚(幂等: 重复执行结果一致) ──
  if (action === 'clean') {
    const out = {};

    // ① pay_transaction tip 流水软删
    let txUpdated = 0;
    try {
      const txR = await col('pay_transaction').where({
        pay_no: TIP_PAY_NO, is_deleted: _.neq(true)
      }).get();
      const txDocs = txR.data || [];
      for (const t of txDocs) {
        await col('pay_transaction').doc(t._id).update({ data: { is_deleted: true, updated_at: now } });
        txUpdated++;
      }
      out.tx_found = txDocs.length;
      out.tx_soft_deleted = txUpdated;
    } catch (e) { out.tx = 'fail:' + (e.message || e); }

    // ② order_main.tip_total_fen 回滚 -1250(下限 0, 幂等)
    try {
      const o = (await col('order_main').doc(ORDER_ID).get().catch(() => ({ data: null }))).data;
      if (o) {
        const cur = Number(o.tip_total_fen) || 0;
        const target = Math.max(0, cur - TIP_FEN);
        await col('order_main').doc(ORDER_ID).update({ data: { tip_total_fen: target, updated_at: now } });
        out.order_before = cur;
        out.order_after = target;
      } else { out.order = 'not_found'; }
    } catch (e) { out.order = 'fail:' + (e.message || e); }

    // ③ system_notice type=tip 软删
    let noticeUpdated = 0;
    try {
      const nR = await col('system_notice').where({
        order_id: ORDER_ID, type: 'tip', is_deleted: _.neq(true)
      }).get();
      const nDocs = nR.data || [];
      for (const n of nDocs) {
        await col('system_notice').doc(n._id).update({ data: { is_deleted: true, updated_at: now } });
        noticeUpdated++;
      }
      out.notice_found = nDocs.length;
      out.notice_soft_deleted = noticeUpdated;
    } catch (e) { out.notice = 'fail:' + (e.message || e); }

    // ④ audit_log 保留(注释说明: 软删会断 audit_verify 哈希链, 业务侧已无痕迹)
    out.audit_policy = 'retained (keep audit chain integrity); mock_tip 审计记录仍在但业务不可见';

    return { ok: true, data: out };
  }

  // ── verify: 清理后核对 ──
  if (action === 'verify') {
    const out = {};
    const txR = await col('pay_transaction').where({ pay_no: TIP_PAY_NO }).limit(10).get().catch(() => ({ data: [] }));
    out.tx_records = (txR.data || []).map(t => ({ _id: t._id, is_deleted: t.is_deleted, amount_fen: t.amount_fen }));
    const o = (await col('order_main').doc(ORDER_ID).get().catch(() => ({ data: null }))).data;
    out.order = o ? { _id: o._id, status: o.status, tip_total_fen: o.tip_total_fen } : 'not_found';
    const nR = await col('system_notice').where({ order_id: ORDER_ID, type: 'tip' }).limit(10).get().catch(() => ({ data: [] }));
    out.tip_notices = (nR.data || []).map(n => ({ _id: n._id, is_deleted: n.is_deleted }));
    return { ok: true, data: out };
  }

  return { ok: false, code: 'unknown_action', msg: '仅支持 clean / verify' };
};
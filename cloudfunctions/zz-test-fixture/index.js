// zz-test-fixture 临时测试数据生成(2026-09-28 规则15 负向测试用) · 用后即删
// 背景: 云端手工编辑 order_main 多次出错(string vs number/漏保存), 改为代码一次性生成
// action=create: 修复 f9ecc4af 的 interrupted_at 为纯数字 + 新建 N1(S1)/N2(S0) 测试文档
// action=verify: 查询 3 单当前 status(定时器处理后应为 S6/S6/S4)
// 守卫: 仅 env=dev 放行(openid.js resolveOpenid fail-closed); prod 拒绝
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);

// 时间戳固定值(与本次测试一致): now≈1790563000000
const T_CREATED = 1790562038420; // 16 分钟前(超 S1 的 15min 阈值)
const T_PAY_EXP = 1790562938420; // 1 分钟前(S0 已过期)
const T_INTERRUPTED = 1790472998420; // ~27.7h 前(超 S3.5 的 24h 阈值)
const N4_ID = 'f9ecc4af6aa0d0c108aae3ed47616862';

exports.main = async (event, context) => {
  const { resolveOpenid } = require('./openid');
  const openid = await resolveOpenid(cloud, event).catch(() => '');
  if (!openid) return { ok: false, code: 'no_openid', msg: '无身份(prod 禁止/undev 无 mock)' };

  const action = event.action;
  const now = Date.now();

  // ── create: 造 3 单 ──
  if (action === 'create') {
    const out = {};
    // 1) 修复 N4(f9ecc4af) interrupted_at 为纯数字 + 确保 status=S3.5
    try {
      await col('order_main').doc(N4_ID).update({ data: {
        status: 'S3.5',
        interrupted_at: T_INTERRUPTED,
        updated_at: now
      } });
      out.n4 = 'ok';
    } catch (e) { out.n4 = 'fail:' + (e.message || e); }

    // 2) 新建 N1(S1)
    try {
      const r = await col('order_main').add({ data: {
        status: 'S1', created_at: T_CREATED, updated_at: now,
        user_openid: openid, partner_openid: openid,
        scene: 'W11', order_no: 'ORD20260928000001', is_deleted: false
      } });
      out.n1 = r._id;
    } catch (e) { out.n1 = 'fail:' + (e.message || e); }

    // 3) 新建 N2(S0)
    try {
      const r = await col('order_main').add({ data: {
        status: 'S0', pay_expire_at: T_PAY_EXP, created_at: T_CREATED, updated_at: now,
        user_openid: openid, partner_openid: openid,
        scene: 'W11', order_no: 'ORD20260928000002', is_deleted: false
      } });
      out.n2 = r._id;
    } catch (e) { out.n2 = 'fail:' + (e.message || e); }

    return { ok: true, data: out };
  }

  // ── verify: 查 3 单当前 status ──
  if (action === 'verify') {
    const out = {};
    const n4 = await col('order_main').doc(N4_ID).get().catch(() => ({ data: null }));
    out.n4 = n4.data ? { order_no: n4.data.order_no, status: n4.data.status } : 'not_found';
    for (const no of ['ORD20260928000001', 'ORD20260928000002']) {
      const r = await col('order_main').where({ order_no: no, is_deleted: false }).limit(1).get().catch(() => ({ data: [] }));
      out[no] = (r.data && r.data[0])
        ? { _id: r.data[0]._id, status: r.data[0].status }
        : 'not_found';
    }
    return { ok: true, data: out };
  }

  return { ok: false, code: 'unknown_action', msg: '仅支持 create / verify' };
};
// 对应 PRD 章节：3.5.1 资金担保与分账架构 / 8.4 退款规则 / 3.4 AA费用 / 附录G 状态机
// payment-mock 模拟支付与退款(MVP 无真实微信支付,一律 is_mock=true)
// 3 个 action: cashier_info(收银台摘要) / mock_pay(模拟支付) / mock_refund(模拟全额退款)
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);

const SCENE_NAMES = { W1: '就医陪诊', W2: '学习陪伴', W8: '生活协助', W10: '出行陪伴', W11: '线上陪伴' };

async function getConfig() {
  try {
    const r = await col('admin_config').where({ _id: 'global' }).limit(1).get();
    if (r.data && r.data[0]) return r.data[0];
  } catch (e) {}
  return { s0_timeout_min: 30 };
}

function genPayNo(prefix) {
  const d = new Date();
  const pad = (n) => n < 10 ? '0' + n : '' + n;
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const r = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}${ymd}${r}`;
}

async function getOrder(orderId) {
  try {
    const r = await col('order_main').doc(orderId).get();
    return r.data || null;
  } catch (e) {
    return null;
  }
}

// 写状态流水
async function logStatus(orderId, from, to, action, operator) {
  await col('order_status_log').add({ data: {
    order_id: orderId, from_status: from, to_status: to,
    action, operator,
    created_at: Date.now(), updated_at: Date.now(), is_deleted: false
  }});
}

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID;
  if (!openid) return { ok: false, code: 'pay_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  console.log(`payment-mock action=${action} openid=${openid}`);

  switch (action) {

    // 1. 收银台摘要(仅订单 user 可看)
    case 'cashier_info': {
      const { order_id } = event;
      if (!order_id) return { ok: false, code: 'cashier_no_order', msg: '缺少订单 ID' };
      const order = await getOrder(order_id);
      if (!order) return { ok: false, code: 'cashier_not_found', msg: '订单不存在' };
      if (order.user_openid !== openid) {
        return { ok: false, code: 'cashier_not_owner', msg: '只能查看自己的订单' };
      }

      const config = await getConfig();
      const sceneList = config.scene_list || [];
      const sceneConf = sceneList.find(s => s.code === order.scene) || {};
      const needAaPromise = !!order.aa_tier && order.aa_tier !== '0-50元';

      return {
        ok: true,
        data: {
          order_id: order._id,
          order_no: order.order_no,
          scene_code: order.scene,
          scene_name: sceneConf.name || SCENE_NAMES[order.scene] || order.scene,
          content_options: order.content_options || [],
          start_time: order.start_time,
          duration_h: order.duration_h,
          location: order.location,
          total_fen: order.total_fen,
          fee_fen: order.fee_fen,
          aa_tier: order.aa_tier || '',
          need_aa_promise: needAaPromise,
          status: order.status,
          pay_expire_at: order.pay_expire_at,
          is_mock: true
        }
      };
    }

    // 2. 模拟支付
    case 'mock_pay': {
      const { order_id, aa_promise_checked } = event;
      if (!order_id) return { ok: false, code: 'pay_no_order', msg: '缺少订单 ID' };

      const order = await getOrder(order_id);
      if (!order) return { ok: false, code: 'pay_not_found', msg: '订单不存在' };
      if (order.user_openid !== openid) {
        return { ok: false, code: 'pay_not_owner', msg: '只能支付自己的订单' };
      }

      // 幂等:已有 success 支付流水直接返回成功(不重复执行)
      try {
        const exist = await col('pay_transaction').where({
          order_id, type: 'pay', status: 'success', is_deleted: false
        }).limit(1).get();
        if (exist.data && exist.data.length > 0) {
          console.log(`mock_pay idempotent hit: ${order.order_no}`);
          return { ok: true, data: { order_id, order_no: order.order_no, status: order.status, idempotent: true } };
        }
      } catch (e) {}

      if (order.status !== 'S0') {
        return { ok: false, code: 'pay_status', msg: `订单当前状态(${order.status})不可支付` };
      }
      if (order.pay_expire_at && order.pay_expire_at < Date.now()) {
        return { ok: false, code: 'pay_expired', msg: '支付超时,请重新下单' };
      }
      // AA 承诺书:非 0-50 元档位必须勾选
      if (order.aa_tier && order.aa_tier !== '0-50元' && !aa_promise_checked) {
        return { ok: false, code: 'pay_aa_promise', msg: '请先阅读并同意《线下费用自理承诺书》' };
      }

      const now = Date.now();
      const payNo = genPayNo('PAY');

      try {
        // 支付流水(is_mock=true)
        await col('pay_transaction').add({ data: {
          pay_no: payNo,
          order_id,
          order_no: order.order_no,
          type: 'pay',
          amount_fen: order.total_fen,
          fee_fen: order.fee_fen,
          channel: 'mock',
          is_mock: true,
          status: 'success',
          paid_at: now,
          created_at: now, updated_at: now, is_deleted: false
        }});

        // 订单 → S2(已支付待履约)
        await col('order_main').doc(order_id).update({ data: {
          status: 'S2', updated_at: now
        }});

        // 状态流水 S0 → S2
        await logStatus(order_id, 'S0', 'S2', 'mock_pay', openid);

        console.log(`mock_pay success: ${order.order_no} pay_no=${payNo}`);
        return {
          ok: true,
          data: { order_id, order_no: order.order_no, pay_no: payNo, status: 'S2', is_mock: true }
        };
      } catch (e) {
        console.log(`mock_pay fail: ${e.message}`);
        return { ok: false, code: 'pay_db_fail', msg: '支付失败,请稍后重试' };
      }
    }

    // 3. 模拟全额退款(本期自动全额退款;demand 保持 matched)
    case 'mock_refund': {
      const { order_id } = event;
      if (!order_id) return { ok: false, code: 'refund_no_order', msg: '缺少订单 ID' };

      const order = await getOrder(order_id);
      if (!order) return { ok: false, code: 'refund_not_found', msg: '订单不存在' };
      if (order.user_openid !== openid) {
        return { ok: false, code: 'refund_not_owner', msg: '只能对自己的订单申请退款' };
      }
      if (['S2', 'S3'].indexOf(order.status) < 0) {
        return { ok: false, code: 'refund_status', msg: `订单当前状态(${order.status})不可退款` };
      }

      // 幂等:已有退款流水直接返回
      try {
        const exist = await col('pay_transaction').where({
          order_id, type: 'refund', status: 'success', is_deleted: false
        }).limit(1).get();
        if (exist.data && exist.data.length > 0) {
          console.log(`mock_refund idempotent hit: ${order.order_no}`);
          return { ok: true, data: { order_id, order_no: order.order_no, status: 'S7', idempotent: true } };
        }
      } catch (e) {}

      const now = Date.now();
      const refundNo = genPayNo('REF');
      const fromStatus = order.status;

      try {
        // 退款流水(全额,is_mock=true)
        await col('pay_transaction').add({ data: {
          pay_no: refundNo,
          order_id,
          order_no: order.order_no,
          type: 'refund',
          amount_fen: order.total_fen,
          channel: 'mock',
          is_mock: true,
          status: 'success',
          paid_at: now,
          created_at: now, updated_at: now, is_deleted: false
        }});

        // 订单 → S7(已退款);demand 保持 matched
        await col('order_main').doc(order_id).update({ data: {
          status: 'S7', updated_at: now
        }});

        // 状态流水 S? → S7
        await logStatus(order_id, fromStatus, 'S7', 'mock_refund', openid);

        console.log(`mock_refund success: ${order.order_no} refund_no=${refundNo}`);
        return {
          ok: true,
          data: { order_id, order_no: order.order_no, refund_no: refundNo, status: 'S7', is_mock: true }
        };
      } catch (e) {
        console.log(`mock_refund fail: ${e.message}`);
        return { ok: false, code: 'refund_db_fail', msg: '退款失败,请联系管理员' };
      }
    }

    default:
      return { ok: false, code: 'pay_unknown_action', msg: '未知动作' };
  }
};

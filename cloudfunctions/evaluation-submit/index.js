// 对应 PRD 章节：3.3.4 评价与默认4星规则 / 附录G 状态机 / 8.1 信用分
// evaluation-submit 评价提交 · 身份取自 getWXContext().OPENID
// 2 个 action: submit(用户评价耍伴, S5→S8) / get_default_star(获取默认星数)
// 规则:S5 完成后 48h 内用户可评价;超时系统默认 4 星转 S9;评价内容过 msgSecCheck。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);
const log = require('./logger');

const BLOCK_WORDS = ['加微信', '加V', '转账', '私聊我'];

async function getConfig() {
  try {
    const r = await col('admin_config').where({ _id: 'global' }).limit(1).get();
    if (r.data && r.data[0]) return r.data[0];
  } catch (e) {}
  return { default_star: 4, eval_window_h: 48 };
}

async function getOrder(orderId) {
  try {
    return (await col('order_main').doc(orderId).get()).data || null;
  } catch (e) {
    return null;
  }
}

// 内容安全:msgSecCheck 不可用时降级本地违禁词
async function checkText(openid, text) {
  if (!text) return true;
  try {
    await cloud.openapi.security.msgSecCheck({
      content: text,
      version: 2,
      scene: 2,
      openid
    });
    return true;
  } catch (e) {
    // 降级:本地违禁词
    const lower = text.toLowerCase();
    for (const w of BLOCK_WORDS) {
      if (lower.includes(w.toLowerCase())) return false;
    }
    return true;
  }
}

async function logStatus(orderId, from, to, action, operator) {
  await col('order_status_log').add({ data: {
    order_id: orderId, from_status: from, to_status: to,
    action, operator,
    created_at: Date.now(), updated_at: Date.now(), is_deleted: false
  }});
}

// 云数据库文档 ID 校验:自动生成的 _id 为 32 位十六进制(拦截订单号/占位符)
function isValidDocId(id) {
  return typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id);
}

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
    const { resolveOpenid } = require('./openid');
  const openid = await resolveOpenid(cloud, event);
  if (!openid) return { ok: false, code: 'ev_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  log.d(`evaluation-submit action=${action} openid=${openid}`);

  // 获取默认星数(用于超时默认评价)
  if (action === 'get_default_star') {
    const cfg = await getConfig();
    return { ok: true, data: { default_star: cfg.default_star || 4 } };
  }

  // 用户提交评价:S5 → S8
  if (action === 'submit') {
    const { order_id, star, content } = event;
    if (!order_id) return { ok: false, code: 'ev_no_order', msg: '缺少订单 ID' };
    if (!isValidDocId(order_id)) return { ok: false, code: 'ev_bad_order_id', msg: '订单 ID 格式不正确:请传入订单 _id(32位十六进制),不是订单号(ORD 开头)' };
    if (!Number.isInteger(star) || star < 1 || star > 5) return { ok: false, code: 'ev_star_invalid', msg: '评分需在 1-5 之间' };

    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'ev_not_found', msg: '订单不存在' };
    if (order.user_openid !== openid) return { ok: false, code: 'ev_not_owner', msg: '仅下单用户可评价' };
    if (order.status !== 'S5') {
      // 已评价/系统默认评价等非 S5 状态: 有评价记录则幂等返回, 便于前端重试/弱网重发
      const dup0 = await col('evaluation').where({ order_id, is_deleted: false }).limit(1).get().catch(() => ({ data: [] }));
      if (dup0.data && dup0.data[0]) {
        return { ok: true, data: { order_id, status: order.status, star: dup0.data[0].star, idempotent: true, is_system: !!dup0.data[0].is_system } };
      }
      if (order.status === 'S9') return { ok: false, code: 'ev_auto_evaluated', msg: '已超过评价时限,系统已默认评价' };
      return { ok: false, code: 'ev_status', msg: `订单当前状态(${order.status})不可评价` };
    }

    // 幂等快查: 已有评价记录直接返回(防弱网重发/重复提交)
    const existR = await col('evaluation').where({ order_id, is_deleted: false }).limit(1).get().catch(() => ({ data: [] }));
    if (existR.data && existR.data[0]) {
      return { ok: true, data: { order_id, status: order.status, star: existR.data[0].star, idempotent: true, is_system: !!existR.data[0].is_system } };
    }

    // 评价内容安全校验
    if (content && !(await checkText(openid, content))) {
      return { ok: false, code: 'ev_text_unsafe', msg: '评价内容包含敏感词,请修改' };
    }

    const now = Date.now();
    // 信用 delta:5星+2, 4星+1, 3星0, 2星-2, 1星-5(冷启动期简化规则)
    const delta = star >= 5 ? 2 : star === 4 ? 1 : star === 3 ? 0 : star === 2 ? -2 : -5;

    // ① CAS 抢占 S5→S8: 用户评价与 order-timer 自动评价互斥, 并发双提仅一方成功
    let casRes;
    try {
      casRes = await col('order_main').where({ _id: order_id, status: 'S5' }).update({
        data: { status: 'S8', evaluated_at: now, updated_at: now }
      });
    } catch (e) {
      log.d(`evaluation cas fail: ${e.message}`);
      return { ok: false, code: 'ev_submit_fail', msg: '评价提交失败' };
    }
    if (!casRes.stats || casRes.stats.updated !== 1) {
      const [latest, dup] = await Promise.all([
        getOrder(order_id),
        col('evaluation').where({ order_id, is_deleted: false }).limit(1).get().catch(() => ({ data: [] }))
      ]);
      if (dup.data && dup.data[0]) {
        return { ok: true, data: { order_id, status: latest ? latest.status : 'S8', star: dup.data[0].star, idempotent: true, is_system: !!dup.data[0].is_system } };
      }
      if (latest && latest.status === 'S9') return { ok: false, code: 'ev_auto_evaluated', msg: '已超过评价时限,系统已默认评价' };
      return { ok: false, code: 'ev_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    }

    // ② 事务: 评价 + 耍伴信用分读改写 + 信用流水 + 状态流水, 同成同败
    //    事务内仅支持按 _id 操作, 先在事务外取耍伴账号 _id
    let partnerDocId = '';
    try {
      const pR = await col('user_account').where({ openid: order.partner_openid }).limit(1).get();
      partnerDocId = (pR.data && pR.data[0] && pR.data[0]._id) || '';
    } catch (e) {
      log.d(`evaluation partner lookup fail: ${e.message}`);
    }

    try {
      await db.runTransaction(async (t) => {
        await t.collection('evaluation').add({ data: {
          order_id,
          from_openid: openid,
          to_openid: order.partner_openid,
          star,
          content: content || '',
          created_at: now,
          updated_at: now,
          is_deleted: false
        }});

        if (partnerDocId) {
          const u = await t.collection('user_account').doc(partnerDocId).get();
          const cur = (u.data && u.data.partner_credit_score) || 800;
          const next = Math.max(0, Math.min(1000, cur + delta));
          await t.collection('user_account').doc(partnerDocId).update({ data: {
            partner_credit_score: next, updated_at: now
          }});
          await t.collection('credit_score_log').add({ data: {
            openid: order.partner_openid, type: 'evaluation', score: next, delta,
            order_id, created_at: now, updated_at: now, is_deleted: false
          }});
        }

        await t.collection('order_status_log').add({ data: {
          order_id, from_status: 'S5', to_status: 'S8',
          action: 'user_evaluate', operator: openid,
          created_at: now, updated_at: now, is_deleted: false
        }});
      });
    } catch (e) {
      // 补偿: 事务失败则订单回 S5, 让用户可重试(极小窗口, 定时器最多再做一次默认评价)
      log.d(`evaluation txn fail: ${e.message}; compensating order ${order_id} → S5`);
      await col('order_main').where({ _id: order_id, status: 'S8' }).update({
        data: { status: 'S5', evaluated_at: null, updated_at: Date.now() }
      }).catch(() => {});
      return { ok: false, code: 'ev_submit_fail', msg: '评价提交失败' };
    }

    log.d(`evaluation submitted: ${order.order_no} star=${star} S5→S8`);
    return { ok: true, data: { order_id, status: 'S8', star, credit_delta: delta } };
  }

  return { ok: false, code: 'ev_unknown_action', msg: '未知动作' };
};

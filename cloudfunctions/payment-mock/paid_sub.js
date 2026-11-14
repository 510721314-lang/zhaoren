// paid_sub.js — 支付成功「支付提醒」订阅消息发送(payment-mock 本地模块, 2026-11-14 方案E 双专家评审立项)
// 状态机与发送入口复用规范源 _shared/sub_msg.js 本地副本(sync-sub-msg.ps1 同步);
// 与 order-action sendCommSub 同口径: 软额度判定 + 43101 收口 + sub_msg_send_logs 全程留痕, 永不抛出(失败不阻断资金链路)。
const { stateOf, softCanSend, sentPatch, exhaustedPatch, sendOnce } = require('./sub_msg');

// 与 order-action/index.js 同实现(函数目录自包含, 禁跨目录 require)
function pageOf(base, key, val) {
  const p = String(base || '');
  if (new RegExp('[?&]' + key + '=').test(p)) return p;
  return p + (p.indexOf('?') >= 0 ? '&' : '?') + key + '=' + encodeURIComponent(String(val || ''));
}
// 云函数运行时 TZ=UTC, 订阅消息时间按北京时间(+8)格式化
function bjTimeStr(ts) {
  const d = new Date(Number(ts || Date.now()) + 8 * 3600 * 1000);
  const p2 = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

// 支付成功 → 通知耍伴(order.partner_openid)。所有早退分支留痕 order_main.sub_msg_send_logs(key='paid')。
async function sendPaidSub(ctx, order) {
  const { cloud, col, _, log, getConfig } = ctx;
  const config = await getConfig();
  const tmpl = (config && config.sub_msg_templates && config.sub_msg_templates.paid) || null;
  const logLocal = async (code) => {
    try {
      await col('order_main').doc(order._id).update({ data: { sub_msg_send_logs: _.push([
        { key: 'paid', openid: order.partner_openid || '', at: Date.now(), channel: 'local', status: 'fail', errCode: code, errMsg: 'early_return' }
      ]) } });
    } catch (e0) {}
  };
  if (!tmpl || !tmpl.tmpl_id) { await logLocal('NO_TMPL'); return; }
  const p = order.partner_openid;
  if (!p) { await logLocal('NO_OPENID'); return; }
  let prof = {};
  try {
    const pr = await col('partner_profile').where({ openid: p }).limit(1).get();
    prof = (pr.data && pr.data[0]) || {};
  } catch (e) { await logLocal('READ_FAIL'); return; }
  const prev = prof.sub_msgs && prof.sub_msgs.paid;
  const st = stateOf(prev);
  // 同催办/沟通链: 放宽本地判定 + 拦截留痕, 由微信侧 43101 兜底收口
  if (!softCanSend(prev)) {
    await logLocal(st.granted > 0 ? 'NO_QUOTA' : 'NO_AUTH');
    return;
  }
  // 模板字段: 默认 thing1/time2/thing3, 可经 admin_config.sub_msg_templates.paid.fields 按实际模板键位覆盖
  const fields = Object.assign({ thing1: 'paid_item', time2: 'paid_time', thing3: 'paid_order' },
    (tmpl.fields && typeof tmpl.fields === 'object') ? tmpl.fields : {});
  const tstr = bjTimeStr(Date.now());
  const data = {};
  for (const kw of Object.keys(fields)) {
    const s = fields[kw];
    let v = '';
    if (s === 'paid_item') v = '您的服务订单已付款';
    else if (s === 'paid_time') v = tstr;
    else if (s === 'paid_order') v = `订单 ${order.order_no || ''}`;
    else if (typeof s === 'string') v = String(s);
    if (v) data[kw] = { value: String(v).slice(0, 20) };
  }
  if (!Object.keys(data).length) { await logLocal('NO_DATA'); return; }
  const entry = { key: 'paid', openid: p, at: Date.now(), channel: 'cloud', status: 'ok', errCode: '', errMsg: '' };
  const res = await sendOnce(cloud, {
    touser: p, templateId: tmpl.tmpl_id,
    page: pageOf(tmpl.page || 'pages-v2/order-detail/order-detail', 'orderId', order._id),
    data, miniprogramState: tmpl.miniprogram_state || 'formal'
  });
  if (res.sent) {
    try {
      await col('partner_profile').doc(prof._id).update({ data: {
        ['sub_msgs.paid']: sentPatch(prev, Date.now()), updated_at: Date.now()
      } });
    } catch (e1) {}
  } else {
    entry.status = 'fail'; entry.errCode = res.errCode; entry.errMsg = res.errMsg;
    if (String(res.errCode) === '43101') {
      // 额度用尽: 关授权 + 站内信引导重新授权(与 sendCommSub 同口径)
      try {
        await col('partner_profile').doc(prof._id).update({ data: {
          ['sub_msgs.paid']: exhaustedPatch(prev, Date.now()), updated_at: Date.now()
        } });
      } catch (e3) {}
      try {
        await col('system_notice').add({ data: {
          to_openid: p, order_id: order._id, type: 'sub_quota',
          title: '微信支付提醒已用完', body: '点此重新开启，可再收 1 条支付提醒',
          action_key: 'jump_accept_config',
          created_at: Date.now(), read: false
        }});
      } catch (e4) {}
    }
  }
  try { await col('order_main').doc(order._id).update({ data: { sub_msg_send_logs: _.push([entry]) } }); } catch (e2) {}
  log.d(`paid_sub: ${order.order_no} sent=${res.sent} errCode=${res.errCode}`);
}

module.exports = { sendPaidSub };

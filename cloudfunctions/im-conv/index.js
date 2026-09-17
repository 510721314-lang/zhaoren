// 对应 PRD 章节：PRD 3.4 IM即时聊天系统 / 3.3.2 四确认前仅系统模板消息
// im-conv 会话读取 · 身份取自 getWXContext().OPENID
// 3 个 action:
//   open       打开(不存在则懒创建)某订单的会话,返回会话元信息+模板列表,并清零本方未读
//   messages   拉取某会话消息(按时间正序),并清零本方未读
//   my_convs   我的会话列表(消息 tab),含对方昵称/最后一条/未读数
// 红线(rules.md 第5/17/41条):
//   - 集合仅创建者可读写,跨用户读取一律走云函数;仅订单参与方可读写会话
//   - 四确认完成前仅允许系统模板消息;free_chat 由订单状态推导(S1 未确认 → false)
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);

const SCENE_NAME = { W1: '就医陪诊', W2: '学习陪伴', W3: '健身陪伴', W7: '情绪陪伴', W8: '生活协助', W9: '宠物陪伴', W10: '出行陪伴', W11: '线上陪伴' };
// 可聊天状态:S6 已取消 / S10 已关闭 禁止收发
const CHAT_BLOCKED = ['S6', 'S10'];
// 自由文本开放状态:四确认完成(S1 之后),且订单未取消/关闭
const FREE_CHAT_STATUS = ['S0', 'S2', 'S3', 'S3.5', 'S4', 'S5', 'S7', 'S8', 'S9', 'S10.5'];

async function getConfig() {
  try {
    const r = await col('admin_config').where({ _id: 'global' }).limit(1).get();
    if (r.data && r.data[0]) return r.data[0];
  } catch (e) {}
  return { system_templates: [], security_only_template_before_confirm: true };
}

async function getOrder(orderId) {
  try {
    return (await col('order_main').doc(orderId).get()).data || null;
  } catch (e) {
    return null;
  }
}

// 云数据库文档 ID 校验:自动生成的 _id 为 32 位十六进制
function isValidDocId(id) {
  return typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id);
}

// 判定调用者在订单中的角色
function roleOf(order, openid) {
  if (order.user_openid === openid) return 'user';
  if (order.partner_openid === openid) return 'partner';
  return null;
}

function isFreeChat(order, config) {
  if (config.security_only_template_before_confirm === false) return true;
  return FREE_CHAT_STATUS.indexOf(order.status) >= 0;
}

// 懒获取会话(不存在则创建);并发下创建冲突则重查
async function getOrCreateConv(order, role) {
  const existing = await col('im_conversation')
    .where({ order_id: order._id, is_deleted: false }).limit(1).get();
  if (existing.data && existing.data[0]) return existing.data[0];

  const now = Date.now();
  const doc = {
    order_id: order._id,
    order_no: order.order_no || '',
    scene: order.scene || '',
    scene_name: SCENE_NAME[order.scene] || order.scene || '',
    user_openid: order.user_openid,
    partner_openid: order.partner_openid,
    user_unread: 0,
    partner_unread: 0,
    last_msg_text: '',
    last_msg_at: 0,
    last_msg_from: '',
    created_at: now,
    updated_at: now,
    is_deleted: false
  };
  try {
    const r = await col('im_conversation').add({ data: doc });
    doc._id = r._id;
    console.log(`im conv created: order=${order.order_no} conv=${r._id}`);
    return doc;
  } catch (e) {
    // 唯一索引冲突(对方刚创建)→ 重查
    const again = await col('im_conversation')
      .where({ order_id: order._id, is_deleted: false }).limit(1).get();
    if (again.data && again.data[0]) return again.data[0];
    throw e;
  }
}

// 清零本方未读
async function clearUnread(convId, role) {
  const patch = role === 'user' ? { user_unread: 0 } : { partner_unread: 0 };
  try {
    await col('im_conversation').doc(convId).update({ data: Object.assign({ updated_at: Date.now() }, patch) });
  } catch (e) {}
}

// 批量取用户公开资料(昵称/头像)
async function getUserMap(openids) {
  const map = {};
  const uniq = Array.from(new Set(openids.filter(Boolean)));
  if (!uniq.length) return map;
  try {
    const r = await col('user_account').where({ openid: _.in(uniq) }).limit(uniq.length).get();
    for (const u of (r.data || [])) {
      map[u.openid] = { nickname: u.nickname || '微信用户', avatar: u.avatar || '' };
    }
  } catch (e) {}
  return map;
}

function peerOf(order, role) {
  return role === 'user'
    ? { openid: order.partner_openid, role: 'partner' }
    : { openid: order.user_openid, role: 'user' };
}

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
    const { resolveOpenid } = require('../_shared/openid');
  const openid = await resolveOpenid(cloud, event);
  if (!openid) return { ok: false, code: 'im_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  console.log(`im-conv action=${action} openid=${openid}`);

  // ───────── 1. 打开会话(懒创建) ─────────
  if (action === 'open') {
    const { order_id } = event;
    if (!isValidDocId(order_id)) {
      return { ok: false, code: 'im_bad_order_id', msg: '订单 ID 格式不正确:请传入订单 _id(32位十六进制)' };
    }
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'im_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'im_not_participant', msg: '你不是该订单参与方' };

    const config = await getConfig();
    const conv = await getOrCreateConv(order, role);
    await clearUnread(conv._id, role);

    const peer = peerOf(order, role);
    const userMap = await getUserMap([openid, peer.openid]);
    const meInfo = userMap[openid] || { nickname: '我', avatar: '' };
    const peerInfo = Object.assign({ openid: peer.openid, role: peer.role }, userMap[peer.openid] || { nickname: peer.role === 'partner' ? '耍伴' : '发单人', avatar: '' });

    return {
      ok: true,
      data: {
        conv_id: conv._id,
        order_id: order._id,
        order_no: order.order_no,
        scene: order.scene,
        scene_name: SCENE_NAME[order.scene] || order.scene,
        status: order.status,
        role,
        chat_blocked: CHAT_BLOCKED.indexOf(order.status) >= 0,
        free_chat: isFreeChat(order, config),
        me: meInfo,
        peer: peerInfo,
        templates: config.system_templates || []
      }
    };
  }

  // ───────── 2. 拉取消息(正序) ─────────
  if (action === 'messages') {
    const { conv_id } = event;
    if (!isValidDocId(conv_id)) {
      return { ok: false, code: 'im_bad_conv_id', msg: '会话 ID 格式不正确' };
    }
    let conv = null;
    try {
      conv = (await col('im_conversation').doc(conv_id).get()).data;
    } catch (e) {
      return { ok: false, code: 'im_conv_not_found', msg: '会话不存在' };
    }
    if (!conv || conv.is_deleted) return { ok: false, code: 'im_conv_not_found', msg: '会话不存在' };
    const role = roleOf(
      { user_openid: conv.user_openid, partner_openid: conv.partner_openid },
      openid
    );
    if (!role) return { ok: false, code: 'im_not_participant', msg: '你不是该会话参与方' };

    await clearUnread(conv_id, role);

    const r = await col('im_message')
      .where({ conv_id, is_deleted: false })
      .orderBy('created_at', 'asc')
      .limit(100)
      .get();

    const messages = (r.data || []).map((m) => ({
      msg_id: m._id,
      from_openid: m.from_openid,
      from_role: m.from_role,
      is_mine: m.from_openid === openid,
      type: m.type,
      text: m.text,
      template_id: m.template_id || '',
      created_at: m.created_at
    }));

    return {
      ok: true,
      data: {
        conv_id,
        order_id: conv.order_id,
        role,
        messages
      }
    };
  }

  // ───────── 3. 我的会话列表(消息 tab) ─────────
  if (action === 'my_convs') {
    const r = await col('im_conversation').where(_.and([
      { is_deleted: false },
      _.or([{ user_openid: openid }, { partner_openid: openid }])
    ])).orderBy('last_msg_at', 'desc').limit(50).get();

    const convs = r.data || [];
    const peerOpenids = convs.map((c) => (c.user_openid === openid ? c.partner_openid : c.user_openid));
    const userMap = await getUserMap(peerOpenids.concat([openid]));

    // 关联订单状态(会话可能创建于订单取消后状态变化)
    const orderIds = Array.from(new Set(convs.map((c) => c.order_id).filter(Boolean)));
    const orderMap = {};
    if (orderIds.length) {
      try {
        const oR = await col('order_main').where({ _id: _.in(orderIds) }).limit(orderIds.length).get();
        for (const o of (oR.data || [])) orderMap[o._id] = o;
      } catch (e) {}
    }

    const config = await getConfig();
    const list = convs.map((c) => {
      const myRole = c.user_openid === openid ? 'user' : 'partner';
      const peerOpenid = myRole === 'user' ? c.partner_openid : c.user_openid;
      const peerRole = myRole === 'user' ? 'partner' : 'user';
      const order = orderMap[c.order_id];
      const status = order ? order.status : '';
      const p = userMap[peerOpenid] || {};
      return {
        conv_id: c._id,
        order_id: c.order_id,
        order_no: c.order_no,
        scene_name: c.scene_name,
        status,
        chat_blocked: CHAT_BLOCKED.indexOf(status) >= 0,
        free_chat: order ? isFreeChat(order, config) : false,
        peer: {
          openid: peerOpenid,
          role: peerRole,
          nickname: p.nickname || (peerRole === 'partner' ? '耍伴' : '发单人'),
          avatar: p.avatar || ''
        },
        last_msg_text: c.last_msg_text || '',
        last_msg_at: c.last_msg_at || c.created_at,
        unread: myRole === 'user' ? (c.user_unread || 0) : (c.partner_unread || 0)
      };
    });

    return { ok: true, data: { list } };
  }

  return { ok: false, code: 'im_unknown_action', msg: '未知动作' };
};

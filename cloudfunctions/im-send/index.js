// 对应 PRD 章节：PRD 3.4 IM即时聊天系统 / 3.3.2 四确认前仅系统模板消息
// im-send 发消息 · 身份取自 getWXContext().OPENID
// 2 个 action:
//   send_template  发送系统模板消息(四确认前唯一允许的消息类型)
//   send_text      发送自由文本(四确认完成后开放,逐条过 msgSecCheck,不可用降级本地违禁词)
// 红线(rules.md 第17/41条):
//   - 四确认完成前禁止自由文本与联系方式交换
//   - 自由文本入库前必须安全检测,不通过拒绝并提示
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);
const log = require('./logger');
const { writeAudit } = require('./audit');

const SCENE_NAME = { W1: '就医陪诊', W2: '学习陪伴', W3: '健身陪伴', W7: '情绪陪伴', W8: '生活协助', W9: '宠物陪伴', W10: '出行陪伴', W11: '线上陪伴' };
const CHAT_BLOCKED = ['S6', 'S10'];
const FREE_CHAT_STATUS = ['S0', 'S2', 'S3', 'S3.5', 'S4', 'S5', 'S7', 'S8', 'S9', 'S10.5'];
const BLOCK_WORDS_FALLBACK = ['加微信', '加V', '转账', '私聊我'];

// 权威 IM 模板表(与前端 config/enums.js TM_TEMPLATES、init-db 种子一致)
// 历史数据曾误用 T1-T8, 这里做运行时规范化并自愈回写 admin_config
const CANONICAL_TEMPLATES = [
  { id: 'TM1', text: '时间确认' },
  { id: 'TM2', text: '地点确认' },
  { id: 'TM3', text: '内容确认' },
  { id: 'TM4', text: '费用确认' },
  { id: 'TM5', text: '特殊需求' },
  { id: 'TM6', text: '到达提醒' },
  { id: 'TM7', text: '取消申请' },
  { id: 'TM8', text: '改期申请' }
];

// 返回 { templates, needHeal }: 已是 TM1-TM8 则原样; 否则返回权威表并标记需回写
function resolveTemplates(raw) {
  const ids = Array.isArray(raw) ? raw.map((t) => String(t && t.id).toUpperCase()) : [];
  const healthy = CANONICAL_TEMPLATES.every((t) => ids.indexOf(t.id) >= 0);
  if (healthy) return { templates: raw, needHeal: false };
  return { templates: CANONICAL_TEMPLATES, needHeal: true };
}

// best-effort 自愈: 把权威模板回写 admin_config(不阻断主流程, 不抛错)
function healTemplates() {
  col('admin_config').where({ _id: 'global' }).update({
    data: { system_templates: CANONICAL_TEMPLATES, updated_at: Date.now() }
  }).then(() => log.d('im templates self-healed to TM1-TM8')).catch(() => {});
}

// W11 线上陪伴 R3 红线词库(6类:引流/虚拟币/赌博/色情/政治/暴力)
const W11_R3_WORDS = {
  '引流站外': ['加微信', '加V', 'QQ', '联系方式', '站外', '私聊我', '加我vx'],
  '虚拟币': ['比特币', 'USDT', '虚拟币', '炒币', '区块链投资', '币圈'],
  '赌博': ['赌博', '赌球', '彩票', '下注', '押注', '百家乐'],
  '色情': ['色情', '裸聊', '约炮', '一夜情', '成人视频'],
  '政治': ['政治敏感', '反动', '颠覆'],
  '暴力': ['暴力', '打人', '杀', '砍人']
};
const TEXT_MAX_LEN = 500;

async function getConfig() {
  try {
    const r = await col('admin_config').doc('global').get();
    if (r.data) return r.data;   // doc().get() 返回单个对象(非数组)
  } catch (e) {}
  return { system_templates: [], block_words: BLOCK_WORDS_FALLBACK, security_only_template_before_confirm: true };
}

async function getOrder(orderId) {
  try {
    return (await col('order_main').doc(orderId).get()).data || null;
  } catch (e) {
    return null;
  }
}

function isValidDocId(id) {
  return typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id);
}

function roleOf(order, openid) {
  if (order.user_openid === openid) return 'user';
  if (order.partner_openid === openid) return 'partner';
  return null;
}

// 懒获取会话(与 im-conv 同构;发送方先于对方打开会话时创建)
async function getOrCreateConv(order) {
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
    return doc;
  } catch (e) {
    const again = await col('im_conversation')
      .where({ order_id: order._id, is_deleted: false }).limit(1).get();
    if (again.data && again.data[0]) return again.data[0];
    throw e;
  }
}

// 内容安全:msgSecCheck v2;87014 明确违规;其他异常(未开通/网络)降级本地违禁词
async function checkText(openid, text, blockWords) {
  try {
    await cloud.openapi.security.msgSecCheck({
      content: text,
      version: 2,
      scene: 2,   // 2=评论/聊天场景
      openid
    });
    return { pass: true };
  } catch (e) {
    if (e && (e.errCode === 87014 || e.errCode === '87014')) {
      return { pass: false, reason: '内容包含违规信息,请修改后重试' };
    }
    // 降级:本地违禁词库
    const words = (blockWords && blockWords.length) ? blockWords : BLOCK_WORDS_FALLBACK;
    const lower = text.toLowerCase();
    for (const w of words) {
      if (w && lower.indexOf(String(w).toLowerCase()) >= 0) {
        return { pass: false, reason: '消息包含平台禁止的内容(如联系方式/转账),请通过平台沟通' };
      }
    }
    return { pass: true, degraded: true };
  }
}

// 写消息 + 更新会话(最后一条/对方未读+1)
async function appendMessage(conv, order, role, openid, type, text, templateId) {
  const now = Date.now();
  const msgDoc = {
    conv_id: conv._id,
    order_id: order._id,
    from_openid: openid,
    from_role: role,
    type,                       // 'template' | 'text'
    text,
    template_id: templateId || '',
    created_at: now,
    updated_at: now,
    is_deleted: false
  };
  const r = await col('im_message').add({ data: msgDoc });

  const convPatch = {
    last_msg_text: text,
    last_msg_at: now,
    last_msg_from: openid,
    updated_at: now
  };
  // 对方未读 +1(原子 inc, 避免并发消息读改写丢计数)
  if (role === 'user') convPatch.partner_unread = _.inc(1);
  else convPatch.user_unread = _.inc(1);
  await col('im_conversation').doc(conv._id).update({ data: convPatch });

  return {
    msg_id: r._id,
    conv_id: conv._id,
    from_openid: openid,
    from_role: role,
    is_mine: true,
    type,
    text,
    template_id: templateId || '',
    created_at: now
  };
}

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const { resolveOpenid } = require('./openid');
  const openid = await resolveOpenid(cloud, event);
  if (!openid) return { ok: false, code: 'im_no_openid', msg: '未获取到登录身份' };
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);

  const { action } = event;
  log.d(`im-send action=${action} openid=${openid}`);

  if (action !== 'send_template' && action !== 'send_text') {
    return { ok: false, code: 'im_unknown_action', msg: '未知动作' };
  }

  const { order_id } = event;
  if (!isValidDocId(order_id)) {
    return { ok: false, code: 'im_bad_order_id', msg: '订单 ID 格式不正确:请传入订单 _id(32位十六进制)' };
  }
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'im_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'im_not_participant', msg: '你不是该订单参与方' };
  if (CHAT_BLOCKED.indexOf(order.status) >= 0) {
    return { ok: false, code: 'im_chat_closed', msg: '订单已取消/关闭,无法发送消息' };
  }

  const config = await getConfig();
  // 平台总开关: 私信维护中直接拦截(模板与文本均禁止)
  if (config.switch_im === false) {
    return { ok: false, code: 'im_disabled', msg: '私信功能维护中,请稍后再试' };
  }
  const conv = await getOrCreateConv(order);

  // ───────── 1. 发送系统模板消息 ─────────
  if (action === 'send_template') {
    const tplId = String(event.template_id || '').toUpperCase();
    const { templates, needHeal } = resolveTemplates(config.system_templates);
    if (needHeal) healTemplates();  // 旧 T1-T8 格式: 本次用权威表放行, 异步修库
    const tpl = templates.find((t) => String(t.id).toUpperCase() === tplId);
    if (!tpl) {
      return { ok: false, code: 'im_bad_template', msg: '模板消息不存在,四确认前仅可发送指定模板' };
    }
    try {
      const msg = await appendMessage(conv, order, role, openid, 'template', tpl.text, tpl.id);
      log.d(`im template sent: order=${order.order_no} ${tpl.id} by=${role}`);
      await writeAudit(db, log, {
        openid, role, category: 'business', action: 'im_send_template',
        target_type: 'im_message', target_id: msg.msg_id || '',
        detail: { conv_id: msg.conv_id, template_id: tpl.id, msg_id: msg.msg_id },
        result: 'ok', client_ip: clientIp, device
      });
      return { ok: true, data: { msg, free_chat: FREE_CHAT_STATUS.indexOf(order.status) >= 0 } };
    } catch (e) {
      log.d(`send_template fail: ${e.message}`);
      return { ok: false, code: 'im_send_fail', msg: '发送失败,请稍后重试' };
    }
  }

  // ───────── 2. 发送自由文本(四确认完成后) ─────────
  if (action === 'send_text') {
    const freeChat = config.security_only_template_before_confirm === false
      || FREE_CHAT_STATUS.indexOf(order.status) >= 0;
    if (!freeChat) {
      return { ok: false, code: 'im_template_only', msg: '四项确认完成前仅可发送系统模板消息' };
    }
    const text = String(event.text || '').trim();
    if (!text) return { ok: false, code: 'im_empty_text', msg: '消息内容不能为空' };
    if (text.length > TEXT_MAX_LEN) {
      return { ok: false, code: 'im_text_too_long', msg: `消息最长 ${TEXT_MAX_LEN} 字` };
    }

    // 私信频控(滑动窗口): 该会话内本窗口已发消息数 ≥ 上限即拦截,
    // retry_after = 窗口内最早一条消息"老化出窗"的剩余秒数, 供客户端倒计时
    const windowMin = Number(config.im_rate_window_min) || 5;
    const maxCount = Number(config.im_rate_max_count) || 30;
    const windowStart = Date.now() - windowMin * 60000;
    const rateQ = { conv_id: conv._id, from_openid: openid, is_deleted: false, created_at: _.gt(windowStart) };
    const cntR = await col('im_message').where(rateQ).count();
    if (cntR.total >= maxCount) {
      const oldestR = await col('im_message').where(rateQ).orderBy('created_at', 'asc').limit(1).get();
      let retryAfter = windowMin * 60;
      if (oldestR.data && oldestR.data[0]) {
        retryAfter = Math.max(1, Math.ceil((oldestR.data[0].created_at + windowMin * 60000 - Date.now()) / 1000));
      }
      log.d(`im rate limited: order=${order.order_no} by=${role} cnt=${cntR.total}/${maxCount} retry=${retryAfter}s`);
      await writeAudit(db, log, {
        openid, role, category: 'security', action: 'im_send_blocked',
        target_type: 'im_message', target_id: '',
        detail: { conv_id: conv._id, retry_after: retryAfter },
        result: 'fail', code: 'im_rate_limited', client_ip: clientIp, device
      });
      return {
        ok: false, code: 'im_rate_limited',
        msg: `发送过于频繁,每 ${windowMin} 分钟最多发送 ${maxCount} 条消息`,
        retry_after: retryAfter
      };
    }

    const chk = await checkText(openid, text, config.block_words);
    if (!chk.pass) {
      log.d(`im text blocked: order=${order.order_no} by=${role} reason=${chk.reason}`);
      return { ok: false, code: 'im_text_blocked', msg: chk.reason };
    }

    // W11 线上陪伴 R3 红线检测(6类),命中拦截并记录 redline_event
    if (order.scene === 'W11') {
      for (const [rtype, words] of Object.entries(W11_R3_WORDS)) {
        if (words.some(w => text.indexOf(w) >= 0)) {
          try {
            await col('platform_event').add({ data: {
              level: 'P1', type: 'redline', openid,
              payload: { order_id, scene: 'W11', redline_type: rtype, text: text.slice(0, 100) },
              created_at: Date.now(), updated_at: Date.now(), is_deleted: false
            }});
          } catch (e) {}
          log.d(`W11 R3 hit: order=${order.order_no} by=${role} type=${rtype}`);
          return { ok: false, code: 'im_r3_blocked', msg: `消息触发W11红线(${rtype}),已记录并上报` };
        }
      }
    }

    try {
      const msg = await appendMessage(conv, order, role, openid, 'text', text, '');
      log.d(`im text sent: order=${order.order_no} by=${role} len=${text.length} degraded=${!!chk.degraded}`);
      await writeAudit(db, log, {
        openid, role, category: 'business', action: 'im_send_text',
        target_type: 'im_message', target_id: msg.msg_id || '',
        detail: { conv_id: msg.conv_id, msg_id: msg.msg_id, text_len: text.length, free_chat: true },
        result: 'ok', client_ip: clientIp, device
      });
      return { ok: true, data: { msg, free_chat: true } };
    } catch (e) {
      log.d(`send_text fail: ${e.message}`);
      return { ok: false, code: 'im_send_fail', msg: '发送失败,请稍后重试' };
    }
  }

  return { ok: false, code: 'im_unknown_action', msg: '未知动作' };
};

// 对应 PRD 章节：3.3 四确认机制 / 3.5 订单交易系统 / 附录G 状态机 / 8.3 超时规则 / 1.7.1 青少年保护
// order-action 订单动作(四确认 + 取消 + 状态机扩展) · 身份取自 getWXContext().OPENID
// 27 个 action: get_confirmation / update_item / confirm_item / confirm_all /
//              cancel / start_service / complete_service / milestone_submit / milestone_confirm /
//              modify / modify_confirm / modify_reject /
//              extend / extend_confirm / extend_reject /
//              resume_service / partial_confirm / ratio_confirm / complaint /
//              no_show_report_submit / no_show_report_defense / no_show_report_withdraw / no_show_report_detail /
//              detail / my_orders / my_counts / nudge_partner
// 爽约申诉(第三批 3B): 用户/耍伴提交申诉 → 被诉方举证 → 管理员裁定(admin-action no_show_decide);
//   订单状态机不因申诉改变; 数值全部后台可配(no_show_* 9 键), 规则纯函数见 ./no_show_rules
//   撤回申诉(2026-10-10, N8 由「一期不做」变更为「做」): 仅申诉人本人、裁定前可撤, 撤回占 N6 配额
// 四确认 SSOT:时间/地点/内容/费用四项,用户与耍伴双方各确认一次共 8 位;
//   8 位全完成 → S1→S0(待支付,30 分钟支付时限);任一方修改任一项 → 8 位全部重置。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);
const log = require('./logger');
const { writeAudit } = require('./audit');
// 第三批 3B: 爽约申诉/举证/裁定纯规则(规范源 _shared/no_show_rules.js, 修改后跑 sync-no-show-rules.ps1)
const { noShowCfg, canSubmitReport, defenseDeadlineOf, canWithdrawReport, REPORT_STATUS } = require('./no_show_rules');

const CONFIRM_FIELDS = ['time', 'location', 'content', 'fee'];
// 确认项中文名(通知文案用)
const FIELD_CN = { time: '时间', location: '地点', content: '内容', fee: '费用' };
// ── 统一订单概要(所有涉及订单信息的提示/通知前置): #订单号 · 场景名 · ¥金额 · 发布时间 · 服务时间 · 履约时长 · 人数 · 履约地点 · AA区间 ──
const SCENE_CN = { W1: '就医陪诊', W2: '学习陪伴', W3: '健身陪伴', W4: '游玩陪伴', W7: '情绪陪伴', W8: '生活协助', W9: '宠物陪伴', W10: '出行陪伴', W11: '线上陪伴' };
function fmtDT(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// 精简时间: MM-DD HH:mm(概要行内更紧凑)
function fmtDTShort(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// 统一订单概要 → 结构化三行(便于排版阅读): l1主信息 / l2时间 / l3地点+AA
function buildOrderSummary(o) {
  if (!o) return { l1: '', l2: '', l3: '' };
  // 场景名(子场景: content_options 多选, 全量以 / 分隔一并展示)
  const sub = Array.isArray(o.content_options) && o.content_options.length ? o.content_options.join('/') : '';
  const sceneTxt = (SCENE_CN[o.scene] || o.scene || '') + (sub ? `(${sub})` : '');
  const l1 = [o.order_no ? `#${o.order_no}` : '', sceneTxt, o.total_fen ? `¥${Math.round(o.total_fen / 100)}` : '', o.duration_h ? `${o.duration_h}小时` : '', o.headcount ? `${o.headcount}人` : ''].filter(Boolean).join(' · ');
  const l2 = [o.created_at ? `发布:${fmtDTShort(o.created_at)}` : '', o.start_time ? `服务:${fmtDTShort(o.start_time)}` : ''].filter(Boolean).join(' · ');
  const l3 = [o.location && o.location.name ? `📍${String(o.location.name)}` : '', o.aa_tier ? `AA:${o.aa_tier}` : ''].filter(Boolean).join(' · ');
  return { l1, l2, l3 };
}

// 自由文本安全检测降级词库(rules.md 六 · msgSecCheck 不可用时降级本地违禁词, 与 demand-publish/im-send 同款)
const BLOCK_WORDS_FALLBACK = ['加微信', '加V', '转账', '私聊我', '威信', 'VX', 'vx', '加我vx', '扣扣', 'QQ号', '支付宝', '口令红包', '站外交易', '线下转账'];

// 内容安全: msgSecCheck v2; 87014 明确违规; 其他异常(未开通/网络)降级本地违禁词 —— 失败不阻断主流程, 仅拦明确违规
async function checkText(openid, text, blockWords) {
  const t = String(text || '');
  if (!t) return { pass: true };
  try {
    await cloud.openapi.security.msgSecCheck({
      content: t.length > 2500 ? t.slice(0, 2500) : t,
      version: 2,
      scene: 2,   // 2=评论/留言场景
      openid
    });
    return { pass: true };
  } catch (e) {
    if (e && (e.errCode === 87014 || e.errCode === '87014')) {
      return { pass: false, reason: '内容包含违规信息,请修改后重试' };
    }
    log.w('msgSecCheck fail(降级本地词库):', (e && (e.errCode || e.errMsg || e.message)) || '');
    // 降级:本地违禁词库
    const words = (blockWords && blockWords.length) ? blockWords : BLOCK_WORDS_FALLBACK;
    const lower = t.toLowerCase();
    for (const w of words) {
      if (w && lower.indexOf(String(w).toLowerCase()) >= 0) {
        return { pass: false, reason: '内容包含平台禁止的内容(如联系方式/转账),请修改后重试' };
      }
    }
    return { pass: true };
  }
}

async function getConfig() {
  try {
    const r = await col('admin_config').doc('global').get();
    if (r.data) return r.data;   // doc().get() 返回单个对象(非数组)
  } catch (e) {}
  return { s0_timeout_min: 30, youth_limit_fen: 20000, platform_fee_rate_fen: 1000 };
}

// 改期/加时原因字数上限(后台 order_reason_max_len 可配, 与前端 CONFIG.ORDER.reasonMaxLen 同源; 缺省 200)
function reasonMaxLen(config) {
  const v = Number(config && config.order_reason_max_len);
  return Number.isFinite(v) && v >= 1 ? v : 200;
}

async function getOrder(orderId) {
  try {
    return (await col('order_main').doc(orderId).get()).data || null;
  } catch (e) {
    return null;
  }
}

/**
 * 写一条系统通知到 system_notice 集合(不阻塞主流程, try-catch 吞掉)
 * @param {object} opt
 * @param {string} opt.to_openid - 收件人
 * @param {string} opt.order_id - 关联订单(可选)
 * @param {string} opt.type - 通知类型枚举: accept/pay/start/modify/modify_confirm/modify_reject/extend_confirm/extend_reject/cancel/milestone/finish/evaluate/settle/pause/resume/custom
 * @param {string} opt.title - 标题
 * @param {string} opt.body - 正文
 * @param {string} opt.action_key - 点击后续动作: jump_order/jump_chat/jump_pay/jump_accept_modify/jump_wallet/jump_evaluate
 * @param {object} opt.action_payload - 动作参数(如 {order_id})
 */
async function writeNotice(opt) {
  try {
    // 去重合并: 同收件人+订单+type 未读则覆盖(更新正文/时间), 避免 confirm_all/补发卡/连发文本时通知刷屏
    const exist = await col('system_notice').where({
      to_openid: opt.to_openid, order_id: opt.order_id || '', type: opt.type, read: false
    }).limit(1).get();
    const data = {
      title: opt.title, body: opt.body || '',
      action_key: opt.action_key || '',
      action_payload: opt.action_payload || {},
      updated_at: Date.now()
    };
    if (exist.data && exist.data[0]) {
      await col('system_notice').doc(exist.data[0]._id).update({ data });
    } else {
      await col('system_notice').add({ data: Object.assign({
        to_openid: opt.to_openid,
        order_id: opt.order_id || '',
        type: opt.type || 'custom',
        created_at: Date.now(),
        read: false
      }, data) });
    }
  } catch (e) {
    log.d('[notice] write failed:', opt.to_openid, opt.type, e.message);
  }
}

// 云数据库文档 ID 校验:自动生成的 _id 为 32 位十六进制
// 拦截订单号(ORD 开头)、<ORDER_ID> 占位符、含空格/截断的非法 ID,避免 doc() 抛错被吞成"订单不存在"
function isValidDocId(id) {
  return typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id);
}

// D2-3 防漂移抽取: 规范源 _shared/take_rules.js(修改后跑 sync-take-rules.ps1 同步四个函数)
const { haversineKm } = require('./take_rules');
// D4-5 防漂移抽取: 资金规则规范源 _shared/money_rules.js(修改后跑 sync-money-rules.ps1 同步)
const { splitOrderAmount } = require('./money_rules');

// 通勤估算:步行 5km/h、骑行 15km/h、公交 20km/h(含等车)、驾车 30km/h(城市道路含红绿灯)
function estimateCommute(km) {
  const walk = Math.round(km / 5 * 60);
  const bike = Math.round(km / 15 * 60);
  const bus = Math.round(km / 20 * 60);
  const drive = Math.round(km / 30 * 60);
  return {
    distance_km: Math.round(km * 10) / 10,
    walk_min: walk,
    bike_min: bike,
    bus_min: bus,
    drive_min: drive
  };
}

async function getConfirmation(orderId) {
  const r = await col('order_confirmations').where({ order_id: orderId, is_deleted: false }).limit(1).get();
  return (r.data && r.data[0]) || null;
}

async function logStatus(orderId, from, to, action, operator) {
  await col('order_status_log').add({ data: {
    order_id: orderId, from_status: from, to_status: to,
    action, operator,
    created_at: Date.now(), updated_at: Date.now(), is_deleted: false
  }});
}

// CAS 条件更新: 仅当订单仍处于期望状态(字符串或数组)时更新, 防止并发/重复流转
// 与 order-timer.casStatus 同构; 返回是否"抢到"
async function casStatus(orderId, expect, patch) {
  try {
    const cond = Array.isArray(expect) ? _.in(expect) : expect;
    const r = await col('order_main').where({ _id: orderId, status: cond }).update({ data: patch });
    return !!(r.stats && r.stats.updated === 1);
  } catch (e) {
    log.d(`casStatus fail: ${e.message}`);
    return false;
  }
}

// 判定调用者在订单中的角色
// 电话脱敏(与 demand-publish maskContact 同口径): 手机保留前 3 后 4; 座机保留区号+后 4; 其他长度保留首尾各 2 位
function maskContact(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  const ll = t.match(/^(0\d{2,3})-(\d{7,8})$/);
  if (ll) return ll[1] + '-****' + ll[2].slice(-4);
  if (/^1[3-9]\d{9}$/.test(t)) return t.slice(0, 3) + '****' + t.slice(7);
  if (t.length <= 4) return t;
  return t.slice(0, 2) + '****' + t.slice(-2);
}

function roleOf(order, openid) {
  if (order.user_openid === openid) return 'user';
  if (order.partner_openid === openid) return 'partner';
  return null;
}

// 8 个确认位是否全部完成
function allConfirmed(items) {
  for (const f of CONFIRM_FIELDS) {
    const it = items[f];
    if (!it || !it.user_ok || !it.partner_ok) return false;
  }
  return true;
}

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
    const { resolveOpenid } = require('./openid');
  const openid = await resolveOpenid(cloud, event);
  if (!openid) return { ok: false, code: 'oa_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  log.d(`order-action action=${action} openid=${openid}`);

  // 需要订单 _id 的动作统一做格式预检(避免 doc(非法ID) 抛错被吞成"订单不存在")
  // 订单 ID 解析: 支持 32 位 hex _id 或 ORD 开头订单号(后者查 order_main 反查 _id)
  let order_id = event.order_id;
  const ORDER_ID_ACTIONS = ['get_confirmation', 'update_item', 'confirm_item', 'confirm_all', 'cancel', 'start_service', 'complete_service', 'detail', 'modify', 'modify_confirm', 'modify_reject', 'extend', 'extend_confirm', 'extend_reject', 'resume_service', 'partial_confirm', 'ratio_confirm', 'complaint', 'nudge_partner', 'no_show_report_submit', 'no_show_report_detail'];
  if (ORDER_ID_ACTIONS.indexOf(action) >= 0) {
    if (!order_id) {
      return { ok: false, code: 'oa_bad_order_id', msg: '缺少 order_id' };
    }
    if (isValidDocId(order_id)) {
      // 32 位 hex, 直接当 _id 用
    } else if (typeof order_id === 'string' && /^ORD[A-Za-z0-9]+$/.test(order_id)) {
      // ORD 订单号, 反查 _id
      try {
        const lookup = await col('order_main').where({ order_no: order_id }).limit(1).get();
        if (!lookup.data || !lookup.data[0]) {
          return { ok: false, code: 'oa_bad_order_id', msg: '订单号 ' + order_id + ' 未找到对应订单' };
        }
        order_id = lookup.data[0]._id;
      } catch (e) {
        return { ok: false, code: 'oa_bad_order_id', msg: '反查订单号失败: ' + e.message };
      }
    } else {
      return { ok: false, code: 'oa_bad_order_id', msg: '订单 ID 格式不正确:请传入 32 位十六进制 _id 或 ORD 开头订单号' };
    }
  }

  // ───────── 1. 查询四确认状态 ─────────
  if (action === 'get_confirmation') {
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };

    const conf = await getConfirmation(order_id);
    if (!conf) return { ok: false, code: 'oa_no_confirm_doc', msg: '确认单不存在' };

    // 统计已确认位数(供前端展示进度)
    let confirmedCount = 0;
    const fields = {};
    for (const f of CONFIRM_FIELDS) {
      const it = conf.items[f] || {};
      if (it.user_ok) confirmedCount++;
      if (it.partner_ok) confirmedCount++;
      fields[f] = { value: it.value, user_ok: !!it.user_ok, partner_ok: !!it.partner_ok };
    }

    // 改期/加时在途请求摘要(供聊天页醒目提示; can_respond=当前查看者是否需要响应)
    const pm = order.pending_modify;
    const pe = order.pending_extend;
    return {
      ok: true,
      data: {
        order_id,
        order_no: order.order_no,
        status: order.status,
        role,
        scene: order.scene || '',
        total_fen: order.total_fen || 0,
        start_time: order.start_time || 0,
        items: fields,
        confirmed_count: confirmedCount,   // 0-8
        total_count: 8,
        all_confirmed: allConfirmed(conf.items),
        version: conf.version || 1,
        pending_modify: pm ? {
          by_openid: pm.by_openid,
          by_role: pm.by_role,
          new_start_time: pm.new_start_time,
          reason: (pm.reason || '').slice(0, 60),
          can_respond: pm.by_openid !== openid
        } : null,
        pending_extend: pe ? {
          by_openid: pe.by_openid,
          by_role: pe.by_role,
          add_hours: pe.add_hours,
          add_amount_fen: pe.add_amount_fen,
          reason: (pe.reason || '').slice(0, 60),
          can_respond: pe.by_openid !== openid
        } : null
      }
    };
  }

  // ───────── 2. 修改四确认项(任一方) ─────────
  if (action === 'update_item') {
    const { item, value } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    if (CONFIRM_FIELDS.indexOf(item) < 0) {
      return { ok: false, code: 'oa_bad_item', msg: '确认项只能是 时间/地点/内容/费用' };
    }
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: `你不是该订单参与方(你的:${openid},user:${order.user_openid},partner:${order.partner_openid})` };
    if (order.status !== 'S1') {
      return { ok: false, code: 'oa_not_editable', msg: '订单当前状态不可修改确认项' };
    }

    const config = await getConfig();
    const now = Date.now();

    // 各项 value 校验
    let updateOrder = null;   // 若改费用需同步订单金额
    if (item === 'time') {
      const ts = Number(value);
      if (!ts || ts <= now) return { ok: false, code: 'oa_time_future', msg: '服务时间必须是未来时间' };
    } else if (item === 'location') {
      if (!value || !value.name || !value.latitude || !value.longitude) {
        return { ok: false, code: 'oa_location_invalid', msg: '地点信息不完整' };
      }
    } else if (item === 'content') {
      if (!Array.isArray(value)) return { ok: false, code: 'oa_content_invalid', msg: '服务内容格式有误' };
    } else if (item === 'fee') {
      const fee = Number(value);
      if (!Number.isInteger(fee)) {
        return { ok: false, code: 'oa_fee_invalid', msg: '费用必须是整数(分)' };
      }
      // ── 服务端重算+区间约束, 前端值仅作参考(金额不可信红线) ──
      const rateMin = config.rate_min_fen || 3000;   // 30 元起
      const rateMax = config.rate_max_fen || 10000;  // 100 元封顶
      // 夹取: 低于下限提到底, 高于上限截到顶
      const clampedFee = Math.max(rateMin, Math.min(rateMax, fee));
      if (clampedFee !== fee) {
        return { ok: false, code: 'oa_fee_out_of_range',
          msg: `费用超出耍伴时薪区间(${Math.round(rateMin/100)}元-${Math.round(rateMax/100)}元/小时),已自动调整为 ${Math.round(clampedFee/100)}元/小时`,
          original_fen: fee, adjusted_fen: clampedFee };
      }
      // 平台抽成: 规则收敛到 _shared/money_rules.js splitOrderAmount(0=免佣为合法值)
      const { feeFen } = splitOrderAmount(clampedFee, config.platform_fee_rate_fen);

      // 青少年保护:改后总价仍受 200 元上限约束
      const youthLimit = config.youth_limit_fen || 20000;
      const [u, p] = await Promise.all([
        col('user_account').where({ openid: order.user_openid }).limit(1).get(),
        col('user_account').where({ openid: order.partner_openid }).limit(1).get()
      ]);
      const isYouth = (doc) => doc && doc.age !== null && doc.age !== undefined && doc.age >= 18 && doc.age <= 22;
      const uYouth = u.data && u.data[0] && isYouth(u.data[0]);
      const pYouth = p.data && p.data[0] && isYouth(p.data[0]);
      if ((uYouth || pYouth) && clampedFee > youthLimit) {
        return { ok: false, code: 'oa_youth_limit', msg: '18-22 岁用户单笔订单上限 200 元' };
      }
      updateOrder = { total_fen: clampedFee, fee_fen: feeFen, partner_income_fen: clampedFee - feeFen };
    }

    // 重置 8 位 + 更新该项 value
    const conf = await getConfirmation(order_id);
    if (!conf) return { ok: false, code: 'oa_no_confirm_doc', msg: '确认单不存在' };

    const newItems = {};
    for (const f of CONFIRM_FIELDS) {
      newItems[f] = {
        value: f === item ? value : conf.items[f].value,
        user_ok: false,
        partner_ok: false
      };
    }

    // OCC 乐观锁: 以 version 为条件整单替换; 期间若有并发确认(version+1)则放弃, 避免静默吃掉确认位
    const v = conf.version || 1;
    let occRes;
    try {
      occRes = await col('order_confirmations').where({ _id: conf._id, version: v }).update({ data: {
        items: newItems,
        version: v + 1,
        updated_at: now
      }});
    } catch (e) {
      log.d(`update_item occ fail: ${e.message}`);
      return { ok: false, code: 'oa_update_fail', msg: '修改失败,请稍后重试' };
    }
    if (!occRes.stats || occRes.stats.updated !== 1) {
      return { ok: false, code: 'oa_conflict', msg: '确认信息刚被对方更新,请刷新后重试' };
    }

    // 改费用同步订单金额与时间; CAS: 仅订单仍在 S1 时写入(已取消/超时则不动)
    const orderPatch = { updated_at: now };
    if (item === 'fee') Object.assign(orderPatch, updateOrder);
    if (item === 'time') orderPatch.start_time = Number(value);
    if (item === 'location') orderPatch.location = value;
    if (item === 'content') orderPatch.content_options = value;
    const orderWon = await casStatus(order_id, 'S1', orderPatch);
    if (!orderWon) {
      return { ok: false, code: 'oa_conflict', msg: '订单状态已变化,请刷新后重试' };
    }

    log.d(`confirm item updated: order=${order.order_no} item=${item} by=${role}, all reset`);
    // 订单沟通同步: 通知对端"对方修改了某项, 需重新确认"
    writeNotice({
      to_openid: role === 'user' ? order.partner_openid : order.user_openid,
      order_id, type: 'modify',
      title: '订单沟通',
      body: `对方修改了「${FIELD_CN[item] || item}」,需重新确认`,
      action_key: 'jump_chat', action_payload: { order_id }
    });
    return {
      ok: true,
      data: { item, reset: true, version: v + 1, confirmed_count: 0, total_count: 8 }
    };
  }

  // ───────── 3. 单项确认 ─────────
  if (action === 'confirm_item') {
    const { item } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    if (CONFIRM_FIELDS.indexOf(item) < 0) {
      return { ok: false, code: 'oa_bad_item', msg: '确认项只能是 时间/地点/内容/费用' };
    }
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: `你不是该订单参与方(你的:${openid},user:${order.user_openid},partner:${order.partner_openid})` };
    if (order.status !== 'S1') {
      return { ok: false, code: 'oa_not_confirmable', msg: '订单当前状态不可确认' };
    }

    const conf = await getConfirmation(order_id);
    if (!conf) return { ok: false, code: 'oa_no_confirm_doc', msg: '确认单不存在' };

    const okKey = role + '_ok';   // user_ok / partner_ok
    const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
    const device = String(event.device || '').slice(0, 200);
    // 幂等:本方已确认该项,直接返回当前状态
    if (conf.items[item][okKey]) {
      let cnt = 0;
      for (const f of CONFIRM_FIELDS) {
        if (conf.items[f].user_ok) cnt++;
        if (conf.items[f].partner_ok) cnt++;
      }
      await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_confirm_item', target_type: 'order', target_id: order_id, detail: { item, role, idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { item, idempotent: true, confirmed_count: cnt, total_count: 8, all_confirmed: allConfirmed(conf.items), status: order.status } };
    }

    // 原子置本方 ok: 只写这一位(点路径) + version+1, 避免双方并发确认整对象覆盖丢位
    const now = Date.now();
    try {
      await col('order_confirmations').doc(conf._id).update({ data: {
        ['items.' + item + '.' + okKey]: true,
        version: _.inc(1),
        updated_at: now
      }});
    } catch (e) {
      log.d(`confirm_item fail: ${e.message}`);
      return { ok: false, code: 'oa_confirm_fail', msg: '确认失败,请稍后重试' };
    }

    // 重读确认单统计(不基于写前快照, 保证并发下计数正确)
    const fresh = await getConfirmation(order_id);
    const freshItems = (fresh && fresh.items) || conf.items;
    let cnt = 0;
    for (const f of CONFIRM_FIELDS) {
      if (freshItems[f].user_ok) cnt++;
      if (freshItems[f].partner_ok) cnt++;
    }
    const done = allConfirmed(freshItems);

    // 8 位全完成 → CAS S1→S0(待支付,30 分钟支付时限); 并发的最后一笔确认仅一方抢到
    let newStatus = order.status;
    if (done) {
      const config = await getConfig();
      const payExpire = now + (config.s0_timeout_min || 30) * 60 * 1000;
      const won = await casStatus(order_id, 'S1', {
        status: 'S0', pay_expire_at: payExpire, updated_at: now
      });
      if (won) {
        await logStatus(order_id, 'S1', 'S0', 'four_confirm_done', openid);
        newStatus = 'S0';
        // 订单状态同步: 四确认全部完成进入待支付, 通知双方
        writeNotice({
          to_openid: order.user_openid, order_id, type: 'confirm_done',
          title: '四确认全部完成',
          body: '订单已进入待支付,请在30分钟内完成支付',
          action_key: 'jump_pay', action_payload: { order_id }
        });
        writeNotice({
          to_openid: order.partner_openid, order_id, type: 'confirm_done',
          title: '四确认全部完成',
          body: '订单已进入待支付,等待发单人付款',
          action_key: 'jump_order', action_payload: { order_id }
        });
        log.d(`four confirm done: order=${order.order_no} → S0, pay_expire=${payExpire}`);
      } else {
        // 未抢到: 多为并发确认/定时器取消; S0 视为幂等成功, 其余报冲突
        const latest = await getOrder(order_id);
        newStatus = latest ? latest.status : 'S1';
        if (newStatus !== 'S0') {
          return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
        }
      }
    }

    await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_confirm_item', target_type: 'order', target_id: order_id, detail: { item, role, confirmed_count: cnt, status: newStatus }, result: 'ok', client_ip: clientIp, device });
    // 订单沟通同步: 通知对端"对方已确认某项"
    writeNotice({
      to_openid: role === 'user' ? order.partner_openid : order.user_openid,
      order_id, type: `confirm:${item}`,
      title: '订单沟通',
      body: `对方已确认「${FIELD_CN[item] || item}」`,
      action_key: 'jump_chat', action_payload: { order_id }
    });
    return {
      ok: true,
      data: {
        item, role, confirmed_count: cnt, total_count: 8,
        all_confirmed: done, status: newStatus
      }
    };
  }

  // ───────── 3.5 一键确认本方全部 4 项(测试便捷用) ─────────
  if (action === 'confirm_all') {
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: `你不是该订单参与方(你的:${openid},user:${order.user_openid},partner:${order.partner_openid})` };
    if (order.status !== 'S1') {
      return { ok: false, code: 'oa_not_confirmable', msg: '订单当前状态不可确认' };
    }
    const conf = await getConfirmation(order_id);
    if (!conf) return { ok: false, code: 'oa_no_confirm_doc', msg: '确认单不存在' };

    const okKey = role + '_ok';
    const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
    const device = String(event.device || '').slice(0, 200);

    // 原子置本方 4 位(点路径, 一次更新) + version+1
    const now = Date.now();
    const bitPatch = { version: _.inc(1), updated_at: now };
    for (const f of CONFIRM_FIELDS) { bitPatch['items.' + f + '.' + okKey] = true; }
    try {
      await col('order_confirmations').doc(conf._id).update({ data: bitPatch });
    } catch (e) {
      log.d(`confirm_all fail: ${e.message}`);
      return { ok: false, code: 'oa_confirm_fail', msg: '确认失败' };
    }

    // 重读统计
    const fresh = await getConfirmation(order_id);
    const freshItems = (fresh && fresh.items) || conf.items;
    let cnt = 0;
    for (const f of CONFIRM_FIELDS) {
      if (freshItems[f].user_ok) cnt++;
      if (freshItems[f].partner_ok) cnt++;
    }
    const done = allConfirmed(freshItems);
    let newStatus = order.status;
    if (done) {
      const config = await getConfig();
      const payExpire = now + (config.s0_timeout_min || 30) * 60 * 1000;
      const won = await casStatus(order_id, 'S1', { status: 'S0', pay_expire_at: payExpire, updated_at: now });
      if (won) {
        await logStatus(order_id, 'S1', 'S0', 'four_confirm_done', openid);
        newStatus = 'S0';
        // 订单状态同步: 四确认全部完成进入待支付, 通知双方
        writeNotice({
          to_openid: order.user_openid, order_id, type: 'confirm_done',
          title: '四确认全部完成',
          body: '订单已进入待支付,请在30分钟内完成支付',
          action_key: 'jump_pay', action_payload: { order_id }
        });
        writeNotice({
          to_openid: order.partner_openid, order_id, type: 'confirm_done',
          title: '四确认全部完成',
          body: '订单已进入待支付,等待发单人付款',
          action_key: 'jump_order', action_payload: { order_id }
        });
      } else {
        const latest = await getOrder(order_id);
        newStatus = latest ? latest.status : 'S1';
        if (newStatus !== 'S0') {
          return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
        }
      }
    }
    await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_confirm_all', target_type: 'order', target_id: order_id, detail: { role, confirmed_count: cnt, status: newStatus }, result: 'ok', client_ip: clientIp, device });
    // 订单沟通同步: 通知对端"对方一键确认全部"
    writeNotice({
      to_openid: role === 'user' ? order.partner_openid : order.user_openid,
      order_id, type: 'confirm_all',
      title: '订单沟通',
      body: '对方已一键确认全部四项',
      action_key: 'jump_chat', action_payload: { order_id }
    });
    return { ok: true, data: { role, confirmed_count: cnt, total_count: 8, all_confirmed: done, status: newStatus } };
  }

  // ───────── 4. 取消订单(S1/S0 → S6) ─────────
  if (action === 'cancel') {
    const { reason } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };

    if (order.status !== 'S1' && order.status !== 'S0') {
      return { ok: false, code: 'oa_cancel_status', msg: `订单当前状态(${order.status})不可取消` };
    }
    // S0(待支付)仅用户可取消;S1(待确认)双方均可
    if (order.status === 'S0' && role !== 'user') {
      return { ok: false, code: 'oa_cancel_perm', msg: '待支付订单仅下单用户可取消' };
    }

    const now = Date.now();
    const fromStatus = order.status;
    const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
    const device = String(event.device || '').slice(0, 200);
    // CAS: 仅 S1/S0 → S6, 与定时器/并发取消/支付互斥
    const won = await casStatus(order_id, ['S1', 'S0'], {
      status: 'S6', cancel_at: now, updated_at: now
    });
    if (!won) {
      const latest = await getOrder(order_id);
      if (latest && latest.status === 'S6') {
        await writeAudit(db, log, { openid, role, category: 'business', action: 'order_cancel', target_type: 'order', target_id: order_id, detail: { from_status: fromStatus, idempotent: true, demand_released: false }, result: 'ok', client_ip: clientIp, device });
        return { ok: true, data: { order_id, status: 'S6', demand_released: false, idempotent: true } };
      }
      return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    }

    await logStatus(order_id, fromStatus, 'S6', role === 'user' ? 'user_cancel' : 'partner_cancel', openid);

    // S1 阶段取消:条件释放需求(仅 matched→matching, 不覆盖已过期/取消的需求)
    let demandReleased = false;
    if (fromStatus === 'S1' && order.demand_id) {
      try {
        const dr = await col('demand').where({ _id: order.demand_id, status: 'matched' }).update({
          data: { status: 'matching', updated_at: now }
        });
        demandReleased = !!(dr.stats && dr.stats.updated === 1);
        log.d(`demand released: ${order.demand_id} → matching (released=${demandReleased})`);
      } catch (e) {}
    }

    log.d(`order cancelled: ${order.order_no} ${fromStatus}→S6 by=${role}`);
    writeNotice({
      to_openid: role === 'user' ? order.partner_openid : order.user_openid,
      order_id, type: 'cancel',
      title: '订单已取消',
      body: `${role === 'user' ? '发单人' : '耍伴'}取消了订单, 请查看详情`,
      action_key: 'jump_order', action_payload: { order_id }
    });
    await writeAudit(db, log, { openid, role, category: 'business', action: 'order_cancel', target_type: 'order', target_id: order_id, detail: { from_status: fromStatus, status: 'S6', demand_released: demandReleased, cancel_reason_type: String(reason || '').slice(0, 30) }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, status: 'S6', demand_released: demandReleased } };
  }

  // 开始履约:S2 → S3(耍伴发起)
  if (action === 'start_service') {
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    if (role !== 'partner') return { ok: false, code: 'oa_start_perm', msg: '仅耍伴可开始履约' };
    if (order.status !== 'S2') return { ok: false, code: 'oa_start_status', msg: `订单当前状态(${order.status})不可开始履约` };

    const now = Date.now();
    const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
    const device = String(event.device || '').slice(0, 200);
    // CAS S2→S3, 防重复开始
    const won = await casStatus(order_id, 'S2', {
      status: 'S3', service_started_at: now, updated_at: now,
      milestone: { current: 0, confirmed: [false, false, false], evidence: [], submitted_at: null }
    });
    if (!won) {
      const latest = await getOrder(order_id);
      if (latest && latest.status === 'S3') {
        await writeAudit(db, log, { openid, role, category: 'business', action: 'order_start_service', target_type: 'order', target_id: order_id, detail: { idempotent: true }, result: 'ok', client_ip: clientIp, device });
        return { ok: true, data: { order_id, status: 'S3', service_started_at: latest.service_started_at || now, idempotent: true } };
      }
      return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    }
    await logStatus(order_id, 'S2', 'S3', 'start_service', openid);
    log.d(`service started: ${order.order_no} S2→S3`);
    writeNotice({
      to_openid: order.user_openid, order_id, type: 'start',
      title: '耍伴已开始履约', body: `${order.partner_nickname || '耍伴'} 已到达服务地点, 履约开始`,
      action_key: 'jump_order', action_payload: { order_id }
    });
    await writeAudit(db, log, { openid, role, category: 'business', action: 'order_start_service', target_type: 'order', target_id: order_id, detail: { status: 'S3' }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, status: 'S3', service_started_at: now } };
  }

  // 完成履约:S3 → S5(耍伴发起)
  if (action === 'complete_service') {
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    if (role !== 'partner') return { ok: false, code: 'oa_complete_perm', msg: '仅耍伴可完成履约' };
    if (order.status !== 'S3') return { ok: false, code: 'oa_complete_status', msg: `订单当前状态(${order.status})不可完成履约` };

    // 里程碑校验:需提交到100%(current===3)才可完成履约
    const ms = order.milestone || { current: 0 };
    if (ms.current < 3) {
      return { ok: false, code: 'oa_milestone_required', msg: `请先提交履约进度到100%(当前${ms.current}/3)再完成履约` };
    }

    const now = Date.now();
    const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
    const device = String(event.device || '').slice(0, 200);
    // CAS S3→S5, 防重复完成
    const won = await casStatus(order_id, 'S3', {
      status: 'S5', service_completed_at: now, updated_at: now
    });
    if (!won) {
      const latest = await getOrder(order_id);
      if (latest && latest.status === 'S5') {
        await writeAudit(db, log, { openid, role, category: 'business', action: 'order_complete_service', target_type: 'order', target_id: order_id, detail: { idempotent: true }, result: 'ok', client_ip: clientIp, device });
        return { ok: true, data: { order_id, status: 'S5', service_completed_at: latest.service_completed_at || now, idempotent: true } };
      }
      return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    }
    await logStatus(order_id, 'S3', 'S5', 'complete_service', openid);
    log.d(`service completed: ${order.order_no} S3→S5`);
    writeNotice({
      to_openid: order.user_openid, order_id, type: 'finish',
      title: '履约已完成', body: '耍伴已完成全部履约, 请对服务进行评价',
      action_key: 'jump_evaluate', action_payload: { order_id }
    });
    await writeAudit(db, log, { openid, role, category: 'business', action: 'order_complete_service', target_type: 'order', target_id: order_id, detail: { status: 'S5', total_fen: Number(order.total_fen) || 0 }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, status: 'S5', service_completed_at: now } };
  }

  // ───────── 里程碑三段式:耍伴提交 30%→60%→100% ─────────
  // current: 0=待开始 1=30% 2=60% 3=100%待验收; complete_service 要求 current===3
  const MS_LABEL = { 1: '30%', 2: '60%', 3: '100%' };
  if (action === 'milestone_submit') {
    const { note, location } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    if (role !== 'partner') return { ok: false, code: 'oa_ms_perm', msg: '仅耍伴可提交履约进度' };
    if (order.status !== 'S3') return { ok: false, code: 'oa_ms_status', msg: `订单当前状态(${order.status})不可提交进度` };

    const ms = order.milestone || { current: 0, confirmed: [false, false, false], evidence: [] };
    if (ms.current >= 3) return { ok: false, code: 'oa_ms_done', msg: '履约进度已提交到100%,无需重复提交' };

    const next = ms.current + 1;
    // 进度说明内容安全(rules.md 六): 违规文本不入库
    if (note) {
      const chk = await checkText(openid, note);
      if (!chk.pass) return { ok: false, code: 'oa_text_unsafe', msg: chk.reason };
    }
    const evidence = Array.isArray(ms.evidence) ? ms.evidence : [];
    evidence.push({
      milestone: next,
      label: MS_LABEL[next],
      note: note || '',
      location: location || null,
      submitted_by: openid,
      submitted_at: Date.now()
    });

    // CAS: 仅当 milestone.current 仍是读取时的值才推进, 防并发双提/重复写证据
    const casRes = await col('order_main').where({
      _id: order_id, status: 'S3', 'milestone.current': ms.current
    }).update({
      data: {
        'milestone.current': next,
        'milestone.evidence': evidence,
        'milestone.submitted_at': Date.now(),
        updated_at: Date.now()
      }
    });
    if (!casRes.stats || casRes.stats.updated !== 1) {
      return { ok: false, code: 'oa_ms_conflict', msg: '进度状态已变化,请刷新后重试' };
    }
    const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
    const device = String(event.device || '').slice(0, 200);
    log.d(`milestone ${next}/3 submitted: ${order.order_no}`);
    writeNotice({
      to_openid: order.user_openid, order_id, type: 'milestone',
      title: `履约进度 ${MS_LABEL[next]}`, body: `耍伴提交了履约进度 ${MS_LABEL[next]}, 可在订单详情查看`,
      action_key: 'jump_order', action_payload: { order_id }
    });
    await writeAudit(db, log, { openid, role, category: 'business', action: 'order_milestone_submit', target_type: 'order', target_id: order_id, detail: { milestone: next, label: MS_LABEL[next] }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, milestone: next, label: MS_LABEL[next] } };
  }

  // 需求者确认里程碑(可手动确认;15分钟自动确认由 order-timer 处理)
  if (action === 'milestone_confirm') {
    const { milestone } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    if (![1, 2, 3].includes(milestone)) return { ok: false, code: 'oa_ms_invalid', msg: 'milestone 须为 1/2/3' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    if (role !== 'user') return { ok: false, code: 'oa_ms_confirm_perm', msg: '仅需求者可确认履约进度' };

    const ms = order.milestone || { current: 0, confirmed: [false, false, false] };
    if (ms.current < milestone) return { ok: false, code: 'oa_ms_not_submitted', msg: '该进度尚未提交' };

    // CAS: 数组对应位置原子置 true, 仅当当前值非 true(false/缺省)时命中, 防并发双确认且不同里程碑互不覆盖
    const idx = milestone - 1;
    const casCond = { _id: order_id };
    casCond[`milestone.confirmed.${idx}`] = _.neq(true);
    const casData = { updated_at: Date.now() };
    casData[`milestone.confirmed.${idx}`] = true;
    const casRes = await col('order_main').where(casCond).update({ data: casData });
    if (!casRes.stats || casRes.stats.updated !== 1) {
      return { ok: false, code: 'oa_ms_already_confirmed', msg: '该进度已确认,无需重复操作' };
    }
    const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
    const device = String(event.device || '').slice(0, 200);
    log.d(`milestone ${milestone} confirmed by user: ${order.order_no}`);
    await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_milestone_confirm', target_type: 'order', target_id: order_id, detail: { milestone, confirmed: true }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, milestone, confirmed: true } };
  }

  // ───────── P0 扩展:状态机补齐 ─────────

  // 改期业务常量(与小程序 config/index.js MODIFY/TIME_REDLINE 对齐; admin_config.modify_config 可覆盖)
  const MODIFY_DEFAULTS = { minLeadHours: 4, maxTimes: 2, maxSpanH: 72, confirmHours: 24 };
  // 时间红线: admin_config.time_redline_close_min / time_redline_open_min (分钟); 默认 24:00 关闭 06:00 恢复
  // close_min=0 语义为"全天开放"(午夜不关闭); open_min 必须 < close_min 才合法
  function redlineBounds(cfg) {
    const c = parseInt(cfg && cfg.time_redline_close_min, 10);
    const o = parseInt(cfg && cfg.time_redline_open_min, 10);
    const close = (c >= 0 && c <= 1440) ? c : 1440;     // 默认 1440=24:00
    const open  = (o >= 0 && o < close) ? o : 360;      // 默认 360=06:00; open 必须 < close
    return { open, close };
  }

  // 时间红线: close_min=0 语义为"全天开放"(任何时间都允许); 否则 mins ∈ [open, close) 合法
  // 东八区折算: 云函数运行时区为 UTC, new Date().getHours() 会少 8 小时, 统一按 UTC+8 计算
  const CN_OFFSET_MS = 8 * 3600 * 1000;
  function isModifyTimeAllowed(ts, cfg) {
    const { open, close } = redlineBounds(cfg);
    if (close === 0) return true;  // 全天开放(运营显式设 close_min=0)
    const d = new Date(ts + CN_OFFSET_MS);
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    return mins >= open && mins < close;
  }

  // 改期发起:S2 → S2_5(改期处理中, 等待对方确认; 超时由 order-timer 自动拒绝)
  // 口径(2026-10-07): 仅 S2(已支付待履约)可发起改期; S3 履约中/S3.5 中断均不可
  // 存量兼容: 原 S3 发起的在途 S2_5(from_status='S3')保留原回退分支, 由确认/拒绝/超时按原逻辑走完(不追溯)
  // 注意: 确认前不改写 start_time, 新时间暂存 pending_modify; modify_count 在确认通过时才消耗
  if (action === 'modify') {
    const { new_start_time, reason } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const newTs = Number(new_start_time);
    if (!newTs || newTs <= Date.now()) {
      return { ok: false, code: 'oa_modify_time_invalid', msg: '新时间必须是未来时间' };
    }
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    // 改期前置:仅已支付待履约(S2); S3/S3.5 不可改期(2026-10-07 收窄)
    if (order.status !== 'S2') {
      return { ok: false, code: 'oa_modify_status', msg: `订单当前状态(${order.status})不可改期` };
    }
    const config = await getConfig();
    const modifyConfig = Object.assign({}, MODIFY_DEFAULTS);
    try { Object.assign(modifyConfig, config.modify_config || {}); } catch (e) {}
    const currentModifyCount = Number(order.modify_count) || 0;
    if (currentModifyCount >= modifyConfig.maxTimes) {
      return { ok: false, code: 'oa_modify_exhausted', msg: `改期次数已用完(${modifyConfig.maxTimes}次)` };
    }
    // 提前量: 至少提前 4 小时
    if (newTs - Date.now() < modifyConfig.minLeadHours * 3600000) {
      return { ok: false, code: 'oa_modify_lead', msg: `须提前${modifyConfig.minLeadHours}小时申请改期` };
    }
    // 时间红线: 00:00-06:00 不可约
    if (!isModifyTimeAllowed(newTs, config)) {
      return { ok: false, code: 'oa_modify_redline', msg: '服务时间须在运营时段内' };
    }
    // 幅度上限 72h(相对原服务时间)
    const span = Math.abs(newTs - Number(order.start_time)) / 3600000;
    if (span > modifyConfig.maxSpanH) {
      return { ok: false, code: 'oa_modify_span', msg: `改期幅度超过上限(${modifyConfig.maxSpanH}小时)` };
    }

    const now = Date.now();
    const fromStatus = order.status;
    const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
    const device = String(event.device || '').slice(0, 200);
    // 改期理由内容安全(rules.md 六): 违规文本不入库
    if (reason) {
      const chk = await checkText(openid, reason);
      if (!chk.pass) return { ok: false, code: 'oa_text_unsafe', msg: chk.reason };
    }
    const won = await casStatus(order_id, 'S2', {
      status: 'S2_5',
      pending_modify: {
        from_status: fromStatus,
        new_start_time: newTs,
        reason: String(reason || '').slice(0, reasonMaxLen(config)),
        by_openid: openid,
        by_role: role,
        created_at: now,
        expire_at: now + modifyConfig.confirmHours * 3600000
      },
      modify_at: now,
      updated_at: now
    });
    if (!won) {
      const latest = await getOrder(order_id);
      if (latest && latest.status === 'S2_5' && latest.pending_modify && latest.pending_modify.by_openid === openid) {
        await writeAudit(db, log, { openid, role, category: 'business', action: 'order_modify_apply', target_type: 'order', target_id: order_id, detail: { status: 'S2_5', idempotent: true }, result: 'ok', client_ip: clientIp, device });
        return { ok: true, data: { order_id, status: 'S2_5', idempotent: true } };
      }
      return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    }
    await logStatus(order_id, fromStatus, 'S2_5', role === 'user' ? 'user_modify' : 'partner_modify', openid);
    log.d(`order modify: ${order.order_no} ${fromStatus}→S2_5 newStart=${newTs} expire=${modifyConfig.confirmHours}h`);
    writeNotice({
      to_openid: role === 'user' ? order.partner_openid : order.user_openid,
      order_id, type: 'modify',
      title: `${role === 'user' ? '发单人' : '耍伴'}发起改期`, body: `请在 ${modifyConfig.confirmHours} 小时内确认或拒绝`,
      action_key: 'jump_accept_modify', action_payload: { order_id }
    });
    await writeAudit(db, log, { openid, role, category: 'business', action: 'order_modify_apply', target_type: 'order', target_id: order_id, detail: { status: 'S2_5', new_start_time: newTs }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, status: 'S2_5', new_start_time: newTs } };
  }

  // 改期确认: 仅对方(非发起人)可操作, S2_5 → pending.from_status, 通过才改写 start_time/消耗次数
  if (action === 'modify_confirm' || action === 'modify_reject') {
      if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };

    const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
    const device = String(event.device || '').slice(0, 200);
    // 幂等: pending_modify 已消失且订单回到 S2/S3 → 按结果返回成功
    if (order.status === 'S2' || order.status === 'S3') {
      if (!order.pending_modify) {
        await writeAudit(db, log, { openid, role, category: action === 'modify_confirm' ? 'consent' : 'business', action: action === 'modify_confirm' ? 'order_modify_confirm' : 'order_modify_reject', target_type: 'order', target_id: order_id, detail: { status: order.status, idempotent: true }, result: 'ok', client_ip: clientIp, device });
        return { ok: true, data: { order_id, status: order.status, idempotent: true } };
      }
    }
    if (order.status !== 'S2_5' || !order.pending_modify) {
      return { ok: false, code: 'oa_modify_status', msg: '订单当前没有待确认的改期申请' };
    }
    const pending = order.pending_modify;
    if (pending.by_openid === openid) {
      return { ok: false, code: 'oa_modify_self', msg: '只能由对方确认或拒绝改期' };
    }
    const toStatus = pending.from_status === 'S3' ? 'S3' : 'S2';
    const now = Date.now();

    if (action === 'modify_reject') {
      const won = await casStatus(order_id, 'S2_5', {
        status: toStatus,
        pending_modify: _.remove(),
        modify_rejected_at: now,
        modify_rejected_by: openid,
        updated_at: now
      });
      if (!won) return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
      await logStatus(order_id, 'S2_5', toStatus, role === 'user' ? 'user_modify_reject' : 'partner_modify_reject', openid);
      log.d(`modify rejected: ${order.order_no} S2_5→${toStatus} by=${role}`);
      await writeNotice({
        to_openid: pending.by_openid, order_id, type: 'modify_reject',
        title: '改期已被拒绝', body: `${role === 'user' ? '发单人' : '耍伴'}拒绝了你的改期申请`,
        action_key: 'jump_order', action_payload: { order_id }
      });
      await writeAudit(db, log, { openid, role, category: 'business', action: 'order_modify_reject', target_type: 'order', target_id: order_id, detail: { status: toStatus, modify_rejected: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: toStatus, modify_rejected: true } };
    }

    // 确认前再兜底校验: 新时间仍合法(未来/提前量/红线)
    const config = await getConfig();
    const modifyConfig = Object.assign({}, MODIFY_DEFAULTS);
    try { Object.assign(modifyConfig, config.modify_config || {}); } catch (e) {}
    if (!pending.new_start_time || pending.new_start_time <= now) {
      return { ok: false, code: 'oa_modify_expired', msg: '改期时间已过期,请重新发起' };
    }
    if (!isModifyTimeAllowed(pending.new_start_time, config)) {
      return { ok: false, code: 'oa_modify_redline', msg: '服务时间不在运营时段内' };
    }
    const won = await casStatus(order_id, 'S2_5', {
      status: toStatus,
      start_time: pending.new_start_time,
      modify_count: (Number(order.modify_count) || 0) + 1,
      pending_modify: _.remove(),
      modify_confirmed_at: now,
      modify_confirmed_by: openid,
      updated_at: now
    });
    if (!won) return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    // 改期生效: 重置四项确认(8 确认位清零, 与 S1 update_item 同口径; value 保留)
    // 目的: start_time 已变更, 双方需重新确认新时间; 确认位仅在 S1 四确认流程消费, 不影响 S2 履约流转
    try {
      const conf = await getConfirmation(order_id);
      if (conf && conf.items) {
        const resetPatch = { version: (Number(conf.version) || 1) + 1, updated_at: now };
        for (const f of CONFIRM_FIELDS) {
          resetPatch['items.' + f + '.user_ok'] = false;
          resetPatch['items.' + f + '.partner_ok'] = false;
        }
        await col('order_confirmations').doc(conf._id).update({ data: resetPatch });
        log.d(`modify confirmed: confirmations reset ok ${order.order_no}`);
      }
    } catch (e) { log.d(`modify_confirm reset confirmations fail: ${e.message}`); }
    await logStatus(order_id, 'S2_5', toStatus, role === 'user' ? 'user_modify_confirm' : 'partner_modify_confirm', openid);
    log.d(`modify confirmed: ${order.order_no} S2_5→${toStatus} newStart=${pending.new_start_time} by=${role}`);
    await writeNotice({
      to_openid: pending.by_openid, order_id, type: 'modify_confirm',
      title: '改期已确认', body: `新时间已生效, 订单状态回到${toStatus === 'S3' ? '履约中' : '待履约'}`,
      action_key: 'jump_order', action_payload: { order_id }
    });
    await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_modify_confirm', target_type: 'order', target_id: order_id, detail: { status: toStatus, start_time: pending.new_start_time }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, status: toStatus, start_time: pending.new_start_time, modify_confirmed: true } };
  }

  // ───────── 加时申请: S3 履约中发起, 对方确认后金额+时长合并进订单 ─────────
  // 算价: add_amount_fen = Math.round(total_fen / duration_h × add_hours)
  if (action === 'extend') {
    const { add_hours, reason } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };

    const addHours = Number(add_hours);
    if (!Number.isInteger(addHours) || addHours <= 0 || addHours > 12) {
      return { ok: false, code: 'oa_extend_hours', msg: '加时时长须为 1-12 小时整数' };
    }
    if (order.status !== 'S3') {
      return { ok: false, code: 'oa_extend_status', msg: `订单当前状态(${order.status})不可申请加时` };
    }
    if (order.pending_extend) {
      return { ok: false, code: 'oa_extend_exist', msg: '已有待确认的加时申请,请等待对方处理' };
    }

    // 算价: 时薪按原单价折算; 一口价(fixed)加时不加价 → add_amount_fen=0
    const isFixedExtend = order.pricing_type === 'fixed';
    const durationH = Number(order.duration_h) || 1;
    const totalFen = Number(order.total_fen) || 0;
    const addAmountFen = isFixedExtend ? 0 : Math.round(totalFen / durationH * addHours);
    if (addAmountFen <= 0 && !isFixedExtend) {
      return { ok: false, code: 'oa_extend_price', msg: '加时金额计算异常,请联系客服' };
    }

    const config = await getConfig();
    const now = Date.now();
    const confirmHours = (config.modify_config && config.modify_config.confirmHours) || 24;
    const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
    const device = String(event.device || '').slice(0, 200);
    // 加时理由内容安全(rules.md 六): 违规文本不入库
    if (reason) {
      const chk = await checkText(openid, reason);
      if (!chk.pass) return { ok: false, code: 'oa_text_unsafe', msg: chk.reason };
    }

    const won = await casStatus(order_id, 'S3', {
      pending_extend: {
        add_hours: addHours,
        add_amount_fen: addAmountFen,
        reason: String(reason || '').slice(0, reasonMaxLen(config)),
        by_openid: openid,
        by_role: role,
        created_at: now,
        expire_at: now + confirmHours * 3600000
      },
      extend_count: (Number(order.extend_count) || 0) + 1,
      updated_at: now
    });
    if (!won) {
      const latest = await getOrder(order_id);
      if (latest && latest.pending_extend && latest.pending_extend.by_openid === openid) {
        await writeAudit(db, log, { openid, role, category: 'business', action: 'order_extend_apply', target_type: 'order', target_id: order_id, detail: { idempotent: true, add_amount_fen: addAmountFen }, result: 'ok', client_ip: clientIp, device });
        return { ok: true, data: { order_id, add_amount_fen: addAmountFen, idempotent: true } };
      }
      return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    }
    await logStatus(order_id, 'S3', 'S3', role === 'user' ? 'user_extend' : 'partner_extend', openid);
    log.d(`order extend: ${order.order_no} +${addHours}h addFen=${addAmountFen}`);
    writeNotice({
      to_openid: role === 'user' ? order.partner_openid : order.user_openid,
      order_id, type: 'custom',
      title: `${role === 'user' ? '发单人' : '耍伴'}申请加时 ${addHours} 小时`,
      body: isFixedExtend
        ? `一口价订单不加价, 延长 ${addHours} 小时, 请在 ${confirmHours} 小时内确认或拒绝`
        : `加时金额 ¥${(addAmountFen / 100).toFixed(2)}, 请在 ${confirmHours} 小时内确认或拒绝`,
      action_key: 'jump_order', action_payload: { order_id }
    });
    await writeAudit(db, log, { openid, role, category: 'business', action: 'order_extend_apply', target_type: 'order', target_id: order_id, detail: { add_hours: addHours, add_amount_fen: addAmountFen }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, add_hours: addHours, add_amount_fen: addAmountFen } };
  }

  // 加时确认/拒绝: 仅对方(非发起人)可操作
  if (action === 'extend_confirm' || action === 'extend_reject') {
      if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };

    if (!order.pending_extend) {
      return { ok: false, code: 'oa_extend_no_pending', msg: '订单当前没有待确认的加时申请' };
    }
    const pending = order.pending_extend;
    if (pending.by_openid === openid) {
      return { ok: false, code: 'oa_extend_self', msg: '只能由对方确认或拒绝加时' };
    }
    const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
    const device = String(event.device || '').slice(0, 200);

    if (action === 'extend_reject') {
      const won = await casStatus(order_id, 'S3', {
        pending_extend: _.remove(),
        extend_rejected_at: Date.now(),
        extend_rejected_by: openid,
        updated_at: Date.now()
      });
      if (!won) return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
      await logStatus(order_id, 'S3', 'S3', role === 'user' ? 'user_extend_reject' : 'partner_extend_reject', openid);
      await writeNotice({
        to_openid: pending.by_openid, order_id, type: 'extend_reject',
        title: '加时申请已被拒绝',
        body: `${role === 'user' ? '发单人' : '耍伴'}拒绝了你的加时申请`,
        action_key: 'jump_order', action_payload: { order_id }
      });
      await writeAudit(db, log, { openid, role, category: 'business', action: 'order_extend_reject', target_type: 'order', target_id: order_id, detail: { extend_rejected: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, extend_rejected: true } };
    }

    // 确认: 更新金额+时长+抽成, 清 pending_extend
    const addFen = Number(pending.add_amount_fen) || 0;
    const addH = Number(pending.add_hours) || 0;
    const isFixedConfirm = order.pricing_type === 'fixed';
    const newTotalFen = (Number(order.total_fen) || 0) + addFen;
    const newDurationH = (Number(order.duration_h) || 0) + addH;
    // 一口价加时不加价: 总金额未变, 不重算分账, 沿用原抽成/收入
    const { feeFen: newFeeFen, partnerIncomeFen: newPartnerIncomeFen } = isFixedConfirm
      ? { feeFen: order.fee_fen, partnerIncomeFen: order.partner_income_fen }
      : splitOrderAmount(newTotalFen, (await getConfig()).platform_fee_rate_fen);

    const won = await casStatus(order_id, 'S3', {
      duration_h: newDurationH,
      total_fen: newTotalFen,
      fee_fen: newFeeFen,
      partner_income_fen: newPartnerIncomeFen,
      pending_extend: _.remove(),
      extend_confirmed_at: Date.now(),
      extend_confirmed_by: openid,
      updated_at: Date.now()
    });
    if (!won) return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    await logStatus(order_id, 'S3', 'S3', role === 'user' ? 'user_extend_confirm' : 'partner_extend_confirm', openid);
    log.d(`order extend confirmed: ${order.order_no} +${addH}h addFen=${addFen} totalFen=${newTotalFen}`);
    await writeNotice({
      to_openid: pending.by_openid, order_id, type: 'extend_confirm',
      title: '加时申请已确认',
      body: isFixedConfirm
        ? `一口价不加价, 服务时长延长至 ${newDurationH} 小时`
        : `服务时长延长至 ${newDurationH} 小时, 加时金额 ¥${(addFen / 100).toFixed(2)} 已合并进结算`,
      action_key: 'jump_order', action_payload: { order_id }
    });
    await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_extend_confirm', target_type: 'order', target_id: order_id, detail: { duration_h: newDurationH, total_fen: newTotalFen, add_amount_fen: addFen }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, duration_h: newDurationH, total_fen: newTotalFen, add_amount_fen: addFen } };
  }


  // 恢复履约:S3.5 → S3(双向确认, 任一方发起即可)
  if (action === 'resume_service') {
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    if (order.status !== 'S3.5') {
      return { ok: false, code: 'oa_resume_status', msg: `订单当前状态(${order.status})不可恢复履约` };
    }
    const now = Date.now();
    const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
    const device = String(event.device || '').slice(0, 200);
    const won = await casStatus(order_id, 'S3.5', {
      status: 'S3', resumed_at: now, resumed_by: openid, updated_at: now
    });
    if (!won) {
      const latest = await getOrder(order_id);
      if (latest && latest.status === 'S3') {
        await writeAudit(db, log, { openid, role, category: 'business', action: 'order_resume_service', target_type: 'order', target_id: order_id, detail: { status: 'S3', idempotent: true }, result: 'ok', client_ip: clientIp, device });
        return { ok: true, data: { order_id, status: 'S3', idempotent: true } };
      }
      return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    }
    await logStatus(order_id, 'S3.5', 'S3', role === 'user' ? 'user_resume' : 'partner_resume', openid);
    log.d(`order resume: ${order.order_no} S3.5→S3`);
    writeNotice({
      to_openid: role === 'user' ? order.partner_openid : order.user_openid,
      order_id, type: 'resume',
      title: '履约已恢复', body: `${role === 'user' ? '发单人' : '耍伴'}恢复了履约, 可继续服务`,
      action_key: 'jump_order', action_payload: { order_id }
    });
    await writeAudit(db, log, { openid, role, category: 'business', action: 'order_resume_service', target_type: 'order', target_id: order_id, detail: { status: 'S3' }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, status: 'S3' } };
  }

  // 转部分完成:S3.5 → S4(双向确认, 任一方发起即可)
  if (action === 'partial_confirm') {
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    if (order.status !== 'S3.5') {
      return { ok: false, code: 'oa_partial_status', msg: `订单当前状态(${order.status})不可转部分完成` };
    }
    const now = Date.now();
    const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
    const device = String(event.device || '').slice(0, 200);
    const won = await casStatus(order_id, 'S3.5', {
      status: 'S4', partial_confirmed_at: now, partial_confirmed_by: openid, updated_at: now
    });
    if (!won) {
      const latest = await getOrder(order_id);
      if (latest && latest.status === 'S4') {
        await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_partial_confirm', target_type: 'order', target_id: order_id, detail: { status: 'S4', idempotent: true }, result: 'ok', client_ip: clientIp, device });
        return { ok: true, data: { order_id, status: 'S4', idempotent: true } };
      }
      return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    }
    await logStatus(order_id, 'S3.5', 'S4', role === 'user' ? 'user_partial_confirm' : 'partner_partial_confirm', openid);
    // 通知对方
    const other = role === 'user' ? order.partner_openid : order.user_openid;
    writeNotice({
      to_openid: other,
      order_id,
      type: 'partial_confirm',
      title: role === 'user' ? '耍伴已确认部分完成' : '发单人已确认部分完成',
      body: '请双方协商确认比例',
      action_key: 'jump_order',
      action_payload: { order_id }
    });
    log.d(`order partial confirm: ${order.order_no} S3.5→S4`);
    await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_partial_confirm', target_type: 'order', target_id: order_id, detail: { status: 'S4' }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, status: 'S4' } };
  }

  // 比例确认:S4 → S5(一般用户确认, 也允许耍伴确认)
  if (action === 'ratio_confirm') {
    const { ratio } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    if (order.status !== 'S4') {
      return { ok: false, code: 'oa_ratio_status', msg: `订单当前状态(${order.status})不可确认比例` };
    }
    // ratio 口径: 仅收 0-100 的整数百分比(如 50=50%), 消除 1 被误解释为 100% 的歧义
    let ratioFen = 100;   // 不传默认 100% 全额
    if (ratio !== undefined && ratio !== null && ratio !== '') {
      const r = Number(ratio);
      if (!Number.isInteger(r) || r < 0 || r > 100) {
        return { ok: false, code: 'oa_ratio_invalid', msg: '比例须为 0-100 的整数(百分比, 如 50 表示 50%)' };
      }
      ratioFen = r;
    }
    const now = Date.now();
    const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
    const device = String(event.device || '').slice(0, 200);
    const won = await casStatus(order_id, 'S4', {
      status: 'S5',
      ratio_confirmed_at: now,
      ratio_confirmed_by: openid,
      ratio_fen: ratioFen,
      updated_at: now
    });
    if (!won) {
      const latest = await getOrder(order_id);
      if (latest && latest.status === 'S5') {
        await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_ratio_confirm', target_type: 'order', target_id: order_id, detail: { status: 'S5', ratio_fen: latest.ratio_fen || ratioFen, idempotent: true }, result: 'ok', client_ip: clientIp, device });
        return { ok: true, data: { order_id, status: 'S5', ratio_fen: latest.ratio_fen || ratioFen, idempotent: true } };
      }
      return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    }
    await logStatus(order_id, 'S4', 'S5', role === 'user' ? 'user_ratio_confirm' : 'partner_ratio_confirm', openid);
    // 通知对方
    const other2 = role === 'user' ? order.partner_openid : order.user_openid;
    writeNotice({
      to_openid: other2,
      order_id,
      type: 'ratio_confirm',
      title: role === 'user' ? '耍伴已确认结算比例' : '发单人已确认结算比例',
      body: `比例 ${ratioFen}% · 订单进入待评价`,
      action_key: 'jump_order',
      action_payload: { order_id }
    });
    log.d(`order ratio confirm: ${order.order_no} S4→S5 ratio=${ratioFen}%`);
    await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_ratio_confirm', target_type: 'order', target_id: order_id, detail: { status: 'S5', ratio_fen: ratioFen }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, status: 'S5', ratio_fen: ratioFen } };
  }

  // 发起争议:S5/S8/S9 → S10.5(售后窗口内, 双方可发起)
  if (action === 'complaint') {
    const { reason } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    if (!['S5', 'S8', 'S9'].includes(order.status)) {
      return { ok: false, code: 'oa_complaint_status', msg: `订单当前状态(${order.status})不可发起争议` };
    }
    const now = Date.now();
    const fromStatus = order.status;
    const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
    const device = String(event.device || '').slice(0, 200);
    // 投诉理由内容安全(rules.md 六): 违规文本不发争议单
    if (reason) {
      const chk = await checkText(openid, reason);
      if (!chk.pass) return { ok: false, code: 'oa_text_unsafe', msg: chk.reason };
    }
    const won = await casStatus(order_id, ['S5', 'S8', 'S9'], {
      status: 'S10.5',
      help_flag: true,
      complaint_at: now,
      complaint_by: openid,
      complaint_reason: reason || '',
      updated_at: now
    });
    if (!won) {
      const latest = await getOrder(order_id);
      if (latest && latest.status === 'S10.5') {
        await writeAudit(db, log, { openid, role, category: 'business', action: 'order_complaint_open', target_type: 'order', target_id: order_id, detail: { status: 'S10.5', idempotent: true }, result: 'ok', client_ip: clientIp, device });
        return { ok: true, data: { order_id, status: 'S10.5', idempotent: true } };
      }
      return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    }
    await logStatus(order_id, fromStatus, 'S10.5', role === 'user' ? 'user_complaint' : 'partner_complaint', openid);

    // 写 complaint 集合(仲裁跟踪用)
    try {
      await col('complaint').add({ data: {
        order_id, order_no: order.order_no,
        initiator_openid: openid, initiator_role: role,
        target_openid: role === 'user' ? order.partner_openid : order.user_openid,
        reason: reason || '',
        status: 'pending',   // pending → processing → resolved/rejected
        created_at: now, updated_at: now, is_deleted: false
      }});
    } catch (e) {
      log.d(`complaint record fail: ${e.message}`);   // 不阻断状态流转
    }

    log.d(`complaint filed: ${order.order_no} ${fromStatus}→S10.5 by=${role}`);
    // 订单沟通同步: 通知对端"对方发起投诉"
    writeNotice({
      to_openid: role === 'user' ? order.partner_openid : order.user_openid,
      order_id, type: 'complaint',
      title: '对方发起投诉',
      body: `${role === 'user' ? '发单人' : '耍伴'}已发起投诉/争议,平台将介入处理`,
      action_key: 'jump_order', action_payload: { order_id }
    });
    await writeAudit(db, log, { openid, role, category: 'business', action: 'order_complaint_open', target_type: 'order', target_id: order_id, detail: { from_status: fromStatus, status: 'S10.5', reason_type: String(reason || '').slice(0, 20) }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, status: 'S10.5' } };
  }

  // ───────── 订单详情(全字段 + 四确认状态 + 评价, 仅参与方可读) ─────────
  if (action === 'detail') {
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };

    const SCENE_NAME = { W1: '就医陪诊', W2: '学习陪伴', W3: '健身陪伴', W4: '游玩陪伴', W7: '情绪陪伴', W8: '生活协助', W9: '宠物陪伴', W10: '出行陪伴', W11: '线上陪伴' };

    // 并行:6 个独立查询(确认单 + 评价 + 双昵称 + sos + checkin)合并为 1 批, 冷启动压到 2s 内
    const [conf, evR, uR, pR, sosR, ckR] = await Promise.all([
      getConfirmation(order_id),
      col('evaluation').where({ order_id, is_deleted: false }).limit(1).get().catch(() => ({ data: [] })),
      col('user_account').where({ openid: order.user_openid }).limit(1).get().catch(() => ({ data: [] })),
      col('user_account').where({ openid: order.partner_openid }).limit(1).get().catch(() => ({ data: [] })),
      col('safety_report').where({ order_id, type: 'sos', status: 'active', is_deleted: false }).orderBy('created_at', 'desc').limit(1).get().catch(() => ({ data: [] })),
      col('safety_report').where({ order_id, type: 'checkin', is_deleted: false }).orderBy('created_at', 'desc').limit(3).get().catch(() => ({ data: [] }))
    ]);

    // 确认单
    let confirm = null;
    if (conf) {
      const fields = {};
      let confirmedCount = 0;
      for (const f of CONFIRM_FIELDS) {
        const it = conf.items[f] || {};
        if (it.user_ok) confirmedCount++;
        if (it.partner_ok) confirmedCount++;
        fields[f] = { value: it.value, user_ok: !!it.user_ok, partner_ok: !!it.partner_ok };
      }
      confirm = { items: fields, confirmed_count: confirmedCount, total_count: 8, all_confirmed: allConfirmed(conf.items), version: conf.version || 1 };
    }

    // 评价
    let evaluation = null;
    if (evR.data && evR.data[0]) {
      evaluation = { star: evR.data[0].star, content: evR.data[0].content || '' };
    }

    // 昵称
    let userNickname = '发单人', partnerNickname = '耍伴';
    if (uR.data && uR.data[0] && uR.data[0].nickname) userNickname = uR.data[0].nickname;
    if (pR.data && pR.data[0] && pR.data[0].nickname) partnerNickname = pR.data[0].nickname;

    // 联系信息(过渡版, 2026-10-09): 接单方且订单已支付后 → 展示对方脱敏号;
    // 代发单展示两条: 需求发布者 + 被代发人(关系); 普通单仅发布者。真实号一律不外传; 拨打为占位(二期接号码保护)。
    let contactDisplay = null;
    if (role === 'partner' && order.demand_id
      && ['S2', 'S3', 'S3.5', 'S4', 'S5', 'S8', 'S9'].indexOf(order.status) >= 0) {
      try {
        const dmR = await col('demand').doc(order.demand_id).get();
        const dm = dmR && dmR.data;
        if (dm) {
          const items = [];
          const ownerMasked = maskContact(dm.contact_phone);
          if (ownerMasked) items.push({ who: '需求发布者', masked: ownerMasked });
          const isProxy = dm.publish_type === 'proxy' && dm.service_target;
          if (isProxy) {
            const proxyMasked = maskContact(dm.service_target.phone || dm.service_target.phone_mask);
            if (proxyMasked) items.push({ who: `被代发人（${dm.service_target.relation || '亲友'}）`, masked: proxyMasked });
          }
          if (items.length) {
            contactDisplay = {
              items,
              note: '号码保护中，暂不支持直接拨打；可先通过「联系用户」聊天沟通'
            };
          }
        }
      } catch (e) { log.d(`contact display fail: ${e.message}`); }
    }

    // safety
    const safety = { help_flag: !!order.help_flag, active_sos: null, checkins: [] };
    const activeSos = sosR.data && sosR.data[0];
    if (activeSos) safety.active_sos = { reporter_role: activeSos.reporter_role || '', created_at: activeSos.created_at || null };
    safety.checkins = (ckR.data || []).map(r => ({
      reporter_role: r.reporter_role || '', created_at: r.created_at || null, location: r.location || null
    }));

    return {
      ok: true,
      data: {
        order_id,
        order_no: order.order_no,
        demand_no: order.demand_no || '',
        scene: order.scene,
        scene_name: SCENE_NAME[order.scene] || order.scene,
        content_options: order.content_options || [],
        location: order.location || null,
        start_time: order.start_time,
        duration_h: order.duration_h,
        total_fen: order.total_fen,
        fee_fen: order.fee_fen,
        partner_income_fen: order.partner_income_fen,
        tip_total_fen: order.tip_total_fen || 0,
        aa_tier: order.aa_tier || '',
        status: order.status,
        role,
        contact_display: contactDisplay,
        pay_expire_at: order.pay_expire_at || null,
        service_started_at: order.service_started_at || null,
        service_completed_at: order.service_completed_at || null,
        evaluated_at: order.evaluated_at || null,
        created_at: order.created_at || null,
        confirm,
        evaluation,
        safety,
        user_nickname: userNickname,
        partner_nickname: partnerNickname,
        milestone: order.milestone || null,
        modify_count: Number(order.modify_count) || 0,
        pending_modify: order.pending_modify || null,
        pending_extend: order.pending_extend || null,
        order_summary: buildOrderSummary(order)
      }
    };
  }

  // ───────── 我的订单列表(耍伴视角含相邻订单通勤; 发单人视角额外聚合"待接单需求") ─────────
  if (action === 'my_orders') {
    const role = event.role === 'user' ? 'user' : 'partner';
    const queryField = role === 'partner' ? 'partner_openid' : 'user_openid';
    const SCENE_NAME = { W1: '就医陪诊', W2: '学习陪伴', W3: '健身陪伴', W4: '游玩陪伴', W7: '情绪陪伴', W8: '生活协助', W9: '宠物陪伴', W10: '出行陪伴', W11: '线上陪伴' };

    // tab 过滤(与前端 TAB_STATUS 同口径; 云端字面量一律点号 S3.5/S10.5/S2.5)
    const FILTER_STATUS = {
      pay: ['S0'],
      doing: ['S1', 'S2', 'S2.5', 'S3', 'S3.5'],
      eval: ['S5'],
      after: ['S6', 'S7', 'S9', 'S10', 'S10.5']
    };
    const filter = (['all', 'pay', 'doing', 'eval', 'after'].indexOf(event.filter) >= 0) ? event.filter : 'all';
    // 分页: 倒序(created_at desc), 每页最多 50
    const page = Math.max(1, Number(event.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(event.page_size) || 20));

    const where = { [queryField]: openid, is_deleted: false };
    if (filter !== 'all') where.status = _.in(FILTER_STATUS[filter]);

    let orders = [];
    try {
      const r = await col('order_main').where(where)
        .orderBy('created_at', 'desc')
        .skip((page - 1) * pageSize).limit(pageSize).get();
      orders = r.data || [];
    } catch (e) {
      log.d(`my_orders query fail: ${e.message}`);
      return { ok: false, code: 'oa_list_fail', msg: '订单查询失败' };
    }

    // 发单人视角: 订单在耍伴接单后才生成, 已发布但仍待接单(matching)的需求需一并展示
    let pendingDemands = [];
    if (role === 'user') {
      try {
        const dr = await col('demand').where({
          creator_openid: openid, status: 'matching', is_deleted: false
        }).orderBy('created_at', 'desc').limit(20).get();
        pendingDemands = (dr.data || []).map((d) => ({
          item_type: 'demand',
          order_id: d._id,
          demand_id: d._id,
          order_no: d.demand_no,
          scene: d.scene,
          scene_name: SCENE_NAME[d.scene] || d.scene,
          content_options: d.content_options || (d.content_option ? [d.content_option] : []),
          location_name: (d.location && d.location.name) || '',
          location_lat: (d.location && d.location.latitude) || null,
          location_lng: (d.location && d.location.longitude) || null,
          start_time: d.start_time,
          duration_h: d.duration_h,
          total_fen: d.total_fen,
          status: 'PENDING',   // 前端映射为"待接单"
          commute: null,
          order_summary: buildOrderSummary({
            order_no: d.demand_no, scene: d.scene, content_options: d.content_options || (d.content_option ? [d.content_option] : []),
            total_fen: d.total_fen, duration_h: d.duration_h, headcount: d.headcount,
            created_at: d.created_at, start_time: d.start_time, location: d.location || null, aa_tier: d.aa_tier
          })
        }));
      } catch (e) {
        log.d(`my_orders pending demands query fail: ${e.message}`);
      }
    }

    const ACTIVE_STATUS = ['S0', 'S1', 'S2', 'S3', 'S3.5'];

    const orderItems = orders.map((o, idx) => {
      const item = {
        item_type: 'order',
        order_id: o._id,
        order_no: o.order_no,
        scene: o.scene,
        scene_name: SCENE_NAME[o.scene] || o.scene,
        content_options: o.content_options || [],
        location_name: (o.location && o.location.name) || '',
        location_lat: (o.location && o.location.latitude) || null,
        location_lng: (o.location && o.location.longitude) || null,
        start_time: o.start_time,
        duration_h: o.duration_h,
        end_time: o.start_time + (o.duration_h || 1) * 3600 * 1000,
        total_fen: o.total_fen,
        status: o.status,
        // 改期待确认红点: 订单处于 S2.5 且改期发起人不是当前查看者
        need_confirm: o.status === 'S2.5' && !!(o.pending_modify && o.pending_modify.by_openid !== openid),
        commute: null,
        order_summary: buildOrderSummary(o)
      };

      // 计算到下一单的通勤(当前单结束 → 下一单开始)
      const next = orders[idx + 1];
      if (next && o.location && next.location &&
          o.location.latitude && next.location.latitude) {
        const km = haversineKm(
          o.location.latitude, o.location.longitude,
          next.location.latitude, next.location.longitude
        );
        const est = estimateCommute(km);
        const gapMin = Math.round((next.start_time - item.end_time) / 60000);
        // 预警:间隔时间小于最快通勤方式(驾车)所需时间
        const tight = gapMin < est.drive_min;
        item.commute = {
          to_location: (next.location && next.location.name) || '',
          gap_min: gapMin,
          distance_km: est.distance_km,
          walk_min: est.walk_min,
          bike_min: est.bike_min,
          bus_min: est.bus_min,
          drive_min: est.drive_min,
          tight
        };
      }
      return item;
    });

    // PENDING 待接单需求: 仅 user+all+第一页 置顶拼接(不参与分页计数)
    const list = (pendingDemands.length && filter === 'all' && page === 1)
      ? [...pendingDemands, ...orderItems]
      : orderItems;
    return { ok: true, data: { role, list, page, page_size: pageSize, has_more: orders.length === pageSize } };
  }

  // ───────── my_counts: 订单四宫格计数 ─────────
  // 按 role(user/partner) 返回对应视角计数
  if (action === 'my_counts') {
    const role = event.role === 'partner' ? 'partner' : 'user';
    const openidField = role === 'partner' ? 'partner_openid' : 'user_openid';
    const COL = col('order_main');
    // 6 次独立 count 合并为 1 批, 冷启动压到 1s 内
    const [pay, doing, eval, afterSale] = await Promise.all([
      // 待支付 S0 只属于 user 视角(partner 看不到)
      COL.where({ user_openid: openid, status: 'S0', is_deleted: false }).count().catch(() => ({ total: 0 })),
      // 进行中
      COL.where({ [openidField]: openid, status: _.in(['S1','S2','S2_5','S3','S3.5']), is_deleted: false }).count().catch(() => ({ total: 0 })),
      // 待评价
      COL.where({ [openidField]: openid, status: 'S5', is_deleted: false }).count().catch(() => ({ total: 0 })),
      // 售后(双方都能看)
      COL.where({
        $or: [{ user_openid: openid }, { partner_openid: openid }],
        status: _.in(['S6','S7','S9','S10','S10.5']),
        is_deleted: false
      }).count().catch(() => ({ total: 0 }))
    ]);
    return { ok: true, data: {
      role,
      pending_pay: pay.total || 0,
      in_progress: doing.total || 0,
      pending_eval: eval.total || 0,
      after_sales: afterSale.total || 0
    }};
  }

  // ───────── 通知:列表 ─────────
  if (action === 'notice_list') {
    const limit = Math.min(Number(event.limit) || 50, 100);
    const skip = Number(event.skip) || 0;
    const list = await col('system_notice')
      .where({ to_openid: openid })
      .orderBy('created_at', 'desc')
      .skip(skip)
      .limit(limit)
      .get();
    // 未读数
    const unread = await col('system_notice').where({ to_openid: openid, read: false }).count();
    // 订单概要(所有订单类通知前置统一概要): 批量关联 order_main
    const orderIds = Array.from(new Set((list.data || []).map((n) => n.order_id).filter(Boolean)));
    const orderMap = {};
    if (orderIds.length) {
      try {
        const orders = await col('order_main').where({ _id: _.in(orderIds) }).limit(100).get();
        (orders.data || []).forEach((o) => { orderMap[o._id] = o; });
      } catch (e) { log.d('notice order join fail:', e.message); }
    }
    const decorated = (list.data || []).map((n) => Object.assign({}, n, {
      order_summary: n.order_id ? buildOrderSummary(orderMap[n.order_id]) : ''
    }));
    return { ok: true, data: { list: decorated, unread: unread.total } };
  }

  // ───────── 通知:轻量轮询(订单详情页停留时检测新到账通知, 如被打赏) ─────────
  if (action === 'notice_poll') {
    if (!/^[a-f0-9]{32}$/i.test(String(event.order_id || ''))) {
      return { ok: false, code: 'oa_bad_order', msg: '缺少有效订单 ID' };
    }
    // 该订单全部未读通知(limit 20, 倒序); 多次打赏会依次追加, 由前端去重递增展示
    const r = await col('system_notice').where({ to_openid: openid, order_id: event.order_id, read: false })
      .orderBy('created_at', 'desc').limit(20).get().catch(() => ({ data: [] }));
    const list = (r.data || []).map((n) => ({ id: n._id, type: n.type || '', title: n.title || '', body: n.body || '', created_at: n.created_at || 0 }));
    return { ok: true, data: { has_new: list.length > 0, list } };
  }

  // ───────── 通知:标记已读(单条或全部) ─────────
  if (action === 'notice_read') {
    if (event.notice_id) {
      // 归属校验: 仅本人通知可标记; 不匹配静默 ok(防他人枚举 notice_id)
      const r = await col('system_notice').where({ _id: event.notice_id, to_openid: openid, read: false })
        .update({ data: { read: true, read_at: Date.now() } });
      return { ok: true, data: { updated: (r.stats && r.stats.updated) || 0 } };
    }
    // 批量标记: not_empty
    await col('system_notice').where({ to_openid: openid, read: false })
      .update({ data: { read: true, read_at: Date.now() } });
    return { ok: true };
  }

  // 用户催促耍伴 (S2/S3 状态下, 用户发给耍伴)
  if (action === 'nudge_partner') {
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    if (order.user_openid !== openid) return { ok: false, code: 'oa_not_owner', msg: '仅用户可催促' };
    if (!['S2', 'S3'].includes(order.status)) {
      return { ok: false, code: 'oa_nudge_status', msg: `当前状态(${order.status})不可催促` };
    }
    // 简单频控: 同一用户 10 分钟内只能催促同一张订单 1 次
    const recent = await col('system_notice').where({
      to_openid: order.partner_openid, order_id, type: 'nudge',
      created_at: _.gte(Date.now() - 10 * 60 * 1000)
    }).count().catch(() => ({ total: 0 }));
    if (recent.total > 0) {
      return { ok: false, code: 'oa_nudge_too_frequent', msg: '10分钟内只能催促一次' };
    }
    writeNotice({
      to_openid: order.partner_openid, order_id, type: 'nudge',
      title: '📢 用户催促履约',
      body: '发单人提醒你按时履约, 请尽快处理',
      action_key: 'jump_order',
      action_payload: { order_id }
    });
    return { ok: true };
  }

  // ───────── 爽约申诉(第三批 3B): 提交受理 / 被诉方举证 / 订单内查询 ─────────
  // 判定模型(设计稿 §2.1): 平台不自动判定"人到没到", 一切处罚必经「提交→举证→管理员裁定」。
  // 幂等/上限: 同订单单方上限 no_show_max_per_order(默认 1, N6); 处罚幂等键 order_id+target_openid(裁定侧)。
  if (action === 'no_show_report_submit') {
    const { reason, reason_type, evidence_file_ids } = event;
    const order = await getOrder(order_id);
    const config = await getConfig();
    const cfg = noShowCfg(config);
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    const gate = canSubmitReport(order, Date.now(), cfg);   // N1: 仅 S2/S3.5 + 开始时间已过 + 时限内
    if (!gate.ok) return { ok: false, code: gate.code, msg: gate.msg };
    const reasonText = String(reason || '').trim();
    if (!reasonText) return { ok: false, code: 'no_show_no_reason', msg: '请填写申诉说明' };
    if (reasonText.length < cfg.reasonMinLen) {
      return { ok: false, code: 'no_show_reason_short', msg: `申诉说明至少 ${cfg.reasonMinLen} 字` };
    }
    // 内容安全(rules.md 六): 违规文本不落库
    const chk = await checkText(openid, reasonText, config.block_words);
    if (!chk.pass) return { ok: false, code: 'oa_text_unsafe', msg: chk.reason };
    // 证据照片(可选; 上限后台可配)
    const files = Array.isArray(evidence_file_ids)
      ? evidence_file_ids.filter((f) => typeof f === 'string' && f).slice(0, cfg.evidenceMax)
      : [];
    // N6: 同订单单方申诉上限
    const mine = await col('no_show_report').where({
      order_id, reporter_openid: openid, is_deleted: _.neq(true)
    }).count().catch(() => ({ total: 0 }));
    if ((mine.total || 0) >= cfg.maxPerOrder) {
      return { ok: false, code: 'no_show_report_limit', msg: `同一订单最多提交 ${cfg.maxPerOrder} 条申诉` };
    }
    const target = role === 'user' ? order.partner_openid : order.user_openid;
    if (!target) return { ok: false, code: 'no_show_no_target', msg: '订单缺少对方账号信息' };
    const now = Date.now();
    const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
    const device = String(event.device || '').slice(0, 200);
    const doc = {
      order_id, order_no: order.order_no || '',
      reporter_openid: openid, reporter_role: role,
      target_openid: target, target_role: role === 'user' ? 'partner' : 'user',
      reason_type: String(reason_type || '').trim().slice(0, 20),   // 原因选项(未出现/迟到超30分钟/中途离开/其他)
      reason: reasonText, evidence_file_ids: files,
      status: REPORT_STATUS.RECEIVED,
      evidence_deadline: defenseDeadlineOf(now, cfg),
      created_at: now, updated_at: now, is_deleted: false
    };
    let reportId = '';
    try {
      const addRes = await col('no_show_report').add({ data: doc });
      reportId = (addRes && addRes._id) || '';
    } catch (e) {
      log.d(`no_show_report add fail: ${e.message}`);
      return { ok: false, code: 'no_show_submit_fail', msg: '提交失败,请稍后重试' };
    }
    // 通知被诉方举证(N 动态取配置; fire-and-forget 反模式已规避: 显式 await)
    await writeNotice({
      to_openid: target, order_id, type: 'no_show_report',
      title: '对方提交了爽约申诉',
      body: `请在 ${cfg.defenseWindowH} 小时内提交举证`,
      action_key: 'jump_order', action_payload: { order_id, report_id: reportId }
    });
    await writeAudit(db, log, {
      openid, role, category: 'business', action: 'no_show_report_submit',
      target_type: 'no_show_report', target_id: reportId,
      detail: { order_no: order.order_no || '', target_role: doc.target_role, files: files.length },
      result: 'ok', client_ip: clientIp, device
    });
    return { ok: true, data: { report_id: reportId, status: REPORT_STATUS.RECEIVED, evidence_deadline: doc.evidence_deadline } };
  }

  if (action === 'no_show_report_defense') {
    const { report_id, defense_reason, defense_file_ids } = event;
    if (!report_id || !isValidDocId(report_id)) return { ok: false, code: 'no_show_bad_report', msg: '申诉记录 ID 格式不正确' };
    let report = null;
    try { report = (await col('no_show_report').doc(report_id).get()).data; } catch (e) { report = null; }
    if (!report || report.is_deleted) return { ok: false, code: 'no_show_report_missing', msg: '申诉记录不存在' };
    if (report.target_openid !== openid) return { ok: false, code: 'no_show_not_target', msg: '仅被诉方可提交举证' };
    if (report.status === REPORT_STATUS.DECIDED) {
      return { ok: false, code: 'no_show_already_decided', msg: '平台已裁定,不可再补充举证' };
    }
    const config = await getConfig();
    const cfg = noShowCfg(config);
    const text = String(defense_reason || '').trim();
    if (!text) return { ok: false, code: 'no_show_no_defense', msg: '请填写举证说明' };
    const chk = await checkText(openid, text, config.block_words);
    if (!chk.pass) return { ok: false, code: 'oa_text_unsafe', msg: chk.reason };
    const files = Array.isArray(defense_file_ids)
      ? defense_file_ids.filter((f) => typeof f === 'string' && f).slice(0, cfg.evidenceMax)
      : [];
    const now = Date.now();
    // N2: 逾期不自动关闭; 逾期后仍允许提交, 标记 overdue 供管理端参考
    const overdue = now > (Number(report.evidence_deadline) || 0);
    const up = await col('no_show_report').where({
      _id: report_id, status: _.in([REPORT_STATUS.RECEIVED, REPORT_STATUS.DEFENSE])
    }).update({ data: {
      defense_reason: text, defense_file_ids: files,
      status: REPORT_STATUS.DEFENSE, defense_at: now, defense_overdue: overdue, updated_at: now
    }});
    if (!up.stats || up.stats.updated < 1) {
      const latest = await col('no_show_report').doc(report_id).get().catch(() => ({ data: null }));
      if (latest && latest.data && latest.data.status === REPORT_STATUS.DECIDED) {
        return { ok: false, code: 'no_show_already_decided', msg: '平台已裁定,不可再补充举证' };
      }
      return { ok: false, code: 'no_show_defense_conflict', msg: '状态已变化,请刷新后重试' };
    }
    const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
    const device = String(event.device || '').slice(0, 200);
    await writeNotice({
      to_openid: report.reporter_openid, order_id: report.order_id, type: 'no_show_defense',
      title: '对方已提交举证', body: '等待平台裁定',
      action_key: 'jump_order', action_payload: { order_id: report.order_id, report_id }
    });
    await writeAudit(db, log, {
      openid, role: 'partner', category: 'business', action: 'no_show_report_defense',
      target_type: 'no_show_report', target_id: report_id,
      detail: { order_no: report.order_no || '', overdue, files: files.length },
      result: 'ok', client_ip: clientIp, device
    });
    return { ok: true, data: { status: REPORT_STATUS.DEFENSE, overdue } };
  }

  // 撤回申诉(N8 于 2026-10-10 由「一期不做」变更为「做」): 仅申诉人本人, 裁定前(received/defense)可撤
  // 口径: 撤回占 N6 配额(不写 is_deleted → 同单同人不可再提交); 通知被诉方时复用 no_show_report type
  //       覆盖正文(writeNotice 去重键含 type, 复用可避免出现「已提交+已撤回」两条未读)
  if (action === 'no_show_report_withdraw') {
    const { report_id } = event;
    if (!report_id || !isValidDocId(report_id)) return { ok: false, code: 'no_show_bad_report', msg: '申诉记录 ID 格式不正确' };
    let report = null;
    try { report = (await col('no_show_report').doc(report_id).get()).data; } catch (e) { report = null; }
    if (!report || report.is_deleted) return { ok: false, code: 'no_show_report_missing', msg: '申诉记录不存在' };
    if (report.reporter_openid !== openid) return { ok: false, code: 'no_show_not_reporter', msg: '仅申诉人可撤回申诉' };
    // 幂等前置: 已撤回直接成功(重复点击/网络重试)
    if (report.status === REPORT_STATUS.WITHDRAWN) {
      return { ok: true, data: { status: REPORT_STATUS.WITHDRAWN, withdrawn_at: report.withdrawn_at || 0, idempotent: true } };
    }
    if (report.status === REPORT_STATUS.DECIDED) {
      return { ok: false, code: 'no_show_already_decided', msg: '平台已裁定,不可撤回申诉' };
    }
    if (!canWithdrawReport(report.status, true)) {
      return { ok: false, code: 'no_show_withdraw_not_allowed', msg: '当前状态不可撤回申诉' };
    }
    const now = Date.now();
    // CAS: 仅当仍为 received/defense 时置 withdrawn(与举证/裁定并发互斥)
    const up = await col('no_show_report').where({
      _id: report_id, status: _.in([REPORT_STATUS.RECEIVED, REPORT_STATUS.DEFENSE])
    }).update({ data: {
      status: REPORT_STATUS.WITHDRAWN, withdrawn_at: now, withdrawn_by: openid, updated_at: now
    }});
    if (!up.stats || up.stats.updated < 1) {
      const latest = await col('no_show_report').doc(report_id).get().catch(() => ({ data: null }));
      const st = latest && latest.data && latest.data.status;
      if (st === REPORT_STATUS.WITHDRAWN) {
        return { ok: true, data: { status: REPORT_STATUS.WITHDRAWN, withdrawn_at: (latest.data.withdrawn_at || 0), idempotent: true } };
      }
      if (st === REPORT_STATUS.DECIDED) {
        return { ok: false, code: 'no_show_already_decided', msg: '平台已裁定,不可撤回申诉' };
      }
      return { ok: false, code: 'no_show_withdraw_conflict', msg: '状态已变化,请刷新后重试' };
    }
    const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
    const device = String(event.device || '').slice(0, 200);
    await writeNotice({
      to_openid: report.target_openid, order_id: report.order_id, type: 'no_show_report',
      title: '对方已撤回爽约申诉',
      body: '该申诉已撤回, 无需再提交举证',
      action_key: 'jump_order', action_payload: { order_id: report.order_id, report_id }
    });
    await writeAudit(db, log, {
      openid, role: report.reporter_role || '', category: 'business', action: 'no_show_report_withdraw',
      target_type: 'no_show_report', target_id: report_id,
      detail: { order_no: report.order_no || '', prev_status: report.status || '' },
      result: 'ok', client_ip: clientIp, device
    });
    return { ok: true, data: { status: REPORT_STATUS.WITHDRAWN, withdrawn_at: now } };
  }

  if (action === 'no_show_report_detail') {
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    const r = await col('no_show_report')
      .where({ order_id, is_deleted: _.neq(true) })
      .orderBy('created_at', 'desc').limit(10).get().catch(() => ({ data: [] }));
    const list = (r.data || []).map((x) => {
      const iAmReporter = x.reporter_openid === openid;
      return {
        report_id: x._id,
        my_role: iAmReporter ? 'reporter' : 'target',
        reporter_role: x.reporter_role || '',
        status: x.status || '',
        verdict: x.verdict || '',
        // 被诉方需看到申诉理由/证据才能举证; 双方均可见对方已提交的内容(裁定公开口径)
        reason_type: x.reason_type || '',
        reason: x.reason || '',
        evidence_file_ids: x.evidence_file_ids || [],
        defense_reason: x.defense_reason || '',
        defense_file_ids: x.defense_file_ids || [],
        evidence_deadline: x.evidence_deadline || 0,
        defense_overdue: x.defense_overdue === true,
        decided_at: x.decided_at || 0,
        withdrawn_at: x.withdrawn_at || 0,
        created_at: x.created_at || 0,
        // 被诉方视角: 仅 received/defense 可提交/补充举证(已裁定/已撤回均不可)
        can_defense: !iAmReporter && x.status !== REPORT_STATUS.DECIDED && x.status !== REPORT_STATUS.WITHDRAWN,
        // 申诉人视角: 裁定前可撤回(纯规则同源 _shared/no_show_rules.canWithdrawReport)
        can_withdraw: canWithdrawReport(x.status, iAmReporter)
      };
    });
    return { ok: true, data: { list } };
  }

  return { ok: false, code: 'oa_unknown_action', msg: '未知动作' };
};

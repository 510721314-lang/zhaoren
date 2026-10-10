// 对应 PRD 章节：3.3 四确认机制 / 3.5 订单交易系统 / 附录G 状态机 / 8.3 超时规则 / 1.7.1 青少年保护
// order-action 订单动作(四确认 + 取消 + 状态机扩展) · 身份取自 getWXContext().OPENID
// 28 个 action: get_confirmation / update_item / confirm_item / confirm_all /
//              cancel / start_service / complete_service / milestone_submit / milestone_confirm /
//              modify / modify_confirm / modify_reject /
//              extend / extend_confirm / extend_reject /
//              resume_service / partial_confirm / ratio_confirm / complaint / complaint_withdraw /
//              no_show_report_submit / no_show_report_defense / no_show_report_withdraw / no_show_report_detail /
//              detail / my_orders / my_counts / nudge_partner
// 爽约申诉(第三批 3B): 用户/耍伴提交申诉 → 被诉方举证 → 管理员裁定(admin-action no_show_decide);
//   订单状态机不因申诉改变; 数值全部后台可配(no_show_* 9 键), 规则纯函数见 ./no_show_rules
//   撤回申诉(2026-10-10, N8 由「一期不做」变更为「做」): 仅申诉人本人、裁定前可撤, 撤回占 N6 配额
// 撤回投诉(2026-10-10): 仅投诉发起人、平台受理前(订单仍 S10.5)可撤, 撤回后订单回退投诉前状态(S5/S8/S9)
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
// Wave1 状态机单源(规范源 _shared/order_state.js, 修改后跑 sync-order-state.ps1): CAS 语义收敛
const { casTransition } = require('./order_state');
// Wave2 止血⑥: S2 履约催办纯规则(规范源 _shared/urge_rules.js, 修改后跑 sync-urge-rules.ps1)
const { canManualUrge } = require('./urge_rules');

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
// 语义收敛至 _shared/order_state.js 的 casTransition(规范源); 本处仅注入本地 col/_/log。
async function casStatus(orderId, expect, patch) {
  return casTransition(col, _, orderId, expect, patch, { onError: (e) => log.d(`casStatus fail: ${e.message}`) });
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

// Wave2 止血⑤(冻结位): 争议/申诉处理期间订单冻结, 禁止推进类操作(start/modify/complete/evaluate),
// 防止单方在申诉期推进状态破坏申诉资格前提(诊断 D9)。frozen 为 Wave1 落地的正交位。
function isFrozen(order) {
  return !!(order && (order.frozen === true || (order.dispute_state && order.dispute_state === 'open')));
}

// 8 个确认位是否全部完成
function allConfirmed(items) {
  for (const f of CONFIRM_FIELDS) {
    const it = items[f];
    if (!it || !it.user_ok || !it.partner_ok) return false;
  }
  return true;
}

// Wave2 止血⑥: 催办提醒订阅发送（手动催办由小程序端触发 → 云调用有效；失败/未授权/未配模板一律降级，不阻断）
async function sendUrgeSub(order, config, now, used) {
  const tmpl = (config && config.sub_msg_templates && config.sub_msg_templates.demand_urge) || null;
  if (!tmpl || !tmpl.tmpl_id) return;                       // 未配模板 → 静默降级
  const p = order.partner_openid;
  if (!p) return;
  let authorized = false;                                    // 耍伴需已授权 demand_urge
  try {
    const pr = await col('partner_profile').where({ openid: p }).limit(1).get();
    const prof = (pr.data && pr.data[0]) || {};
    authorized = !!(prof.sub_msgs && prof.sub_msgs.demand_urge && prof.sub_msgs.demand_urge.authorized === true);
  } catch (e) { return; }
  if (!authorized) return;
  const fields = Object.assign({ thing4: 'urge_content', time3: 'urge_time' },
    (tmpl.fields && typeof tmpl.fields === 'object') ? tmpl.fields : {});
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const d = new Date(now);
  const tstr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const data = {};
  for (const kw of Object.keys(fields)) {
    const s = fields[kw];
    let v = '';
    if (s === 'urge_content') v = `用户催办履约 第${used}次`;
    else if (s === 'urge_time') v = tstr;
    else if (typeof s === 'string') v = String(s);
    if (v) data[kw] = { value: String(v).slice(0, 20) };
  }
  if (!Object.keys(data).length) return;
  await cloud.openapi.subscribeMessage.send({
    touser: p, templateId: tmpl.tmpl_id, page: tmpl.page || 'pages-v2/order-detail/order-detail',
    data, miniprogramState: tmpl.miniprogram_state || 'formal'
  });
}

// ── action 分发表：已物理抽到同级 action_*.js 的 handler 在此注册，ctx 注入共享符号 ──
// 新增分组：require 后 Object.assign 进 HANDLERS；handler 签名 (ctx)=>result，禁止反向 require('./index')。
const HANDLERS = Object.assign(
  {},
  require('./action_nudge'),
  require('./action_query'),
  require('./action_confirm'),
  require('./action_lifecycle'),
  require('./action_modify_extend'),
  require('./action_dispute')
);

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
  const ORDER_ID_ACTIONS = ['get_confirmation', 'update_item', 'confirm_item', 'confirm_all', 'cancel', 'start_service', 'complete_service', 'detail', 'modify', 'modify_confirm', 'modify_reject', 'extend', 'extend_confirm', 'extend_reject', 'resume_service', 'partial_confirm', 'ratio_confirm', 'complaint', 'complaint_withdraw', 'nudge_partner', 'no_show_report_submit', 'no_show_report_detail'];
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

  // 已抽离到 action_*.js 的动作优先走分发表（ctx 注入共享符号，行为与原内联逐字一致）
  if (HANDLERS[action]) {
    const ctx = {
      event, openid, order_id, action, wxCtx,
      col, db, _, log, cloud,
      getConfig, getOrder, writeNotice, getConfirmation, logStatus, casStatus,
      roleOf, isFrozen, allConfirmed, sendUrgeSub, buildOrderSummary,
      fmtDT, fmtDTShort, isValidDocId, maskContact, reasonMaxLen, estimateCommute, checkText,
      canManualUrge, casTransition, noShowCfg, canSubmitReport, defenseDeadlineOf, canWithdrawReport, REPORT_STATUS,
      haversineKm, splitOrderAmount, writeAudit,
      CONFIRM_FIELDS, FIELD_CN, SCENE_CN, BLOCK_WORDS_FALLBACK
    };
    return await HANDLERS[action](ctx);
  }

  // （get_confirmation/update_item/confirm_item/confirm_all 已抽离到 ./action_confirm.js，由上方 HANDLERS 分发表处理）

  // （cancel/start_service/complete_service/milestone_* 已抽离到 ./action_lifecycle.js）

  // （改期/加时/比例 helpers + modify*/extend*/partial_confirm/ratio_confirm 已抽离到 ./action_modify_extend.js）

  // （complaint*/no_show_report_* 已抽离到 ./action_dispute.js，由上方 HANDLERS 分发表处理）

  return { ok: false, code: 'oa_unknown_action', msg: '未知动作' };
};
